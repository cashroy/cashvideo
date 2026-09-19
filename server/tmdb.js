import { db } from './db.js';
import { sampleTitles } from './sample-data.js';

const BASE = 'https://api.themoviedb.org/3';

function credentials() {
  return db.prepare("SELECT value FROM settings WHERE key='tmdb_token'").get()?.value?.trim() || null;
}

function imageUrl(imagePath, size = 'w780') {
  if (!imagePath || imagePath.startsWith('http')) return imagePath;
  return `https://image.tmdb.org/t/p/${size}${imagePath}`;
}

export function normalize(item, type) {
  const mediaType = item.media_type || type || (item.title ? 'movie' : 'tv');
  return {
    ...item,
    media_type: mediaType,
    title: item.title || item.name,
    date: item.release_date || item.first_air_date,
    backdrop_path: imageUrl(item.backdrop_path, 'original'),
    poster_path: imageUrl(item.poster_path, 'w500'),
  };
}

export async function tmdb(apiPath, params = {}) {
  const token = credentials();
  if (!token) return null;
  const url = new URL(`${BASE}${apiPath}`);
  url.searchParams.set('language', 'en-US');
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const isV4 = token.includes('.') || token.length > 40;
  if (!isV4) url.searchParams.set('api_key', token);
  const response = await fetch(url, { headers: isV4 ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(response.status === 401 ? 'TMDB rejected this API key.' : `TMDB request failed (${response.status}).`);
  return response.json();
}

export async function catalogue(kind = 'trending') {
  const apiPath = kind === 'popular' ? '/movie/popular' : '/trending/all/week';
  const data = await tmdb(apiPath);
  return (data?.results || sampleTitles).filter((item) => ['movie', 'tv'].includes(item.media_type || (item.title ? 'movie' : 'tv'))).map((item) => normalize(item));
}

export async function search(query) {
  if (!query.trim()) return [];
  const data = await tmdb('/search/multi', { query, include_adult: false });
  if (!data) return sampleTitles.filter((item) => (item.title || item.name).toLowerCase().includes(query.toLowerCase())).map((item) => normalize(item));
  return data.results.filter((item) => ['movie', 'tv'].includes(item.media_type)).map((item) => normalize(item));
}

export async function recommendations(type, id) {
  const data = await tmdb(`/${type}/${id}/recommendations`);
  return (data?.results || []).map((item) => normalize(item, type));
}
