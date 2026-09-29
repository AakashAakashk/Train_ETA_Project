
import os
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, r2_score

pd.set_option("display.width", 120)

DATA_PATH = os.path.join("data", "cleaned_train_data.csv")

# ------------------------------------------------------------------
# 1. LOAD -- and refuse to continue if the real file is missing
# ------------------------------------------------------------------
if not os.path.exists(DATA_PATH):
    raise FileNotFoundError(
        f"Could not find {DATA_PATH}. This script will NOT generate fake "
        f"data. Please place your real cleaned_train_data.csv there first."
    )

print("Loading data...")
df = pd.read_csv(DATA_PATH)
print(f"  Rows: {len(df)}, Columns: {list(df.columns)}")

if len(df) < 50:
    print(f"  WARNING: only {len(df)} rows found -- this looks too small "
          f"to be your real dataset. Double check the file.")

# ------------------------------------------------------------------
# 2. CLEAN
# ------------------------------------------------------------------
before = len(df)
df = df.dropna(subset=["delay"])   # delay is our target -- must exist
print(f"  Dropped {before - len(df)} rows with missing delay")

df["date"] = pd.to_datetime(df["date"])

# ------------------------------------------------------------------
# 3. ENCODE CATEGORICALS (station_zone, type_code)
# ------------------------------------------------------------------
df = pd.get_dummies(df, columns=["station_zone", "type_code"], drop_first=False)

# ------------------------------------------------------------------
# 4. FEATURE LIST
# ------------------------------------------------------------------
base_features = [
    "hour_of_day", "day_of_week", "month", "is_weekend", "is_peak_hour",
    "distance_from_origin", "section_historical_avg_delay",
    "cumulative_delay_so_far",
]
encoded_features = [
    c for c in df.columns
    if c.startswith("station_zone_") or c.startswith("type_code_")
]
features = base_features + encoded_features

print(f"\nUsing {len(features)} features:")
print(f"  {features}")

X = df[features]
y = df["delay"]

# ------------------------------------------------------------------
# 5. TRAIN/TEST SPLIT -- by TIME, not random (mimics real deployment)
# ------------------------------------------------------------------
df_sorted = df.sort_values("date")
split_idx = int(len(df_sorted) * 0.8)
train_idx = df_sorted.index[:split_idx]
test_idx = df_sorted.index[split_idx:]

X_train, y_train = X.loc[train_idx], y.loc[train_idx]
X_test, y_test = X.loc[test_idx], y.loc[test_idx]

print(f"\nTrain rows: {len(X_train)}, Test rows: {len(X_test)}")

# ------------------------------------------------------------------
# 6. TRAIN
# ------------------------------------------------------------------
print("\nTraining XGBoost model...")
model = XGBRegressor(
    n_estimators=200,
    max_depth=6,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
)
model.fit(X_train, y_train)

# ------------------------------------------------------------------
# 7. EVALUATE
# ------------------------------------------------------------------
preds = model.predict(X_test)
mae = mean_absolute_error(y_test, preds)
r2 = r2_score(y_test, preds)

print(f"\n--- Evaluation ---")
print(f"MAE  (avg error in minutes): {mae:.2f}")
print(f"R^2  (fit quality, 0-1):     {r2:.3f}")

# ------------------------------------------------------------------
# 8. FEATURE IMPORTANCE
# ------------------------------------------------------------------
importance = pd.Series(model.feature_importances_, index=features).sort_values(ascending=False)
print(f"\n--- Top 15 Feature Importances ---")
print(importance.head(15).to_string())

# ------------------------------------------------------------------
# 9. SAVE MODEL + feature list
# ------------------------------------------------------------------
model.save_model("eta_model.json")
with open("model_features.txt", "w") as f:
    f.write("\n".join(features))

print(f"\nSaved model -> eta_model.json")
print(f"Saved feature list -> model_features.txt ({len(features)} features)")