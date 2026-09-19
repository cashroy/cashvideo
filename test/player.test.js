import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeTimestamp, resolvePlaybackTemplate } from '../src/player.js';

test('resume timestamp accepts finite non-negative seconds', () => {
  assert.equal(parseResumeTimestamp('?t=95'), 95);
  assert.equal(parseResumeTimestamp('?t=12.5'), 12.5);
  assert.equal(parseResumeTimestamp('?t=0'), 0);
});

test('resume timestamp ignores missing or invalid values', () => {
  assert.equal(parseResumeTimestamp(''), null);
  assert.equal(parseResumeTimestamp('?t='), null);
  assert.equal(parseResumeTimestamp('?t=-1'), null);
  assert.equal(parseResumeTimestamp('?t=tomorrow'), null);
});

test('playback templates expand IMDb movie and TV placeholders', () => {
  const movie = { id: 10, media_type: 'movie', imdb_id: 'tt1234567' };
  const show = { id: 20, media_type: 'tv', external_ids: { imdb_id: 'tt7654321' } };
  assert.equal(resolvePlaybackTemplate('https://website.com/embed/movie/{IMDb_ID}', movie), 'https://website.com/embed/movie/tt1234567');
  assert.equal(resolvePlaybackTemplate('https://website.com/{IMDb_ID}/{SEASON}/{EPISODE}', show, 3, 7), 'https://website.com/tt7654321/3/7');
});

test('IMDb templates are unavailable until metadata includes an IMDb ID', () => {
  assert.equal(resolvePlaybackTemplate('https://website.com/embed/movie/{IMDb_ID}', { id: 10, media_type: 'movie' }), null);
});
