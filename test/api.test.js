import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
  const created = await request('/api/auth/setup', { method: 'POST', body: { username: 'owner', password: 'verysecure', displayName: 'Owner' } });
  assert.equal(created.status, 201);
  const me = await request('/api/me');
  assert.equal(me.body.user.role, 'admin');
  const duplicate = await request('/api/auth/setup', { method: 'POST', body: { username: 'other', password: 'verysecure' } });
  assert.equal(duplicate.status, 409);
});

test('admin creates a user and user data is isolated', async () => {
  const created = await request('/api/admin/users', { method: 'POST', body: { username: 'viewer', password: 'viewersecret', displayName: 'Viewer' } });
  assert.equal(created.status, 201);
  const saved = await request('/api/watchlist/movie/157336', { method: 'PUT', body: { title: 'Interstellar', posterPath: '/poster.jpg' } });
  assert.equal(saved.body.saved, true);
  const home = await request('/api/catalogue');
  assert.equal(home.body.watchlist.length, 1);
  await request('/api/auth/logout', { method: 'POST' });
  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'viewer', password: 'viewersecret' } });
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
  const invalid = await request('/api/progress/movie/not-a-number', { method: 'PUT', body: { title: 'Invalid' } });
  assert.equal(invalid.status, 400);
});

test.after(() => {
  server.close();
  rmSync(testData, { recursive: true, force: true });
});
