import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Check, Info, Play, Plus, Search, X } from 'lucide-react';
import { api } from './api.js';

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
        <div><strong>{title}</strong><span>{(item.date || item.release_date || item.first_air_date || '').slice(0, 4)} · {item.media_type === 'tv' ? 'Series' : 'Movie'}</span></div>
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
  const videoRef = useRef(null);
  const lastSavedRef = useRef(-1);
  useEffect(() => {
    api(`/api/media/${initial.media_type}/${initial.id || initial.media_id}`).then(({ item: full }) => setItem(full)).catch(() => {}).finally(() => setLoading(false));
  }, [initial]);
  useEffect(() => {
    if (!playing || !item.source_url || !videoRef.current) return;
    const video = videoRef.current;
    let hls;
    if (item.source_url.includes('.m3u8') && Hls.isSupported()) { hls = new Hls(); hls.loadSource(item.source_url); hls.attachMedia(video); } else video.src = item.source_url;
    return () => hls?.destroy();
  }, [playing, item.source_url]);
  const saveProgress = (force = false) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const bucket = Math.floor(video.currentTime / 20);
    if (!force && bucket === lastSavedRef.current) return;
    lastSavedRef.current = bucket;
    api(`/api/progress/${item.media_type}/${item.id || item.media_id}`, { method: 'PUT', body: { title: item.title, posterPath: item.poster_path, position: video.currentTime, duration: video.duration } }).then(onSaved).catch(() => {});
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <article className="details-modal">
      <button className="modal-close" aria-label="Close details" onClick={onClose}><X /></button>
      {playing ? <div className="player-wrap"><video ref={videoRef} controls autoPlay onPause={() => saveProgress(true)} onEnded={() => saveProgress(true)} onTimeUpdate={() => saveProgress()} /></div> : <div className="modal-visual" style={{ '--hero': `url("${item.backdrop_path || item.poster_path}")` }}>
        <button className="play-large" disabled={!item.source_url} onClick={() => item.source_url && setPlaying(true)}><Play fill="currentColor" /></button>
      </div>}
      <div className="modal-copy">
        {loading && <Spinner />}
        <h2>{item.title || item.name}</h2>
        <div className="hero-facts"><span className="match">{Math.round((item.vote_average || 8) * 10)}% match</span><span>{(item.date || '').slice(0, 4)}</span><span>{item.media_type === 'tv' ? 'Series' : 'Movie'}</span></div>
        <p>{item.overview}</p>
        {!item.source_url && <div className="source-notice"><Info size={18} /><span>No playable source is linked yet. An administrator can attach a direct URL to media you own.</span></div>}
        <button className="button glass" onClick={() => onListChange(item, !inList)}>{inList ? <Check size={18} /> : <Plus size={18} />} {inList ? 'Remove from watchlist' : 'Add to watchlist'}</button>
      </div>
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
