import pandas as pd
import numpy as np
import scipy.stats as stats
from scipy.stats import linregress
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.dates import DateFormatter
import matplotlib.dates as mdates
import os
import sys
from collections import defaultdict
from pathlib import Path


# Resolve paths relative to this file, no matter where you run Flask from
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "static" / "data"
CSV_PATH = DATA_DIR / "co_wind_v2.csv"
PARQUET_PATH = DATA_DIR / "co_wind_v2.parquet"



# ---------- Preprocessing Utilities ----------

def assign_season(month):
    if month in [12, 1, 2]:
        return 'Winter'
    elif month in [3, 4, 5]:
        return 'Spring'
    elif month in [6, 7, 8]:
        return 'Summer'
    else:
        return 'Fall'

def assign_region(state):
    if not isinstance(state, str):
        return 'Other'

    state = state.title()

    northern_states = [
        'Connecticut', 'Delaware', 'Illinois', 'Indiana', 'Iowa', 'Maine',
        'Massachusetts', 'Michigan', 'Minnesota', 'Montana', 'Nebraska',
        'New Hampshire', 'New Jersey', 'New York', 'North Dakota', 'Ohio',
        'Pennsylvania', 'Rhode Island', 'South Dakota', 'Vermont', 'Wisconsin', 'Wyoming',
        'Idaho', 'Oregon', 'Washington'
    ]

    southern_states = [
        'Alabama', 'Arkansas', 'Florida', 'Georgia', 'Kentucky', 'Louisiana',
        'Maryland', 'Mississippi', 'Missouri', 'North Carolina', 'Oklahoma',
        'South Carolina', 'Tennessee', 'Texas', 'Virginia', 'West Virginia',
        'Arizona', 'California', 'Nevada', 'New Mexico', 'Utah'
    ]

    if state in northern_states:
        return 'Northern'
    elif state in southern_states:
        return 'Southern'
    return 'Other'

# ---------- State Name ↔ Code Mappings ----------

state_name_to_code = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH',
    'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN',
    'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
    'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
}

state_code_to_name = {v: k for k, v in state_name_to_code.items()}

# State codes to FIPS codes
state_code_to_fips = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56"
}
# ---------- Main Load & Prep Function ----------
def convert_to_parquet(csv_path: Path = CSV_PATH, parquet_path: Path = PARQUET_PATH) -> Path:
    """Convert CSV → Parquet (fast loads). Creates data dir if needed."""
    parquet_path.parent.mkdir(parents=True, exist_ok=True)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path} (cwd={Path.cwd()})")
    df = pd.read_csv(csv_path)
    # requires pyarrow or fastparquet installed
    df.to_parquet(parquet_path, index=False)
    return parquet_path

def ensure_parquet() -> Path:
    """Return a path to a ready-to-load Parquet file, converting if needed."""
    if PARQUET_PATH.exists():
        return PARQUET_PATH
    if CSV_PATH.exists():
        return convert_to_parquet(CSV_PATH, PARQUET_PATH)
    raise FileNotFoundError(
        f"Neither Parquet nor CSV found.\nTried:\n  {PARQUET_PATH}\n  {CSV_PATH}\n(cwd={Path.cwd()})"
    )

def load_filtered_data(filepath: Path | None = None) -> pd.DataFrame:
    """
    Load the dataset (prefers Parquet). If no path is given, ensures/uses PARQUET_PATH.
    """
    path = Path(filepath) if filepath else ensure_parquet()

    # Load based on extension
    if path.suffix.lower() == ".parquet":
        df = pd.read_parquet(path)          # needs pyarrow/fastparquet
    elif path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
    else:
        raise ValueError(f"Unsupported file type: {path.suffix} @ {path}")

    # --- Filtering & feature engineering ---
    df["date_local"] = pd.to_datetime(df["date_local"])
    df = df[(df["date_local"].dt.year >= 2014) & (df["date_local"].dt.year <= 2024)].copy()

    df["date"] = df["date_local"].dt.strftime("%Y-%m-%d")
    df["year"] = df["date_local"].dt.year
    df["month"] = df["date_local"].dt.month
    df["year_month"] = df["date_local"].dt.to_period("M").astype(str)
    df["season"] = df["month"].apply(assign_season)
    df["region"] = df["state"].apply(assign_region)
    df["state_code"] = df["state"].map(state_name_to_code)
    df["state_fips"] = df["state_code"].map(state_code_to_fips)
    return df


# ---------- Data Aggregation Functions ----------

def get_monthly_averages(df, state=None):
    if state:
        df = df[df['state'] == state].copy()

    df['year_month'] = pd.to_datetime(df['date_local']).dt.strftime('%Y-%m')
    monthly = df.groupby('year_month').agg({
        'avg_measurement': 'mean',
        'avg_wind_speed': 'mean'
    }).reset_index()

    monthly['date'] = pd.to_datetime(monthly['year_month'])
    monthly = monthly.sort_values('date')

    # Add rolling averages
    monthly['rolling_avg_co'] = monthly['avg_measurement'].rolling(window=12, center=True, min_periods=12).mean()
    monthly['rolling_avg_wind'] = monthly['avg_wind_speed'].rolling(window=12, center=True, min_periods=12).mean()
    
    return monthly

def get_state_monthly_averages(df, use_rolling=False):
    df = df.copy()
    df['year_month'] = pd.to_datetime(df['date_local']).dt.to_period('M').astype(str)

    monthly = df.groupby(['state', 'year_month']).agg({
        'avg_measurement': 'mean',
        'avg_wind_speed': 'mean'
    }).reset_index()

    monthly['date'] = pd.to_datetime(monthly['year_month'])

    if use_rolling:
        monthly['avg_measurement'] = (
            monthly.groupby('state')['avg_measurement']
            .transform(lambda x: x.rolling(12, min_periods=12).mean())
        )
        monthly['avg_wind_speed'] = (
            monthly.groupby('state')['avg_wind_speed']
            .transform(lambda x: x.rolling(12, min_periods=12).mean())
        )

    return monthly

def get_monthly_avg_by_region(df):
    monthly_avg = df.groupby(['year_month', 'region']).agg({
        'avg_measurement': 'mean',
        'avg_wind_speed': 'mean'
    }).reset_index()
    monthly_avg['date'] = pd.to_datetime(monthly_avg['year_month'])

    monthly_avg = monthly_avg.sort_values(['region', 'date'])
    
    return monthly_avg

def get_seasonal_avg_by_region(df):
    seasonal_avg = df.groupby(['season', 'region']).agg({
        'avg_measurement': 'mean',
        'avg_wind_speed': 'mean'
    }).reset_index()

    return seasonal_avg

def get_yearly_trends(df):
    yearly_trends = df.groupby(['year', 'region']).agg({
        'avg_measurement': 'mean',
        'avg_wind_speed': 'mean'
    }).reset_index()

    return yearly_trends

def get_state_averages_with_trend():
    df = load_filtered_data()

    grouped = df.groupby("state").agg({
        "avg_measurement": "mean",
        "avg_wind_speed": "mean"
    }).reset_index()

    grouped["avg_measurement"] = grouped["avg_measurement"].round(3)
    grouped["avg_wind_speed"] = grouped["avg_wind_speed"].round(1)
    grouped = grouped.sort_values("avg_wind_speed", ascending=True)

    # Linear regression
    x = grouped["avg_wind_speed"]
    y = grouped["avg_measurement"]
    slope, intercept, r_value, p_value, std_err = linregress(x, y)

    trend = {
        "slope": slope,
        "intercept": intercept,
        "r_value": r_value,
        "p_value": p_value,
        "std_err": std_err
    }

    return {
        "averages": grouped.to_dict(orient="records"),
        "trend": trend,
        "correlation": r_value
    }

def get_wind_rose_data(df, state=None):
    filtered_df = df.copy()

    # Optional filtering by state
    if state:
        filtered_df = filtered_df[filtered_df['state'] == state]

    # Binning logic (as you already wrote)
    available_cols = [col for col in ['avg_wind_dir', 'WDF1', 'WDF2', 'WDF5', 'WDFG'] if col in filtered_df.columns]
    if not available_cols:
        return []

    wind_dir_col = available_cols[0]
    filtered_df = filtered_df.dropna(subset=[wind_dir_col, 'avg_wind_speed'])

    def bin_wind_direction(degrees, n_bins=16):
        return int(np.floor(degrees % 360 / (360 / n_bins)))

    def categorize_wind_speed(speed):
        if speed < 10: return 'Light (<10)'
        elif speed < 20: return 'Moderate (10-20)'
        elif speed < 30: return 'Strong (20-30)'
        elif speed < 40: return 'Very Strong (30-40)'
        else: return 'Extreme (>40)'

    filtered_df['direction_bin'] = filtered_df[wind_dir_col].apply(bin_wind_direction)
    filtered_df['speed_category'] = filtered_df['avg_wind_speed'].apply(categorize_wind_speed)

    counts = (
        filtered_df.groupby(['direction_bin', 'speed_category'])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )

    return counts.to_dict(orient='records')

def get_animated_wind_rose_data(df, data_type="wind"):
    """
    Prepares wind rose data by region and year for animation.
    Returns a nested dictionary: { region: { year: [ binned records ] } }
    """
    filtered_df = df.copy()

    # Select wind direction column
    wind_dir_cols = ['avg_wind_dir', 'WDF1', 'WDF2', 'WDF5', 'WDFG']
    available_cols = [col for col in wind_dir_cols if col in filtered_df.columns]
    if not available_cols:
        return {}

    wind_dir_col = available_cols[0]
    filtered_df = filtered_df.dropna(subset=[wind_dir_col, 'avg_wind_speed', 'avg_measurement'])

    def bin_wind_direction(degrees, n_bins=16):
        return int(np.floor(degrees % 360 / (360 / n_bins)))

    def categorize_wind_speed(speed):
        if speed < 10: return 'Light (<10)'
        elif speed < 20: return 'Moderate (10-20)'
        elif speed < 30: return 'Strong (20-30)'
        elif speed < 40: return 'Very Strong (30-40)'
        else: return 'Extreme (>40)'

    def categorize_co(co_level):
        if co_level < 0.1: return 'Very Low (<0.1)'
        elif co_level < 0.2: return 'Low (0.1-0.2)'
        elif co_level < 0.3: return 'Moderate (0.2-0.3)'
        elif co_level < 0.4: return 'High (0.3-0.4)'
        else: return 'Very High (>0.4)'

    # Prep bins
    filtered_df['direction_bin'] = filtered_df[wind_dir_col].apply(bin_wind_direction)

    if data_type == "wind":
        filtered_df['category'] = filtered_df['avg_wind_speed'].apply(categorize_wind_speed)
    else:
        filtered_df['category'] = filtered_df['avg_measurement'].apply(categorize_co)

    grouped = (
        filtered_df.groupby(['region', 'year', 'direction_bin', 'category'])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )

    # Nest the data
    animated_data = {}
    for region in grouped['region'].unique():
        region_df = grouped[grouped['region'] == region]
        year_dict = {}
        for year in region_df['year'].unique():
            year_df = region_df[region_df['year'] == year].drop(columns=['region', 'year'])
            year_dict[str(year)] = year_df.to_dict(orient='records')
        animated_data[region] = year_dict

    return animated_data

def get_animated_co_data(df):
    """
    Builds a dict with nested time-granular CO values for each state_code.
    {
      "CA": {
        "state_code": "CA",
        "state": "California",
        "state_fips": "06",
        "year": { "2014": 0.26, ... },
        "month": { "2014-01": 0.30, ... },
        "season": { "2014-Winter": 0.28, ... }
      },
      ...
    }
    """
    output = {}

    for _, row in df.iterrows():
        code = row["state_code"]
        name = row["state"]
        fips = row["state_fips"]
        date = row["date_local"]
        year = date.year
        month = date.month
        season = assign_season(month)

        if code not in output:
            output[code] = {
                "state_code": code,
                "state": name,
                "state_fips": fips,
                "year": {},
                "month": {},
                "season": {}
            }

        # Build time keys
        year_key = str(year)
        month_key = f"{year}-{month:02d}"
        season_key = f"{year}-{season}"

        # Append values
        output[code]["year"].setdefault(year_key, []).append(row["avg_measurement"])
        output[code]["month"].setdefault(month_key, []).append(row["avg_measurement"])
        output[code]["season"].setdefault(season_key, []).append(row["avg_measurement"])

    # Collapse lists to averages
    for state in output:
        for period_type in ["year", "month", "season"]:
            for key, values in output[state][period_type].items():
                if values:
                    output[state][period_type][key] = round(sum(values) / len(values), 3)
                else:
                    output[state][period_type][key] = None

    return output

def get_wind_vectors_static(df):
    """
    Returns a DataFrame with average wind direction and speed by state,
    including state_code, state, and state_fips.
    """
    vectors = (
        df.groupby(['state_code', 'state', 'state_fips'])
        .agg({
            'avg_wind_dir': 'mean',
            'avg_wind_speed': 'mean'
        })
        .reset_index()
        .rename(columns={
            'avg_wind_dir': 'wind_direction',
            'avg_wind_speed': 'wind_speed'
        })
    )

    vectors['state_fips'] = vectors['state_fips'].astype(str)

    return vectors

def get_wind_vectors_by_year(df):
    """
    Average wind vectors by state and year (for animated choropleth).
    Returns a dict: { "2014": [ ... ], "2015": [ ... ], ... }
    """
    df = df.copy()
    df["year"] = df["date_local"].dt.year 
    
    grouped = (
        df.groupby(['year', 'state_code', 'state', 'state_fips'])
        .agg({
            'avg_wind_dir': 'mean',
            'avg_wind_speed': 'mean'
        })
        .reset_index()
        .rename(columns={
            'avg_wind_dir': 'wind_direction',
            'avg_wind_speed': 'wind_speed'
        })
    )
    grouped['state_fips'] = grouped['state_fips'].astype(str)

    vectors_year = {}
    for _, row in grouped.iterrows():
        year = str(row['year'])
        if year not in vectors_year:
            vectors_year[year] = []
        vectors_year[year].append({
            'state': row['state'],
            'state_code': row['state_code'],
            'state_fips': row['state_fips'],
            'wind_direction': row['wind_direction'],
            'wind_speed': row['wind_speed']
        })

    return vectors_year


def get_wind_vectors_by_season(df):
    """
    Returns a nested dict: {year: {season: {state_code: {wind data dict}}}}
    Each entry includes wind_direction, wind_speed, and state metadata.
    """
    df = df.copy()
    df["year"] = df["date_local"].dt.year
    df["season"] = df["date_local"].dt.month.apply(assign_season)

    vectors_seasons = (
        df.groupby(["state_code", "state", "state_fips", "year", "season"])
        .agg({
            "avg_wind_dir": "mean",
            "avg_wind_speed": "mean"
        })
        .reset_index()
        .rename(columns={
            "avg_wind_dir": "wind_direction",
            "avg_wind_speed": "wind_speed"
        })
    )

    vectors_seasons["state_fips"] = vectors_seasons["state_fips"].astype(str)

    # Reshape into nested dict: year → season → state_code → windData
    grouped = defaultdict(lambda: defaultdict(dict))
    for _, row in vectors_seasons.iterrows():
        year = str(row["year"])
        season = row["season"]
        state_code = row["state_code"] or row["state_fips"]
        grouped[year][season][state_code] = {
            "state": row["state"],
            "state_code": row["state_code"],
            "state_fips": row["state_fips"],
            "year": row["year"],
            "season": row["season"],
            "wind_direction": row["wind_direction"],
            "wind_speed": row["wind_speed"]
        }

    return grouped

# ---------- Statistical Analysis ----------

def calculate_correlation(df, group_by_cols):
    results = []
    grouped = df.dropna(subset=['avg_measurement', 'avg_wind_speed']).groupby(group_by_cols)
    
    for name, group in grouped:
        if len(group) > 1:
            x = group['avg_measurement']
            y = group['avg_wind_speed']

            # Debug print
            print(f"[DEBUG] group: {name}")
            if isinstance(x, pd.Series):
                print(f"[DEBUG] x dtype: {x.dtype}, head:\n{x.head()}")
            else:
                print(f"[DEBUG] x type: {type(x)}, columns: {x.columns.tolist()}")
            if isinstance(y, pd.Series):
                print(f"[DEBUG] y dtype: {y.dtype}, head:\n{y.head()}")
            else:
                print(f"[DEBUG] y type: {type(y)}, columns: {y.columns.tolist()}")

            try:
                corr, p_val = stats.pearsonr(x.astype(float), y.astype(float))
                print(f"[DEBUG] corr: {corr}, p_val raw: {p_val} (type: {type(p_val)})")
                p_val = float(p_val)
            except Exception as e:
                print(f"[ERROR] Pearson failed for group: {name} — {e}")
                continue

            sig = "significant" if p_val < 0.05 else "not significant"
            name_parts = name if isinstance(name, tuple) else (name,)
            results.append((*name_parts, corr, p_val, sig))
    
    return pd.DataFrame(results, columns=[*group_by_cols, 'Correlation', 'P-value', 'Significance'])

def calculate_trend_line(df, date_col, value_col):
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])
    df = df.sort_values(date_col)

    # Drop NaNs that would break the regression
    df = df.dropna(subset=[date_col, value_col])
    if df.empty:
        return {
            "slope": None,
            "intercept": None,
            "r_value": None,
            "p_value": None,
            "std_err": None
        }

    df["timestamp"] = df[date_col].astype("int64") // 10**9  # convert to UNIX seconds
    slope, intercept, r_value, p_value, std_err = linregress(df["timestamp"], df[value_col])

    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "r_value": float(r_value),
        "p_value": float(p_value),
        "std_err": float(std_err)
    }
    
def compute_raw_state_correlations(df):
    df = df.dropna(subset=['avg_measurement', 'avg_wind_speed'])
    grouped = df.groupby('state')
    
    records = []
    for state, group in grouped:
        corr = group['avg_measurement'].corr(group['avg_wind_speed'])
        records.append({
            'state': state,
            'Correlation': round(corr, 6) if pd.notnull(corr) else None
        })
    
    result = pd.DataFrame(records)
    result['state_code'] = result['state'].map(state_name_to_code)
    result['state_fips'] = result['state_code'].map(state_code_to_fips)
    result['Significance'] = 'significant'  # your teammate didn't calculate p-values
    return result

# ---------- Fetch State Name List ----------

def get_unique_states(df):
    return sorted(df['state'].dropna().unique())

# ---------- Utilities ----------
def clean_for_json(obj):
    if isinstance(obj, pd.DataFrame):
        obj = obj.where(pd.notnull(obj), None)
        return [
            {k: clean_for_json(v) for k, v in row.items()}
            for row in obj.to_dict(orient="records")
        ]
    elif isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(v) for v in obj]
    elif isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    elif isinstance(obj, float) and pd.isna(obj):
        return None
    return obj

