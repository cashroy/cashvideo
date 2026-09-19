# CashVideo

CashVideo is a private, self-hosted home cinema for a household. Each person gets an isolated profile, watchlist, viewing history, continue-watching state, and recommendations. The first account created is the administrator.

## Features

- First-run admin setup, household user management, securely hashed 4-digit PINs, login throttling, and 30-day sessions
- Per-user profiles, watchlists, history, progress, recommendations, and account deletion
- Trending, popular, search, artwork, and recommendations from TMDB using one admin-managed key
- Built-in Jellyfin playback matched by TMDB ID, plus custom embed templates and direct media overrides
- Responsive TV-friendly interface with no advertising or third-party player popups
- SQLite storage in one easy-to-back-up data directory
- Docker and Docker Compose deployment for TrueNAS SCALE

CashVideo intentionally does not bundle or connect to unlicensed streaming sites. TMDB supplies metadata only. An admin can link each TMDB title to a direct media URL they are authorised to use (for example, a URL from their own local media server).

## Run locally

Requirements: Node.js 22.5 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port 3000 and Vite proxies it during development.

For the production build:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

## TrueNAS SCALE setup

The simplest installation uses a TrueNAS Custom App with Docker Compose.

1. In TrueNAS, create a dataset such as `tank/apps/cashvideo`. Give the Apps service read/write access to it.
2. Open **System > Shell**, change into that dataset, and clone this repository:

   ```bash
   cd /mnt/tank/apps/cashvideo
   git clone https://github.com/cashroy/cashvideo.git app
   cd app
   ```

3. In **Apps > Discover Apps**, choose **Install via YAML** (called **Custom App** on some SCALE releases).
4. Paste the contents of `docker-compose.yml`, or run `docker compose up -d --build` from the `app` directory if Docker Compose is available in your SCALE release.
5. Open `http://TRUENAS-IP:3000`. CashVideo shows its first-run setup; the account created there becomes the administrator and chooses a 4-digit PIN.
6. In CashVideo, open **Admin** and add your TMDB key, Jellyfin connection, and household accounts.

The included Compose file stores the database in `./data`. For a Custom App created through the TrueNAS UI, replace `./data:/data` with the absolute dataset path `/mnt/tank/apps/cashvideo/data:/data` if its working directory differs from the clone.

### TMDB key

1. Create a free account at [The Movie Database](https://www.themoviedb.org/).
2. Open **Account Settings > API** and request an API key for personal use.
3. Paste either the v3 API key or v4 read access token into **CashVideo > Admin > TMDB catalogue**.

One key is stored server-side in SQLite and used for every CashVideo profile. It is never returned to browsers.

### Connect Jellyfin (default playback)

CashVideo uses Jellyfin as its default timestamp-aware provider. Jellyfin remains responsible for serving or transcoding media you own, while CashVideo keeps separate resume progress for every CashVideo profile.

1. Install Jellyfin from the TrueNAS app catalogue and add your movie and TV datasets.
2. Include TMDB IDs in filenames where possible, such as `Movie (2024) [tmdbid-12345]`. Jellyfin also identifies most normally named media automatically.
3. In Jellyfin, open **Dashboard > Advanced > API Keys**, create a key for CashVideo, and copy it.
4. In **CashVideo > Admin > Playback system**, leave **Jellyfin (recommended)** selected, enter the server URL and API key, then save.

When both apps share a container network, the URL is commonly `http://jellyfin:8096`. Otherwise use the Jellyfin LAN address, such as `http://TRUENAS-IP:8096`. The API key stays on the CashVideo server and is never returned to browsers. Jellyfin playlists and media are proxied through authenticated CashVideo routes so per-user resume remains isolated.

CashVideo searches Jellyfin by the TMDB ID supplied by its catalogue. For shows it then resolves the selected season and episode. Native playback reports the current timestamp to CashVideo every five seconds, as well as on pause, completion, and player exit. Resume seeks to that timestamp the next time the same profile opens the title.

To start a title at an explicit position, add seconds to the CashVideo page URL, for example `?t=95`. This URL value takes priority over saved progress for that player session; invalid or negative values are ignored.

### Custom playback templates

Select **Custom embed templates** in **Admin > Playback system** to use an authorised iframe player instead. Save one movie URL template and one TV URL template; CashVideo applies them automatically to every catalogue title. For example:

```text
Movie: https://website.com/embed/movie/{IMDb_ID}
TV:    https://website.com/{IMDb_ID}/{SEASON}/{EPISODE}
```

`{IMDb_ID}` is replaced with the title's IMDb ID. `{SEASON}` and `{EPISODE}` use the episode selected in the player. Lowercase placeholders work too. The existing `{id}`, `{show}`, `{title}`, and `{type}` placeholders remain available. Templates must be HTTP(S) URLs and contain an IMDb, TMDB, show, or title placeholder.

Embedded players run without the iframe `sandbox` attribute for compatibility with providers that require normal browser capabilities. Only configure a source you trust and are authorised to embed. The configured service must allow iframe embedding. Existing direct MP4, WebM, or HLS title overrides remain supported by the server and take precedence over a template.

Native MP4, WebM, and HLS sources resume at the user's saved timestamp. TV embeds resume at the saved season and episode. A custom iframe player can opt into exact timestamp resume with this origin-checked `postMessage` contract:

- Player to CashVideo: `{ type: "cashvideo:progress", currentTime, duration }`
- Player to CashVideo when finished: `{ type: "cashvideo:ended" }`
- CashVideo to player after load: `{ type: "cashvideo:resume", currentTime }`

CashVideo also recognises `vidcore:ended` as a completion event, but providers that do not publish timestamp and seek events cannot support reliable per-user timestamp resume. Starting playback opens a black, viewport-filling watch screen so the catalogue and details page are no longer visible. The browser Back button, Escape key, and in-player back button return to the previous CashVideo screen.

For a fully local setup, serve a read-only media dataset with a media server or reverse proxy and link its URLs. Do not expose the underlying dataset with write access.

### HTTPS and remote access

The supplied Compose file sets `COOKIE_SECURE=false` so sign-in works over HTTP on a trusted home LAN. If you place CashVideo behind an HTTPS reverse proxy, set `COOKIE_SECURE=true` and forward port 3000 only through that proxy. Do not expose port 3000 directly to the public internet.

### Backups and updates

Back up the entire `data` dataset. It contains `cashvideo.db` plus SQLite's temporary WAL files. Stop the app or use a TrueNAS snapshot for a consistent backup.

### Updating on TrueNAS SCALE

The application code can be rebuilt without deleting the `data` dataset. Your admin account, users, TMDB/Jellyfin settings, watchlists, and progress remain in that dataset, so do not remove or recreate it during an update.

1. In **Datasets**, take a snapshot of `tank/apps/cashvideo` (or at minimum its `data` child dataset).
2. Open **System > Shell** and update the checkout:

```bash
cd /mnt/tank/apps/cashvideo/app
git pull --ff-only
docker compose up -d --build
```

3. Confirm the replacement container is healthy:

```bash
docker compose ps
docker compose logs --tail=100 cashvideo
```

Then open `http://TRUENAS-IP:3000` and sign in normally. `docker compose up -d --build` replaces only the application container; the mounted `data` directory is retained.

If you deployed through **Apps > Installed > CashVideo** rather than running Compose from the shell, first run the same `git pull --ff-only` in the checkout. Then open the app's **Edit** screen and save/redeploy it so TrueNAS rebuilds from the updated checkout. Keep the host-path mount pointing at the existing `/mnt/tank/apps/cashvideo/data` dataset. The exact button names vary between SCALE releases, but use the app's edit/redeploy action rather than uninstalling it.

If the new version does not start, restore the TrueNAS snapshot and redeploy the prior checkout. Do not delete `data/cashvideo.db`, `data/cashvideo.db-wal`, or `data/cashvideo.db-shm` as part of troubleshooting.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `DATA_DIR` | `./data` | SQLite storage directory |
| `NODE_ENV` | — | Use `production` in containers |
| `COOKIE_SECURE` | automatic | Set `true` behind HTTPS or `false` for LAN HTTP |

## Validation

```bash
npm test
npm run build
```

TMDB attribution: This product uses the TMDB API but is not endorsed or certified by TMDB.
