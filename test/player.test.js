import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeTimestamp } from '../src/player.js';

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
