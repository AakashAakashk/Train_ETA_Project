import time
from datetime import datetime


# ============================================================
# TRAIN INFORMATION
# ============================================================

trains = {
    "12673": {
        "name": "Mumbai Central - New Delhi Express",

        "route": [
            {
                "station": "Mumbai Central",
                "code": "MMCT",
                "distance": 0,
                "lat": 18.9690,
                "lon": 72.8193,
                "stop_minutes": 0
            },
            {
                "station": "Borivali",
                "code": "BVI",
                "distance": 30,
                "lat": 19.2307,
                "lon": 72.8567,
                "stop_minutes": 2
            },
            {
                "station": "Surat",
                "code": "ST",
                "distance": 263,
                "lat": 21.1702,
                "lon": 72.8311,
                "stop_minutes": 5
            },
            {
                "station": "Vadodara Junction",
                "code": "BRC",
                "distance": 392,
                "lat": 22.3072,
                "lon": 73.1812,
                "stop_minutes": 10
            },
            {
                "station": "Ratlam Junction",
                "code": "RTM",
                "distance": 653,
                "lat": 23.3342,
                "lon": 75.0367,
                "stop_minutes": 3
            },
            {
                "station": "Nagda Junction",
                "code": "NAD",
                "distance": 695,
                "lat": 23.4580,
                "lon": 75.4170,
                "stop_minutes": 2
            },
            {
                "station": "Kota Junction",
                "code": "KOTA",
                "distance": 920,
                "lat": 25.2138,
                "lon": 75.8648,
                "stop_minutes": 5
            },
            {
                "station": "New Delhi",
                "code": "NDLS",
                "distance": 1384,
                "lat": 28.6431,
                "lon": 77.2197,
                "stop_minutes": 0
            }
        ]
    }
}


# ============================================================
# SELECT TRAIN
# ============================================================

train_number = "12673"

train = trains[train_number]

route = train["route"]


# ============================================================
# SPEED SETTINGS
# ============================================================

normal_speed = 80
fog_speed = 40
rain_speed = 60

maximum_speed = normal_speed

current_speed = 0

acceleration = 10
deceleration = 15

approach_distance = 5


# ============================================================
# SIMULATION SETTINGS
# ============================================================

# How often the simulator sends an update
update_interval = 0.5

# Makes the simulation much faster than real time.
#
# 1   = real-time movement
# 10  = 10 times faster
# 60  = 60 times faster
#
# 60 is good for testing.
simulation_speed_multiplier = 60


# ============================================================
# WEATHER / DISTURBANCE ZONES
# ============================================================

# Fog warning appears before the train enters the fog.

fog_warning_distance = 100

fog_start_distance = 120
fog_end_distance = 140


# Rain disturbance

rain_start_distance = 160
rain_end_distance = 220


# ============================================================
# SIMULATION VARIABLES
# ============================================================

current_distance = 0

current_station_index = 0

next_station_index = 1

is_stopped = False

stop_remaining = 0


# Weather state

weather = "CLEAR"

fog_detected = False
fog_active = False

rain_active = False


# Used to avoid printing the same message repeatedly

previous_weather = "CLEAR"
previous_speed = 0


# ============================================================
# FUNCTION: GET POSITION
# ============================================================

def get_position(distance):

    # If destination is reached
    if distance >= route[-1]["distance"]:
        return route[-1]["lat"], route[-1]["lon"]

    for i in range(len(route) - 1):

        start = route[i]
        end = route[i + 1]

        if start["distance"] <= distance <= end["distance"]:

            section_distance = end["distance"] - start["distance"]

            progress = (
                distance - start["distance"]
            ) / section_distance

            latitude = (
                start["lat"]
                + (end["lat"] - start["lat"]) * progress
            )

            longitude = (
                start["lon"]
                + (end["lon"] - start["lon"]) * progress
            )

            return latitude, longitude

    return route[-1]["lat"], route[-1]["lon"]


# ============================================================
# FUNCTION: DISPLAY DISTURBANCE
# ============================================================

def display_disturbance():

    print()
    print("==============================================")

    if weather == "FOG PREDICTED":

        print("🌫️  FOG PREDICTED AHEAD!")
        print("⚠️  Disturbance detected in upcoming route")
        print(
            f"⚡ Speed response: "
            f"{normal_speed} → {fog_speed + 30} km/h"
        )

    elif weather == "FOG":

        print("🌫️  FOG ACTIVE!")
        print("⚠️  Train is inside fog disturbance")
        print(
            f"⚡ Speed reduced: "
            f"{normal_speed} → {fog_speed} km/h"
        )

    elif weather == "RAIN":

        print("🌧️  RAIN DETECTED!")
        print("⚠️  Weather disturbance affecting route")
        print(
            f"⚡ Speed reduced: "
            f"{normal_speed} → {rain_speed} km/h"
        )

    elif weather == "CLEAR":

        print("☀️  WEATHER CLEAR")
        print("✅ No active weather disturbance")

    print("==============================================")
    print()


# ============================================================
# MAIN SIMULATION
# ============================================================

print()
print("==============================================")
print("🚆 TRAIN SIMULATION STARTED")
print("==============================================")
print(f"Train Number : {train_number}")
print(f"Train Name   : {train['name']}")
print(f"Route        : Mumbai Central → New Delhi")
print(f"Simulation Speed : {simulation_speed_multiplier}x")
print("==============================================")
print()


while current_distance < route[-1]["distance"]:

    # ========================================================
    # WEATHER DETECTION
    # ========================================================

    # ---------------- FOG PREDICTION ----------------

    if (
        current_distance >= fog_warning_distance
        and not fog_detected
    ):

        fog_detected = True

        weather = "FOG PREDICTED"

        display_disturbance()


    # ---------------- FOG ACTIVE ----------------

    if (
        current_distance >= fog_start_distance
        and current_distance <= fog_end_distance
    ):

        if not fog_active:

            fog_active = True

            weather = "FOG"

            display_disturbance()


    # ---------------- FOG CLEARED ----------------

    if (
        current_distance > fog_end_distance
        and fog_active
    ):

        fog_active = False

        # Only change to clear if rain has not started
        if not rain_active:

            weather = "CLEAR"

            display_disturbance()


    # ========================================================
    # RAIN DETECTION
    # ========================================================

    if (
        current_distance >= rain_start_distance
        and current_distance <= rain_end_distance
    ):

        if not rain_active:

            rain_active = True

            weather = "RAIN"

            display_disturbance()


    # ---------------- RAIN CLEARED ----------------

    if (
        current_distance > rain_end_distance
        and rain_active
    ):

        rain_active = False

        weather = "CLEAR"

        display_disturbance()


    # ========================================================
    # DETERMINE TARGET SPEED
    # ========================================================

    target_speed = normal_speed


    # Fog active
    if fog_active:

        target_speed = fog_speed


    # Rain active
    elif rain_active:

        target_speed = rain_speed


    # Fog predicted
    elif weather == "FOG PREDICTED":

        # Demonstration assumption:
        # controlled speed adjustment before disturbance

        target_speed = 70


    # ========================================================
    # STATION APPROACH
    # ========================================================

    if next_station_index < len(route):

        next_station = route[next_station_index]

        distance_to_station = (
            next_station["distance"]
            - current_distance
        )

        if distance_to_station <= approach_distance:

            target_speed = 0


    # ========================================================
    # ACCELERATION / DECELERATION
    # ========================================================

    if current_speed < target_speed:

        current_speed += acceleration

        if current_speed > target_speed:

            current_speed = target_speed


    elif current_speed > target_speed:

        current_speed -= deceleration

        if current_speed < target_speed:

            current_speed = target_speed


    # ========================================================
    # STATION STOP
    # ========================================================

    if is_stopped:

        current_speed = 0

        stop_remaining -= (
            update_interval
            * simulation_speed_multiplier
        )

        if stop_remaining <= 0:

            is_stopped = False

            print()
            print(
                f"🚆 Departed from "
                f"{route[current_station_index]['station']}"
            )
            print()

        else:

            # Create telemetry while stopped

            latitude, longitude = get_position(
                current_distance
            )

            gps_data = {

                "train_number": train_number,

                "train_name": train["name"],

                "latitude": round(latitude, 6),

                "longitude": round(longitude, 6),

                "speed": 0,

                "distance": round(current_distance, 2),

                "weather": weather,

                "fog_detected": fog_detected,

                "fog_active": fog_active,

                "rain_active": rain_active,

                "status": "STOPPED",

                "current_station":
                    route[current_station_index]["station"],

                "next_station":
                    route[next_station_index]["station"]
                    if next_station_index < len(route)
                    else "Destination",

                "timestamp":
                    datetime.now().strftime(
                        "%Y-%m-%d %H:%M:%S"
                    )
            }

            print(
                f"🚆 {train_number} | "
                f"🛑 STOPPED | "
                f"📍 {gps_data['current_station']} | "
                f"🌤️ {weather}"
            )

            time.sleep(update_interval)

            continue


    # ========================================================
    # MOVE TRAIN
    # ========================================================

    distance_this_update = (
        current_speed
        * update_interval
        / 3600
        * simulation_speed_multiplier
    )

    current_distance += distance_this_update


    # ========================================================
    # CHECK STATION ARRIVAL
    # ========================================================

    if next_station_index < len(route):

        next_station = route[next_station_index]

        if current_distance >= next_station["distance"]:

            current_distance = next_station["distance"]

            current_station_index = next_station_index

            next_station_index += 1

            station_name = next_station["station"]

            stop_minutes = next_station["stop_minutes"]


            print()
            print("==============================================")
            print(f"📍 ARRIVED AT {station_name}")
            print(f"🚆 Train: {train_number}")
            print("==============================================")


            if stop_minutes > 0:

                is_stopped = True

                stop_remaining = (
                    stop_minutes * 60
                )

                print(
                    f"🛑 Station stop: "
                    f"{stop_minutes} minutes"
                )

            else:

                print("🏁 Destination reached!")


            print()


    # ========================================================
    # GET GPS POSITION
    # ========================================================

    latitude, longitude = get_position(
        current_distance
    )


    # ========================================================
    # STATUS
    # ========================================================

    if is_stopped:

        status = "STOPPED"

    elif fog_active:

        status = "FOG DISTURBANCE"

    elif rain_active:

        status = "RAIN DISTURBANCE"

    elif weather == "FOG PREDICTED":

        status = "FOG WARNING"

    else:

        status = "RUNNING"


    # ========================================================
    # GPS TELEMETRY
    # ========================================================

    gps_data = {

        "train_number": train_number,

        "train_name": train["name"],

        "latitude": round(latitude, 6),

        "longitude": round(longitude, 6),

        "speed": round(current_speed, 1),

        "distance": round(current_distance, 2),

        "weather": weather,

        "fog_detected": fog_detected,

        "fog_active": fog_active,

        "rain_active": rain_active,

        "status": status,

        "current_station":
            route[current_station_index]["station"],

        "next_station":
            route[next_station_index]["station"]
            if next_station_index < len(route)
            else "New Delhi",

        "timestamp":
            datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S"
            )
    }


    # ========================================================
    # PRINT LIVE INFORMATION
    # ========================================================

    print(
        f"🚆 {train_number} | "
        f"📍 {current_distance:.1f} km | "
        f"⚡ {current_speed:.0f} km/h | "
        f"🌤️ {weather} | "
        f"{status}"
    )


    # ========================================================
    # SPEED CHANGE MESSAGE
    # ========================================================

    if (
        previous_speed != 0
        and current_speed != previous_speed
        and (
            fog_active
            or rain_active
            or weather == "FOG PREDICTED"
        )
    ):

        print(
            f"   ⚡ SPEED CHANGE: "
            f"{previous_speed:.0f} → "
            f"{current_speed:.0f} km/h"
        )


    previous_speed = current_speed


    # ========================================================
    # WAIT
    # ========================================================

    time.sleep(update_interval)


# ============================================================
# SIMULATION FINISHED
# ============================================================

print()
print("==============================================")
print("🏁 SIMULATION COMPLETED")
print("==============================================")
print(f"🚆 Train       : {train_number}")
print(f"📍 Destination : New Delhi")
print(f"📏 Distance    : {current_distance:.1f} km")
print("==============================================")