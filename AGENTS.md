# Repository Guidelines

## Project Structure & Modules
- `w209.py`: Flask app entrypoint serving `templates/w209.html` and all API routes.
- `data_prep.py`: Loads and aggregates CO + wind data (monthly averages, correlations, wind vectors); expects data in `static/data/co_wind_v2.csv` or the parquet equivalent; keep large artifacts in Git LFS.
- `templates/`: Jinja/HTML layout for the dashboard. `static/` holds `js/main.js`, `js/windVectors.js`, `js/loaderUtils.js`, styles in `css/main.css`, and supporting assets in `images/` and `data/`.
- `requirements.txt`: Python dependencies; `gunicorn_config.py`: process config for production deployments.

## Build, Test, and Development Commands
- `python -m venv .venv && .venv\Scripts\activate` (Windows) or `source .venv/bin/activate` (macOS/Linux) then `pip install -r requirements.txt` to set up.
- `python w209.py` to run the Flask dev server at `http://localhost:5000`.
- `gunicorn -c gunicorn_config.py w209:app` for a production-like run (ensure data files are present in `static/data`).
- `curl http://localhost:5000/healthz` to verify the service is up before UI testing.

## Coding Style & Naming Conventions
- Python: follow PEP 8 with 4-space indents; snake_case for functions/variables; uppercase constants; group imports stdlib/third-party/local.
- JavaScript: camelCase for variables and D3 helpers; keep selections and containers clearly named; prefer readable line wraps (~100 cols).
- Paths: use `pathlib.Path` and repo-relative paths (`static/data`) instead of hard-coded absolutes.
- Formatting: keep functions small and pure where possible; add concise comments only when logic is non-obvious.

## Testing Guidelines
- No automated suite yet; before opening a PR, run `python w209.py` and exercise key views (overview, state comparison, animated choropleths, wind roses).
- Validate API payloads with quick calls: `curl http://localhost:5000/state_averages` or `curl -X POST http://localhost:5000/wind_rose -H "Content-Type: application/json" -d '{"state":"California"}'`.
- When modifying data prep logic, spot-check aggregates against source rows and note any assumptions in the PR.

## Commit & Pull Request Guidelines
- Commits: short, present-tense summaries (mirroring history like `add parquet for fast file loading`); keep each commit focused.
- PRs: include a clear description, linked issue/goal, setup steps (data location, env vars), and screenshots/GIFs for UI or visual changes.
- If altering endpoints or data schema, document breaking changes and update README/API notes alongside the code.

## Security & Data Notes
- Do not commit secrets; the existing `app.secret_key` is development-only—use environment variables for production configs.
- Keep large datasets under `static/data` and prefer Git LFS for new binaries; avoid adding personal or sensitive data to the repo.
- Validate and sanitize request bodies for new endpoints to keep JSON responses consistent and safe for the D3 frontend.
