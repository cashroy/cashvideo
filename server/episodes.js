import { sampleTitles } from './sample-data.js';
import { tmdb } from './tmdb.js';

export async function nextEpisodeFor(tvId, seasonNumber, episodeNumber) {
  let details = null;
  try { details = await tmdb(`/tv/${tvId}`); } catch { details = null; }
  const sample = sampleTitles.find((title) => title.media_type === 'tv' && Number(title.id) === Number(tvId));
  const seasons = (details?.seasons || sample?.seasons || [])
    .filter((season) => Number(season.season_number) > 0 && Number(season.episode_count) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  const current = seasons.find((season) => Number(season.season_number) === Number(seasonNumber));
  if (!current) return undefined;
  if (Number(episodeNumber) < Number(current.episode_count)) return { season: Number(seasonNumber), episode: Number(episodeNumber) + 1 };
  const nextSeason = seasons.find((season) => Number(season.season_number) > Number(seasonNumber));
  return nextSeason ? { season: Number(nextSeason.season_number), episode: 1 } : null;
}
