import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Home, LogOut, Search, Settings, Shield, User, Users } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { DetailsModal, Hero, MediaCard, Rail, SearchBox, Spinner } from './components.jsx';

const avatars = ['violet', 'ocean', 'ember', 'forest', 'rose', 'gold'];

function PinInput({ value, onChange, ...props }) {
  return <input {...props} type="password" inputMode="numeric" pattern="\d{4}" minLength="4" maxLength="4" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))} />;
}

function AuthScreen({ setup, profiles = [], onAuthenticated }) {
  const [form, setForm] = useState({ displayName: '', username: '', pin: '' });
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [manualLogin, setManualLogin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const body = selectedProfile ? { profileId: selectedProfile.id, pin: form.pin } : form;
    try { await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body }); await onAuthenticated(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <div className="auth-art"><div className="brand"><Clapperboard fill="currentColor" /> Cash<span>Video</span></div><div className="auth-quote"><p>YOUR PRIVATE CINEMA</p><h1>Everything you love.<br />All in one place.</h1><span>Personal profiles, watchlists, recommendations, and your own media — beautifully organised.</span></div></div>
    {!setup && !selectedProfile && !manualLogin ? <section className="auth-card profile-select" aria-labelledby="profile-select-title">
      <div className="mobile-brand brand"><Clapperboard fill="currentColor" /> Cash<span>Video</span></div>
      <p className="eyebrow">Welcome home</p><h2 id="profile-select-title">Who’s watching?</h2><p>Choose your profile, then enter your 4-digit PIN.</p>
      <div className="profile-grid">{profiles.map((profile) => <button className="profile-choice" type="button" key={profile.id} onClick={() => { setSelectedProfile(profile); setError(''); }}><span className={`avatar ${profile.avatar}`}>{profile.display_name.charAt(0)}</span><b>{profile.display_name}</b></button>)}</div>
      <button type="button" className="button glass wide" onClick={() => setManualLogin(true)}>Sign in with username</button>
      <small>Need a profile? An administrator can add one in Admin → Household users.</small>
    </section> : <form className="auth-card" onSubmit={submit}>
      <div className="mobile-brand brand"><Clapperboard fill="currentColor" /> Cash<span>Video</span></div>
      <p className="eyebrow">{setup ? 'Welcome home' : 'Welcome back'}</p>
      <h2>{setup ? 'Create the admin account' : selectedProfile ? `Hi, ${selectedProfile.display_name}` : 'Sign in to CashVideo'}</h2>
      <p>{setup ? 'The first account becomes the administrator and controls users, TMDB, and playback.' : selectedProfile ? 'Enter your 4-digit PIN to continue.' : 'Pick up exactly where you left off.'}</p>
      {setup && <label>Display name<input autoFocus value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="How should we call you?" required /></label>}
      {!selectedProfile && <label>Username<input autoFocus={!setup} autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="yourname" required /></label>}
      <label>4-digit PIN<PinInput autoFocus={Boolean(selectedProfile)} value={form.pin} onChange={(pin) => setForm({ ...form, pin })} placeholder="••••" aria-label="4-digit PIN" required /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={busy}>{busy ? <Spinner /> : setup ? 'Create CashVideo' : 'Sign in'}</button>
      {!setup && <button type="button" className="button text-button wide" onClick={() => { setSelectedProfile(null); setManualLogin(false); setForm({ ...form, pin: '' }); setError(''); }}>Choose a different profile</button>}
      <small>Private by design · Data stays on your server</small>
    </form>}
  </main>;
}

function Layout({ user, onLogout, children }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Clapperboard fill="currentColor" /> Cash<span>Video</span></div>
      <nav><NavLink to="/"><Home /> <span>Home</span></NavLink><NavLink to="/discover"><Search /> <span>Discover</span></NavLink><NavLink to="/watchlist"><Clapperboard /> <span>My list</span></NavLink></nav>
      <div className="side-bottom">{user.role === 'admin' && <NavLink to="/admin"><Shield /> <span>Admin</span></NavLink>}<NavLink to="/profile"><Settings /> <span>Settings</span></NavLink></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><SearchBox onResults={(query, results) => { sessionStorage.setItem('search', JSON.stringify({ query, results })); location.assign('/discover'); }} /><NavLink className="profile-pill" to="/profile"><span className={`avatar ${user.avatar}`}>{user.display_name.charAt(0).toUpperCase()}</span><span><b>{user.display_name}</b><small>{user.role === 'admin' ? 'Administrator' : 'Member'}</small></span></NavLink><button className="icon-button logout" onClick={onLogout} title="Sign out"><LogOut /></button></header>
      <main className="content">{children}</main>
    </div>
    <nav className="mobile-nav"><NavLink to="/"><Home /><small>Home</small></NavLink><NavLink to="/discover"><Search /><small>Discover</small></NavLink><NavLink to="/watchlist"><Clapperboard /><small>My list</small></NavLink><NavLink to="/profile"><User /><small>Profile</small></NavLink></nav>
  </div>;
}

function HomePage({ data, refresh }) {
  const [selected, setSelected] = useState(null);
  const saved = (item) => data.watchlist.some((x) => Number(x.media_id) === Number(item.id || item.media_id) && x.media_type === item.media_type);
  async function updateList(item, shouldSave) {
    await api(`/api/watchlist/${item.media_type}/${item.id || item.media_id}`, { method: shouldSave ? 'PUT' : 'DELETE', body: shouldSave ? { title: item.title || item.name, posterPath: item.poster_path } : undefined });
    refresh();
  }
  async function removeProgress(item) {
    await api(`/api/progress/${item.media_type}/${item.id || item.media_id}`, { method: 'DELETE' });
    refresh();
  }
  const open = (item) => setSelected({ ...item, id: item.id || item.media_id });
  return <>
    <Hero item={data.trending[0]} onOpen={open} onListChange={updateList} inList={data.trending[0] && saved(data.trending[0])} />
    {!data.configured && <div className="setup-banner"><Shield /><span><b>Sample catalogue is showing.</b> Add a free TMDB API key in Admin to enable live search, trending, and recommendations.</span></div>}
    <div className="home-rails">
      <Rail title="Continue watching" subtitle="Jump back in" items={data.continued} onOpen={open} watchlist={data.watchlist} onListChange={updateList} onRemove={removeProgress} />
      <Rail title="Trending now" subtitle="What everyone’s watching" items={data.trending.slice(1)} onOpen={open} watchlist={data.watchlist} onListChange={updateList} numbered />
      <Rail title="Made for you" subtitle="Based on your viewing" items={data.recommended} onOpen={open} watchlist={data.watchlist} onListChange={updateList} />
      <Rail title="Popular movies" items={data.popular} onOpen={open} watchlist={data.watchlist} onListChange={updateList} />
    </div>
    {selected && <DetailsModal item={selected} onClose={() => setSelected(null)} onListChange={updateList} inList={saved(selected)} onSaved={refresh} />}
  </>;
}

function GridPage({ title, subtitle, items, watchlist, refresh }) {
  const [selected, setSelected] = useState(null);
  async function updateList(item, shouldSave) { await api(`/api/watchlist/${item.media_type}/${item.id || item.media_id}`, { method: shouldSave ? 'PUT' : 'DELETE', body: shouldSave ? { title: item.title, posterPath: item.poster_path } : undefined }); refresh(); }
  const saved = (item) => watchlist.some((x) => Number(x.media_id) === Number(item.id || item.media_id) && x.media_type === item.media_type);
  return <div className="page"><div className="page-title"><p className="eyebrow">Your cinema</p><h1>{title}</h1><p>{subtitle}</p></div><div className="media-grid">{items.map((item) => <MediaCard key={`${item.media_type}-${item.id || item.media_id}`} item={{ ...item, id: item.id || item.media_id }} onOpen={setSelected} inList={saved(item)} onListChange={updateList} />)}</div>{!items.length && <div className="empty"><Clapperboard /><h2>Nothing here yet</h2><p>Explore the catalogue and add something you love.</p></div>}{selected && <DetailsModal item={selected} onClose={() => setSelected(null)} onListChange={updateList} inList={saved(selected)} onSaved={refresh} />}</div>;
}

function DiscoverPage({ data, refresh }) {
  const cached = JSON.parse(sessionStorage.getItem('search') || 'null');
  const [query, setQuery] = useState(cached?.query || '');
  const [results, setResults] = useState(cached?.results || data.trending);
  const [busy, setBusy] = useState(false);
  async function search(event) { event.preventDefault(); setBusy(true); try { const found = await api(`/api/search?q=${encodeURIComponent(query)}`); setResults(found.results); } finally { setBusy(false); } }
  return <div className="page"><div className="page-title"><p className="eyebrow">Find your next favourite</p><h1>Discover</h1></div><form className="discover-search" onSubmit={search}><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search movies and TV shows…" autoFocus /><button className="button primary">{busy ? <Spinner /> : 'Search'}</button></form><GridPage title={query ? `Results for “${query}”` : 'Explore'} subtitle="Movies and series from TMDB" items={results} watchlist={data.watchlist} refresh={refresh} /></div>;
}

function ProfilePage({ user, reloadUser, logout }) {
  const [profile, setProfile] = useState({ displayName: user.display_name, age: user.age || '', avatar: user.avatar });
  const [pins, setPins] = useState({ currentPin: '', newPin: '' });
  const [message, setMessage] = useState('');
  async function save(event) { event.preventDefault(); try { await api('/api/me', { method: 'PATCH', body: profile }); await reloadUser(); setMessage('Profile saved.'); } catch (e) { setMessage(e.message); } }
  async function changePin(event) { event.preventDefault(); try { await api('/api/me/pin', { method: 'PATCH', body: pins }); setPins({ currentPin: '', newPin: '' }); setMessage('PIN changed.'); } catch (e) { setMessage(e.message); } }
  async function remove() { if (!confirm('Permanently delete your account and viewing data?')) return; try { await api('/api/me', { method: 'DELETE' }); logout(false); } catch (e) { setMessage(e.message); } }
  return <div className="page narrow"><div className="page-title"><p className="eyebrow">Personalise</p><h1>Profile settings</h1></div>{message && <div className="toast-inline">{message}</div>}<form className="settings-card" onSubmit={save}><h2>Your profile</h2><div className="avatar-picker">{avatars.map((avatar) => <button type="button" key={avatar} className={`avatar ${avatar} ${profile.avatar === avatar ? 'chosen' : ''}`} onClick={() => setProfile({ ...profile, avatar })}>{user.display_name.charAt(0).toUpperCase()}</button>)}</div><div className="form-row"><label>Display name<input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} required /></label><label>Age<input type="number" min="1" max="120" value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })} placeholder="Optional" /></label></div><button className="button primary">Save profile</button></form><form className="settings-card" onSubmit={changePin}><h2>Change PIN</h2><div className="form-row"><label>Current PIN<PinInput value={pins.currentPin} onChange={(currentPin) => setPins({ ...pins, currentPin })} placeholder="••••" required /></label><label>New PIN<PinInput value={pins.newPin} onChange={(newPin) => setPins({ ...pins, newPin })} placeholder="••••" required /></label></div><button className="button glass">Update PIN</button></form><section className="settings-card danger-zone"><h2>Delete account</h2><p>This permanently removes your profile, watchlist, and viewing history.</p><button className="button danger" onClick={remove}>Delete my account</button></section></div>;
}

function AdminPage({ currentUser, reloadUser }) {
  const [state, setState] = useState(null);
  const [message, setMessage] = useState('');
  const [newUser, setNewUser] = useState({ username: '', displayName: '', pin: '', role: 'user', maxContentRating: '' });
  const [playback, setPlayback] = useState({ provider: 'jellyfin', jellyfinUrl: '', jellyfinApiKey: '', movieTemplate: '', tvTemplate: '' });
  const load = useCallback(async () => { const data = await api('/api/admin'); setState(data); setPlayback({ provider: data.playbackProvider, jellyfinUrl: data.jellyfinUrl, jellyfinApiKey: '', movieTemplate: data.movieTemplate, tvTemplate: data.tvTemplate }); }, []);
  useEffect(() => { load(); }, [load]);
  async function saveToken(event) { event.preventDefault(); try { await api('/api/admin/settings', { method: 'PUT', body: { tmdbToken: event.currentTarget.tmdbToken.value } }); setMessage('TMDB connection saved.'); load(); event.currentTarget.reset(); } catch (e) { setMessage(e.message); } }
  async function savePlayback(event) { event.preventDefault(); try { const body = playback.provider === 'jellyfin' ? { playbackProvider: 'jellyfin', jellyfinUrl: playback.jellyfinUrl, jellyfinApiKey: playback.jellyfinApiKey } : { playbackProvider: 'custom', movieTemplate: playback.movieTemplate, tvTemplate: playback.tvTemplate }; await api('/api/admin/settings', { method: 'PUT', body }); setMessage(playback.provider === 'jellyfin' ? 'Jellyfin connected as the default player.' : 'Custom playback templates saved.'); load(); } catch (e) { setMessage(e.message); } }
  async function addUser(event) { event.preventDefault(); try { await api('/api/admin/users', { method: 'POST', body: newUser }); setNewUser({ username: '', displayName: '', pin: '', role: 'user', maxContentRating: '' }); setMessage('User created.'); load(); } catch (e) { setMessage(e.message); } }
  async function updateRestriction(id, maxContentRating) { try { await api(`/api/admin/users/${id}/restriction`, { method: 'PATCH', body: { maxContentRating } }); setMessage('Age restriction saved.'); await load(); if (id === currentUser.id) await reloadUser(); } catch (e) { setMessage(e.message); } }
  async function removeUser(id) { if (!confirm('Delete this user and all of their data?')) return; await api(`/api/admin/users/${id}`, { method: 'DELETE' }); load(); }
  if (!state) return <Spinner />;
  return <div className="page admin-page"><div className="page-title"><p className="eyebrow">Control room</p><h1>Administration</h1><p>Manage your household, catalogue connection, and playable media.</p></div>{message && <div className="toast-inline">{message}</div>}
    <div className="admin-grid"><form className="settings-card" onSubmit={saveToken}><div className="card-title"><span className="feature-icon"><Clapperboard /></span><div><h2>TMDB catalogue</h2><p>One free key powers metadata for every user.</p></div></div><label>API key or read access token<input name="tmdbToken" type="password" placeholder={state.tmdbConfigured ? `Connected · ${state.tmdbHint}` : 'Paste your TMDB key'} /></label><p className="help">Create a key at themoviedb.org/settings/api. Saving an empty field disconnects TMDB.</p><button className="button primary">Save connection</button></form>
      <form className="settings-card" onSubmit={savePlayback}><div className="card-title"><span className="feature-icon"><Clapperboard /></span><div><h2>Playback system</h2><p>Jellyfin is the default, timestamp-aware player.</p></div></div><label>Provider<select value={playback.provider} onChange={(event) => setPlayback({ ...playback, provider: event.target.value })}><option value="jellyfin">Jellyfin (recommended)</option><option value="custom">Custom embed templates</option></select></label>{playback.provider === 'jellyfin' ? <><label>Jellyfin server URL<input type="url" value={playback.jellyfinUrl} onChange={(event) => setPlayback({ ...playback, jellyfinUrl: event.target.value })} placeholder="http://jellyfin:8096" required /></label><label>Jellyfin API key<input type="password" value={playback.jellyfinApiKey} onChange={(event) => setPlayback({ ...playback, jellyfinApiKey: event.target.value })} placeholder={state.jellyfinConfigured ? `Connected · ${state.jellyfinHint}` : 'Paste an API key'} /></label><p className="help">CashVideo matches your Jellyfin library by TMDB ID and keeps the key server-side. Leave the key blank to keep the saved key. Each CashVideo profile keeps its own resume timestamp.</p></> : <><label>Movie iframe source template<input value={playback.movieTemplate} onChange={(event) => setPlayback({ ...playback, movieTemplate: event.target.value })} placeholder="https://website.com/embed/movie/{IMDb_ID}" /></label><label>TV iframe source template<input value={playback.tvTemplate} onChange={(event) => setPlayback({ ...playback, tvTemplate: event.target.value })} placeholder="https://website.com/{IMDb_ID}/{SEASON}/{EPISODE}" /></label><p className="help">Use <code>{'{IMDb_ID}'}</code> for the IMDb ID and <code>{'{SEASON}'}</code>/<code>{'{EPISODE}'}</code> for TV. The existing TMDB placeholders <code>{'{id}'}</code> and <code>{'{show}'}</code> remain supported. Use only a player you own or are authorised to embed.</p></>}<button className="button primary">Save playback system</button></form></div>
    <section className="settings-card"><div className="card-title"><span className="feature-icon"><Users /></span><div><h2>Household users</h2><p>{state.users.length} account{state.users.length !== 1 && 's'} on this server. Unrated titles are hidden from restricted profiles.</p></div></div><div className="user-table">{state.users.map((person) => <div className="user-row" key={person.id}><span className={`avatar ${person.avatar}`}>{person.display_name.charAt(0)}</span><span><b>{person.display_name}</b><small>@{person.username}</small></span><i>{person.role}</i><select className="restriction-select" aria-label={`Age restriction for ${person.display_name}`} value={person.max_content_rating ?? ''} onChange={(event) => updateRestriction(person.id, event.target.value)}><option value="">Unrestricted</option><option value="7">Up to age 7</option><option value="13">Up to age 13</option><option value="16">Up to age 16</option><option value="18">Up to age 18</option></select>{person.id === currentUser.id ? <small>You</small> : <button className="button danger subtle" onClick={() => removeUser(person.id)}>Remove</button>}</div>)}</div><form className="inline-form" onSubmit={addUser}><input placeholder="Display name" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} required /><input placeholder="Username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required /><PinInput value={newUser.pin} onChange={(pin) => setNewUser({ ...newUser, pin })} placeholder="4-digit PIN" aria-label="4-digit PIN" required /><select aria-label="Account role" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}><option value="user">Member</option><option value="admin">Admin</option></select><select aria-label="Age restriction" value={newUser.maxContentRating} onChange={(e) => setNewUser({ ...newUser, maxContentRating: e.target.value })}><option value="">Unrestricted</option><option value="7">Up to age 7</option><option value="13">Up to age 13</option><option value="16">Up to age 16</option><option value="18">Up to age 18</option></select><button className="button primary">Add user</button></form></section>
    {state.sources.length > 0 && <section className="settings-card"><h2>Linked media</h2><div className="source-list">{state.sources.map((item) => <div key={`${item.media_type}-${item.media_id}`}><span><b>{item.title}</b><small>{item.media_type} · TMDB {item.media_id}</small></span><button className="button danger subtle" onClick={async () => { await api(`/api/admin/sources/${item.media_type}/${item.media_id}`, { method: 'DELETE' }); load(); }}>Unlink</button></div>)}</div></section>}
  </div>;
}

export default function App() {
  const [status, setStatus] = useState('loading');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [user, setUser] = useState(null);
  const [catalogueData, setCatalogueData] = useState(null);
  const navigate = useNavigate();
  const loadUser = useCallback(async () => {
    try { const { user: current } = await api('/api/me'); setUser(current); setStatus('ready'); return true; }
    catch { setUser(null); const boot = await api('/api/bootstrap'); setNeedsSetup(boot.needsSetup); setProfiles(boot.profiles || []); setStatus('auth'); return false; }
  }, []);
  const loadCatalogue = useCallback(() => api('/api/catalogue').then(setCatalogueData), []);
  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { if (user) loadCatalogue(); }, [user, loadCatalogue]);
  async function logout(callApi = true) { if (callApi) await api('/api/auth/logout', { method: 'POST' }); setUser(null); setCatalogueData(null); setStatus('auth'); navigate('/'); }
  if (status === 'loading') return <div className="splash"><div className="brand"><Clapperboard fill="currentColor" /> Cash<span>Video</span></div><Spinner /></div>;
  if (!user) return <AuthScreen setup={needsSetup} profiles={profiles} onAuthenticated={loadUser} />;
  if (!catalogueData) return <div className="splash"><Spinner /></div>;
  return <Layout user={user} onLogout={logout}>
    <Routes>
      <Route path="/" element={<HomePage data={catalogueData} refresh={loadCatalogue} />} />
      <Route path="/discover" element={<DiscoverPage data={catalogueData} refresh={loadCatalogue} />} />
      <Route path="/watchlist" element={<GridPage title="My watchlist" subtitle="Everything you saved for later." items={catalogueData.watchlist} watchlist={catalogueData.watchlist} refresh={loadCatalogue} />} />
      <Route path="/profile" element={<ProfilePage user={user} reloadUser={loadUser} logout={logout} />} />
      <Route path="/admin" element={user.role === 'admin' ? <AdminPage currentUser={user} reloadUser={loadUser} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Layout>;
}
