import { Readable } from 'node:stream';

const clientProfile = {
  Name: 'CashVideo',
  MaxStreamingBitrate: 120_000_000,
  DirectPlayProfiles: [
    { Type: 'Video', Container: 'mp4,m4v,webm', VideoCodec: 'h264,hevc,vp8,vp9,av1', AudioCodec: 'aac,mp3,opus,vorbis,flac' },
  ],
  TranscodingProfiles: [
    { Type: 'Video', Context: 'Streaming', Protocol: 'hls', Container: 'ts', VideoCodec: 'h264', AudioCodec: 'aac', MaxAudioChannels: '8', BreakOnNonKeyFrames: true },
  ],
};

export function normalizeJellyfinUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter a valid HTTP(S) Jellyfin server URL.');
  return parsed.href.replace(/\/$/, '');
}

function jellyfinUrl(baseUrl, resource) {
  return new URL(String(resource).replace(/^\/+/, ''), `${baseUrl}/`);
}

function authHeaders(apiKey, extra = {}) {
  return { 'X-Emby-Token': apiKey, 'X-Emby-Authorization': `MediaBrowser Client="CashVideo", Device="Server", DeviceId="cashvideo", Version="1.0.0", Token="${apiKey}"`, ...extra };
}

async function jellyfinFetch(baseUrl, apiKey, resource, options = {}) {
  const response = await fetch(jellyfinUrl(baseUrl, resource), {
    ...options,
    headers: authHeaders(apiKey, options.headers),
    signal: Object.hasOwn(options, 'signal') ? options.signal : AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Jellyfin rejected that API key.' : `Jellyfin request failed (${response.status}).`);
  return response;
}

export async function verifyJellyfin(baseUrl, apiKey) {
  await jellyfinFetch(baseUrl, apiKey, '/Items?limit=1');
}

function providerId(item, name) {
  const entry = Object.entries(item?.ProviderIds || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] == null ? '' : String(entry[1]);
}

async function findLibraryItem(baseUrl, apiKey, { type, tmdbId, title, season = 1, episode = 1 }) {
  const query = new URLSearchParams({ recursive: 'true', includeItemTypes: type === 'movie' ? 'Movie' : 'Series', fields: 'ProviderIds', searchTerm: title || '', limit: '50' });
  const response = await jellyfinFetch(baseUrl, apiKey, `/Items?${query}`);
  const library = await response.json();
  const parent = library.Items?.find((item) => providerId(item, 'Tmdb') === String(tmdbId));
  if (!parent) throw new Error('This title is not in the connected Jellyfin library.');
  if (type === 'movie') return parent;

  const episodeQuery = new URLSearchParams({ season: String(season), fields: 'ProviderIds', enableUserData: 'false' });
  const episodeResponse = await jellyfinFetch(baseUrl, apiKey, `/Shows/${encodeURIComponent(parent.Id)}/Episodes?${episodeQuery}`);
  const episodes = await episodeResponse.json();
  const selected = episodes.Items?.find((item) => Number(item.ParentIndexNumber) === Number(season) && Number(item.IndexNumber) === Number(episode));
  if (!selected) throw new Error(`Season ${season}, episode ${episode} is not in the connected Jellyfin library.`);
  return selected;
}

function withoutCredentials(url) {
  for (const key of [...url.searchParams.keys()]) if (/^(api_key|apiKey|x-emby-token)$/i.test(key)) url.searchParams.delete(key);
  return url;
}

function proxyUrl(target) {
  return `/api/jellyfin/stream?url=${encodeURIComponent(withoutCredentials(new URL(target)).href)}`;
}

export async function resolveJellyfinPlayback(config, media) {
  const item = await findLibraryItem(config.baseUrl, config.apiKey, media);
  const response = await jellyfinFetch(config.baseUrl, config.apiKey, `/Items/${encodeURIComponent(item.Id)}/PlaybackInfo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ DeviceProfile: clientProfile, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true }),
  });
  const playback = await response.json();
  const source = playback.MediaSources?.[0];
  if (!source) throw new Error('Jellyfin did not return a playable media source.');
  const resource = source.TranscodingUrl || source.DirectStreamUrl || `/Videos/${encodeURIComponent(item.Id)}/stream?static=true&mediaSourceId=${encodeURIComponent(source.Id || '')}`;
  const target = jellyfinUrl(config.baseUrl, resource);
  return { sourceUrl: proxyUrl(target), sourceType: target.pathname.endsWith('.m3u8') ? 'hls' : 'native' };
}

function allowedTarget(baseUrl, requestedUrl) {
  const base = new URL(`${baseUrl}/`);
  const target = new URL(requestedUrl);
  const basePath = base.pathname.replace(/\/$/, '');
  if (target.origin !== base.origin || (basePath && !target.pathname.startsWith(`${basePath}/`))) throw new Error('Invalid Jellyfin media URL.');
  const relativePath = basePath ? target.pathname.slice(basePath.length) : target.pathname;
  if (!/^\/(Videos|Audio)\//.test(relativePath)) throw new Error('Invalid Jellyfin media URL.');
  return withoutCredentials(target);
}

function rewritePlaylist(text, playlistUrl, baseUrl) {
  const rewrite = (value) => proxyUrl(value.startsWith('/') ? jellyfinUrl(baseUrl, value) : new URL(value, playlistUrl));
  return text.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith('#')) return rewrite(line);
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`);
  }).join('\n');
}

export async function proxyJellyfinMedia(req, res, config) {
  const target = allowedTarget(config.baseUrl, String(req.query.url || ''));
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  const response = await jellyfinFetch(config.baseUrl, config.apiKey, target, { headers, signal: undefined });
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (/mpegurl/i.test(contentType) || target.pathname.endsWith('.m3u8')) {
    res.status(response.status).type('application/vnd.apple.mpegurl').send(rewritePlaylist(await response.text(), target, config.baseUrl));
    return;
  }
  res.status(response.status);
  for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type']) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}
