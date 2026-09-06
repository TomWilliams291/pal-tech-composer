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
app becomes visible again, and on **Refresh from Sheet** (Settings tab). No
local launcher needed.

- **Battery Scores tab** — `battery_tech` and `battery_installer` techs.
  Type the score in the box; it is saved to the Sheet as you type (see
  *Score write-back* below). Then **Open in Gmail** to send the set to the
  monitor.
- **Other SVC Scores tab** — `rs` (road service) techs. Same.
- **Tech Roster tab** — review the roster and send a Roster Update so the
  monitor's `techs.json` (the source of truth for ROLE) stays current. Roster
  rows (name, role, aliases, email, phones) are edited in the Sheet itself.

### Score write-back

Scores change twice a week; techs are added rarely. So the score boxes in the
app are editable, and **every change is written straight into the Sheet's
score column** for that tech, with a `saving… / saved to Sheet ✓ / not saved —
retry` marker on the row. Several people can use the app at once: writes are
per cell, so two navigators editing different techs never clobber each other,
and the same cell edited twice resolves to whoever saved last — the Sheet's own
rule. Whoever opens the app next sees the current Sheet values.

On open (and on every resume / refresh) the app reads the score cells directly
through the same endpoint rather than trusting only the published CSV, which
Google can hold back for several minutes after an edit.

The endpoint is a Google Apps Script Web app bound to the roster Sheet:
[`sheet_writeback.gs`](sheet_writeback.gs). One-time deploy, from the Google
account that owns the Sheet:

1. Open the roster Sheet → **Extensions → Apps Script**.
2. Replace the default `Code.gs` with the contents of `sheet_writeback.gs`.
   Save.
3. Optional: **Project Settings → Script Properties** → add `PAL_TOKEN` with
   any secret. When set, the app must send the same token (Settings tab).
4. **Deploy → New deployment → Web app** — *Execute as: Me*, *Who has access:
   Anyone*. Authorise when prompted. Copy the Web app URL (`…/exec`).
5. Paste it into the app's **Settings → Score write-back → Web app URL** and
   click **Test connection**. To spare every navigator that step, put the URL
   in `DEFAULT_WRITEBACK_URL` in `index.html`, bump `CACHE_NAME`, and push.

If you later edit the script, use **Deploy → Manage deployments → ✎ → New
version**; the `/exec` URL otherwise keeps serving the old code.

Without a write-back URL the score boxes are read-only and scores are changed
in the Sheet (the behaviour since 2026-08-20). A Sheet with no score columns at
all falls back to per-browser entry, as before.

### Why scores live in the Sheet

Scores used to be typed into the composer and kept in each browser's
`localStorage`. That made every navigator's copy an independent replica: the
composer had no way to show what anyone else had set, and because a send emits
*every* score the browser holds — not just the ones changed that session — each
send replayed one person's private history over everyone else's newer values.
Central state converged on whoever sent last rather than whoever knew last.

Sourcing scores from the Sheet fixes this without changing the send logic: every
composer now replays the *same* state, so a full-set send becomes self-healing
instead of destructive. Write-back keeps that property: the app never holds a
score the Sheet doesn't (a failed save is flagged on the row and again before
you send), so the send still replays the shared state.

A **blank** score cell means "no opinion": that tech is omitted from the email
body, and `scores_watcher` leaves their existing score untouched. It does not
erase anything.

Sheet columns: `Canonical Name, Role, Aliases, Email, Phone, Phone 2,
Battery Score, Other SVC Score`. The two score columns are optional — with a
Sheet that lacks them the composer falls back to the old per-browser entry
behaviour, so adding them can be done at any time.

**Columns are matched on header text, not position.** Order, column position,
capitalisation and surrounding spaces are all irrelevant; only the header wording
matters:

- Battery scale (1–5): a header containing `score` **and** `batt` —
  `Battery Score`, `Batt Score`.
- Other-SVC scale (1–3): a header containing `score` **and** one of `svc`,
  `other`, `road` — `Other SVC Score`, `SVC Score`, `Road Score`.

The Other-SVC match is deliberately strict rather than "any score column that
isn't battery", so that adding an unrelated column such as `Performance Score`
can't silently hijack the road-service score. A header that matches neither rule
is ignored, which is safe: those techs are left out of the email and the monitor
keeps whatever score it already holds. If a whole column reads as blank in the
app, check the header wording first.

`techs.json` role vocabulary: `rs`, `battery_tech`, `battery_installer`.

## Architecture

V2 of the Scores Composer — a deployed GitHub Pages PWA, modeled on the
Schedule Composer. Fetches the published-CSV Sheet directly (Google serves it
with `Access-Control-Allow-Origin: *`), caches the roster in localStorage for
offline opens, and queues emails to an Outbox when offline. Replaces the old
V1.0 local Python launcher + `/proxy`.

## Deploying

Served from Cloudflare at **https://tech.palnnj-tools.com/** (Worker
`pal-tech-composer`, static assets from this folder — see `wrangler.jsonc`).
Cloudflare's Git integration watches
`github.com/TomWilliams291/pal-tech-composer`, so:

**Pushing to `main` IS the deploy.** There is no manual step and no
`wrangler deploy` to run — the Cloudflare project is wired to the repo in the
dashboard, not by a workflow file in this repo. (There is no `.github/workflows`
here; don't conclude from that that deploys are manual.)

To verify a deploy landed, diff the live asset against the local one — a
published change is byte-identical:

```
curl -sS https://tech.palnnj-tools.com/ | wc -c     # compare with: wc -c < index.html
curl -sS https://tech.palnnj-tools.com/sw.js | grep CACHE_NAME
```

Bump `CACHE_NAME` in `sw.js` whenever a cached asset changes so clients pick up
the new version. Because the service worker is cache-first on the app shell, the
first open after a deploy still serves the old shell while the new worker
installs; the second open gets the new one.

## Files

- `index.html` — the composer
- `sheet_writeback.gs` — Apps Script Web app that saves scores into the Sheet
  (deployed on the Sheet, not served from here)
- `sw.js` — service worker (offline app shell)
- `manifest.webmanifest` — PWA manifest
- `icons/`, `favicon.ico` — PWA icons
- `PAL_Tech_Roster_Template.csv` — starter CSV for the canonical Sheet
- `Scores Composer V1.0.html`, `launch_composer.py` — legacy local-launcher
  version, kept for reference
