from flask import Flask, render_template, request, redirect, url_for, jsonify, session
from flask_cors import CORS
import data_prep

app = Flask(__name__)
CORS(app)
app.secret_key = "mids_209"

# Load pre-filtered 2014–2024 data once
full_df = data_prep.load_filtered_data()

# Pre-compute monthly averages for the entire dataset
# and add rolling averages
us_monthly = data_prep.get_monthly_averages(full_df)
us_co_trend = data_prep.calculate_trend_line(us_monthly, "date", "rolling_avg_co")
us_wind_trend = data_prep.calculate_trend_line(us_monthly, "date", "rolling_avg_wind")

@app.route("/", methods=["GET", "POST"])
def w209():
    return render_template("w209.html")

# ---------- API ROUTES ----------
@app.route("/healthz")
def healthz():
    return {"ok": True}, 200

@app.route("/states")
def get_states():
    states = data_prep.get_unique_states(full_df)
    return jsonify(states)

@app.route("/us_data", methods=["GET"])
def us_data():
    return jsonify(full_df.to_dict(orient='records'))

@app.route("/state_data", methods=["POST"])
def state_data():
    selected_state = request.json.get('state')
    filtered = full_df[full_df['state'] == selected_state]
    return jsonify(filtered.to_dict(orient='records'))

@app.route("/correlation_data", methods=["GET"])
def correlation_data():
    corr_df = data_prep.calculate_correlation(full_df, ['region'])
    return jsonify(corr_df.to_dict(orient='records'))

@app.route("/state_averages")
def state_averages():
    from data_prep import get_state_averages_with_trend
    return jsonify(get_state_averages_with_trend())

@app.route("/seasonal_averages")
def seasonal_averages():
    df = full_df
    seasonal_df = data_prep.get_seasonal_avg_by_region(df)

    # Confirm casing is consistent
    seasonal_df['region'] = seasonal_df['region'].str.title()
    seasonal_df['season'] = seasonal_df['season'].str.title()

    north = seasonal_df[seasonal_df['region'] == 'Northern'].to_dict(orient='records')
    south = seasonal_df[seasonal_df['region'] == 'Southern'].to_dict(orient='records')

    return jsonify({
        "north": north,
        "south": south
    })

# ---------- CHART LOGIC ----------
@app.route("/us_combo_data")
def us_combo_data():
    df_with_region = full_df.copy()
    df_with_region['region'] = 'US'
    
    us_df = data_prep.get_monthly_averages(df_with_region)

    # Add a dummy group for compatibility with the existing function
    us_df['region'] = 'US'

    correlation_df = data_prep.calculate_correlation(us_df, group_by_cols=['region'])
    correlation = correlation_df['Correlation'].iloc[0] if not correlation_df.empty else None

   # print(data_prep.clean_for_json(us_df))
    return jsonify({
        "us_monthly": data_prep.clean_for_json(us_df),
        "us_trend": {
            "co": data_prep.clean_for_json(data_prep.calculate_trend_line(us_df, "date", "rolling_avg_co")),
            "wind": data_prep.clean_for_json(data_prep.calculate_trend_line(us_df, "date", "rolling_avg_wind"))
        },
        "correlation": correlation
    })


@app.route("/state_comparison", methods=["POST"])
def state_comparison():
    state = request.json.get("state")

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
    df = data_prep.load_filtered_data()

    # Group by state and region to get avg CO
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
            "region": row["region"]
        })

    return jsonify(nodes)

@app.route("/wind_rose", methods=["POST"])
def wind_rose():
    selected_state = request.json.get('state')

    df = full_df
    wind_data = data_prep.get_wind_rose_data(df, selected_state)

    return jsonify(wind_data)

@app.route("/wind_rose/animated")
def animated_wind_rose():
    data_type = request.args.get("type", "wind")  # defaults to 'wind' if not provided

    df = full_df
    if data_type not in ["wind", "co"]:
        return jsonify({"error": "Invalid data type"}), 400

    data = data_prep.get_animated_wind_rose_data(df, data_type)
    return jsonify(data)

@app.route("/choropleth_data")
def choropleth_data():
    df = full_df
    
    state_avg = (
    df.groupby(['state_code','state_fips', 'state'])['avg_measurement']
    .mean()
    .reset_index()
    .rename(columns={'avg_measurement': 'avg_co'})
)
    return jsonify(state_avg.to_dict(orient='records'))

@app.route("/choropleth_data/animated")
def animated_choropleth_data():
    df = full_df
    
    data = data_prep.get_animated_co_data(df)
    return jsonify(data)

@app.route("/co_wind_correlation")
def co_wind_correlation():
    df = full_df  # ensure this is raw daily data
    corr_df = data_prep.compute_raw_state_correlations(df)
    return jsonify(corr_df.to_dict(orient="records"))

@app.route("/wind_vectors/static")
def state_wind_vectors():
    df = full_df
    wind_vectors = data_prep.get_wind_vectors_static(df)

    return jsonify(data_prep.clean_for_json(wind_vectors))

@app.route("/wind_vectors/animated")
def wind_vectors_animated():
    df = full_df
    vectors_by_year = data_prep.get_wind_vectors_by_year(df)
    return jsonify(data_prep.clean_for_json(vectors_by_year))

@app.route("/wind_vectors/seasonal")
def wind_vectors_seasonal():
    df = full_df
    grouped_data = data_prep.get_wind_vectors_by_season(df)
    return jsonify(data_prep.clean_for_json(grouped_data))

if __name__ == "__main__":
    app.run(debug=True)
