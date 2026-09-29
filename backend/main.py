from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "ml"))
from build_features import ETAPredictor

app = FastAPI(title="Dynamic ETA Prediction API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

predictor = ETAPredictor(
    model_path=os.path.join("ml", "eta_model.json"),
    features_path=os.path.join("ml", "model_features.txt"),
    data_path=os.path.join("ml", "data", "cleaned_train_data.csv"),
    quantile_model_path=os.path.join("ml", "eta_model_quantile.json"),
)

train_state = {}


@app.get("/eta")
def get_eta(train_no: int, station: str, current_delay: Optional[float] = None):
    delay_to_use = current_delay
    if delay_to_use is None:
        delay_to_use = train_state.get(train_no, {}).get("current_delay", 0)

    try:
        result = predictor.predict(
            train_no=train_no,
            station=station.upper(),
            current_delay=delay_to_use,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pred = result["predicted_delay_minutes"]
    spread = max(abs(pred) * 0.2, 2)
    result["confidence_range_minutes"] = [round(pred - spread, 1), round(pred + spread, 1)]

    return result


class TriggerEvent(BaseModel):
    train_no: int
    event_type: str
    extra_delay_minutes: float = 0


EVENT_DELAY_DEFAULTS = {"fog": 15, "signal_hold": 8, "clear": 0}


@app.post("/trigger-event")
def trigger_event(event: TriggerEvent):
    added_delay = event.extra_delay_minutes or EVENT_DELAY_DEFAULTS.get(event.event_type, 0)

    state = train_state.setdefault(event.train_no, {"current_delay": 0, "active_event": None})
    if event.event_type == "clear":
        state["current_delay"] = 0
        state["active_event"] = None
    else:
        state["current_delay"] = state.get("current_delay", 0) + added_delay
        state["active_event"] = event.event_type

    return {
        "train_no": event.train_no,
        "event_applied": event.event_type,
        "added_delay_minutes": added_delay,
        "new_current_delay": state["current_delay"],
    }


@app.get("/conflicts")
def get_conflicts():
    return {"conflicts": [], "resolutions": []}


@app.websocket("/ws/live-eta/{train_no}")
async def websocket_eta(websocket: WebSocket, train_no: int):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            station = data.get("station", "").upper()
            current_delay = train_state.get(train_no, {}).get("current_delay", 0)
            try:
                result = predictor.predict(train_no, station, current_delay)
                await websocket.send_json(result)
            except ValueError as e:
                await websocket.send_json({"error": str(e)})
    except WebSocketDisconnect:
        pass


@app.get("/")
def root():
    return {"status": "ok", "message": "Dynamic ETA Prediction API is running"}

@app.get("/eta/route/{train_no}")
def get_eta_for_route(train_no: int, current_delay: Optional[float] = None):
    """
    Returns predicted ETA for EVERY station on this train's route,
    given just the train number -- no need to know station codes.
    """
    delay_to_use = current_delay
    if delay_to_use is None:
        delay_to_use = train_state.get(train_no, {}).get("current_delay", 0)

    try:
        results = predictor.predict_full_route(train_no, starting_delay=delay_to_use)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if not results:
        raise HTTPException(status_code=404, detail=f"No route data found for train {train_no}.")

    return {"train_no": train_no, "stations": results}