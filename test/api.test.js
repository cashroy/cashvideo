import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testData = mkdtempSync(path.join(tmpdir(), 'cashvideo-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = testData;
const { app } = await import('../server/index.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const jellyfin = createServer(async (req, res) => {
  if (req.headers['x-emby-token'] !== 'test-jellyfin-key') { res.writeHead(401).end(); return; }
  const url = new URL(req.url, 'http://jellyfin.test');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/Items' && url.searchParams.get('limit') === '1') { res.end(JSON.stringify({ Items: [] })); return; }
  if (url.pathname === '/Items') { const series = url.searchParams.get('includeItemTypes') === 'Series'; res.end(JSON.stringify({ Items: [series ? { Id: 'jf-series', ProviderIds: { Tmdb: '1399' } } : { Id: 'jf-movie', ProviderIds: { Tmdb: '157336' } }] })); return; }
  if (url.pathname === '/Shows/jf-series/Episodes') { res.end(JSON.stringify({ Items: [{ Id: 'jf-episode', ParentIndexNumber: 3, IndexNumber: 7 }] })); return; }
  if (url.pathname === '/Items/jf-movie/PlaybackInfo') { res.end(JSON.stringify({ MediaSources: [{ Id: 'source-1', TranscodingUrl: '/Videos/jf-movie/master.m3u8?api_key=must-not-leak' }] })); return; }
  if (url.pathname === '/Items/jf-episode/PlaybackInfo') { res.end(JSON.stringify({ MediaSources: [{ Id: 'source-2', DirectStreamUrl: '/Videos/jf-episode/stream.mp4' }] })); return; }
  if (url.pathname === '/Videos/jf-movie/master.m3u8') { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXTINF:10,\nsegment0.ts'); return; }
  if (url.pathname === '/Videos/jf-movie/segment0.ts') { res.setHeader('content-type', 'video/mp2t'); res.end('fake-segment'); return; }
  res.writeHead(404).end(JSON.stringify({ error: 'missing' }));
});
jellyfin.listen(0, '127.0.0.1');
await new Promise((resolve) => jellyfin.once('listening', resolve));
const jellyfinBase = `http://127.0.0.1:${jellyfin.address().port}`;

async function request(url, options = {}) {
  const response = await fetch(`${base}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...options.headers },
    body: options.body && JSON.stringify(options.body),
  });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return { status: response.status, body: await response.json() };
}

test('first account becomes admin and setup closes', async () => {
  const before = await request('/api/bootstrap');
  assert.equal(before.body.needsSetup, true);
  const invalidPin = await request('/api/auth/setup', { method: 'POST', body: { username: 'owner', pin: '12345', displayName: 'Owner' } });
  assert.equal(invalidPin.status, 400);
  const created = await request('/api/auth/setup', { method: 'POST', body: { username: 'owner', pin: '1234', displayName: 'Owner' } });
  assert.equal(created.status, 201);
  const me = await request('/api/me');
  assert.equal(me.body.user.role, 'admin');
  const defaults = await request('/api/admin');
  assert.equal(defaults.body.playbackProvider, 'jellyfin');
  assert.equal(defaults.body.jellyfinConfigured, false);
  const duplicate = await request('/api/auth/setup', { method: 'POST', body: { username: 'other', pin: '5678' } });
  assert.equal(duplicate.status, 409);
});

test('admin creates a user and user data is isolated', async () => {
  const created = await request('/api/admin/users', { method: 'POST', body: { username: 'viewer', pin: '2468', displayName: 'Viewer' } });
  assert.equal(created.status, 201);
  const rejectedTemplate = await request('/api/admin/settings', { method: 'PUT', body: { movieTemplate: 'javascript:alert(1)' } });
  assert.equal(rejectedTemplate.status, 400);
  const templates = await request('/api/admin/settings', { method: 'PUT', body: { movieTemplate: 'https://media.home/embed/movie/{IMDb_ID}', tvTemplate: 'https://media.home/{IMDb_ID}/{SEASON}/{EPISODE}' } });
  assert.equal(templates.status, 200);
  const movie = await request('/api/media/movie/157336');
  assert.equal(movie.body.item.playback_template, 'https://media.home/embed/movie/{IMDb_ID}');
  const jellyfinSettings = await request('/api/admin/settings', { method: 'PUT', body: { playbackProvider: 'jellyfin', jellyfinUrl: jellyfinBase, jellyfinApiKey: 'test-jellyfin-key' } });
  assert.equal(jellyfinSettings.status, 200);
  const jellyfinDetails = await request('/api/media/movie/157336');
  assert.equal(jellyfinDetails.body.item.playback_provider, 'jellyfin');
  assert.equal(jellyfinDetails.body.item.jellyfin_configured, true);
  assert.equal(jellyfinDetails.body.item.playback_template, null);
  const playback = await request('/api/playback/movie/157336');
  assert.equal(playback.status, 200);
  assert.equal(playback.body.sourceType, 'hls');
  assert.match(playback.body.sourceUrl, /^\/api\/jellyfin\/stream\?url=/);
  assert.doesNotMatch(playback.body.sourceUrl, /must-not-leak|test-jellyfin-key/);
  const media = await fetch(`${base}${playback.body.sourceUrl}`, { headers: { cookie } });
  assert.equal(media.status, 200);
  const playlist = await media.text();
  assert.doesNotMatch(playlist, /must-not-leak|test-jellyfin-key/);
  const segmentUrl = playlist.split('\n').find((line) => line.startsWith('/api/jellyfin/stream'));
  const segment = await fetch(`${base}${segmentUrl}`, { headers: { cookie } });
  assert.equal(await segment.text(), 'fake-segment');
  const saved = await request('/api/watchlist/movie/157336', { method: 'PUT', body: { title: 'Interstellar', posterPath: '/poster.jpg' } });
  assert.equal(saved.body.saved, true);
  const home = await request('/api/catalogue');
  assert.equal(home.body.watchlist.length, 1);
  await request('/api/auth/logout', { method: 'POST' });
  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'viewer', pin: '2468' } });
  assert.equal(login.status, 200);
  const viewerHome = await request('/api/catalogue');
  assert.equal(viewerHome.body.watchlist.length, 0);
});

test('progress is saved and returned as continue watching', async () => {
  const update = await request('/api/progress/movie/27205', { method: 'PUT', body: { title: 'Inception', position: 420, duration: 7200 } });
  assert.equal(update.status, 200);
  const home = await request('/api/catalogue');
  assert.equal(home.body.continued[0].title, 'Inception');
  assert.equal(home.body.continued[0].position, 420);
  const details = await request('/api/media/movie/27205');
  assert.equal(details.body.item.progress.position, 420);
  assert.equal(details.body.item.progress.duration, 7200);
  const invalid = await request('/api/progress/movie/not-a-number', { method: 'PUT', body: { title: 'Invalid' } });
  assert.equal(invalid.status, 400);
  const invalidEpisode = await request('/api/progress/tv/1399', { method: 'PUT', body: { title: 'Game of Thrones', season: 0, episode: 2 } });
  assert.equal(invalidEpisode.status, 400);
  const episode = await request('/api/progress/tv/1399', { method: 'PUT', body: { title: 'Game of Thrones', position: 1, season: 3, episode: 7 } });
  assert.equal(episode.status, 200);
  const episodePlayback = await request('/api/playback/tv/1399?season=3&episode=7');
  assert.equal(episodePlayback.status, 200);
  assert.equal(episodePlayback.body.sourceType, 'native');
  const updatedHome = await request('/api/catalogue');
  const show = updatedHome.body.continued.find((item) => item.media_id === 1399);
  assert.equal(show.season, 3);
  assert.equal(show.episode, 7);
});

test('users can change PIN and repeated failed logins are throttled', async () => {
  const changed = await request('/api/me/pin', { method: 'PATCH', body: { currentPin: '2468', newPin: '1357' } });
  assert.equal(changed.status, 200);
  await request('/api/auth/logout', { method: 'POST' });
  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'viewer', pin: '1357' } });
  assert.equal(login.status, 200);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await request('/api/auth/login', { method: 'POST', body: { username: 'nobody', pin: '0000' } });
    assert.equal(failed.status, 401);
  }
  const blocked = await request('/api/auth/login', { method: 'POST', body: { username: 'nobody', pin: '0000' } });
  assert.equal(blocked.status, 429);
});

test.after(() => {
  server.close();
  jellyfin.close();
  rmSync(testData, { recursive: true, force: true });
});
