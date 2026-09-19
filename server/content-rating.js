import { db } from './db.js';
import { sampleTitles } from './sample-data.js';
import { tmdb } from './tmdb.js';

const textRatings = new Map([
  ['G', 0], ['TV-G', 0], ['U', 0], ['ALL', 0],
  ['PG', 10], ['TV-PG', 10], ['PG-13', 13], ['TV-14', 14], ['12', 12], ['12A', 12], ['13', 13],
  ['15', 15], ['16', 16], ['R', 17], ['TV-MA', 18], ['NC-17', 18], ['18', 18], ['R18+', 18], ['MA15+', 15],
]);

function ratingToAge(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || ['NR', 'N/A', 'UNRATED'].includes(normalized)) return null;
  if (textRatings.has(normalized)) return textRatings.get(normalized);
  const numeric = Number.parseInt(normalized, 10);
  return Number.isInteger(numeric) ? Math.min(18, Math.max(0, numeric)) : null;
}

function ratingFromDetails(data, type) {
  if (!data) return null;
  if (Number.isInteger(data.content_rating)) return data.content_rating;
  if (data.adult) return 18;
  const groups = type === 'movie' ? data.release_dates?.results : data.content_ratings?.results;
  if (!Array.isArray(groups)) return null;
  const preferred = groups.find((group) => group.iso_3166_1 === 'US') || groups.find((group) => ['GB', 'AU', 'CA'].includes(group.iso_3166_1)) || groups[0];
  const labels = type === 'movie' ? preferred?.release_dates?.map((release) => release.certification) : [preferred?.rating];
  const ages = (labels || []).map(ratingToAge).filter(Number.isInteger);
  return ages.length ? Math.max(...ages) : null;
}

export async function contentAgeRating(type, id, item = null) {
  const direct = ratingFromDetails(item, type);
  if (direct !== null) return direct;
  const sample = sampleTitles.find((title) => Number(title.id) === Number(id) && title.media_type === type);
  if (sample) return sample.content_rating;
  const cached = db.prepare('SELECT age_rating FROM content_ratings WHERE media_id=? AND media_type=?').get(Number(id), type);
  if (cached) return cached.age_rating;
  let details = null;
  try { details = await tmdb(`/${type}/${id}`, { append_to_response: type === 'movie' ? 'release_dates' : 'content_ratings' }); } catch { return null; }
  const rating = ratingFromDetails(details, type);
  db.prepare('INSERT INTO content_ratings(media_id,media_type,age_rating,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(media_id,media_type) DO UPDATE SET age_rating=excluded.age_rating,updated_at=CURRENT_TIMESTAMP').run(Number(id), type, rating);
  return rating;
}

export async function filterForUser(items, user) {
  if (user.max_content_rating == null) return items;
  const output = [];
  for (let offset = 0; offset < items.length; offset += 6) {
    const chunk = items.slice(offset, offset + 6);
    const rated = await Promise.all(chunk.map(async (item) => {
      const type = item.media_type || (item.title ? 'movie' : 'tv');
      const id = item.id || item.media_id;
      const ageRating = await contentAgeRating(type, id, item);
      return ageRating !== null && ageRating <= user.max_content_rating ? { ...item, content_rating: ageRating } : null;
    }));
    output.push(...rated.filter(Boolean));
  }
  return output;
}

export async function titleAllowed(user, type, id, item = null) {
  if (user.max_content_rating == null) return true;
  const rating = await contentAgeRating(type, id, item);
  return rating !== null && rating <= user.max_content_rating;
}
