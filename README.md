# PAL Tech Composer

Hosted browser-based composer for Pop-A-Lock of Northern NJ's tech roster and
battery / other-SVC scores. (Renamed from "PAL Tech Roster & Scores Composer"
in v2.1 — same three tabs, same features, shorter name.)  Sends the three
emails the AI Navigator monitor watches for:

- **Battery Scores** (`Name: 1-5`)
- **Other SVC Scores** (`Name: 1-3`)
- **Tech Roster Update** (`Name | role | aliases | email` -- aliases / email optional)

## Usage

Bookmark the deployed URL and open it. **The Sheet is the source of truth for
both the roster and the scores.** The composer fetches it on open, whenever the
app becomes visible again, and on **Refresh from Sheet** (Settings tab). Edit the
Sheet, then send. No local launcher needed.

- **Battery Scores tab** — `battery_tech` and `battery_installer` techs.
- **Other SVC Scores tab** — `rs` (road service) techs.
- **Tech Roster tab** — review the roster and send a Roster Update so the
  monitor's `techs.json` (the source of truth for ROLE) stays current.

### Why scores live in the Sheet

Scores used to be typed into the composer and kept in each browser's
`localStorage`. That made every navigator's copy an independent replica: the
composer had no way to show what anyone else had set, and because a send emits
*every* score the browser holds — not just the ones changed that session — each
send replayed one person's private history over everyone else's newer values.
Central state converged on whoever sent last rather than whoever knew last.

Sourcing scores from the Sheet fixes this without changing the send logic: every
composer now replays the *same* state, so a full-set send becomes self-healing
instead of destructive. The score inputs are read-only in the app for the same
reason the roster rows are — edit the Sheet, refresh, then send.

A **blank** score cell means "no opinion": that tech is omitted from the email
body, and `scores_watcher` leaves their existing score untouched. It does not
erase anything.

Sheet columns: `Canonical Name, Role, Aliases, Email, Phone, Phone 2,
Battery Score, Other SVC Score`. The two score columns are optional — with a
Sheet that lacks them the composer falls back to the old per-browser entry
behaviour, so adding them can be done at any time.

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
