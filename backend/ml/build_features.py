"""
build_features.py
-------------------
This is the bridge between your cleaned dataset/trained model and a LIVE
prediction request. Given a train_no and the station it's currently
heading to, this builds the exact 28-value feature vector eta_model.json
expects (same order as model_features.txt), using cleaned_train_data.csv
as the historical reference table.

This is the core logic Pranaya's FastAPI /eta endpoint will call.

Usage (standalone test):
    python build_features.py

Usage (from FastAPI):
    from build_features import ETAPredictor
    predictor = ETAPredictor()
    result = predictor.predict(train_no=1023, station="JJR", current_delay=6)
"""

import pandas as pd
import numpy as np
import os
from datetime import datetime, timedelta
from xgboost import XGBRegressor


class ETAPredictor:
    def __init__(
        self,
        model_path="eta_model.json",
        features_path="model_features.txt",
        data_path="data/cleaned_train_data.csv",
        quantile_model_path="eta_model_quantile.json",
    ):
        # load trained model (point prediction)
        self.model = XGBRegressor()
        self.model.load_model(model_path)

        # load quantile model (p10/p50/p90), if available -- optional,
        # so existing code keeps working even before this is trained
        self.quantile_model = None
        if os.path.exists(quantile_model_path):
            self.quantile_model = XGBRegressor()
            self.quantile_model.load_model(quantile_model_path)

        # load exact feature order the model expects
        with open(features_path) as f:
            self.feature_order = [line.strip() for line in f if line.strip()]

        # load historical dataset -- used as lookup reference for
        # section averages, zones, distances, train type, etc.
        self.history = pd.read_csv(data_path)
        self.history["date"] = pd.to_datetime(self.history["date"])

        # precompute lookup tables so live requests are fast (no scanning
        # the whole dataset on every API call)
        self._build_lookup_tables()

    def _build_lookup_tables(self):
        # section -> historical average delay
        self.section_avg_lookup = (
            self.history.groupby("section_id")["delay"].mean().to_dict()
        )

        # (train_no, station_name) -> static info: zone, distance, type_code
        # (take the most recent row for that train+station combo)
        static_cols = [
            "train_no", "station_name", "station_zone",
            "distance_from_origin", "type_code", "station_no", "arrival_time",
        ]
        self.train_station_lookup = (
            self.history[static_cols]
            .drop_duplicates(subset=["train_no", "station_name"], keep="last")
            .set_index(["train_no", "station_name"])
            .to_dict(orient="index")
        )

        # per-train, per-station -> the PREVIOUS station in its route
        # (needed to build section_id = prev_station + "_" + this_station)
        # IMPORTANT: dedupe to one row per (train_no, station_no) FIRST,
        # since the real dataset has one row per train per station PER DATE
        # -- without deduping first, shift() can pick a same-named station
        # from a different date as the "previous" one.
        unique_route = (
            self.history[["train_no", "station_no", "station_name"]]
            .drop_duplicates(subset=["train_no", "station_no"])
            .sort_values(["train_no", "station_no"])
        )
        unique_route["prev_station"] = unique_route.groupby("train_no")["station_name"].shift(1)
        self.prev_station_lookup = (
            unique_route.drop_duplicates(subset=["train_no", "station_name"], keep="first")
            .set_index(["train_no", "station_name"])["prev_station"]
            .to_dict()
        )

        # known station zones / train types -> exact one-hot column names
        self.known_zone_cols = [c for c in self.feature_order if c.startswith("station_zone_")]
        self.known_type_cols = [c for c in self.feature_order if c.startswith("type_code_")]

    def build_feature_vector(self, train_no, station, current_delay=0, at_time=None):
        """
        Builds the exact ordered feature vector for a live prediction.

        train_no        : int, e.g. 1023
        station         : str, the UPCOMING station code, e.g. "JJR"
        current_delay   : float, the train's delay (minutes) at its last
                           known position -- this becomes cumulative_delay_so_far
        at_time         : datetime, defaults to now() -- used for hour/day/month
        """
        if at_time is None:
            at_time = datetime.now()

        key = (train_no, station)
        if key not in self.train_station_lookup:
            raise ValueError(
                f"No historical record for train {train_no} at station {station}. "
                f"Check the route/station code is correct."
            )

        static_info = self.train_station_lookup[key]
        prev_station = self.prev_station_lookup.get(key, "ORIGIN")
        if pd.isna(prev_station):
            prev_station = "ORIGIN"
        section_id = f"{prev_station}_{station}"

        row = {}

        # temporal
        row["hour_of_day"] = at_time.hour
        row["day_of_week"] = at_time.weekday()
        row["month"] = at_time.month
        row["is_weekend"] = int(at_time.weekday() >= 5)
        row["is_peak_hour"] = int(
            (7 <= at_time.hour <= 10) or (17 <= at_time.hour <= 20)
        )

        # journey progress
        row["cumulative_delay_so_far"] = current_delay

        # spatial
        row["distance_from_origin"] = static_info["distance_from_origin"]
        row["section_historical_avg_delay"] = self.section_avg_lookup.get(section_id, 0.0)

        # zone one-hot
        zone_col = f"station_zone_{static_info['station_zone']}"
        for col in self.known_zone_cols:
            row[col] = 1 if col == zone_col else 0

        # train type one-hot
        type_col = f"type_code_{static_info['type_code']}"
        for col in self.known_type_cols:
            row[col] = 1 if col == type_col else 0

        # assemble in exact model order (fill 0 for anything unseen)
        vector = [row.get(f, 0) for f in self.feature_order]
        return vector, section_id

    def predict(self, train_no, station, current_delay=0, at_time=None):
        vector, section_id = self.build_feature_vector(
            train_no, station, current_delay, at_time
        )
        predicted_delay = float(self.model.predict([vector])[0])

        # look up the scheduled arrival time (HH:MM string) for this stop
        key = (train_no, station)
        scheduled_arrival = self.train_station_lookup.get(key, {}).get("arrival_time")

        # sanitize NaN -> None so this is valid JSON (origin stations
        # have no arrival_time, which pandas reads as NaN, not a string)
        if isinstance(scheduled_arrival, float) and pd.isna(scheduled_arrival):
            scheduled_arrival = None

        result = {
            "train_no": train_no,
            "station": station,
            "section_id": section_id,
            "predicted_delay_minutes": round(predicted_delay, 1),
            "input_current_delay": current_delay,
            "scheduled_arrival_time": scheduled_arrival,
        }

        # real p10/p50/p90 quantile predictions, if the quantile model
        # was trained and loaded -- this replaces any fake +/- percentage
        if self.quantile_model is not None:
            q_preds = self.quantile_model.predict([vector])[0]  # [p10, p50, p90]
            p10, p50, p90 = float(q_preds[0]), float(q_preds[1]), float(q_preds[2])
            result["delay_p10_minutes"] = round(p10, 1)
            result["delay_p50_minutes"] = round(p50, 1)
            result["delay_p90_minutes"] = round(p90, 1)
            result["confidence_range_minutes"] = [round(p10, 1), round(p90, 1)]
        else:
            # fallback if quantile model isn't available yet
            spread = max(abs(predicted_delay) * 0.2, 2)
            result["confidence_range_minutes"] = [
                round(predicted_delay - spread, 1),
                round(predicted_delay + spread, 1),
            ]

        # compute the actual predicted clock-time ETA, if we have a
        # scheduled time and it's not blank (origin stations have none)
        if isinstance(scheduled_arrival, str) and scheduled_arrival.strip():
            try:
                sched_dt = datetime.strptime(scheduled_arrival.strip(), "%H:%M")
                eta_dt = sched_dt + timedelta(minutes=predicted_delay)
                result["predicted_eta_time"] = eta_dt.strftime("%H:%M")
            except ValueError:
                result["predicted_eta_time"] = None
        else:
            result["predicted_eta_time"] = None

        return result

    def get_route(self, train_no):
        """
        Returns the ordered list of stations for a given train, so the
        caller doesn't need to already know the station codes.
        """
        route = (
            self.history[self.history["train_no"] == train_no]
            [["station_no", "station_name"]]
            .drop_duplicates()
            .sort_values("station_no")
        )
        if route.empty:
            raise ValueError(f"No route found for train {train_no}.")
        return route["station_name"].tolist()

    def predict_full_route(self, train_no, starting_delay=0, at_time=None):
        """
        Given JUST a train number, predicts the ETA at every station
        along its route, carrying delay forward stop by stop (each
        stop's predicted delay becomes the next stop's current_delay).
        """
        stations = self.get_route(train_no)
        results = []
        running_delay = starting_delay

        for station in stations:
            try:
                result = self.predict(train_no, station, running_delay, at_time)
                results.append(result)
                running_delay = result["predicted_delay_minutes"]
            except ValueError:
                continue  # skip stations with no static info (rare edge case)

        return results


# ------------------------------------------------------------------
# Standalone test
# ------------------------------------------------------------------
if __name__ == "__main__":
    predictor = ETAPredictor()

    # test with a train/station combo that exists in your sample data
    result = predictor.predict(train_no=1023, station="JJR", current_delay=6)
    print("Test prediction:")
    print(result)