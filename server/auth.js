import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(pin, salt, 64);
  return `${salt}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPin(pin, encoded) {
  const [salt, saved] = encoded.split(':');
  if (!salt || !saved) return false;
  const derived = await scrypt(pin, salt, 64);
  const savedBuffer = Buffer.from(saved, 'hex');
  return savedBuffer.length === derived.length && crypto.timingSafeEqual(savedBuffer, derived);
}

function parseCookies(header = '') {
  const pairs = header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key);
  return Object.fromEntries(pairs);
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").run(tokenHash, userId);
  res.cookie('cashvideo_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false', maxAge: 30 * 86400 * 1000, path: '/' });
}

export function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie).cashvideo_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex'));
  res.clearCookie('cashvideo_session', { path: '/' });
}

export function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie).cashvideo_session;
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = db.prepare(`SELECT u.id,u.username,u.role,u.display_name,u.age,u.avatar,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).get(tokenHash);
  if (!user) return res.status(401).json({ error: 'Your session has expired.' });
  req.user = user;
  next();
}

export function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}

export function publicUser(user) {
  if (!user) return null;
  const { password_hash: _password, ...safe } = user;
  return safe;
}
