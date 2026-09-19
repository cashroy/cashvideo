import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, Check, Info, Play, Plus, Search } from 'lucide-react';
import { api } from './api.js';
import { parseResumeTimestamp, resolvePlaybackTemplate } from './player.js';

export function Spinner() { return <div className="spinner" aria-label="Loading" />; }

export function MediaCard({ item, onOpen, inList = false, onListChange, progress }) {
  const title = item.title || item.name;
  const percent = progress ?? (item.duration ? Math.min(100, (item.position / item.duration) * 100) : 0);
  return (
    <article className="media-card" onClick={() => onOpen(item)} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onOpen(item)}>
      <div className="poster-wrap">
        {item.poster_path ? <img src={item.poster_path} alt="" loading="lazy" /> : <div className="poster-fallback">CV</div>}
        <div className="card-overlay"><button className="round" aria-label={`Open ${title}`}><Play fill="currentColor" size={18} /></button></div>
        {percent > 0 && <div className="progress-track"><i style={{ width: `${percent}%` }} /></div>}
      </div>
      <div className="card-meta">
        <div><strong>{title}</strong><span>{item.media_type === 'tv' && item.season ? `S${item.season} E${item.episode}` : `${(item.date || item.release_date || item.first_air_date || '').slice(0, 4)} · ${item.media_type === 'tv' ? 'Series' : 'Movie'}`}</span></div>
        {onListChange && <button className="icon-button" aria-label={inList ? 'Remove from watchlist' : 'Add to watchlist'} onClick={(event) => { event.stopPropagation(); onListChange(item, !inList); }}>{inList ? <Check size={17} /> : <Plus size={17} />}</button>}
      </div>
    </article>
  );
}

export function Rail({ title, subtitle, items = [], onOpen, watchlist = [], onListChange, numbered = false }) {
  if (!items.length) return null;
  return <section className="rail-section">
    <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
    <div className="rail">
      {items.map((item, index) => <div className={numbered ? 'ranked' : ''} key={`${item.media_type}-${item.id || item.media_id}`}>
        {numbered && <b aria-hidden="true">{index + 1}</b>}
        <MediaCard item={{ ...item, id: item.id || item.media_id }} onOpen={onOpen} inList={watchlist.some((saved) => Number(saved.media_id) === Number(item.id || item.media_id) && saved.media_type === item.media_type)} onListChange={onListChange} />
      </div>)}
    </div>
  </section>;
}

export function Hero({ item, onOpen, onListChange, inList }) {
  if (!item) return null;
  return <section className="hero" style={{ '--hero': `url("${item.backdrop_path}")` }}>
    <div className="hero-content">
      <div className="eyebrow"><i /> This week’s spotlight</div>
      <h1>{item.title}</h1>
      <div className="hero-facts"><span className="match">{Math.round((item.vote_average || 8.4) * 10)}% match</span><span>{item.date?.slice(0, 4)}</span><span>{item.media_type === 'tv' ? 'Series' : 'Movie'}</span><span className="quality">4K</span></div>
      <p>{item.overview}</p>
      <div className="hero-actions"><button className="button primary" onClick={() => onOpen(item)}><Play fill="currentColor" size={18} /> Watch now</button><button className="button glass" onClick={() => onListChange(item, !inList)}>{inList ? <Check size={19} /> : <Plus size={19} />} {inList ? 'In watchlist' : 'Watchlist'}</button><button className="round glass" aria-label={`More information about ${item.title}`} onClick={() => onOpen(item)}><Info size={20} /></button></div>
    </div>
  </section>;
}

export function DetailsModal({ item: initial, onClose, onListChange, inList, onSaved }) {
  const [item, setItem] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [season, setSeason] = useState(Number(initial.season) || 1);
  const [episode, setEpisode] = useState(Number(initial.episode) || 1);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const pushedHistoryRef = useRef(false);
  const lastSavedRef = useRef(-1);
  onCloseRef.current = onClose;
  useEffect(() => {
    api(`/api/media/${initial.media_type}/${initial.id || initial.media_id}`).then(({ item: full }) => {
      setItem(full);
      if (full.progress?.season) setSeason(full.progress.season);
      if (full.progress?.episode) setEpisode(full.progress.episode);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [initial]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!pushedHistoryRef.current) {
      window.history.pushState({ ...window.history.state, cashvideoPlayer: true }, '');
      pushedHistoryRef.current = true;
    }
    const handlePopState = () => { pushedHistoryRef.current = false; onCloseRef.current(); };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (pushedHistoryRef.current) window.history.back(); else onCloseRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('popstate', handlePopState); window.removeEventListener('keydown', handleKeyDown); };
  }, []);
  useEffect(() => {
    if (!playing || !item.source_url || !videoRef.current) return;
    const video = videoRef.current;
    let hls;
    if ((item.source_type === 'hls' || item.source_url.includes('.m3u8')) && Hls.isSupported()) { hls = new Hls(); hls.loadSource(item.source_url); hls.attachMedia(video); } else video.src = item.source_url;
    return () => hls?.destroy();
  }, [playing, item.source_type, item.source_url]);
  const embedUrl = item.source_url ? null : resolvePlaybackTemplate(item.playback_template, item, season, episode);
  const jellyfinReady = item.playback_provider === 'jellyfin' && item.jellyfin_configured;
  const playable = Boolean(item.source_url || embedUrl || jellyfinReady);
  const requestedPosition = parseResumeTimestamp(window.location.search);
  const resumePosition = requestedPosition ?? (Number(item.progress?.position ?? initial.position) || 0);
  const requestClose = () => { if (pushedHistoryRef.current) window.history.back(); else onCloseRef.current(); };
  const saveEmbeddedProgress = useCallback((updates = {}) => {
    const position = Number.isFinite(updates.position) ? updates.position : Math.max(1, resumePosition);
    const duration = Number.isFinite(updates.duration) ? updates.duration : Number(item.progress?.duration) || 0;
    api(`/api/progress/${item.media_type}/${item.id || item.media_id}`, { method: 'PUT', body: { title: item.title, posterPath: item.poster_path, position, duration, season, episode, completed: updates.completed } }).then(onSaved).catch(() => {});
  }, [episode, item, onSaved, resumePosition, season]);
  useEffect(() => {
    if (!playing || !embedUrl) return;
    saveEmbeddedProgress();
    const allowedOrigin = new URL(embedUrl).origin;
    const handleMessage = (event) => {
      if (event.origin !== allowedOrigin || event.source !== iframeRef.current?.contentWindow) return;
      let payload = event.data;
      if (typeof payload === 'string' && payload.startsWith('{')) { try { payload = JSON.parse(payload); } catch { return; } }
      const eventType = typeof payload === 'string' ? payload : payload?.type || payload?.event;
      if (eventType === 'cashvideo:progress' && Number.isFinite(Number(payload.currentTime))) saveEmbeddedProgress({ position: Number(payload.currentTime), duration: Number(payload.duration) || 0 });
      if (eventType === 'cashvideo:ended' || eventType === 'vidcore:ended') saveEmbeddedProgress({ completed: true });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [embedUrl, playing, saveEmbeddedProgress]);
  const saveProgress = useCallback((force = false) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const bucket = Math.floor(video.currentTime / 20);
    if (!force && bucket === lastSavedRef.current) return;
    lastSavedRef.current = bucket;
    api(`/api/progress/${item.media_type}/${item.id || item.media_id}`, { method: 'PUT', body: { title: item.title, posterPath: item.poster_path, position: video.currentTime, duration: video.duration, season, episode } }).then(onSaved).catch(() => {});
  }, [episode, item, onSaved, season]);
  useEffect(() => {
    if (!playing || !item.source_url || embedUrl) return;
    const timer = window.setInterval(() => saveProgress(true), 5_000);
    return () => { window.clearInterval(timer); saveProgress(true); };
  }, [embedUrl, item.source_url, playing, saveProgress]);
  const startPlayback = async () => {
    setPlayerError('');
    if (item.source_url || embedUrl) return setPlaying(true);
    if (!jellyfinReady) return;
    setResolving(true);
    try {
      const query = new URLSearchParams({ season: String(season), episode: String(episode) });
      const playback = await api(`/api/playback/${item.media_type}/${item.id || item.media_id}?${query}`);
      setItem((current) => ({ ...current, source_url: playback.sourceUrl, source_type: playback.sourceType }));
      setPlaying(true);
    } catch (error) {
      setPlayerError(error.message);
    } finally {
      setResolving(false);
    }
  };
  const resumeAvailable = resumePosition > 1 || (item.media_type === 'tv' && Boolean(item.progress || initial.season));
  return <div className={`modal-backdrop${playing ? ' watch-screen' : ''}`} onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <article className="details-modal" role="dialog" aria-modal="true" aria-labelledby={playing ? undefined : 'media-details-title'} aria-label={playing ? `Playing ${item.title || item.name}` : undefined}>
      <button className="modal-close" aria-label="Back to previous page" onClick={requestClose}><ArrowLeft /></button>
      {playing ? <div className="player-wrap">{embedUrl ? <iframe ref={iframeRef} src={embedUrl} title={`Playing ${item.title || item.name}`} width="100%" height="100%" frameBorder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerPolicy="no-referrer" allowFullScreen onLoad={() => { if (resumePosition > 1) iframeRef.current?.contentWindow?.postMessage({ type: 'cashvideo:resume', currentTime: resumePosition }, new URL(embedUrl).origin); }} /> : <video ref={videoRef} controls autoPlay onLoadedMetadata={(event) => { if (resumePosition > 0) event.currentTarget.currentTime = Math.min(resumePosition, Math.max(0, event.currentTarget.duration - 1)); }} onPause={() => saveProgress(true)} onEnded={() => saveProgress(true)} />}</div> : <div className="modal-visual" style={{ '--hero': `url("${item.backdrop_path || item.poster_path}")` }}>
        <button className="play-large" aria-label={`${resumeAvailable ? 'Resume' : 'Play'} ${item.title || item.name}`} disabled={!playable || resolving} onClick={startPlayback}><Play fill="currentColor" /><span>{resolving ? 'Loading…' : resumeAvailable ? 'Resume' : 'Play'}</span></button>
      </div>}
      {!playing && <div className="modal-copy">
        {loading && <Spinner />}
        <h2 id="media-details-title">{item.title || item.name}</h2>
        <div className="hero-facts"><span className="match">{Math.round((item.vote_average || 8) * 10)}% match</span><span>{(item.date || '').slice(0, 4)}</span><span>{item.media_type === 'tv' ? 'Series' : 'Movie'}</span></div>
        <p>{item.overview}</p>
        {item.media_type === 'tv' && playable && <div className="episode-picker"><label>Season<input type="number" min="1" max={item.number_of_seasons || 99} value={season} onChange={(event) => setSeason(Math.max(1, Number(event.target.value) || 1))} /></label><label>Episode<input type="number" min="1" value={episode} onChange={(event) => setEpisode(Math.max(1, Number(event.target.value) || 1))} /></label>{embedUrl && <span>Playing S{season} E{episode}</span>}</div>}
        {playerError && <div className="form-error">{playerError}</div>}
        {!playable && <div className="source-notice"><Info size={18} /><span>{item.playback_provider === 'jellyfin' ? 'Jellyfin is the default player. An administrator needs to connect it before playback is available.' : 'No playback system is configured yet. An administrator can add one template for every movie and series.'}</span></div>}
        <button className="button glass" onClick={() => onListChange(item, !inList)}>{inList ? <Check size={18} /> : <Plus size={18} />} {inList ? 'Remove from watchlist' : 'Add to watchlist'}</button>
      </div>}
    </article>
  </div>;
}

export function SearchBox({ onResults }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try { const data = await api(`/api/search?q=${encodeURIComponent(query)}`); onResults(query, data.results); } finally { setBusy(false); }
  }
  return <form className="search-box" onSubmit={submit}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search films & series" aria-label="Search" />{busy && <Spinner />}</form>;
}
