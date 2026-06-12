# CO Dashboard — Threat Analysis & Functionality Audit

*Audited 2026-06-10. Static code review of every file plus live verification against a local dev server (endpoint latencies and payload sizes below were measured, not estimated).*

---

## 1. Executive Summary

The app is architecturally sound for its purpose (static, pre-aggregated EPA + weather data served by Flask to a D3 frontend), and no injection or XSS vulnerabilities were found. The dominant risks are **resource-exhaustion** (one endpoint returns 112 MB of JSON per request; another burns ~4 s of CPU per request) and **deployment fragility** (a dependency used in code is missing from `requirements.txt`).

All three bugs you reported were root-caused:

1. **"Show Wind" toggle misbehaves across map modes** → a stale closure pins the toggle to the *static* wind data URL forever, and the overlay code can't parse the animated/seasonal payload shapes at all (it silently draws nothing). The `filterYear` parameter is accepted and then discarded.
2. **Animation doesn't represent wind-direction trends** → wind directions are averaged with an *arithmetic* mean of degrees (circular-mean bug: mean of 350° and 10° comes out 180°, the opposite direction), so the yearly/seasonal vectors are statistically wrong before they ever reach D3. The arrows also point *into* the wind (meteorological "from" convention rendered as "to").
3. **Wind-rose auto-progression broken** → the year index becomes a string after any slider scrub (`"5" + 1 = "51"`), the rose is fully torn down and rebuilt each frame with *re-computed scales*, so frames aren't visually comparable and the D3 transition code path is dead.

Severity counts: **3 High / 8 Medium / 12 Low** security & reliability findings, plus a prioritized TODO/TOFIX log of 40 items in §6.

---

## 2. Threat Analysis

### 2.1 High

| ID | Finding | Evidence | Fix |
|----|---------|----------|-----|
| SEC-01 | **Unbounded full-dataset dump.** `/us_data` serializes the entire filtered DataFrame to JSON. Measured: **112.1 MB, ~4.8 s server CPU per request.** The frontend never calls it. A handful of concurrent requests will exhaust worker memory/CPU (trivial DoS). Same pattern: `/state_data` (unused, unbounded). | `w209.py:32-40`; measured live | Delete both routes (nothing consumes them), or paginate + cap. |
| SEC-02 | **Expensive uncached endpoint.** `/choropleth_data/animated` runs `df.iterrows()` over every row per request. Measured: **3.86 s per request, recomputed on every click** of "Animated CO Evolution". No rate limiting anywhere. | `w209.py:172-177`, `data_prep.py:341-396`; measured live | Vectorize with `groupby` and compute **once at startup** (data is static). See PERF-01. |
| SEC-03 | **Deploy-breaking missing dependency.** `w209.py` imports `flask_cors`, but `requirements.txt` does not list `Flask-Cors`. A fresh `pip install -r requirements.txt` deploy crashes on import. All deps are also unpinned (silent supply-chain drift). | `w209.py:2` vs `requirements.txt` | Add `Flask-Cors` (or drop CORS entirely, see SEC-05) and pin versions (`pip freeze` or pip-tools). |

### 2.2 Medium

| ID | Finding | Evidence | Fix |
|----|---------|----------|-----|
| SEC-04 | Hardcoded session secret `"mids_209"`. Sessions aren't currently used, but any future `session`/`flash` use is forgeable. | `w209.py:7` | `os.environ.get("SECRET_KEY", secrets.token_hex(32))`. |
| SEC-05 | Global wildcard CORS on all routes. The app is same-origin (Flask serves its own frontend) — CORS is unnecessary surface. | `w209.py:6` | Remove `CORS(app)`, or scope to specific origins/routes if cross-origin embedding is intended. |
| SEC-06 | CDN scripts for D3 and TopoJSON are version-floating (`d3@7`, `topojson@3`) with **no SRI hashes** (Bootstrap has them — inconsistent). A compromised or breaking upstream publish flows straight into your page. | `templates/w209.html:496-499` | Pin exact versions + `integrity`/`crossorigin`, or vendor the two files locally (no build step needed). |
| SEC-07 | `debug=True` in both entrypoints. If ever run directly on a reachable host, the Werkzeug debugger is interactive RCE. | `app.py:15`, `w209.py:205` | `app.run(debug=os.environ.get("FLASK_DEBUG") == "1")`. |
| SEC-08 | No security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`). | global | Add a small `@app.after_request` or set at the proxy. CSP is realistic here since scripts are enumerable. |
| SEC-09 | Input validation: POST bodies are trusted. Wrong content-type → 415/500 stack-path responses; unknown/garbage state (verified with `{"state":"<script>…"}`) → HTTP 200 with empty series instead of 400/404. No injection found (pandas equality filter + JSON responses; frontend inserts names via `textContent`), but error behavior is sloppy and burns compute on junk. | `w209.py:36-40, 94-115, 140-147`; probed live | `request.get_json(silent=True)`, validate `state` against `get_unique_states()`, return 400/404 JSON errors. |
| SEC-10 | **Unrelated 25 MB SQLite database tracked in git.** `players_20.db` (header verified: SQLite 3; it's a FIFA-players dataset) ships with every clone of your portfolio repo. | repo root | `git rm`, and if you care about history size, purge with `git filter-repo`. |
| SEC-11 | Repo/data hygiene: `co_wind_v2.parquet` (19.5 MB) is a plain git blob while the CSV is in LFS; `.gitignore` is 2 lines; `images/` contains DigitalOcean console screenshots — review them for account identifiers/emails before treating the repo as a public portfolio. | `.gitattributes`, `images/` | Track parquet in LFS (or generate it at boot from the CSV and gitignore it), expand `.gitignore`, audit screenshots. |

### 2.3 Low

- **SEC-12** `target="_blank"` links lack `rel="noopener noreferrer"` (`w209.html:60, 93, 115`). Modern browsers mitigate, but add it.
- **SEC-13** EPA citations go through `tinyurl.com` (`w209.html:60, 394`) — a mutable third-party redirect in a public dashboard. Link directly to epa.gov.
- **SEC-14** `print()` debug statements in `calculate_correlation` (`data_prep.py:512-527`) log request-driven data frames to stdout on every `/us_combo_data` call — log noise/leak channel.
- **SEC-15** `gunicorn_config.py` binds `0.0.0.0:8080` with no `preload_app`; 2 workers each duplicate the full DataFrame in RAM. Add `preload_app = True` (copy-on-write sharing) and bind behind a proxy.

---

## 3. Root-Cause Analysis of Your Three Reported Bugs

### 3.1 Wind toggle ("Show Wind") behaves differently per condition — CONFIRMED, four interacting causes

1. **Stale closure on the data URL.** The checkbox listener is registered once inside `loadUSMapData(mode)`, called exactly once with `"static"` (`main.js:523-536`, called at `main.js:770`). So `dataUrl: WIND_VECTOR_URLS[mode]` is frozen to `/wind_vectors/static` *forever* — toggling wind on in Animated or Correlation mode fetches the 2014–2024 static averages, never the per-year data. **Fix:** resolve `WIND_VECTOR_URLS[currentMapMode]` inside the handler at event time.
2. **Animated/seasonal payload shapes are unparseable by the overlay.** `toggleWindOverlay` (`windVectors.js:129-134`) only understands a flat array or `{byState}`. The year-keyed (`{"2014":[…]}`) and year→season-keyed payloads fall through to `data = []` — so when `drawMap`/`updateMap` refresh the overlay in animated mode (which *do* pass the correct URL), the arrows silently vanish. **Fix:** in `toggleWindOverlay`, when the cache is year-keyed, select `cache[filterYear]` (and `cache[year][season]` for seasonal).
3. **`filterYear` is accepted and discarded.** `updateMap` passes `filterYear` (`main.js:285-292`) and `toggleWindOverlay` forwards it, but `drawWindTrails`' destructured options omit it (`windVectors.js:168-178`) — dead parameter. **Fix:** filter the bound data by year before drawing, or implement cause-2's selection upstream.
4. **Tooltip cache mismatch.** Tooltips look up wind via `getWindByAbbr(abbr, {mode:"animated"|"seasonal"})`, which reads `windDataCache` keyed by URL — but because of cause 1 only the static URL was ever fetched, so tooltips show "Wind: No data" in animated mode even with the overlay on.

Also: the debounce wrapper (`main.js:10`, 1500 ms) is shorter than the 2000 ms animation tick, so the entire trail layer is torn down and rebuilt nearly every frame.

### 3.2 Animation doesn't represent wind-direction trends — CONFIRMED, the data is wrong before D3 sees it

1. **Circular-mean bug (the big one).** `get_wind_vectors_static/by_year/by_season` all do `.agg({'avg_wind_dir': 'mean'})` (`data_prep.py:398-498`) — an arithmetic mean of compass degrees. Mean of 350° and 10° is **180°** (due south) instead of 0° (north). Every rendered vector, and therefore every year-over-year "trend," is biased; states with northerly winds are hit worst. **Fix:** vector-average — `np.degrees(np.arctan2(np.mean(np.sin(rad)), np.mean(np.cos(rad)))) % 360`, optionally speed-weighted. *(Note: the per-day `avg_wind_dir` column itself, e.g. 165.4° vs WDF1 125° in row 1 of the CSV, suggests the upstream county aggregation has the same flaw — worth regenerating if you still have the pipeline.)*
2. **Arrows point INTO the wind.** `wind_direction` (WDF*/avg_wind_dir) is the direction wind blows *from* (meteorological convention). `drawWindTrails` rotates a line drawn toward (0, −len) by that angle (`windVectors.js:199-205`), so the animated "flow" travels toward the source. **Fix:** `rotate(${angle + 180})` for flow semantics, or barb-style glyphs + a legend note for the "from" convention.
3. **Nothing actually animates between years.** Trail segments loop an opacity fade in place; on each year tick the group is destroyed and redrawn. There's no rotation/length interpolation, so direction *change* over time — the trend you want to showcase — is never visually encoded. **Fix:** keep a persistent selection keyed by state and `transition()` the rotate/length between years.
4. **Units are suspect.** Sample rows show daily `avg_wind_speed` of 34–50 labeled "mph" (sustained gale, every day, in New Jersey — not credible). GHCN-Daily AWND/WSF raw units are **tenths of m/s** (34 → 3.4 m/s ≈ 7.6 mph, which *is* plausible). The speed-category bins (`<10` light … `>40` extreme) and every "mph" axis label inherit this. **Verify and relabel/convert** — for a data-science portfolio this is the kind of thing reviewers check.

### 3.3 Wind-rose auto-progression broken — CONFIRMED, three causes

1. **String-index bug.** The slider handler does `windYearIndex = e.target.value` (a **string**, `main.js:2484-2487`). Next autoplay tick: `("5" + 1) = "51"`, then `"51" % 11 = 7` → playback teleports to the wrong year after any scrub, every time. **Fix:** `windYearIndex = +e.target.value;` (and pause the timer while scrubbing — currently autoplay fights the user's drag).
2. **Full teardown + per-frame rescaling.** `drawWindRose` starts with `container.selectAll("*").remove()` (`main.js:2263`), so the `.join()` update/transition branch below it is dead code. Worse, `radiusScale` and `angleScale` domains are recomputed *from each frame's data* (`main.js:2315-2323`): the radial scale jumps between years and sectors shift position whenever a direction bin is empty — the "progression" reads as random flicker instead of a trend. **Fix:** compute one global max across all years/regions for the radius domain; fix the angle domain to `d3.range(16)`; keep the SVG and transition arcs between frames.
3. **Self-refetch ignores its argument.** `DOMContentLoaded` fetches `/wind_rose/animated?type=wind` and passes the data in (`main.js:762-768`), but `startStackedWindRoseAnimation()` takes no parameters and fetches `/wind_rose/animated` again (`main.js:2415-2418`) — duplicate request, and the `type` param is silently dropped (works today only because `wind` is the default).

**Related progression bug you didn't mention:** the *map's* seasonal progression plays in alphabetical order — season keys sort as `2014-Fall → 2014-Spring → 2014-Summer → 2014-Winter` (`main.js:340`, keys from `data_prep.py:381`). Seasons run Fall→Spring→Summer→Winter instead of calendar order. Fix with an explicit season-order comparator (and decide whether December belongs to the following year's winter).

---

## 4. Performance Findings (measured)

| Endpoint | Latency | Payload | Issue |
|---|---|---|---|
| `/us_data` | 4,799 ms | **112.1 MB** | Unused; delete (SEC-01) |
| `/choropleth_data/animated` | 3,863 ms | 234 KB | `iterrows()` over full df per request (SEC-02) |
| `/us_combo_data` | 498 ms | 37 KB | Recomputes monthly aggregates + correlation (with debug prints) per request |
| `/state_averages` | 459 ms | 5 KB | Calls `load_filtered_data()` → re-reads parquet from disk per request (`data_prep.py:214`) |
| `/treemap_data` | 437 ms | 5 KB | Same re-read (`w209.py:119`) — and the frontend fetches it **twice at page load** plus once per legend toggle |
| `/wind_rose/animated` | 288 ms | 105 KB | Fetched twice at page load (§3.3) |
| Everything else | 22–136 ms | — | Fine |

Backend: all of this is static data — compute every aggregate **once at startup** (or `functools.lru_cache` the prep functions) and these all become ~5 ms dict lookups. Also: `matplotlib`/`seaborn` are imported in `data_prep.py` but never used in the serving path (startup time + ~100 MB RSS per worker); `altair`, `networkx`, `scikit-learn` in requirements are unused entirely.

Frontend: a document-level click listener (`main.js:2060-2077`) rebuilds the entire grouped bar chart on **any** click anywhere outside it (including dropdown interactions); wind-rose + map animations autoplay on page load while off-screen, and wind trails run ~200 infinite looping transitions (49 states × 4 layers) — gate with `IntersectionObserver` and respect `prefers-reduced-motion`.

---

## 5. Data-Correctness & Visualization-Craft Findings

These matter most for the "exemplary D3/data-science portfolio" goal:

- **DV-01** Correlation map claims every state is "✅ Significant" — `Significance` is hardcoded `'significant'` (`data_prep.py:578`, acknowledged in the comment). Displaying fabricated significance is the single worst credibility item in the app. Compute `scipy.stats.pearsonr` p-values (you already do this in `calculate_correlation`).
- **DV-02** Circular-mean wind direction (§3.2.1) — also affects tooltips' "Direction: X°" everywhere.
- **DV-03** Wind-speed units (§3.2.4) — verify mph vs tenths-of-m/s; bins, axis labels, tooltips, and the seasonal chart's hardcoded `[0, 40]` domain all depend on it.
- **DV-04** Wind-rose sector labeling is off by half a bin: data bins are `[0°, 22.5°)` edge-aligned (`data_prep.py:259-260`) but sectors are labeled with centered cardinal names; `degreesToCardinal` uses ±11.25° centering — the "N" sector actually spans N→NNE. Either offset binning by 11.25° or relabel.
- **DV-05** Wind-rose direction labels are placed at the sector's *start* angle, not its center (`main.js:2379-2380` — missing `+ angleScale.bandwidth()/2`).
- **DV-06** `angleScale` domain comes from bins present in the data (`main.js:2316-2318`) — roses distort when bins are empty. Use `d3.range(16)`.
- **DV-07** Seasonal bar charts: x-axis in alphabetical season order and hardcoded y-domains (`main.js:2103-2119`).
- **DV-08** Grouped bar chart "Top 3 / Bottom 3" recomputes on the brushed subset, so "Top 3 CO" is true only of the filtered view — misleading badge. Also four in-place `.sort()` calls mutate the bound data (`main.js:1788-1811`).
- **DV-09** The regression line drawn across a categorical state axis (`main.js:1896-1904`) implies a trend over an arbitrary ordering; the wind→CO relationship would be honest and more impressive as a scatter with a fitted line + r/p annotation (you already have the stats from `/state_averages`).
- **DV-10** Correlation coefficients are passed to both the combo chart and bar chart but the display code is commented out (`main.js:1147-1154, 1954-1963`) — the dashboard's central statistical claim is currently invisible.
- **DV-11** DC is absent from `state_name_to_code` (`data_prep.py:64-76`) while present in the FIPS map — any DC rows silently get NaN codes and drop out of every map.
- **DV-12** Tooltip crash risk: `updateTooltip` dereferences `meta.state` without a guard (`main.js:100-104`) — hovering a state missing from `animatedData` throws.

---

## 6. TODO / TOFIX Log (prioritized)

**P0 — broken behavior & security, fix first** *(all completed 2026-06-10; verified live in-browser: animated mode + wind toggle draws 50 year-specific arrows, scrub→play resumes correctly, zero console errors)*

- [x] **FIX** `main.js` — wind-overlay `dataUrl` now resolved from `currentMapMode` at event time via `getCurrentFilterYear()`; stale closure removed (§3.1.1)
- [x] **FIX** `windVectors.js` — new `selectWindRecords()` normalizes all three payload shapes and applies `filterYear`/`filterSeason` (§3.1.2)
- [x] **FIX** `windVectors.js` — year filtering now happens upstream in `toggleWindOverlay`; dead `filterYear` pass-through removed (§3.1.3)
- [x] **FIX** `main.js` — slider value coerced with `+e.target.value`; autoplay pauses on scrub; map scrub also syncs `currentIndex` so play resumes from the scrubbed frame (§3.3.1)
- [x] **FIX** `data_prep.py` — `circular_mean_degrees()` (vector mean) used in all three wind-vector functions (§3.2.1)
- [x] **FIX** `data_prep.py` — real `pearsonr` p-values; hardcoded significance removed (verified: Wyoming now "not significant", r=-0.02, p=0.17) (DV-01)
- [x] **REMOVE** `w209.py` — `/us_data` and `/state_data` routes deleted; both verified 404 (SEC-01)
- [x] **FIX** dependencies — `CORS(app)` removed entirely (same-origin app); `requirements.txt` pinned and slimmed to the six real runtime deps (SEC-03, SEC-05)
- [x] **FIX** `templates/w209.html` — `chartsContainer` attribute quoting repaired; class list restored

**P1 — performance & the animation rework** *(all completed 2026-06-11; verified live in-browser at :5050: zero console errors; animated-CO endpoint 3863 ms → 4 ms; single treemap + wind-rose fetch at load; arrows update per year; rose persists as one SVG; seasonal charts in calendar order with mph axis)*

- [x] **PERF** `data_prep.py` — `get_animated_co_data` vectorized with `groupby` (no more `iterrows` over 686k rows); all static payloads precomputed once at startup in `w209.py` (measured: `/choropleth_data/animated` 3863 ms → 4 ms, treemap/state_averages/combo ~0 ms) (SEC-02)
- [x] **PERF** `w209.py`, `data_prep.py` — `/treemap_data`, `/state_averages`, and every other route now serve module-level precomputed objects; no per-request parquet re-reads (`get_state_averages_with_trend` takes the shared `full_df`)
- [x] **PERF** `main.js` — treemap fetched once into `treemapData` cache; legend toggles filter client-side via `renderTreemapFromCache()`; redundant load-time fetch removed
- [x] **FIX** `main.js` — `startStackedWindRoseAnimation(data)` uses its passed data; duplicate argument-less fetch removed, `?type=` honored
- [x] **REWORK** wind-rose animation: global radius domain (`buildWindRoseScales`/`windRoseRadiusMax`), fixed `d3.range(16)` angle domain, 16-bin normalization, persistent `rose-root` SVG with arc transitions; labels centered at sector mid-angle (§3.3.2, DV-06, DV-05)
- [x] **REWORK** wind-vector animation: one persistent arrow per state (line + arrowhead) keyed by `state_fips`, rotate/length transitions between years; flipped to flow semantics (`wind_direction + 180`); length via mph scale (§3.2.2-3)
- [x] **FIX** season ordering: `sortSeasonKeys`/`seasonRank` calendar-order comparator applied to map seasonal progression and seasonal bar charts (verified: Winter→Spring→Summer→Fall) (§3.3 note, DV-07)
- [x] **VERIFY** wind-speed units — confirmed GHCN tenths-of-m/s (raw mean 35 → 7.4 mph); converted to mph once in `load_filtered_data` (invalid <0 / >500 dropped), so all "mph" labels/bins are now truthful; seasonal `[0,40]` domain replaced with dynamic mph domain (DV-03)
- [x] **FIX** `main.js` — reset-brush logic moved off the document-wide click listener onto a dedicated `#resetBrushButton` (added to `w209.html`)
- [x] **PERF** wind-rose autoplay gated by `IntersectionObserver` (starts on scroll-into-view) and `prefers-reduced-motion` (verified: suppressed under reduced-motion); wind trails honor reduced-motion too
- [x] **REMOVE** debug `print()`s in `data_prep.py` `calculate_correlation` and the active `console.log`s in `main.js`

**P2 — security hardening & repo hygiene**

- [x] Secret key from environment with dev-only fallback (`w209.py`) (SEC-04) — *Done 2026-06-10*
- [x] Validate POST `state` against known states; return 400/404 JSON; `get_json(silent=True)` (SEC-09) — *Done 2026-06-11: `_require_state()` helper on `/state_comparison` + `/wind_rose`; verified valid→200, unknown→404, missing→400, non-JSON→400.*
- [x] Pin + SRI (or vendor) the D3 and TopoJSON CDN scripts (SEC-06) — *Done 2026-06-11: pinned d3@7.9.0 + topojson@3.0.2 with sha384 SRI (byte-identical to the floating tags); verified d3 7.9.0 loads in-browser.*
- [x] Gate `debug=True` behind `FLASK_DEBUG=1` env var in `app.py`/`w209.py` (SEC-07) — *Done 2026-06-10*
- [x] Add security headers via `@app.after_request` (SEC-08) — *Done 2026-06-11: CSP (strict `script-src`, no `unsafe-inline`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; verified zero CSP violations, all CDN scripts/fonts/charts load.*
- [x] ~~`git rm players_20.db` (25 MB unrelated FIFA SQLite) (SEC-10)~~ — *Done 2026-06-10: purged from history with `git filter-repo`, `*.db` gitignored, rewrite force-pushed.*
- [x] Move `co_wind_v2.parquet` to LFS or generate at boot; expand `.gitignore`; audit `images/` screenshots for account info (SEC-11) — *Done 2026-06-11: parquet `git rm --cached` + gitignored (regenerated at boot from the LFS CSV); `.gitignore` expanded; the 9 DigitalOcean console screenshots removed from the repo.*
- [x] `rel="noopener noreferrer"` on `target="_blank"` links; replace tinyurl with direct EPA URLs (SEC-12, SEC-13) — *Done 2026-06-11: both `tinyurl.com/mubjf8wv` links → `https://www.epa.gov/report-environment/indoor-air-quality`; `rel` added to all external links.*
- [x] `preload_app = True` in `gunicorn_config.py` (SEC-15) — *Done: already present, binds loopback `127.0.0.1:5000`.*
- [x] Remove unused heavy imports (`matplotlib`, `seaborn` from `data_prep.py`) and unused requirements (`altair`, `networkx`, `scikit-learn`, `seaborn`, `matplotlib`) — *Done 2026-06-10*

**P3 — polish & craft (portfolio impact)**

> **DECISION (2026-06-12):** Add the **wind-vs-CO scatter** as a new visualization (no viz-switcher toggle for now). Done — see below.

- [x] **NEW VIZ** wind-vs-CO scatter (DV-09): per-state points (x = avg wind mph, y = avg CO PPM), backend `trend` regression line, and an honest `r`/`p` significance annotation. Added `#windCoScatter` card under the "Relationship…" section, `drawWindCoScatter()` in `main.js` wired into the existing `/state_averages` fetch (no backend change). *(Done 2026-06-12: verified live at :5050 — 50 points, fitted line, "r = -0.32, p = 0.021 (significant)", zero console errors.)*
- [x] Re-enable correlation annotations on combo + bar charts (DV-10) — *Done 2026-06-12: both un-commented with numeric guards; relabeled to distinguish the two distinct statistics — combo = "U.S. Wind–CO correlation over time: r = 0.158" (temporal), bar/scatter = "Cross-state Wind–CO correlation: r = -0.325" (spatial). Verified live.*
- [x] ~~Update `#stWindRoseTitle` on state change~~ — already handled (`main.js` updates both `#stateTitle` and `#stWindRoseTitle`; verified "Wind Rose Chart – Georgia").
- [x] Guard `updateTooltip` against missing state meta (DV-12) — already guarded (`if (!meta) return;`); **add DC to `state_name_to_code` (DV-11)** — *Done 2026-06-12 (defensive; DC isn't in the 50-state dataset, but the mapping now matches the FIPS map).*
- [x] Wind-rose half-bin label alignment (DV-04) and label centering (DV-05) — *Done 2026-06-12: binning offset by +11.25° so bin 0 = true N (`data_prep.py`, both rose functions); arcs + labels centered on each bearing in `drawWindRose`. Verified live: N/E/S/W land at top/right/bottom/left on all 3 roses.*
- [x] Honest Top-3/Bottom-3 on brushed subsets; replace in-place sorts with copies (DV-08) — *Done 2026-06-12: ranked against the full national dataset (`fullDataSet`) so badges stay truthful when brushed; `[...arr].sort()` copies, no more mutation of bound data.*
- [x] Fix loader CSS — *Done 2026-06-12: removed the overriding `display:flex` from all four loader rules (`#treemapLoader`, `#mapLoader`, `.chart-loader-overlay`, `#groupedBarLoader`); base state is now `display:none`, JS supplies `flex` inline when showing.*
- [x] Remove `max="X"` placeholder attrs on range inputs; remove dead footer social links; update © year — *Done 2026-06-12: both `max="X"` removed (JS sets `.max`); footer socials + their orphaned `<symbol>` defs deleted; © 2025 → 2026.*
- [x] Deduplicate: `degreesToCardinal` ×2, `WIND_VECTOR_URLS` ×2, `getValue` ×2; delete unused `listenersAttached`, `windVectors.js` globals — *Done 2026-06-12: `degreesToCardinal`/`WIND_VECTOR_URLS` now exported from `windVectors.js` and imported into `main.js`; redundant second `getValue` removed; `listenersAttached`, `hoveredWindElement`, `windArrowSelection` deleted. Verified live: no console errors.*
- [x] **VERIFY** wind-vector direction (per goal) — *Confirmed correct 2026-06-12: `wind_direction` is the meteorological "from" bearing; `rotate(wind_direction + 180)` with the up-pointing base arrow renders flow-to semantics. Live DOM check: CA/NY (from W) → arrows point E; TX (from SE) → NW; 33/50 states flow east, matching US prevailing westerlies.*
- [x] Mobile: drop `background-attachment: fixed` on touch/small screens (janks on iOS) — *Done 2026-06-12 via `@media (hover: none), (max-width: 768px)`.* Fixed-width card/margin audit still open.
- [x] Accessibility (partial) — *Done 2026-06-12: `aria-label`s on both scrubber sliders and all four icon-only play/pause buttons (`aria-hidden` on the glyphs).* Broader pass (chart text alternatives, non-color encodings, keyboard/touch tooltips) still open.
- [ ] **Deferred (own session):** Split the 3,144-line `main.js` into per-chart ES modules; finish the accessibility pass (chart `<title>`/`aria` descriptions, non-color encodings, keyboard tooltip access); finish the mobile audit of fixed-width cards and `margin-top` offsets.

---

## 7. What's Already Good

Worth saying explicitly: path handling via `pathlib` with parquet fast-loading and CSV fallback is clean; the local-TopoJSON-with-CDN-fallback pattern is nice; `healthz` exists; SRI is on the Bootstrap assets; the frontend consistently uses `textContent`/JSON (no XSS found); and the linked-view structure (combo → state drill-down → map modes → roses → seasonality) is a genuinely good dashboard narrative. The fixes above are mostly about making the wind story *statistically true* and the animations *legible* — the bones are solid.
