import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.resolve('data');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'cashvideo.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    display_name TEXT NOT NULL,
    age INTEGER CHECK(age IS NULL OR (age >= 1 AND age <= 120)),
    avatar TEXT NOT NULL DEFAULT 'violet',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, media_id, media_type)
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, media_id, media_type)
  );
  CREATE TABLE IF NOT EXISTS media_sources (
    media_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    PRIMARY KEY(media_id, media_type)
  );
`);

export function cleanExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
}
