export function parseResumeTimestamp(search = '') {
  const raw = new URLSearchParams(search).get('t');
  if (raw == null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function resolvePlaybackTemplate(template, item, season = 1, episode = 1) {
  if (!template) return null;
  const id = item.id || item.media_id;
  const imdbId = item.imdb_id || item.external_ids?.imdb_id || '';
  const values = {
    id,
    show: id,
    title: item.title || item.name || '',
    type: item.media_type,
    season,
    episode,
    imdb: imdbId,
    imdb_id: imdbId,
  };
  let missingValue = false;
  const resolved = template.replace(/\{([^}]+)\}/g, (match, key) => {
    const normalized = key.toLowerCase();
    if (!Object.hasOwn(values, normalized)) return match;
    if (values[normalized] == null || values[normalized] === '') missingValue = true;
    return encodeURIComponent(String(values[normalized] ?? ''));
  });
  return missingValue ? null : resolved;
}

export function addEmbedPlaybackParams(embedUrl, position = 0) {
  if (!embedUrl) return null;
  try {
    const url = new URL(embedUrl);
    const startAt = Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
    url.searchParams.set('autoPlay', 'true');
    url.searchParams.set('startAt', String(startAt));
    return url.toString();
  } catch {
    return embedUrl;
  }
}
