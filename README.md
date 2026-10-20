# EuroLeague Assist Networks (2026-27)

An interactive 3D constellation of every EuroLeague club's assist network,
modelled on OptykMedia's NBA assist-network viewer. Each dot is a player
(size = assists given + received), each tube is a pair that has shared at
least 2 assists (thickness = count, the thick end is the usual passer).
Click a player to see their ego network, click a second to list every
assist between the two with links to the game.

Static site, no backend: a Python pipeline turns the EuroLeague live API
into JSON under `public/data/`, and the page (vanilla ES modules + three.js
+ d3-force-3d via an import map) reads those files.

## Update after new rounds

```bash
.venv/bin/python pipeline/fetch.py    # pulls only games not yet cached
.venv/bin/python pipeline/build.py    # rebuilds JSON, validates vs boxscores
.venv/bin/python pipeline/images.py   # fetches any new crests / headshots
```

First time: `python3 -m venv .venv && .venv/bin/pip install requests networkx numpy`.

## Run locally

```bash
python3 pipeline/serve.py 8765        # http://127.0.0.1:8765 (no-cache static server)
```

Any static host works for deployment (GitHub Pages, Cloudflare Pages):
publish the folder as-is. `pipeline/cache/` and `.venv/` are ignored.

## Layout

- `pipeline/fetch.py` — games list, play-by-play, boxscores, rosters → `pipeline/cache/`
- `pipeline/build.py` — assist pairing (`AS` row ↔ preceding made shot), top-12 per club,
  edges ≥ `MIN_EDGE`, modularity (networkx greedy communities), league quintiles, `meta.json`
- `pipeline/images.py` — crests → `public/logos/`, headshots → `public/headshots/`
- `scripts/classes/` — `App` (wiring), `Data` (JSON), `World` (three.js scene, focus/pair
  state machine), `Force` (d3-force-3d), `Label` (HTML labels), `Stats` (graph metrics),
  `Sidebar` (metric cards, rank popovers, info modal), `Plays` (pair panel), `Filters`
  (team picker), `teamColors` (club accents)

Metric definitions (edge density, out-degree entropy, modularity, pass–score
asymmetry, HITS hub/authority, pair rank) are in `scripts/classes/Sidebar.js`.
