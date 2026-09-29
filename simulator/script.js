/* =========================================================
   SIH 2026 - Dynamic Train ETA Simulation
   FastAPI + SQLite Connected Version
   + REAL /eta MODEL INTEGRATION (main.py, port 8001)
   ========================================================= */

/* =========================================================
   API
   ========================================================= */

const API_BASE_URL = "http://127.0.0.1:8000"; // her app.py -- train list CRUD / SQLite

const ETA_API_BASE_URL = "http://127.0.0.1:8001"; // Aakash's main.py -- real ETA model

const TRAINS_API_URL =
    `${API_BASE_URL}/trains`;

const LOCAL_STORAGE_KEY =
    "sihTrainData";


/* =========================================================
   DEFAULT TRAIN
   This is kept as a fallback.
   The main source will now be SQLite.
   ========================================================= */

const defaultTrains = {

    "12673": {

        number: "12673",

        name: "12673 Express",

        normalSpeed: 80,

        stations: [

            {
                name: "Mumbai Central",
                code: "MMCT",
                distance: 0,
                lat: 18.9690,
                lng: 72.8193
            },

            {
                name: "Borivali",
                code: "BVI",
                distance: 30,
                lat: 19.2307,
                lng: 72.8567
            },

            {
                name: "Surat",
                code: "ST",
                distance: 263,
                lat: 21.1702,
                lng: 72.8311
            },

            {
                name: "Vadodara Junction",
                code: "BRC",
                distance: 392,
                lat: 22.3072,
                lng: 73.1812
            },

            {
                name: "Ratlam Junction",
                code: "RTM",
                distance: 653,
                lat: 23.3342,
                lng: 75.0367
            },

            {
                name: "Nagda Junction",
                code: "NAD",
                distance: 695,
                lat: 23.4580,
                lng: 75.4170
            },

            {
                name: "Kota Junction",
                code: "KOTA",
                distance: 920,
                lat: 25.2138,
                lng: 75.8648
            },

            {
                name: "New Delhi",
                code: "NDLS",
                distance: 1384,
                lat: 28.6431,
                lng: 77.2197
            }

        ],

        currentDistance: 0,
        currentSpeed: 0,
        targetSpeed: 80,
        weather: "Clear",
        status: "Ready",
        running: false,
        marker: null,
        routeLine: null,
        stationMarkers: [],
        weatherLines: [],

        // NEW: real-model prediction state
        lastEtaStationCode: null,
        predictedDelayMinutes: null,
        predictedEtaTime: null,
        confidenceRangeMinutes: null

    }

};


/* =========================================================
   MAIN TRAIN OBJECT
   This will be populated from SQLite.
   ========================================================= */

const trains = {};


/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

const map = L.map("map");

let selectedTrainNumber = "12673";

let demoMultiplier = 5;

let animationFrame = null;

let lastTimestamp = null;


/* =========================================================
   MAP
   ========================================================= */

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution:
            "&copy; OpenStreetMap contributors"
    }
).addTo(map);


/* =========================================================
   TRAIN ICON
   ========================================================= */

const trainIcon = L.divIcon({

    className: "train-marker",

    html: `
        <div class="train-icon">
            🚆
        </div>
    `,

    iconSize: [34, 34],

    iconAnchor: [17, 17]

});


/* =========================================================
   DOM ELEMENTS
   ========================================================= */

const trainSelect =
    document.getElementById("trainSelect");

const startBtn =
    document.getElementById("startBtn");

const pauseBtn =
    document.getElementById("pauseBtn");

const resetBtn =
    document.getElementById("resetBtn");

const deleteBtn =
    document.getElementById("deleteBtn");

const demoSpeed =
    document.getElementById("demoSpeed");

const speedValue =
    document.getElementById("speedValue");

const trainNameElement =
    document.getElementById("trainName");

const currentSpeedElement =
    document.getElementById("currentSpeed");

const distanceCoveredElement =
    document.getElementById("distanceCovered");

const currentStationElement =
    document.getElementById("currentStation");

const nextStationElement =
    document.getElementById("nextStation");

const weatherElement =
    document.getElementById("weather");

const statusElement =
    document.getElementById("status");

// NEW: real-model panel elements (added to index.html)
const predictedDelayElement =
    document.getElementById("predictedDelay");

const predictedEtaElement =
    document.getElementById("predictedEta");

const confidenceRangeElement =
    document.getElementById("confidenceRange");


/* =========================================================
   MODAL ELEMENTS
   ========================================================= */

const addTrainModal =
    document.getElementById("addTrainModal");

const deleteModal =
    document.getElementById("deleteModal");

const closeModalBtn =
    document.getElementById("closeModalBtn");

const cancelBtn =
    document.getElementById("cancelBtn");

const addStationBtn =
    document.getElementById("addStationBtn");

const stationContainer =
    document.getElementById("stationContainer");

const trainForm =
    document.getElementById("trainForm");

const cancelDeleteBtn =
    document.getElementById("cancelDeleteBtn");

const confirmDeleteBtn =
    document.getElementById("confirmDeleteBtn");


/* =========================================================
   CREATE RUNTIME TRAIN OBJECT
   ========================================================= */

function createRuntimeTrain(trainData) {

    return {

        number: trainData.number,

        name: trainData.name,

        normalSpeed:
            Number(trainData.normalSpeed),

        stations:
            trainData.stations || [],

        currentDistance:
            Number(trainData.currentDistance || 0),

        currentSpeed:
            Number(trainData.currentSpeed || 0),

        targetSpeed:
            Number(
                trainData.targetSpeed ||
                trainData.normalSpeed
            ),

        weather:
            trainData.weather || "Clear",

        status:
            trainData.status || "Ready",

        running: false,

        marker: null,

        routeLine: null,

        stationMarkers: [],

        weatherLines: [],

        // NEW: real-model prediction state
        lastEtaStationCode: null,

        predictedDelayMinutes: null,

        predictedEtaTime: null,

        confidenceRangeMinutes: null

    };

}


/* =========================================================
   FETCH REAL ETA FROM MODEL BACKEND (main.py, port 8001)
   ========================================================= */

async function fetchRealEta(trainNumber, stationCode, currentDelay = 0) {

    try {

        const url =
            `${ETA_API_BASE_URL}/eta?train_no=${encodeURIComponent(trainNumber)}` +
            `&station=${encodeURIComponent(stationCode)}` +
            `&current_delay=${currentDelay}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`ETA backend returned ${response.status}`);
        }

        return await response.json();

    } catch (error) {

        console.error("[EtaBridge] Could not fetch real ETA:", error);
        return null;

    }

}


/* =========================================================
   STATION-CROSSING DETECTION
   Fires a real /eta fetch exactly once per station reached,
   not on every animation frame.
   ========================================================= */

function checkStationCrossingAndFetchEta(train) {

    const currentStation = getCurrentStation(train);

    if (!currentStation) {
        return;
    }

    if (currentStation.code === train.lastEtaStationCode) {
        return;
    }

    train.lastEtaStationCode = currentStation.code;

    fetchRealEta(
        train.number,
        currentStation.code,
        train.predictedDelayMinutes || 0
    ).then(eta => {

        if (!eta) {
            // Backend unreachable or train/station not recognized --
            // leave previous values in place rather than blanking them.
            return;
        }

        train.predictedDelayMinutes = eta.predicted_delay_minutes;
        train.predictedEtaTime = eta.predicted_eta_time;
        train.confidenceRangeMinutes = eta.confidence_range_minutes;

        updateInfoPanel(train);

    });

}


/* =========================================================
   LOAD LOCAL STORAGE
   Temporary safety fallback
   ========================================================= */

function loadLocalStorageTrains() {

    try {

        const saved =
            localStorage.getItem(
                LOCAL_STORAGE_KEY
            );

        if (!saved) {
            return {};
        }

        return JSON.parse(saved);

    } catch (error) {

        console.error(
            "Could not read localStorage:",
            error
        );

        return {};

    }

}


/* =========================================================
   SAVE LOCAL STORAGE
   Temporary backup
   ========================================================= */

function saveLocalStorageTrains() {

    try {

        const data = {};

        Object.keys(trains).forEach(
            number => {

                const train =
                    trains[number];

                data[number] = {

                    number:
                        train.number,

                    name:
                        train.name,

                    normalSpeed:
                        train.normalSpeed,

                    stations:
                        train.stations,

                    currentDistance:
                        train.currentDistance,

                    currentSpeed:
                        train.currentSpeed,

                    targetSpeed:
                        train.targetSpeed,

                    weather:
                        train.weather,

                    status:
                        train.status,

                    running: false

                };

            }
        );

        localStorage.setItem(
            LOCAL_STORAGE_KEY,
            JSON.stringify(data)
        );

    } catch (error) {

        console.error(
            "Could not save localStorage:",
            error
        );

    }

}


/* =========================================================
   LOAD TRAINS FROM FASTAPI / SQLITE
   ========================================================= */

async function loadTrainsFromDatabase() {

    try {

        const response =
            await fetch(
                TRAINS_API_URL
            );

        if (!response.ok) {

            throw new Error(
                `Server returned ${response.status}`
            );

        }

        const databaseTrains =
            await response.json();

        Object.keys(trains).forEach(
            number => {

                clearTrainFromMap(
                    trains[number]
                );

                delete trains[number];

            }
        );

        databaseTrains.forEach(
            trainData => {

                const train =
                    createRuntimeTrain(
                        trainData
                    );

                trains[
                    train.number
                ] = train;

            }
        );

        if (
            databaseTrains.length === 0
        ) {

            console.warn(
                "SQLite database is empty. Checking localStorage..."
            );

            const localTrains =
                loadLocalStorageTrains();

            Object.values(localTrains).forEach(
                trainData => {

                    trains[
                        trainData.number
                    ] =
                        createRuntimeTrain(
                            trainData
                        );

                }
            );

        }

        if (
            Object.keys(trains).length === 0
        ) {

            console.warn(
                "No saved trains found. Using default train 12673."
            );

            const defaultTrain =
                defaultTrains["12673"];

            trains["12673"] =
                createRuntimeTrain(
                    defaultTrain
                );

        }

        return true;

    } catch (error) {

        console.error(
            "Could not connect to FastAPI:",
            error
        );

        const localTrains =
            loadLocalStorageTrains();

        Object.values(localTrains).forEach(
            trainData => {

                trains[
                    trainData.number
                ] =
                    createRuntimeTrain(
                        trainData
                    );

            }
        );

        if (
            Object.keys(trains).length === 0
        ) {

            const defaultTrain =
                defaultTrains["12673"];

            trains["12673"] =
                createRuntimeTrain(
                    defaultTrain
                );

        }

        return false;

    }

}


/* =========================================================
   SAVE TRAIN TO FASTAPI / SQLITE
   ========================================================= */

async function saveTrainToDatabase(train) {

    try {

        const response =
            await fetch(
                TRAINS_API_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        number:
                            train.number,

                        name:
                            train.name,

                        normalSpeed:
                            train.normalSpeed,

                        stations:
                            train.stations

                    })

                }
            );

        if (!response.ok) {

            const errorData =
                await response.json()
                    .catch(() => null);

            if (response.status === 409) {

                console.warn(
                    `Train ${train.number} already exists in database.`
                );

                return true;

            }

            throw new Error(
                errorData?.detail ||
                `Server returned ${response.status}`
            );

        }

        console.log(
            `Train ${train.number} saved to SQLite.`
        );

        return true;

    } catch (error) {

        console.error(
            "Could not save train to database:",
            error
        );

        return false;

    }

}


/* =========================================================
   DELETE TRAIN FROM FASTAPI / SQLITE
   ========================================================= */

async function deleteTrainFromDatabase(
    trainNumber
) {

    try {

        const response =
            await fetch(
                `${TRAINS_API_URL}/${encodeURIComponent(trainNumber)}`,
                {
                    method: "DELETE"
                }
            );

        if (!response.ok) {

            if (response.status === 404) {

                console.warn(
                    `Train ${trainNumber} was not found in database.`
                );

                return true;

            }

            const errorData =
                await response.json()
                    .catch(() => null);

            throw new Error(
                errorData?.detail ||
                `Server returned ${response.status}`
            );

        }

        console.log(
            `Train ${trainNumber} deleted from SQLite.`
        );

        return true;

    } catch (error) {

        console.error(
            "Could not delete train from database:",
            error
        );

        return false;

    }

}


/* =========================================================
   GET SELECTED TRAIN
   ========================================================= */

function getSelectedTrain() {

    return trains[
        selectedTrainNumber
    ];

}


/* =========================================================
   GET TOTAL DISTANCE
   ========================================================= */

function getTotalDistance(train) {

    if (
        !train ||
        !train.stations ||
        !train.stations.length
    ) {

        return 0;

    }

    return train.stations[
        train.stations.length - 1
    ].distance;

}


/* =========================================================
   GET TRAIN POSITION
   ========================================================= */

function getTrainPosition(
    train,
    distance
) {

    const stations =
        train.stations;

    if (!stations.length) {

        return [0, 0];

    }

    if (
        distance <=
        stations[0].distance
    ) {

        return [
            stations[0].lat,
            stations[0].lng
        ];

    }

    const last =
        stations[
            stations.length - 1
        ];

    if (
        distance >=
        last.distance
    ) {

        return [
            last.lat,
            last.lng
        ];

    }

    for (
        let i = 0;
        i < stations.length - 1;
        i++
    ) {

        const start =
            stations[i];

        const end =
            stations[i + 1];

        if (
            distance >= start.distance &&
            distance <= end.distance
        ) {

            const segmentDistance =
                end.distance -
                start.distance;

            const progress =
                (
                    distance -
                    start.distance
                ) /
                segmentDistance;

            const latitude =
                start.lat +
                (
                    end.lat -
                    start.lat
                ) *
                progress;

            const longitude =
                start.lng +
                (
                    end.lng -
                    start.lng
                ) *
                progress;

            return [
                latitude,
                longitude
            ];

        }

    }

    return [
        stations[0].lat,
        stations[0].lng
    ];

}


/* =========================================================
   FIND CURRENT STATION
   ========================================================= */

function getCurrentStation(train) {

    const stations =
        train.stations;

    let current =
        stations[0];

    for (
        let i = 0;
        i < stations.length;
        i++
    ) {

        if (
            train.currentDistance >=
            stations[i].distance
        ) {

            current =
                stations[i];

        }

    }

    return current;

}


/* =========================================================
   FIND NEXT STATION
   ========================================================= */

function getNextStation(train) {

    const stations =
        train.stations;

    for (
        let i = 0;
        i < stations.length;
        i++
    ) {

        if (
            train.currentDistance <
            stations[i].distance
        ) {

            return stations[i];

        }

    }

    return null;

}


/* =========================================================
   WEATHER ZONE

   DEMO CONDITIONS ONLY.
   NOT ACTUAL RAILWAY OPERATING RULES.
   ========================================================= */

function getWeatherZone(train) {

    const totalDistance =
        getTotalDistance(train);

    if (totalDistance <= 0) {

        return "Clear";

    }

    const percentage =
        train.currentDistance /
        totalDistance;

    if (percentage < 0.40) {

        return "Clear";

    }

    if (percentage < 0.55) {

        return "Fog Warning";

    }

    if (percentage < 0.70) {

        return "Fog";

    }

    if (percentage < 0.85) {

        return "Rain";

    }

    return "Clear";

}


/* =========================================================
   WEATHER SPEED EFFECT
   ========================================================= */

function getWeatherSpeed(train) {

    const normal =
        train.normalSpeed;

    switch (train.weather) {

        case "Fog Warning":

            return Math.min(
                normal,
                60
            );

        case "Fog":

            return Math.min(
                normal,
                35
            );

        case "Rain":

            return Math.min(
                normal,
                55
            );

        default:

            return normal;

    }

}


/* =========================================================
   UPDATE WEATHER
   ========================================================= */

function updateWeather(train) {

    const newWeather =
        getWeatherZone(train);

    train.weather =
        newWeather;

    train.targetSpeed =
        getWeatherSpeed(train);

}


/* =========================================================
   SMOOTH SPEED CHANGE
   ========================================================= */

function updateTrainSpeed(train) {

    const difference =
        train.targetSpeed -
        train.currentSpeed;

    const acceleration =
        1.5;

    if (
        Math.abs(difference) <=
        acceleration
    ) {

        train.currentSpeed =
            train.targetSpeed;

    }

    else if (
        difference > 0
    ) {

        train.currentSpeed +=
            acceleration;

    }

    else {

        train.currentSpeed -=
            acceleration;

    }

}


/* =========================================================
   CREATE TRAIN MARKER
   ========================================================= */

function createTrainMarker(train) {

    const position =
        getTrainPosition(
            train,
            train.currentDistance
        );

    train.marker =
        L.marker(
            position,
            {
                icon: trainIcon
            }
        ).addTo(map);

    train.marker.bindPopup(
        `<b>${train.number}</b><br>${train.name}`
    );

}


/* =========================================================
   CREATE ROUTE
   ========================================================= */

function createRoute(train) {

    const coordinates =
        train.stations.map(
            station => [
                station.lat,
                station.lng
            ]
        );

    train.routeLine =
        L.polyline(
            coordinates,
            {
                color: "#2563eb",
                weight: 4
            }
        ).addTo(map);

}


/* =========================================================
   CREATE STATION MARKERS
   ========================================================= */

function createStationMarkers(train) {

    train.stationMarkers =
        [];

    train.stations.forEach(
        station => {

            const marker =
                L.circleMarker(
                    [
                        station.lat,
                        station.lng
                    ],
                    {
                        radius: 6,
                        color: "#111827",
                        fillColor: "#ffffff",
                        fillOpacity: 1,
                        weight: 2
                    }
                ).addTo(map);

            marker.bindPopup(
                `<b>${station.name}</b><br>
                 Code: ${station.code}<br>
                 Distance: ${station.distance} km`
            );

            train.stationMarkers.push(
                marker
            );

        }
    );

}


/* =========================================================
   INTERPOLATE POSITION ALONG ROUTE
   ========================================================= */

function interpolateRoutePoint(
    train,
    distance
) {

    return getTrainPosition(
        train,
        distance
    );

}


/* =========================================================
   CREATE WEATHER ZONES
   ========================================================= */

function createWeatherZones(train) {

    train.weatherLines =
        [];

    const totalDistance =
        getTotalDistance(train);

    if (totalDistance <= 0) {

        return;

    }

    const zones = [

        {
            name: "Clear",
            start: 0,
            end: 0.40,
            color: "#198754"
        },

        {
            name: "Fog Warning",
            start: 0.40,
            end: 0.55,
            color: "#f59e0b"
        },

        {
            name: "Fog",
            start: 0.55,
            end: 0.70,
            color: "#6b7280"
        },

        {
            name: "Rain",
            start: 0.70,
            end: 0.85,
            color: "#2563eb"
        },

        {
            name: "Clear",
            start: 0.85,
            end: 1,
            color: "#198754"
        }

    ];

    zones.forEach(
        zone => {

            for (
                let i = 0;
                i < train.stations.length - 1;
                i++
            ) {

                const startStation =
                    train.stations[i];

                const endStation =
                    train.stations[i + 1];

                const segmentStart =
                    startStation.distance /
                    totalDistance;

                const segmentEnd =
                    endStation.distance /
                    totalDistance;

                const overlapStart =
                    Math.max(
                        segmentStart,
                        zone.start
                    );

                const overlapEnd =
                    Math.min(
                        segmentEnd,
                        zone.end
                    );

                if (
                    overlapStart <
                    overlapEnd
                ) {

                    const startDistance =
                        overlapStart *
                        totalDistance;

                    const endDistance =
                        overlapEnd *
                        totalDistance;

                    const startPoint =
                        interpolateRoutePoint(
                            train,
                            startDistance
                        );

                    const endPoint =
                        interpolateRoutePoint(
                            train,
                            endDistance
                        );

                    const line =
                        L.polyline(
                            [
                                startPoint,
                                endPoint
                            ],
                            {
                                color:
                                    zone.color,
                                weight: 9,
                                opacity: 0.7
                            }
                        ).addTo(map);

                    line.bindTooltip(
                        zone.name,
                        {
                            sticky: true
                        }
                    );

                    train.weatherLines.push(
                        line
                    );

                }

            }

        }
    );

}


/* =========================================================
   DISPLAY TRAIN ON MAP
   ========================================================= */

function displayTrain(train) {

    if (!train) {

        return;

    }

    if (!train.routeLine) {

        createRoute(train);

        createStationMarkers(train);

        createWeatherZones(train);

        createTrainMarker(train);

    }

    const position =
        getTrainPosition(
            train,
            train.currentDistance
        );

    train.marker.setLatLng(
        position
    );

}


/* =========================================================
   CLEAR TRAIN FROM MAP
   ========================================================= */

function clearTrainFromMap(train) {

    if (!train) {

        return;

    }

    if (train.marker) {

        map.removeLayer(
            train.marker
        );

        train.marker =
            null;

    }

    if (train.routeLine) {

        map.removeLayer(
            train.routeLine
        );

        train.routeLine =
            null;

    }

    if (train.stationMarkers) {

        train.stationMarkers.forEach(
            marker => {

                map.removeLayer(
                    marker
                );

            }
        );

    }

    train.stationMarkers =
        [];

    if (train.weatherLines) {

        train.weatherLines.forEach(
            line => {

                map.removeLayer(
                    line
                );

            }
        );

    }

    train.weatherLines =
        [];

}


/* =========================================================
   UPDATE INFORMATION PANEL
   ========================================================= */

function updateInfoPanel(train) {

    if (!train) {

        return;

    }

    const currentStation =
        getCurrentStation(train);

    const nextStation =
        getNextStation(train);

    trainNameElement.textContent =
        `${train.number} - ${train.name}`;

    currentSpeedElement.textContent =
        `${train.currentSpeed.toFixed(1)} km/h`;

    distanceCoveredElement.textContent =
        `${train.currentDistance.toFixed(1)} km`;

    currentStationElement.textContent =
        currentStation
            ? `${currentStation.name} (${currentStation.code})`
            : "-";

    nextStationElement.textContent =
        nextStation
            ? `${nextStation.name} (${nextStation.code})`
            : "Destination reached";

    weatherElement.textContent =
        train.weather;

    statusElement.textContent =
        train.status;

    // NEW: real-model predictions, if any have been fetched yet
    if (predictedDelayElement) {

        predictedDelayElement.textContent =
            train.predictedDelayMinutes != null
                ? `${train.predictedDelayMinutes.toFixed(1)} min`
                : "-";

    }

    if (predictedEtaElement) {

        predictedEtaElement.textContent =
            train.predictedEtaTime || "-";

    }

    if (confidenceRangeElement) {

        confidenceRangeElement.textContent =
            train.confidenceRangeMinutes
                ? `${train.confidenceRangeMinutes[0].toFixed(1)} - ${train.confidenceRangeMinutes[1].toFixed(1)} min`
                : "-";

    }

    // Once a real prediction exists, let it drive the Status label
    // instead of only the locally-simulated status string.
    if (train.predictedDelayMinutes != null && train.running) {

        statusElement.textContent =
            train.predictedDelayMinutes > 5
                ? "Delayed (model)"
                : "On Time (model)";

    }

}


/* =========================================================
   RESET TRAIN
   ========================================================= */

function resetTrain(train) {

    if (!train) {

        return;

    }

    train.currentDistance =
        0;

    train.currentSpeed =
        0;

    train.targetSpeed =
        train.normalSpeed;

    train.weather =
        "Clear";

    train.status =
        "Ready";

    train.running =
        false;

    // NEW: clear stale predictions on reset
    train.lastEtaStationCode =
        null;

    train.predictedDelayMinutes =
        null;

    train.predictedEtaTime =
        null;

    train.confidenceRangeMinutes =
        null;

    displayTrain(train);

    updateInfoPanel(train);

    saveLocalStorageTrains();

}


/* =========================================================
   START TRAIN
   ========================================================= */

function startTrain() {

    const train =
        getSelectedTrain();

    if (!train) {

        return;

    }

    if (
        train.currentDistance >=
        getTotalDistance(train)
    ) {

        return;

    }

    train.running =
        true;

    train.status =
        "Running";

    lastTimestamp =
        null;

    startAnimation();

}


/* =========================================================
   PAUSE TRAIN
   ========================================================= */

function pauseTrain() {

    const train =
        getSelectedTrain();

    if (!train) {

        return;

    }

    train.running =
        false;

    train.status =
        "Paused";

    updateInfoPanel(train);

    saveLocalStorageTrains();

}


/* =========================================================
   UPDATE TRAIN MOVEMENT
   ========================================================= */

function updateTrain(
    train,
    deltaTime
) {

    if (!train.running) {

        return;

    }

    updateWeather(train);

    updateTrainSpeed(train);

    const baseMovement =
        0.35;

    const speedRatio =
        train.normalSpeed > 0
            ? train.currentSpeed /
              train.normalSpeed
            : 0;

    const movement =
        baseMovement *
        demoMultiplier *
        speedRatio;

    train.currentDistance +=
        movement;

    const totalDistance =
        getTotalDistance(train);

    if (
        train.currentDistance >=
        totalDistance
    ) {

        train.currentDistance =
            totalDistance;

        train.currentSpeed =
            0;

        train.targetSpeed =
            0;

        train.running =
            false;

        train.status =
            "Destination Reached";

    }

    displayTrain(train);

    updateInfoPanel(train);

    // NEW: fires a real /eta fetch exactly once per new station reached
    checkStationCrossingAndFetchEta(train);

}


/* =========================================================
   ANIMATION LOOP
   ========================================================= */

function animate(timestamp) {

    const train =
        getSelectedTrain();

    if (!train) {

        animationFrame =
            requestAnimationFrame(
                animate
            );

        return;

    }

    if (lastTimestamp === null) {

        lastTimestamp =
            timestamp;

    }

    const deltaTime =
        timestamp -
        lastTimestamp;

    lastTimestamp =
        timestamp;

    if (train.running) {

        updateTrain(
            train,
            deltaTime
        );

    }

    animationFrame =
        requestAnimationFrame(
            animate
        );

}


/* =========================================================
   START ANIMATION
   ========================================================= */

function startAnimation() {

    if (!animationFrame) {

        animationFrame =
            requestAnimationFrame(
                animate
            );

    }

}


/* =========================================================
   TRAIN DROPDOWN
   ========================================================= */

function refreshTrainDropdown() {

    const current =
        selectedTrainNumber;

    trainSelect.innerHTML =
        "";

    Object.keys(trains).forEach(
        number => {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                number;

            option.textContent =
                `${number} - ${trains[number].name}`;

            trainSelect.appendChild(
                option
            );

        }
    );

    const addOption =
        document.createElement(
            "option"
        );

    addOption.value =
        "ADD_NEW";

    addOption.textContent =
        "+ Add New Train";

    trainSelect.appendChild(
        addOption
    );

    if (trains[current]) {

        trainSelect.value =
            current;

    }

}


/* =========================================================
   SELECT TRAIN
   ========================================================= */

function selectTrain(number) {

    if (!trains[number]) {

        return;

    }

    Object.keys(trains).forEach(
        trainNumber => {

            if (
                trainNumber !== number
            ) {

                trains[
                    trainNumber
                ].running =
                    false;

            }

        }
    );

    selectedTrainNumber =
        number;

    const train =
        getSelectedTrain();

    clearAllMapLayers();

    displayTrain(train);

    updateInfoPanel(train);

    fitMapToTrain(train);

}


/* =========================================================
   CLEAR ALL MAP LAYERS
   ========================================================= */

function clearAllMapLayers() {

    Object.keys(trains).forEach(
        number => {

            clearTrainFromMap(
                trains[number]
            );

        }
    );

}


/* =========================================================
   FIT MAP TO TRAIN ROUTE
   ========================================================= */

function fitMapToTrain(train) {

    if (
        !train ||
        !train.stations.length
    ) {

        return;

    }

    const bounds =
        L.latLngBounds(
            train.stations.map(
                station => [
                    station.lat,
                    station.lng
                ]
            )
        );

    map.fitBounds(
        bounds,
        {
            padding: [30, 30]
        }
    );

}


/* =========================================================
   ADD STATION ROW
   ========================================================= */

function addStationRow() {

    const row =
        document.createElement(
            "div"
        );

    row.className =
        "station-row";

    row.innerHTML = `

        <input
            type="text"
            placeholder="Station Name"
            class="station-name"
            required
        >

        <input
            type="text"
            placeholder="Code"
            class="station-code"
            required
        >

        <input
            type="number"
            placeholder="Distance (km)"
            class="station-distance"
            min="0"
            required
        >

        <input
            type="number"
            step="any"
            placeholder="Latitude"
            class="station-lat"
            required
        >

        <input
            type="number"
            step="any"
            placeholder="Longitude"
            class="station-lng"
            required
        >

        <button
            type="button"
            class="remove-station"
        >
            ×
        </button>

    `;

    stationContainer.appendChild(
        row
    );

    attachRemoveStationButton(
        row
    );

}


/* =========================================================
   REMOVE STATION
   ========================================================= */

function attachRemoveStationButton(
    row
) {

    const button =
        row.querySelector(
            ".remove-station"
        );

    button.addEventListener(
        "click",
        () => {

            const rows =
                stationContainer.querySelectorAll(
                    ".station-row"
                );

            if (rows.length <= 2) {

                alert(
                    "A train must have at least 2 stations."
                );

                return;

            }

            row.remove();

        }
    );

}


/* =========================================================
   ATTACH EXISTING REMOVE BUTTONS
   ========================================================= */

document
    .querySelectorAll(
        ".station-row"
    )
    .forEach(
        row => {

            attachRemoveStationButton(
                row
            );

        }
    );


/* =========================================================
   OPEN ADD TRAIN MODAL
   ========================================================= */

function openAddTrainModal() {

    trainForm.reset();

    const rows =
        stationContainer.querySelectorAll(
            ".station-row"
        );

    rows.forEach(
        (row, index) => {

            if (index >= 2) {

                row.remove();

            }

        }
    );

    addTrainModal.classList.remove(
        "hidden"
    );

}


/* =========================================================
   CLOSE ADD TRAIN MODAL
   ========================================================= */

function closeAddTrainModal() {

    addTrainModal.classList.add(
        "hidden"
    );

}


/* =========================================================
   READ STATION FORM DATA
   ========================================================= */

function readStations() {

    const rows =
        stationContainer.querySelectorAll(
            ".station-row"
        );

    const stations = [];

    rows.forEach(
        row => {

            const name =
                row.querySelector(
                    ".station-name"
                ).value.trim();

            const code =
                row.querySelector(
                    ".station-code"
                ).value.trim();

            const distance =
                Number(
                    row.querySelector(
                        ".station-distance"
                    ).value
                );

            const lat =
                Number(
                    row.querySelector(
                        ".station-lat"
                    ).value
                );

            const lng =
                Number(
                    row.querySelector(
                        ".station-lng"
                    ).value
                );

            stations.push({

                name: name,

                code: code,

                distance: distance,

                lat: lat,

                lng: lng

            });

        }
    );

    return stations;

}


/* =========================================================
   VALIDATE STATIONS
   ========================================================= */

function validateStations(
    stations
) {

    if (
        stations.length < 2
    ) {

        return (
            "Please add at least 2 stations."
        );

    }

    for (
        let i = 0;
        i < stations.length;
        i++
    ) {

        const station =
            stations[i];

        if (
            !station.name ||
            !station.code
        ) {

            return (
                "Please fill all station names and codes."
            );

        }

        if (
            !Number.isFinite(
                station.distance
            )
        ) {

            return (
                "Invalid station distance."
            );

        }

        if (
            !Number.isFinite(
                station.lat
            ) ||
            station.lat < -90 ||
            station.lat > 90
        ) {

            return (
                "Invalid latitude."
            );

        }

        if (
            !Number.isFinite(
                station.lng
            ) ||
            station.lng < -180 ||
            station.lng > 180
        ) {

            return (
                "Invalid longitude."
            );

        }

        if (
            i > 0 &&
            station.distance <=
            stations[i - 1].distance
        ) {

            return (
                "Station distances must increase in route order."
            );

        }

    }

    return null;

}


/* =========================================================
   ADD NEW TRAIN
   ========================================================= */

trainForm.addEventListener(
    "submit",
    async function (event) {

        event.preventDefault();

        const number =
            document
                .getElementById(
                    "newTrainNumber"
                )
                .value.trim();

        const name =
            document
                .getElementById(
                    "newTrainName"
                )
                .value.trim();

        const normalSpeed =
            Number(
                document
                    .getElementById(
                        "newTrainSpeed"
                    )
                    .value
            );

        if (
            !number ||
            !name
        ) {

            alert(
                "Please enter train number and train name."
            );

            return;

        }

        if (
            trains[number]
        ) {

            alert(
                "A train with this number already exists."
            );

            return;

        }

        if (
            !Number.isFinite(
                normalSpeed
            ) ||
            normalSpeed <= 0
        ) {

            alert(
                "Please enter a valid normal speed."
            );

            return;

        }

        const stations =
            readStations();

        const validationError =
            validateStations(
                stations
            );

        if (validationError) {

            alert(
                validationError
            );

            return;

        }

        const newTrain = {

            number:
                number,

            name:
                name,

            normalSpeed:
                normalSpeed,

            stations:
                stations,

            currentDistance:
                0,

            currentSpeed:
                0,

            targetSpeed:
                normalSpeed,

            weather:
                "Clear",

            status:
                "Ready",

            running:
                false,

            marker:
                null,

            routeLine:
                null,

            stationMarkers:
                [],

            weatherLines:
                [],

            // NEW: real-model prediction state
            lastEtaStationCode:
                null,

            predictedDelayMinutes:
                null,

            predictedEtaTime:
                null,

            confidenceRangeMinutes:
                null

        };

        trains[number] =
            newTrain;

        const saved =
            await saveTrainToDatabase(
                newTrain
            );

        saveLocalStorageTrains();

        if (!saved) {

            alert(
                "Train was added to the simulator, but could not be saved to SQLite. Please check that FastAPI is running."
            );

        }

        selectedTrainNumber =
            number;

        refreshTrainDropdown();

        trainSelect.value =
            number;

        closeAddTrainModal();

        selectTrain(
            number
        );

    }
);


/* =========================================================
   DELETE TRAIN
   ========================================================= */

function openDeleteModal() {

    const keys =
        Object.keys(trains);

    if (
        keys.length <= 1
    ) {

        alert(
            "At least one train must remain in the simulation."
        );

        return;

    }

    deleteModal.classList.remove(
        "hidden"
    );

}


/* =========================================================
   CONFIRM DELETE
   ========================================================= */

async function deleteSelectedTrain() {

    const train =
        getSelectedTrain();

    if (!train) {

        return;

    }

    const trainNumber =
        selectedTrainNumber;

    clearTrainFromMap(
        train
    );

    const deleted =
        await deleteTrainFromDatabase(
            trainNumber
        );

    delete trains[
        trainNumber
    ];

    const remainingTrains =
        Object.keys(trains);

    if (
        remainingTrains.length === 0
    ) {

        alert(
            "No trains are available."
        );

        deleteModal.classList.add(
            "hidden"
        );

        return;

    }

    selectedTrainNumber =
        remainingTrains[0];

    refreshTrainDropdown();

    selectTrain(
        selectedTrainNumber
    );

    saveLocalStorageTrains();

    deleteModal.classList.add(
        "hidden"
    );

    if (!deleted) {

        alert(
            "Train was removed from the current simulator, but could not be deleted from SQLite. Please check that FastAPI is running."
        );

    }

}


/* =========================================================
   EVENT LISTENERS
   ========================================================= */

trainSelect.addEventListener(
    "change",
    function () {

        const value =
            this.value;

        if (
            value === "ADD_NEW"
        ) {

            this.value =
                selectedTrainNumber;

            openAddTrainModal();

            return;

        }

        selectTrain(
            value
        );

    }
);


startBtn.addEventListener(
    "click",
    startTrain
);


pauseBtn.addEventListener(
    "click",
    pauseTrain
);


resetBtn.addEventListener(
    "click",
    function () {

        resetTrain(
            getSelectedTrain()
        );

    }
);


deleteBtn.addEventListener(
    "click",
    openDeleteModal
);


demoSpeed.addEventListener(
    "input",
    function () {

        demoMultiplier =
            Number(
                this.value
            );

        speedValue.textContent =
            `${demoMultiplier}×`;

    }
);


closeModalBtn.addEventListener(
    "click",
    closeAddTrainModal
);


cancelBtn.addEventListener(
    "click",
    closeAddTrainModal
);


addStationBtn.addEventListener(
    "click",
    addStationRow
);


cancelDeleteBtn.addEventListener(
    "click",
    function () {

        deleteModal.classList.add(
            "hidden"
        );

    }
);


confirmDeleteBtn.addEventListener(
    "click",
    deleteSelectedTrain
);


/* =========================================================
   INITIALIZE
   ========================================================= */

async function initialize() {

    const databaseAvailable =
        await loadTrainsFromDatabase();

    console.log(
        databaseAvailable
            ? "Connected to FastAPI + SQLite."
            : "FastAPI unavailable. Using local fallback."
    );

    if (trains["12673"]) {

        selectedTrainNumber =
            "12673";

    } else {

        selectedTrainNumber =
            Object.keys(trains)[0];

    }

    refreshTrainDropdown();

    selectTrain(
        selectedTrainNumber
    );

    startAnimation();

    console.log(
        "Loaded trains:",
        Object.keys(trains)
    );

}


initialize();