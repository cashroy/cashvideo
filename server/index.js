import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, cleanExpiredSessions } from './db.js';
import { auth, admin, clearSession, createSession, hashPin, publicUser, verifyPin } from './auth.js';
import { normalizeJellyfinUrl, proxyJellyfinMedia, resolveJellyfinPlayback, verifyJellyfin } from './jellyfin.js';
import { catalogue, recommendations, search, tmdb, normalize } from './tmdb.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store'); next(); });

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validPin = (value) => typeof value === 'string' && /^\d{4}$/.test(value);
const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(value);
const failedLogins = new Map();
const loginWindowMs = 15 * 60 * 1000;
const templateKeys = { movie: 'playback_movie_template', tv: 'playback_tv_template' };
const jellyfinKeys = { url: 'jellyfin_url', apiKey: 'jellyfin_api_key' };

function loginKey(req) {
  return `${req.ip}:${String(req.body.username || '').trim().toLowerCase()}`;
}

function recordFailedLogin(key) {
  const now = Date.now();
  if (failedLogins.size >= 1000) {
    for (const [savedKey, value] of failedLogins) if (value.resetAt <= now) failedLogins.delete(savedKey);
    if (failedLogins.size >= 1000 && !failedLogins.has(key)) failedLogins.delete(failedLogins.keys().next().value);
  }
  const previous = failedLogins.get(key);
  const attempts = previous && previous.resetAt > now ? previous.attempts + 1 : 1;
  failedLogins.set(key, { attempts, resetAt: now + loginWindowMs });
}

function validPlaybackTemplate(value) {
  if (value === '') return true;
  const placeholders = [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (!placeholders.some((key) => ['id', 'show', 'title'].includes(key)) || placeholders.some((key) => !['id', 'show', 'title', 'type', 'season', 'episode'].includes(key))) return false;
  try {
    const parsed = new URL(value.replace(/\{[^}]+\}/g, 'sample'));
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function setting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
}

function saveSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

function playbackProvider() {
  const saved = setting('playback_provider');
  if (['jellyfin', 'custom'].includes(saved)) return saved;
  return setting(templateKeys.movie) || setting(templateKeys.tv) ? 'custom' : 'jellyfin';
}

function jellyfinConfig() {
  const baseUrl = setting(jellyfinKeys.url);
  const apiKey = setting(jellyfinKeys.apiKey);
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/bootstrap', (_req, res) => res.json({ needsSetup: db.prepare('SELECT COUNT(*) count FROM users').get().count === 0 }));

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (db.prepare('SELECT COUNT(*) count FROM users').get().count !== 0) return res.status(409).json({ error: 'CashVideo is already set up.' });
  const { username, pin, displayName } = req.body;
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, dashes, or underscores.' });
  if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
  const pinHash = await hashPin(pin);
  let transactionOpen = false;
  let result;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    if (db.prepare('SELECT COUNT(*) count FROM users').get().count !== 0) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'CashVideo is already set up.' });
    }
    result = db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,'admin',?)").run(username.trim(), pinHash, String(displayName || username).trim().slice(0, 60));
    db.exec('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK');
    throw error;
  }
  createSession(res, Number(result.lastInsertRowid));
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const key = loginKey(req);
  const failures = failedLogins.get(key);
  if (failures?.attempts >= 5 && failures.resetAt > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username || '');
  if (!validPin(req.body.pin) || !user || !(await verifyPin(req.body.pin, user.password_hash))) {
    recordFailedLogin(key);
    return res.status(401).json({ error: 'Incorrect username or PIN.' });
  }
  failedLogins.delete(key);
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));
app.post('/api/auth/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.patch('/api/me', auth, (req, res) => {
  const displayName = String(req.body.displayName || '').trim().slice(0, 60);
  const age = req.body.age === '' || req.body.age == null ? null : Number(req.body.age);
  const avatar = String(req.body.avatar || 'violet').slice(0, 20);
  if (!displayName || (age !== null && (!Number.isInteger(age) || age < 1 || age > 120))) return res.status(400).json({ error: 'Enter a valid name and age.' });
  db.prepare('UPDATE users SET display_name=?,age=?,avatar=? WHERE id=?').run(displayName, age, avatar, req.user.id);
  res.json({ ok: true });
});
app.patch('/api/me/pin', auth, asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!validPin(req.body.currentPin) || !(await verifyPin(req.body.currentPin, row.password_hash))) return res.status(400).json({ error: 'Current PIN is incorrect.' });
  if (!validPin(req.body.newPin)) return res.status(400).json({ error: 'New PIN must be exactly 4 digits.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPin(req.body.newPin), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  createSession(res, req.user.id);
  res.json({ ok: true });
}));
app.delete('/api/me', auth, (req, res) => {
  if (req.user.role === 'admin' && db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get().count === 1) return res.status(400).json({ error: 'Create another administrator before deleting the only admin.' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
  clearSession(req, res);
  res.json({ ok: true });
});

app.get('/api/catalogue', auth, asyncRoute(async (req, res) => {
  const [trending, popular] = await Promise.all([catalogue('trending'), catalogue('popular')]);
  const continued = db.prepare('SELECT * FROM progress WHERE user_id=? AND completed=0 AND position>0 ORDER BY updated_at DESC LIMIT 20').all(req.user.id);
  const watchlist = db.prepare('SELECT * FROM watchlist WHERE user_id=? ORDER BY added_at DESC').all(req.user.id);
  let recommended = [];
  const recent = db.prepare('SELECT media_id,media_type FROM progress WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').get(req.user.id);
  if (recent) recommended = await recommendations(recent.media_type, recent.media_id);
  if (!recommended.length) recommended = trending.slice().sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  res.json({ trending, popular, recommended, continued, watchlist, configured: Boolean(db.prepare("SELECT value FROM settings WHERE key='tmdb_token'").get()?.value) });
}));

app.get('/api/search', auth, asyncRoute(async (req, res) => res.json({ results: await search(String(req.query.q || '').slice(0, 100)) })));
app.get('/api/media/:type/:id', auth, asyncRoute(async (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  const data = await tmdb(`/${req.params.type}/${req.params.id}`, { append_to_response: 'videos,credits,similar' });
  const source = db.prepare('SELECT source_url FROM media_sources WHERE media_id=? AND media_type=?').get(req.params.id, req.params.type);
  const progressState = db.prepare('SELECT position,duration,completed,season,episode,updated_at FROM progress WHERE user_id=? AND media_id=? AND media_type=?').get(req.user.id, req.params.id, req.params.type) || null;
  const provider = playbackProvider();
  const playbackTemplate = provider === 'custom' ? setting(templateKeys[req.params.type]) : '';
  const playbackState = { playback_provider: provider, jellyfin_configured: Boolean(jellyfinConfig()) };
  if (!data) {
    const fallback = (await catalogue()).find((item) => item.id === Number(req.params.id) && item.media_type === req.params.type);
    if (!fallback) return res.status(404).json({ error: 'Title not found.' });
    return res.json({ item: { ...fallback, source_url: source?.source_url || null, playback_template: playbackTemplate || null, progress: progressState, ...playbackState } });
  }
  res.json({ item: { ...normalize(data, req.params.type), cast: data.credits?.cast?.slice(0, 8) || [], similar: data.similar?.results?.slice(0, 12).map((item) => normalize(item, req.params.type)) || [], source_url: source?.source_url || null, playback_template: playbackTemplate || null, progress: progressState, ...playbackState } });
}));

app.get('/api/playback/:type/:id', auth, asyncRoute(async (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  if (playbackProvider() !== 'jellyfin') return res.status(400).json({ error: 'Jellyfin is not the active playback provider.' });
  const config = jellyfinConfig();
  if (!config) return res.status(400).json({ error: 'An administrator needs to connect Jellyfin first.' });
  const season = Number(req.query.season ?? 1);
  const episode = Number(req.query.episode ?? 1);
  if (req.params.type === 'tv' && (![season, episode].every(Number.isInteger) || season < 1 || episode < 1 || season > 9999 || episode > 9999)) return res.status(400).json({ error: 'Season and episode must be positive whole numbers.' });
  const data = await tmdb(`/${req.params.type}/${req.params.id}`);
  const fallback = data ? null : (await catalogue()).find((item) => item.id === Number(req.params.id) && item.media_type === req.params.type);
  const title = data?.title || data?.name || fallback?.title || '';
  try {
    const playback = await resolveJellyfinPlayback(config, { type: req.params.type, tmdbId: req.params.id, title, season, episode });
    res.json(playback);
  } catch (error) {
    if (/not in|rejected|did not return|request failed/i.test(error.message)) return res.status(404).json({ error: error.message });
    throw error;
  }
}));

app.get('/api/jellyfin/stream', auth, asyncRoute(async (req, res) => {
  const config = jellyfinConfig();
  if (!config || playbackProvider() !== 'jellyfin') return res.status(404).json({ error: 'Jellyfin playback is not configured.' });
  await proxyJellyfinMedia(req, res, config);
}));

app.put('/api/watchlist/:type/:id', auth, (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  db.prepare('INSERT OR REPLACE INTO watchlist(user_id,media_id,media_type,title,poster_path,added_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').run(req.user.id, Number(req.params.id), req.params.type, String(req.body.title || 'Untitled').slice(0, 200), req.body.posterPath || null);
  res.json({ saved: true });
});
app.delete('/api/watchlist/:type/:id', auth, (req, res) => { db.prepare('DELETE FROM watchlist WHERE user_id=? AND media_id=? AND media_type=?').run(req.user.id, Number(req.params.id), req.params.type); res.json({ saved: false }); });
app.put('/api/progress/:type/:id', auth, (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  const rawPosition = Number(req.body.position) || 0;
  const rawDuration = Number(req.body.duration) || 0;
  const position = Number.isFinite(rawPosition) && rawPosition >= 0 ? rawPosition : 0;
  const duration = Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : 0;
  const season = req.params.type === 'tv' ? Number(req.body.season ?? 1) : null;
  const episode = req.params.type === 'tv' ? Number(req.body.episode ?? 1) : null;
  if (req.params.type === 'tv' && (![season, episode].every(Number.isInteger) || season < 1 || episode < 1 || season > 9999 || episode > 9999)) return res.status(400).json({ error: 'Season and episode must be positive whole numbers.' });
  const completed = Boolean(req.body.completed || (duration > 0 && position / duration >= 0.92));
  db.prepare(`INSERT INTO progress(user_id,media_id,media_type,title,poster_path,position,duration,completed,season,episode,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,media_id,media_type) DO UPDATE SET title=excluded.title,poster_path=excluded.poster_path,position=excluded.position,duration=excluded.duration,completed=excluded.completed,season=excluded.season,episode=excluded.episode,updated_at=CURRENT_TIMESTAMP`).run(req.user.id, Number(req.params.id), req.params.type, String(req.body.title || 'Untitled').slice(0, 200), req.body.posterPath || null, position, duration, completed ? 1 : 0, season, episode);
  res.json({ ok: true });
});

app.get('/api/admin', auth, admin, (_req, res) => {
  const users = db.prepare('SELECT id,username,role,display_name,age,avatar,created_at FROM users ORDER BY created_at').all();
  const sources = db.prepare('SELECT * FROM media_sources ORDER BY title').all();
  const token = db.prepare("SELECT value FROM settings WHERE key='tmdb_token'").get()?.value || '';
  const jellyfinApiKey = setting(jellyfinKeys.apiKey);
  res.json({ users, sources, tmdbConfigured: Boolean(token), tmdbHint: token ? `${token.slice(0, 4)}••••${token.slice(-4)}` : '', playbackProvider: playbackProvider(), jellyfinUrl: setting(jellyfinKeys.url), jellyfinConfigured: Boolean(jellyfinConfig()), jellyfinHint: jellyfinApiKey ? `${jellyfinApiKey.slice(0, 4)}••••${jellyfinApiKey.slice(-4)}` : '', movieTemplate: setting(templateKeys.movie), tvTemplate: setting(templateKeys.tv) });
});
app.put('/api/admin/settings', auth, admin, asyncRoute(async (req, res) => {
  if (Object.hasOwn(req.body, 'tmdbToken')) {
    const token = String(req.body.tmdbToken || '').trim();
    if (token) {
    const isV4 = token.includes('.') || token.length > 40;
    const url = new URL('https://api.themoviedb.org/3/configuration');
    if (!isV4) url.searchParams.set('api_key', token);
    const response = await fetch(url, { headers: isV4 ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(400).json({ error: 'TMDB could not verify that API key.' });
    }
    saveSetting('tmdb_token', token);
  }
  if (Object.hasOwn(req.body, 'movieTemplate') || Object.hasOwn(req.body, 'tvTemplate')) {
    const movieTemplate = Object.hasOwn(req.body, 'movieTemplate') ? String(req.body.movieTemplate || '').trim() : setting(templateKeys.movie);
    const tvTemplate = Object.hasOwn(req.body, 'tvTemplate') ? String(req.body.tvTemplate || '').trim() : setting(templateKeys.tv);
    if (!validPlaybackTemplate(movieTemplate) || !validPlaybackTemplate(tvTemplate)) return res.status(400).json({ error: 'Each playback template must be an HTTP(S) URL containing {id}, {show}, or {title}.' });
    if (Object.hasOwn(req.body, 'movieTemplate')) saveSetting(templateKeys.movie, movieTemplate);
    if (Object.hasOwn(req.body, 'tvTemplate')) saveSetting(templateKeys.tv, tvTemplate);
  }
  if (Object.hasOwn(req.body, 'playbackProvider')) {
    if (!['jellyfin', 'custom'].includes(req.body.playbackProvider)) return res.status(400).json({ error: 'Choose Jellyfin or custom embed playback.' });
    saveSetting('playback_provider', req.body.playbackProvider);
  }
  if (Object.hasOwn(req.body, 'jellyfinUrl') || Object.hasOwn(req.body, 'jellyfinApiKey')) {
    const rawUrl = Object.hasOwn(req.body, 'jellyfinUrl') ? String(req.body.jellyfinUrl || '').trim() : setting(jellyfinKeys.url);
    const apiKey = String(req.body.jellyfinApiKey || '').trim() || setting(jellyfinKeys.apiKey);
    if (!rawUrl) {
      saveSetting(jellyfinKeys.url, '');
      saveSetting(jellyfinKeys.apiKey, '');
    } else {
      let baseUrl;
      try { baseUrl = normalizeJellyfinUrl(rawUrl); } catch (error) { return res.status(400).json({ error: error.message }); }
      if (!apiKey) return res.status(400).json({ error: 'Enter a Jellyfin API key.' });
      try { await verifyJellyfin(baseUrl, apiKey); } catch (error) { return res.status(400).json({ error: error.message }); }
      saveSetting(jellyfinKeys.url, baseUrl);
      saveSetting(jellyfinKeys.apiKey, apiKey);
    }
  }
  res.json({ ok: true });
}));
app.post('/api/admin/users', auth, admin, asyncRoute(async (req, res) => {
  const { username, pin, displayName, role = 'user' } = req.body;
  if (!validUsername(username) || !validPin(pin) || !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Enter a valid username, 4-digit PIN, and role.' });
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)').run(username.trim(), await hashPin(pin), role, String(displayName || username).trim().slice(0, 60));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'That username is already in use.' });
    throw error;
  }
}));
app.delete('/api/admin/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Delete your own account from profile settings.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});
app.put('/api/admin/sources/:type/:id', auth, admin, (req, res) => {
  const sourceUrl = String(req.body.sourceUrl || '').trim();
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id) || !/^https?:\/\//i.test(sourceUrl)) return res.status(400).json({ error: 'Enter a valid title and HTTP(S) media URL.' });
  db.prepare('INSERT OR REPLACE INTO media_sources(media_id,media_type,title,source_url) VALUES(?,?,?,?)').run(Number(req.params.id), req.params.type, String(req.body.title || 'Untitled').slice(0, 200), sourceUrl);
  res.json({ ok: true });
});
app.delete('/api/admin/sources/:type/:id', auth, admin, (req, res) => { db.prepare('DELETE FROM media_sources WHERE media_id=? AND media_type=?').run(Number(req.params.id), req.params.type); res.json({ ok: true }); });

app.use('/assets', express.static(path.join(root, 'dist/assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(path.join(root, 'dist'), { setHeaders: (res, filePath) => { if (path.basename(filePath) === 'index.html') res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*splat', (req, res, next) => { if (req.path.startsWith('/api')) return next(); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(root, 'dist/index.html')); });
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message?.startsWith('TMDB') ? error.message : 'Something went wrong.' });
});

cleanExpiredSessions();
setInterval(cleanExpiredSessions, 6 * 60 * 60 * 1000).unref();

if (process.env.NODE_ENV !== 'test') app.listen(port, '0.0.0.0', () => console.log(`CashVideo listening on http://0.0.0.0:${port}`));

export { app };
