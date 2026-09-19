import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, cleanExpiredSessions } from './db.js';
import { auth, admin, clearSession, createSession, hashPassword, publicUser, verifyPassword } from './auth.js';
import { catalogue, recommendations, search, tmdb, normalize } from './tmdb.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { res.setHeader('Cache-Control', req.path.startsWith('/api') ? 'no-store' : 'public, max-age=3600'); next(); });

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 128;
const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(value);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/bootstrap', (_req, res) => res.json({ needsSetup: db.prepare('SELECT COUNT(*) count FROM users').get().count === 0 }));

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (db.prepare('SELECT COUNT(*) count FROM users').get().count !== 0) return res.status(409).json({ error: 'CashVideo is already set up.' });
  const { username, password, displayName } = req.body;
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, dashes, or underscores.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const result = db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,'admin',?)").run(username.trim(), await hashPassword(password), (displayName || username).trim().slice(0, 60));
  createSession(res, Number(result.lastInsertRowid));
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username || '');
  if (!user || !(await verifyPassword(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'Incorrect username or password.' });
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
app.patch('/api/me/password', auth, asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!(await verifyPassword(req.body.currentPassword || '', row.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!validPassword(req.body.newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(req.body.newPassword), req.user.id);
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
  if (!data) {
    const fallback = (await catalogue()).find((item) => item.id === Number(req.params.id) && item.media_type === req.params.type);
    if (!fallback) return res.status(404).json({ error: 'Title not found.' });
    return res.json({ item: { ...fallback, source_url: source?.source_url || null } });
  }
  res.json({ item: { ...normalize(data, req.params.type), cast: data.credits?.cast?.slice(0, 8) || [], similar: data.similar?.results?.slice(0, 12).map((item) => normalize(item, req.params.type)) || [], source_url: source?.source_url || null } });
}));

app.put('/api/watchlist/:type/:id', auth, (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  db.prepare('INSERT OR REPLACE INTO watchlist(user_id,media_id,media_type,title,poster_path,added_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').run(req.user.id, Number(req.params.id), req.params.type, String(req.body.title || 'Untitled').slice(0, 200), req.body.posterPath || null);
  res.json({ saved: true });
});
app.delete('/api/watchlist/:type/:id', auth, (req, res) => { db.prepare('DELETE FROM watchlist WHERE user_id=? AND media_id=? AND media_type=?').run(req.user.id, Number(req.params.id), req.params.type); res.json({ saved: false }); });
app.put('/api/progress/:type/:id', auth, (req, res) => {
  if (!['movie', 'tv'].includes(req.params.type) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid title.' });
  const position = Math.max(0, Number(req.body.position) || 0);
  const duration = Math.max(0, Number(req.body.duration) || 0);
  const completed = Boolean(req.body.completed || (duration > 0 && position / duration >= 0.92));
  db.prepare(`INSERT INTO progress(user_id,media_id,media_type,title,poster_path,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,media_id,media_type) DO UPDATE SET title=excluded.title,poster_path=excluded.poster_path,position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=CURRENT_TIMESTAMP`).run(req.user.id, Number(req.params.id), req.params.type, String(req.body.title || 'Untitled').slice(0, 200), req.body.posterPath || null, position, duration, completed ? 1 : 0);
  res.json({ ok: true });
});

app.get('/api/admin', auth, admin, (_req, res) => {
  const users = db.prepare('SELECT id,username,role,display_name,age,avatar,created_at FROM users ORDER BY created_at').all();
  const sources = db.prepare('SELECT * FROM media_sources ORDER BY title').all();
  const token = db.prepare("SELECT value FROM settings WHERE key='tmdb_token'").get()?.value || '';
  res.json({ users, sources, tmdbConfigured: Boolean(token), tmdbHint: token ? `${token.slice(0, 4)}••••${token.slice(-4)}` : '' });
});
app.put('/api/admin/settings', auth, admin, asyncRoute(async (req, res) => {
  const token = String(req.body.tmdbToken || '').trim();
  if (token) {
    const isV4 = token.includes('.') || token.length > 40;
    const url = new URL('https://api.themoviedb.org/3/configuration');
    if (!isV4) url.searchParams.set('api_key', token);
    const response = await fetch(url, { headers: isV4 ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(400).json({ error: 'TMDB could not verify that API key.' });
  }
  db.prepare("INSERT INTO settings(key,value) VALUES('tmdb_token',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(token);
  res.json({ ok: true });
}));
app.post('/api/admin/users', auth, admin, asyncRoute(async (req, res) => {
  const { username, password, displayName, role = 'user' } = req.body;
  if (!validUsername(username) || !validPassword(password) || !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Enter a valid username, password (8+ characters), and role.' });
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)').run(username.trim(), await hashPassword(password), role, String(displayName || username).trim().slice(0, 60));
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
app.use(express.static(path.join(root, 'dist')));
app.get('*splat', (req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(root, 'dist/index.html')));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message?.startsWith('TMDB') ? error.message : 'Something went wrong.' });
});

cleanExpiredSessions();
setInterval(cleanExpiredSessions, 6 * 60 * 60 * 1000).unref();

if (process.env.NODE_ENV !== 'test') app.listen(port, '0.0.0.0', () => console.log(`CashVideo listening on http://0.0.0.0:${port}`));

export { app };
