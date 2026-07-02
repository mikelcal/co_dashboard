import os

from flask import Flask, render_template, request, jsonify
import data_prep

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-not-secret")

# Load pre-filtered 2014–2024 data once
full_df = data_prep.load_filtered_data()

# Pre-compute monthly averages for the entire dataset
# and add rolling averages
us_monthly = data_prep.get_monthly_averages(full_df)
us_co_trend = data_prep.calculate_trend_line(us_monthly, "date", "rolling_avg_co")
us_wind_trend = data_prep.calculate_trend_line(us_monthly, "date", "rolling_avg_wind")


def _build_treemap_nodes(df):
    co_by_state = (
        df.groupby(["state", "region"])["avg_measurement"]
        .mean()
        .reset_index()
        .sort_values("avg_measurement", ascending=False)
    )
    nodes = [{"id": "US", "parentId": "", "value": None, "region": None}]
    for _, row in co_by_state.iterrows():
        nodes.append({
            "id": row["state"],
            "parentId": "US",
            "value": round(row["avg_measurement"], 3),
            "region": row["region"],
        })
    return nodes


def _build_us_combo():
    df_with_region = full_df.copy()
    df_with_region["region"] = "US"
    us_df = data_prep.get_monthly_averages(df_with_region)
    us_df["region"] = "US"
    correlation_df = data_prep.calculate_correlation(us_df, group_by_cols=["region"])
    correlation = correlation_df["Correlation"].iloc[0] if not correlation_df.empty else None
    return {
        "us_monthly": data_prep.clean_for_json(us_df),
        "us_trend": {
            "co": data_prep.clean_for_json(data_prep.calculate_trend_line(us_df, "date", "rolling_avg_co")),
            "wind": data_prep.clean_for_json(data_prep.calculate_trend_line(us_df, "date", "rolling_avg_wind")),
        },
        "correlation": correlation,
    }


def _build_seasonal_averages():
    seasonal_df = data_prep.get_seasonal_avg_by_region(full_df)
    seasonal_df["region"] = seasonal_df["region"].str.title()
    seasonal_df["season"] = seasonal_df["season"].str.title()
    return {
        "north": seasonal_df[seasonal_df["region"] == "Northern"].to_dict(orient="records"),
        "south": seasonal_df[seasonal_df["region"] == "Southern"].to_dict(orient="records"),
    }


# ---------- Precomputed static payloads ----------
# The dataset never changes at runtime, so every aggregate is computed once here
# instead of per request (the animated CO endpoint alone was ~3.9 s/request).
STATES = data_prep.get_unique_states(full_df)
STATES_SET = set(STATES)
CORRELATION_DATA = data_prep.calculate_correlation(full_df, ['region']).to_dict(orient='records')
STATE_AVERAGES = data_prep.get_state_averages_with_trend(full_df)
SEASONAL_AVERAGES = _build_seasonal_averages()
MONTHLY_CLIMATOLOGY = data_prep.get_monthly_climatology(full_df)
US_COMBO_DATA = _build_us_combo()
TREEMAP_NODES = _build_treemap_nodes(full_df)
ANIMATED_WIND_ROSE = {
    "wind": data_prep.get_animated_wind_rose_data(full_df, "wind"),
    "co": data_prep.get_animated_wind_rose_data(full_df, "co"),
}
CHOROPLETH_DATA = (
    full_df.groupby(['state_code', 'state_fips', 'state'])['avg_measurement']
    .mean()
    .reset_index()
    .rename(columns={'avg_measurement': 'avg_co'})
    .to_dict(orient='records')
)
ANIMATED_CHOROPLETH_DATA = data_prep.get_animated_co_data(full_df)
CO_WIND_CORRELATION = data_prep.compute_raw_state_correlations(full_df).to_dict(orient="records")
WIND_VECTORS_STATIC = data_prep.clean_for_json(data_prep.get_wind_vectors_static(full_df))
WIND_VECTORS_BY_YEAR = data_prep.clean_for_json(data_prep.get_wind_vectors_by_year(full_df))
WIND_VECTORS_BY_SEASON = data_prep.clean_for_json(data_prep.get_wind_vectors_by_season(full_df))

@app.after_request
def set_security_headers(response):
    # Scripts are all enumerable (self + jsdelivr CDN), so we can keep a strict
    # script-src with no 'unsafe-inline'. Styles need 'unsafe-inline' for the
    # template's inline style="" attributes and D3's .style() calls.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' https://cdn.jsdelivr.net; "
        # jsdelivr allowed for the us-atlas TopoJSON CDN fallback (main.js:571)
        "connect-src 'self' https://cdn.jsdelivr.net; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "object-src 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.route("/", methods=["GET", "POST"])
def w209():
    return render_template("w209.html")

# ---------- API ROUTES ----------
@app.route("/healthz")
def healthz():
    return {"ok": True}, 200

@app.route("/states")
def get_states():
    return jsonify(STATES)

@app.route("/correlation_data", methods=["GET"])
def correlation_data():
    return jsonify(CORRELATION_DATA)

@app.route("/state_averages")
def state_averages():
    return jsonify(STATE_AVERAGES)

@app.route("/seasonal_averages")
def seasonal_averages():
    return jsonify(SEASONAL_AVERAGES)

@app.route("/monthly_climatology")
def monthly_climatology():
    return jsonify(MONTHLY_CLIMATOLOGY)

# ---------- CHART LOGIC ----------
@app.route("/us_combo_data")
def us_combo_data():
    return jsonify(US_COMBO_DATA)


def _require_state():
    """Parse the JSON body safely and validate `state`. Returns (state, None)
    on success or (None, (response, status)) on failure."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None, (jsonify({"error": "Request body must be JSON"}), 400)
    state = body.get("state")
    if not state:
        return None, (jsonify({"error": "Missing 'state'"}), 400)
    if state not in STATES_SET:
        return None, (jsonify({"error": f"Unknown state: {state}"}), 404)
    return state, None


@app.route("/state_comparison", methods=["POST"])
def state_comparison():
    state, err = _require_state()
    if err:
        return err

    state_monthly = data_prep.get_monthly_averages(full_df, state=state)

    co_state_trend = data_prep.calculate_trend_line(state_monthly, "date", "rolling_avg_co")
    wind_state_trend = data_prep.calculate_trend_line(state_monthly, "date", "rolling_avg_wind")

    return jsonify({
        "state": state,
        "state_monthly": data_prep.clean_for_json(state_monthly),
        "state_trend": {
            "co": co_state_trend,
            "wind": wind_state_trend
        },
        "us_monthly": data_prep.clean_for_json(us_monthly),
        "us_trend": {
            "co": us_co_trend,
            "wind": us_wind_trend
        }
    })

@app.route("/treemap_data")
def treemap_data():
    return jsonify(TREEMAP_NODES)

@app.route("/wind_rose", methods=["POST"])
def wind_rose():
    selected_state, err = _require_state()
    if err:
        return err

    wind_data = data_prep.get_wind_rose_data(full_df, selected_state)
    return jsonify(wind_data)

@app.route("/wind_rose/animated")
def animated_wind_rose():
    data_type = request.args.get("type", "wind")  # defaults to 'wind' if not provided
    if data_type not in ANIMATED_WIND_ROSE:
        return jsonify({"error": "Invalid data type"}), 400
    return jsonify(ANIMATED_WIND_ROSE[data_type])

@app.route("/choropleth_data")
def choropleth_data():
    return jsonify(CHOROPLETH_DATA)

@app.route("/choropleth_data/animated")
def animated_choropleth_data():
    return jsonify(ANIMATED_CHOROPLETH_DATA)

@app.route("/co_wind_correlation")
def co_wind_correlation():
    return jsonify(CO_WIND_CORRELATION)

@app.route("/wind_vectors/static")
def state_wind_vectors():
    return jsonify(WIND_VECTORS_STATIC)

@app.route("/wind_vectors/animated")
def wind_vectors_animated():
    return jsonify(WIND_VECTORS_BY_YEAR)

@app.route("/wind_vectors/seasonal")
def wind_vectors_seasonal():
    return jsonify(WIND_VECTORS_BY_SEASON)

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
