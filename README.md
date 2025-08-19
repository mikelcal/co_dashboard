# Carbon Monoxide Dashboard

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](#)
[![Flask](https://img.shields.io/badge/Flask-2.3%2B-000000?logo=flask&logoColor=white)](#)
[![D3.js](https://img.shields.io/badge/D3.js-v7-orange?logo=d3.js&logoColor=white)](#)
[![Pandas](https://img.shields.io/badge/Pandas-1.5%2B-150458?logo=pandas&logoColor=white)](#)
[![NumPy](https://img.shields.io/badge/NumPy-1.26%2B-013243?logo=numpy&logoColor=white)](#)
[![SciPy](https://img.shields.io/badge/SciPy-1.11%2B-654FF0?logo=scipy&logoColor=white)](#)

An interactive dashboard for visualizing **carbon monoxide (CO) pollution across the United States (2014–2024)** and its relationship to **wind patterns**.

Built with **Flask** (backend) and **D3.js** (frontend), the app provides multiple linked visualizations—including animated choropleths, wind rose diagrams, treemaps, and correlation charts—that let users explore trends over time, across states, and between environmental factors.

---

## Features

- **Overview Chart** – Compare U.S.‐level rolling averages of CO concentration and wind speed with trendlines and correlation estimates.
- **State Comparison** – Drill down into individual state CO and wind speed trends relative to the national average.
- **Grouped Bar Chart** – Compare states by average CO levels and wind speeds; highlights top/bottom performers.
- **Choropleth Maps**
  - *Static:* Average CO levels (2014–2024).
  - *Animated:* Yearly CO evolution.
  - *Correlation:* CO–wind correlations by state, with optional wind vector overlays.
- **Wind Rose Diagrams** – Polar plots showing the distribution of wind speeds and directions by state or region, including animated regional wind roses by year.
- **Treemap** – Compare state contributions to national CO pollution, filterable by region.
- **Seasonality Analysis** – Explore seasonal patterns of CO and wind behavior in northern vs. southern states.
- **Interactive Tooltips & Legends** – Hover for detailed stats, toggle trend lines, enable/disable overlays, and scrub through years.

---

## Architecture

- **Backend:** Flask (`w209.py`) serving API routes that preprocess and aggregate data with Pandas/NumPy (`data_prep.py`).
- **Frontend:** D3.js visualizations (`static/js/main.js`, `static/js/windVectors.js`) embedded in a Bootstrap layout (`templates/w209.html`), styled with custom CSS (`static/css/main.css`).
- **Data:** Preprocessed EPA air quality dataset (`static/data/co_wind_v2.csv`, filtered to 2014–2024).

APIs provide data to the frontend for choropleths, bar charts, trendlines, wind roses, treemaps, and seasonal comparisons.

---

## Installation & Setup

### Requirements
- Python 3.11+ (tested on 3.12)
- No Node build step required (static assets are served by Flask)
- Python dependencies: Flask, Flask-CORS, pandas, numpy, scipy, matplotlib, seaborn

If you don't have a `requirements.txt`, you can install directly:
```bash
pip install Flask Flask-Cors pandas numpy scipy matplotlib seaborn
```

### Quick Start
1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/CO-Dashboard.git
   cd CO-Dashboard
   ```

2. **Create & activate a virtual environment (conda example)**
   ```bash
   conda create -n co_dashboard python=3.12 -y
   conda activate co_dashboard
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   # or, see the pip line above if you don't have requirements.txt
   ```

4. **Place the dataset**
   - Ensure the file is available at `static/data/co_wind_v2.csv`.
   - If your path differs, update `csv_path` in `data_prep.py` accordingly.

5. **Run the app**
   ```bash
   python w209.py
   ```
   Visit: http://localhost:5000

> **Windows Tip:** If you run into path issues, confirm the absolute path set in `data_prep.py` (`csv_path`) points to your local `static/data/co_wind_v2.csv`. You can replace it with a project-relative path if preferred.

---

## API Endpoints

The frontend uses the following routes (served by `w209.py`). Methods are `GET` unless noted.

- `/states` — List of unique state names.
- `/us_data` — Full filtered dataset (2014–2024).
- `/correlation_data` — Region-level correlation of CO vs wind speed.
- `/state_averages` — Per-state averages with a global trend summary.
- `/seasonal_averages` — Seasonal averages split into Northern vs Southern regions.
- `/us_combo_data` — Monthly U.S. data with rolling averages and trend lines.

**State detail & comparisons**
- `/state_comparison` *(POST)* — Body: `{ "state": "California" }`; returns state vs U.S. monthly series and trend lines.
- `/wind_rose` *(POST)* — Body: `{ "state": "Georgia" }`; wind rose bin counts by direction and speed tier.
- `/wind_rose/animated?type=wind|co` — Animated stacks of regional wind or CO distribution by year.

**Maps**
- `/choropleth_data` — Static state averages for CO.
- `/choropleth_data/animated` — Yearly CO values by state for animation.
- `/co_wind_correlation` — Per-state correlation values for CO vs wind.
- `/wind_vectors/static` — Average wind vectors per state (direction & speed).
- `/wind_vectors/animated` — Wind vectors per state by year (for the animated map).
- `/wind_vectors/seasonal` — Wind vectors per state by (year, season).

> The frontend optionally fetches US TopoJSON from a local file: `static/data/states-10m.json`, and falls back to the `us-atlas` CDN if not found.

---

## File Structure

```
├── w209.py                      # Flask app, routes, API
├── data_prep.py                 # Data preprocessing & aggregation
├── templates/
│   └── w209.html                # Main dashboard page
├── static/
│   ├── css/
│   │   └── main.css             # Styles
│   ├── js/
│   │   ├── main.js              # D3 visualizations, charts, map logic
│   │   └── windVectors.js       # Wind overlay (vectors & trails)
│   └── data/
│       ├── co_wind_v2.csv       # Source dataset (2014–2024)
│       └── states-10m.json      # US map TopoJSON (optional local copy)
```

---

## Visualizations

- **US Overview (Combo Line Chart):** Rolling 12‑month averages of CO (ppm) and wind speed (mph), with optional trend lines and correlation label.
- **State vs US Charts:** Single-axis comparisons for CO and wind (state against national).
- **Grouped Bars by State:** Avg CO vs wind per state, with trend line across points and brush-to-filter interaction.
- **Treemap:** State contributions to national CO with region filters and reset.
- **Wind Roses:** State-level stacked radial histograms of wind direction × speed; animated regional wind roses by year.
- **Choropleths:** Static averages, animated yearly evolution, and correlation views; optional wind vector overlays with animated “trails.”

---

## Troubleshooting

- **CSV not found / path errors:** Update `csv_path` in `data_prep.py` to point at `static/data/co_wind_v2.csv` (absolute or relative).
- **TopoJSON missing:** The app falls back to the `us-atlas` CDN automatically; ensure internet access if the local file is absent.
- **CORS / local testing:** `Flask-CORS` is enabled; if embedding behind a proxy or path prefix, ensure fetch URLs match your mount path.

---

## Future Improvements

- Add live EPA data pipelines and/or scheduled refresh.
- Expand filters (year, season) to propagate across all linked views.
- Cloud deployment templates (Digital Ocean App) with environment-based data paths.
- Accessibility & mobile responsiveness polish.

---

## Credits

Developed for **UC Berkeley MIDS W209: Data Visualization**.

> Contributors: [Mikel Calderon](https://www.linkedin.com/in/mikelcal), [Carol Sanchez Garibay](https://www.linkedin.com/in/carol-sanchez-garibay), [Tracy Volz](https://www.ischool.berkeley.edu/people/tracy-volz)
