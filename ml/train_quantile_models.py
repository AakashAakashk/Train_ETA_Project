

import os
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_pinball_loss

DATA_PATH = os.path.join("data", "cleaned_train_data.csv")
FEATURES_PATH = "model_features.txt"

if not os.path.exists(DATA_PATH):
    raise FileNotFoundError(f"Could not find {DATA_PATH}.")

if not os.path.exists(FEATURES_PATH):
    raise FileNotFoundError(
        f"Could not find {FEATURES_PATH}. Run train_model.py FIRST -- "
        f"this script reuses its feature list so both models stay in sync."
    )

print("Loading data...")
df = pd.read_csv(DATA_PATH)
df = df.dropna(subset=["delay"])
df["date"] = pd.to_datetime(df["date"])
print(f"  Rows: {len(df)}")

df = pd.get_dummies(df, columns=["station_zone", "type_code"], drop_first=False)

# use the EXISTING feature list from train_model.py, not a fresh one
with open(FEATURES_PATH) as f:
    features = [line.strip() for line in f if line.strip()]

# add any missing one-hot columns as all-zero (can happen if this run
# of the data doesn't contain every category the point model saw)
for feat in features:
    if feat not in df.columns:
        df[feat] = 0

print(f"\nUsing {len(features)} features (matched to existing model_features.txt)")

X = df[features]
y = df["delay"]

df_sorted = df.sort_values("date")
split_idx = int(len(df_sorted) * 0.8)
train_idx = df_sorted.index[:split_idx]
test_idx = df_sorted.index[split_idx:]

X_train, y_train = X.loc[train_idx], y.loc[train_idx]
X_test, y_test = X.loc[test_idx], y.loc[test_idx]

print(f"\nTrain rows: {len(X_train)}, Test rows: {len(X_test)}")

# ------------------------------------------------------------------
# Train ONE model that outputs all 3 quantiles at once
# (XGBoost 2.0+ native multi-quantile support)
# ------------------------------------------------------------------
print("\nTraining multi-quantile XGBoost model (p10, p50, p90)...")
quantiles = [0.1, 0.5, 0.9]

model = XGBRegressor(
    objective="reg:quantileerror",
    quantile_alpha=quantiles,
    n_estimators=200,
    max_depth=6,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
)
model.fit(X_train, y_train)

preds = model.predict(X_test)  # shape: (n_samples, 3) -> [p10, p50, p90]

print("\n--- Evaluation (pinball loss per quantile, lower is better) ---")
for i, q in enumerate(quantiles):
    loss = mean_pinball_loss(y_test, preds[:, i], alpha=q)
    print(f"  p{int(q*100)}: pinball loss = {loss:.3f}")

# sanity check: p10 <= p50 <= p90 should hold for most rows
valid_order = ((preds[:, 0] <= preds[:, 1]) & (preds[:, 1] <= preds[:, 2])).mean()
print(f"\n  Rows where p10 <= p50 <= p90 (should be ~100%): {valid_order*100:.1f}%")

model.save_model("eta_model_quantile.json")

print(f"\nSaved quantile model -> eta_model_quantile.json")
print(f"(reused existing model_features.txt -- not overwritten)")