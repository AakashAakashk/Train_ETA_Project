from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import json


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI()


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# EXISTING TRAIN DATA
# ============================================================

train_data = {
    "train_id": "12673",
    "latitude": 11.0168,
    "longitude": 76.9558,
    "speed": 60
}


# ============================================================
# SQLITE DATABASE
# ============================================================

DATABASE = "train_database.db"


def get_connection():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def create_database():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trains (
            train_number TEXT PRIMARY KEY,
            train_name TEXT NOT NULL,
            normal_speed REAL NOT NULL,
            stations TEXT NOT NULL
        )
    """)

    connection.commit()
    connection.close()


# Create the database/table when FastAPI starts
create_database()


# ============================================================
# TRAIN DATA MODEL
# ============================================================

class Train(BaseModel):

    number: str
    name: str
    normalSpeed: float
    stations: list


# ============================================================
# EXISTING ENDPOINT
# ============================================================

@app.get("/train")
def get_train():

    return train_data


# ============================================================
# GET ALL SAVED TRAINS
# ============================================================

@app.get("/trains")
def get_trains():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(
        "SELECT * FROM trains"
    )

    rows = cursor.fetchall()

    connection.close()

    trains = []

    for row in rows:

        trains.append({
            "number": row["train_number"],
            "name": row["train_name"],
            "normalSpeed": row["normal_speed"],
            "stations": json.loads(row["stations"])
        })

    return trains


# ============================================================
# ADD A NEW TRAIN
# ============================================================

@app.post("/trains")
def add_train(train: Train):

    connection = get_connection()

    cursor = connection.cursor()

    # Check whether train already exists
    cursor.execute(
        """
        SELECT train_number
        FROM trains
        WHERE train_number = ?
        """,
        (train.number,)
    )

    existing = cursor.fetchone()

    if existing:

        connection.close()

        raise HTTPException(
            status_code=409,
            detail="Train already exists"
        )

    # Insert train
    cursor.execute(
        """
        INSERT INTO trains
        (
            train_number,
            train_name,
            normal_speed,
            stations
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            train.number,
            train.name,
            train.normalSpeed,
            json.dumps(train.stations)
        )
    )

    connection.commit()

    connection.close()

    return {
        "message": "Train added successfully",
        "train": train
    }


# ============================================================
# DELETE A TRAIN
# ============================================================

@app.delete("/trains/{train_number}")
def delete_train(train_number: str):

    connection = get_connection()

    cursor = connection.cursor()

    # Check whether train exists
    cursor.execute(
        """
        SELECT train_number
        FROM trains
        WHERE train_number = ?
        """,
        (train_number,)
    )

    existing = cursor.fetchone()

    if not existing:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Train not found"
        )

    # Delete train
    cursor.execute(
        """
        DELETE FROM trains
        WHERE train_number = ?
        """,
        (train_number,)
    )

    connection.commit()

    connection.close()

    return {
        "message":
            f"Train {train_number} deleted successfully"
    }