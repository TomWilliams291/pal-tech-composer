# PAL Tech Composer

Hosted browser-based composer for Pop-A-Lock of Northern NJ's tech roster and
battery / other-SVC scores. (Renamed from "PAL Tech Roster & Scores Composer"
in v2.1 — same three tabs, same features, shorter name.)  Sends the three
emails the AI Navigator monitor watches for:

- **Battery Scores** (`Name: 1-5`)
- **Other SVC Scores** (`Name: 1-3`)
- **Tech Roster Update** (`Name | role | aliases`)

## Usage

Bookmark the deployed URL and open it. The roster (canonical names + roles +
aliases) is fetched directly from the shared Google Sheet on open — edit the
Sheet, and the composer reflects it on the next open or **Refresh from Sheet**
(Settings tab). No local launcher needed.

- **Battery Scores tab** — `battery_tech` and `battery_installer` techs.
- **Other SVC Scores tab** — `rs` (road service) techs.
- **Tech Roster tab** — review the roster and send a Roster Update so the
  monitor's `techs.json` (the source of truth for ROLE) stays current.

`techs.json` role vocabulary: `rs`, `battery_tech`, `battery_installer`.

## Architecture

V2 of the Scores Composer — a deployed GitHub Pages PWA, modeled on the
Schedule Composer. Fetches the published-CSV Sheet directly (Google serves it
with `Access-Control-Allow-Origin: *`), caches the roster in localStorage for
offline opens, and queues emails to an Outbox when offline. Replaces the old
V1.0 local Python launcher + `/proxy`.

## Deploying

Served from GitHub Pages.

1. Push this folder's contents to a public repo's `main` branch.
2. Repo **Settings → Pages**: source `Deploy from a branch`, branch `main`,
   folder `/ (root)`.
3. Distribute the published URL to navigators.

Bump `CACHE_NAME` in `sw.js` whenever a cached asset changes so clients pick up
the new version.

## Files

- `index.html` — the composer
- `sw.js` — service worker (offline app shell)
- `manifest.webmanifest` — PWA manifest
- `icons/`, `favicon.ico` — PWA icons
- `PAL_Tech_Roster_Template.csv` — starter CSV for the canonical Sheet
- `Scores Composer V1.0.html`, `launch_composer.py` — legacy local-launcher
  version, kept for reference
