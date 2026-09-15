const API_URL = "https://ai-rainguard.onrender.com";

let rainfallData = [];
let rainfallChart = null;
let riskMap = null;
let mapMarkers = [];

let apiConnected = false;
let predictionCache = new Map();
let cellPredictions = [];

const stationMeta = {
    sohra: {
        lat: 25.27,
        lon: 91.73
    },

    guwahati: {
        lat: 26.14,
        lon: 91.74
    },

    imphal: {
        lat: 24.82,
        lon: 93.94
    },

    agartala: {
        lat: 23.83,
        lon: 91.28
    }
};


/* =========================================================
   CSV PARSER
========================================================= */

function parseCSV(text) {

    const lines = text
        .trim()
        .split(/\r?\n/);

    if (lines.length < 2) {
        return [];
    }

    const headers = lines[0]
        .split(",")
        .map(header => header.trim());

    return lines.slice(1).map(line => {

        const values = line.split(",");
        const row = {};

        headers.forEach((header, index) => {

            row[header] =
                values[index]
                    ? values[index].trim()
                    : "";

        });

        return row;
    });
}


/* =========================================================
   LOAD NASA RAINFALL DATA
========================================================= */

async function loadRainfallData() {

    try {

        const response =
            await fetch(
                "NER_Rainfall_Dataset.csv"
            );

        if (!response.ok) {

            throw new Error(
                "NASA CSV could not be loaded"
            );
        }

        const text =
            await response.text();

        rainfallData =
            parseCSV(text)
                .map(row => ({

                    time:
                        row.time ||
                        row.date,

                    lat:
                        Number(
                            row.lat ||
                            row.latitude
                        ),

                    lon:
                        Number(
                            row.lon ||
                            row.longitude
                        ),

                    precipitation:
                        Number(
                            row.precipitation
                        )

                }))
                .filter(row =>

                    Number.isFinite(row.lat) &&
                    Number.isFinite(row.lon) &&
                    Number.isFinite(
                        row.precipitation
                    )

                );

        console.log(
            "NASA rainfall records:",
            rainfallData.length
        );

        if (!rainfallData.length) {

            showToast(
                "NASA rainfall dataset contains no valid records."
            );

            return;
        }

        createRainfallChart("sohra");

        /*
         * Prediction data is loaded after API health
         * verification during initialization.
         */

    } catch (error) {

        console.error(
            "Dataset error:",
            error
        );

        showToast(
            "NASA rainfall dataset could not be loaded."
        );
    }
}


/* =========================================================
   RISK CALCULATION FALLBACK
========================================================= */

function calculateRisk(rainfall) {

    rainfall = Number(rainfall);

    if (rainfall >= 100) {

        return {
            level: "Severe",
            score: 90
        };
    }

    if (rainfall >= 50) {

        return {
            level: "High",
            score: 70
        };
    }

    if (rainfall >= 25) {

        return {
            level: "Moderate",
            score: 45
        };
    }

    return {
        level: "Low",
        score: 20
    };
}


/* =========================================================
   CREATE GRID CELLS
========================================================= */

function createGridCells() {

    const cells = new Map();

    rainfallData.forEach(row => {

        const key =
            row.lat.toFixed(1) +
            "," +
            row.lon.toFixed(1);

        if (!cells.has(key)) {

            cells.set(
                key,
                {
                    lat: row.lat,
                    lon: row.lon,
                    rainfall:
                        row.precipitation
                }
            );

        } else {

            const cell =
                cells.get(key);

            cell.rainfall =
                Math.max(
                    cell.rainfall,
                    row.precipitation
                );
        }
    });

    return cells;
}


/* =========================================================
   API PREDICTION
========================================================= */

async function predictRisk(
    latitude,
    longitude,
    rainfall
) {

    const cacheKey =
        `${latitude.toFixed(2)},${longitude.toFixed(2)},${rainfall.toFixed(2)}`;

    if (predictionCache.has(cacheKey)) {

        return predictionCache.get(
            cacheKey
        );
    }

    try {

        const response =
            await fetch(
                API_URL +
                "/api/predict",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            latitude:
                                latitude,

                            longitude:
                                longitude,

                            rainfall:
                                rainfall
                        })
                }
            );

        if (!response.ok) {

            throw new Error(
                "Prediction API error: " +
                response.status
            );
        }

        const result =
            await response.json();

        if (
            result.status !== "success"
        ) {

            throw new Error(
                result.message ||
                "Prediction failed"
            );
        }

        predictionCache.set(
            cacheKey,
            result
        );

        return result;

    } catch (error) {

        console.error(
            "Prediction error:",
            error
        );

        return null;
    }
}


/* =========================================================
   GET PREDICTIONS FOR GRID
========================================================= */

async function getCellPredictions(
    limit = 80
) {

    if (!rainfallData.length) {

        return [];
    }

    const cells =
        createGridCells();

    const selectedCells =
        Array.from(
            cells.values()
        ).slice(0, limit);

    const predictions =
        await Promise.all(

            selectedCells.map(
                async cell => {

                    const prediction =
                        await predictRisk(
                            cell.lat,
                            cell.lon,
                            cell.rainfall
                        );

                    let risk;

                    if (prediction) {

                        risk = {

                            level:
                                prediction.risk_level ||
                                prediction.level ||
                                "Low",

                            score:
                                Number(
                                    prediction.risk_score ||
                                    prediction.score ||
                                    20
                                )
                        };

                    } else {

                        risk =
                            calculateRisk(
                                cell.rainfall
                            );
                    }

                    return {

                        ...cell,

                        riskLevel:
                            risk.level,

                        riskScore:
                            risk.score,

                        prediction:
                            prediction

                    };
                }
            )
        );

    cellPredictions =
        predictions;

    return predictions;
}


/* =========================================================
   UPDATE DASHBOARD
========================================================= */

function updateDashboard(
    predictions = cellPredictions
) {

    if (!rainfallData.length) {

        return;
    }

    const values =
        rainfallData.map(
            row =>
                row.precipitation
        );

    const average =
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / values.length;

    const rainfallCard =
        document.getElementById(
            "statRainfall"
        );

    if (rainfallCard) {

        rainfallCard.textContent =
            average.toFixed(2) +
            " mm/day";
    }


    let highZones = 0;
    let totalZones = predictions.length;

    predictions.forEach(
        prediction => {

            if (
                prediction.riskLevel ===
                    "High" ||
                prediction.riskLevel ===
                    "Severe"
            ) {

                highZones++;
            }
        }
    );


    if (!predictions.length) {

        const fallback =
            calculateRiskZones();

        highZones =
            fallback.high;

        totalZones =
            fallback.total;
    }


    const zonesCard =
        document.getElementById(
            "statZones"
        );

    if (zonesCard) {

        zonesCard.innerHTML =
            highZones +
            ' <span class="card__value-of">/ ' +
            totalZones +
            "</span>";
    }


    let alertCount = 0;

    if (predictions.length) {

        predictions.forEach(
            prediction => {

                if (
                    prediction.riskLevel ===
                        "High" ||
                    prediction.riskLevel ===
                        "Severe"
                ) {

                    alertCount++;
                }
            }
        );

    } else {

        alertCount =
            calculateAlertCount();
    }


    const alertCard =
        document.getElementById(
            "statAlerts"
        );

    if (alertCard) {

        alertCard.textContent =
            Math.min(
                alertCount,
                9
            );
    }
}


/* =========================================================
   FALLBACK RISK ZONES
========================================================= */

function calculateRiskZones() {

    const cells =
        createGridCells();

    let high = 0;

    cells.forEach(cell => {

        const risk =
            calculateRisk(
                cell.rainfall
            );

        if (
            risk.level === "High" ||
            risk.level === "Severe"
        ) {

            high++;
        }
    });

    return {

        total:
            cells.size,

        high:
            high
    };
}


/* =========================================================
   CREATE RISK MAP
========================================================= */

async function createRiskMap() {

    const mapElement =
        document.getElementById(
            "map"
        );

    if (!mapElement) {

        return;
    }


    if (riskMap) {

        riskMap.remove();

        mapMarkers = [];
    }


    riskMap =
        L.map("map")
            .setView(
                [25.8, 93.0],
                6
            );


    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            attribution:
                "&copy; OpenStreetMap contributors"
        }
    ).addTo(riskMap);


    let predictions =
        await getCellPredictions(
            80
        );


    if (!predictions.length) {

        updateMapMessage();

        return;
    }


    predictions.forEach(
        prediction => {

            const marker =
                L.circleMarker(
                    [
                        prediction.lat,
                        prediction.lon
                    ],
                    {

                        radius: 7,

                        weight: 2,

                        color:
                            getRiskColor(
                                prediction.riskLevel
                            ),

                        fillColor:
                            getRiskColor(
                                prediction.riskLevel
                            ),

                        fillOpacity: 0.78
                    }
                );


            marker.bindPopup(`

                <div class="map-popup">

                    <strong>
                        AI RainGuard Risk Cell
                    </strong>

                    <br><br>

                    <b>Latitude:</b>
                    ${prediction.lat.toFixed(2)}

                    <br>

                    <b>Longitude:</b>
                    ${prediction.lon.toFixed(2)}

                    <br>

                    <b>NASA Rainfall:</b>
                    ${prediction.rainfall.toFixed(2)}
                    mm/day

                    <br>

                    <b>Risk Level:</b>
                    ${prediction.riskLevel}

                    <br>

                    <b>Risk Score:</b>
                    ${prediction.riskScore}/100

                    <br><br>

                    <small>

                        Prediction generated by the
                        connected AI RainGuard rainfall-risk
                        API using NASA GPM IMERG rainfall
                        input.

                        <br><br>

                        This prototype currently provides
                        rainfall-risk inference.
                        Full inundation prediction requires
                        terrain, drainage, river-level and
                        flood-extent inputs.

                    </small>

                </div>

            `);


            marker.addTo(
                riskMap
            );

            mapMarkers.push(
                marker
            );
        }
    );


    updateDashboard(
        predictions
    );

    generateAlerts(
        predictions
    );

    updateMapMessage();
}


/* =========================================================
   RISK COLOR
========================================================= */

function getRiskColor(level) {

    switch (level) {

        case "Severe":
            return "#ef4444";

        case "High":
            return "#f97316";

        case "Moderate":
            return "#eab308";

        default:
            return "#22c55e";
    }
}


/* =========================================================
   STATION DATA
========================================================= */

function getNearestStationData(
    stationName
) {

    const station =
        stationMeta[
            stationName
        ];

    if (!station) {

        return [];
    }


    const grouped =
        new Map();


    rainfallData.forEach(row => {

        const distance =
            Math.pow(
                row.lat -
                station.lat,
                2
            ) +

            Math.pow(
                row.lon -
                station.lon,
                2
            );


        const date =
            row.time;


        if (!grouped.has(date)) {

            grouped.set(
                date,
                {
                    row: row,
                    distance:
                        distance
                }
            );

        } else {

            const current =
                grouped.get(date);


            if (
                distance <
                current.distance
            ) {

                grouped.set(
                    date,
                    {
                        row: row,
                        distance:
                            distance
                    }
                );
            }
        }
    });


    return Array.from(
        grouped.values()
    )
    .sort(
        (a, b) =>
            new Date(
                a.row.time
            ) -

            new Date(
                b.row.time
            )
    )
    .map(
        item =>
            item.row
    );
}


/* =========================================================
   RAINFALL CHART
========================================================= */

function createRainfallChart(
    stationName
) {

    const canvas =
        document.getElementById(
            "rainfallChart"
        );

    if (!canvas) {

        return;
    }


    const data =
        getNearestStationData(
            stationName
        );


    const labels =
        data.map(row =>

            new Date(
                row.time
            ).toLocaleDateString(
                "en-IN",
                {

                    day: "2-digit",

                    month: "short"
                }
            )
        );


    const values =
        data.map(
            row =>
                Number(
                    row.precipitation
                )
        );


    if (rainfallChart) {

        rainfallChart.destroy();
    }


    rainfallChart =
        new Chart(
            canvas,
            {

                type: "line",

                data: {

                    labels:
                        labels,

                    datasets: [

                        {

                            label:
                                "NASA Rainfall (mm/day)",

                            data:
                                values,

                            borderWidth:
                                2,

                            tension:
                                0.3,

                            fill:
                                false
                        },

                        {

                            label:
                                "Reference Level (25 mm/day)",

                            data:
                                values.map(
                                    () => 25
                                ),

                            borderWidth:
                                1,

                            borderDash:
                                [6, 6],

                            pointRadius:
                                0,

                            fill:
                                false
                        }

                    ]
                },


                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    plugins: {

                        legend: {

                            display:
                                true
                        }
                    },


                    scales: {

                        y: {

                            beginAtZero:
                                true,

                            title: {

                                display:
                                    true,

                                text:
                                    "Rainfall (mm/day)"
                            }
                        }
                    }
                }
            }
        );


    updateStationStats(
        data
    );
}


/* =========================================================
   STATION STATISTICS
========================================================= */

function updateStationStats(
    data
) {

    if (!data.length) {

        return;
    }


    const values =
        data.map(
            row =>
                Number(
                    row.precipitation
                )
        );


    const peak =
        Math.max(
            ...values
        );


    const cumulative =
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        );


    const peakElement =
        document.getElementById(
            "statPeak"
        );


    const cumulativeElement =
        document.getElementById(
            "statCumulative"
        );


    if (peakElement) {

        peakElement.textContent =
            peak.toFixed(2) +
            " mm/day";
    }


    if (cumulativeElement) {

        cumulativeElement.textContent =
            cumulative.toFixed(2) +
            " mm";
    }
}


/* =========================================================
   STATION SELECTOR
========================================================= */

function setupStationSelector() {

    const selector =
        document.getElementById(
            "stationSelect"
        );

    if (!selector) {

        return;
    }


    selector.addEventListener(
        "change",
        () => {

            createRainfallChart(
                selector.value
            );

        }
    );
}


/* =========================================================
   API HEALTH CHECK
========================================================= */

async function checkAPIHealth() {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/health",
                {
                    method: "GET",
                    cache: "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                "Backend unavailable"
            );
        }


        const health =
            await response.json();


        console.log(
            "Backend health:",
            health
        );


        if (
            health.status ===
            "healthy"
        ) {

            apiConnected = true;

            setConnectionStatus(
                true
            );

            return true;
        }


        apiConnected = false;

        setConnectionStatus(
            false
        );

        return false;


    } catch (error) {

        console.error(
            "API health error:",
            error
        );

        apiConnected = false;

        setConnectionStatus(
            false
        );

        return false;
    }
}


/* =========================================================
   CONNECTION STATUS
========================================================= */

function setConnectionStatus(
    connected
) {

    const riskCard =
        document.getElementById(
            "statRisk"
        );


    const modelStatus =
        document.getElementById(
            "modelStatus"
        );


    const apiStatus =
        document.getElementById(
            "apiStatus"
        );


    const modelDot =
        document.getElementById(
            "modelDot"
        );


    const apiDot =
        document.getElementById(
            "apiDot"
        );


    const message =
        document.getElementById(
            "modelMessage"
        );


    if (connected) {

        if (riskCard) {

            riskCard.textContent =
                "Connected";
        }


        if (modelStatus) {

            modelStatus.textContent =
                "Connected";

            modelStatus.className =
                "status-tag status-tag--connected";
        }


        if (apiStatus) {

            apiStatus.textContent =
                "Connected";

            apiStatus.className =
                "status-tag status-tag--connected";
        }


        if (modelDot) {

            modelDot.className =
                "status-dot status-dot--connected";
        }


        if (apiDot) {

            apiDot.className =
                "status-dot status-dot--connected";
        }


        if (message) {

            message.innerHTML =
                "<strong>AI RainGuard API: Connected.</strong> The deployed Render prediction API is responding and providing prototype rainfall-risk inference using NASA GPM IMERG rainfall input. Full inundation prediction requires additional terrain, drainage, river-level and flood-extent inputs.";
        }


    } else {

        if (riskCard) {

            riskCard.textContent =
                "Not Connected";
        }


        if (modelStatus) {

            modelStatus.textContent =
                "Not Connected";

            modelStatus.className =
                "status-tag status-tag--pending";
        }


        if (apiStatus) {

            apiStatus.textContent =
                "Not Connected";

            apiStatus.className =
                "status-tag status-tag--pending";
        }


        if (modelDot) {

            modelDot.className =
                "status-dot status-dot--pending";
        }


        if (apiDot) {

            apiDot.className =
                "status-dot status-dot--pending";
        }


        if (message) {

            message.innerHTML =
                "<strong>AI RainGuard API: Not Connected.</strong> The deployed prediction API could not be reached. The dashboard can still display NASA rainfall data using the local prototype risk thresholds.";
        }
    }
}


/* =========================================================
   MAP MESSAGE
========================================================= */

function updateMapMessage() {

    const message =
        document.querySelector(
            "#risk-map .section__head p"
        );


    if (message) {

        if (apiConnected) {

            message.textContent =
                "Grid cells show NASA GPM IMERG rainfall across North-East India. Risk colours are generated through the connected AI RainGuard prediction API. Click a cell for detailed rainfall and risk information.";

        } else {

            message.textContent =
                "Grid cells show NASA GPM IMERG rainfall across North-East India. The prediction API is currently unavailable, so local prototype rainfall thresholds are used as a fallback.";
        }
    }
}


/* =========================================================
   ALERT COUNT
========================================================= */

function calculateAlertCount() {

    let count = 0;


    rainfallData.forEach(row => {

        if (
            row.precipitation >=
            50
        ) {

            count++;
        }
    });


    return Math.min(
        count,
        9
    );
}


/* =========================================================
   GENERATE ALERTS
========================================================= */

function generateAlerts(
    predictions = cellPredictions
) {

    const list =
        document.getElementById(
            "alertList"
        );


    if (!list) {

        return;
    }


    list.innerHTML =
        "";


    let alertData = [];


    if (
        predictions &&
        predictions.length
    ) {

        alertData =
            predictions
                .filter(
                    prediction =>
                        prediction.riskLevel ===
                            "High" ||
                        prediction.riskLevel ===
                            "Severe"
                )
                .sort(
                    (a, b) =>
                        b.rainfall -
                        a.rainfall
                )
                .slice(
                    0,
                    6
                );

    } else {

        alertData =
            rainfallData
                .filter(
                    row =>
                        row.precipitation >=
                        50
                )
                .sort(
                    (a, b) =>
                        b.precipitation -
                        a.precipitation
                )
                .slice(
                    0,
                    6
                )
                .map(row => {

                    const risk =
                        calculateRisk(
                            row.precipitation
                        );

                    return {

                        lat:
                            row.lat,

                        lon:
                            row.lon,

                        rainfall:
                            row.precipitation,

                        riskLevel:
                            risk.level,

                        riskScore:
                            risk.score
                    };
                });
    }


    if (!alertData.length) {

        const item =
            document.createElement(
                "li"
            );


        item.className =
            "alert-item";


        item.innerHTML = `

            <strong>
                No high rainfall-risk cells detected
            </strong>

            <small>
                Based on the current NASA rainfall
                prototype dataset.
            </small>

        `;


        list.appendChild(
            item
        );


        return;
    }


    alertData.forEach(
        prediction => {

            const item =
                document.createElement(
                    "li"
                );


            item.className =
                "alert-item";


            const sourceText =
                apiConnected
                    ? "Connected AI RainGuard API"
                    : "Local prototype fallback";


            item.innerHTML = `

                <strong>
                    ${escapeHTML(
                        prediction.riskLevel
                    )}
                    rainfall-risk cell
                </strong>

                <span>
                    ${Number(
                        prediction.rainfall
                    ).toFixed(2)}
                    mm/day
                </span>

                <small>
                    ${Number(
                        prediction.lat
                    ).toFixed(2)}°N,
                    ${Number(
                        prediction.lon
                    ).toFixed(2)}°E
                    · ${sourceText}
                </small>

            `;


            list.appendChild(
                item
            );
        }
    );
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

    const links =
        document.querySelectorAll(
            ".nav-link"
        );


    links.forEach(
        link => {

            link.addEventListener(
                "click",
                event => {

                    event.preventDefault();


                    const target =
                        link.getAttribute(
                            "href"
                        );


                    const section =
                        document.querySelector(
                            target
                        );


                    if (section) {

                        section.scrollIntoView(
                            {
                                behavior:
                                    "smooth"
                            }
                        );
                    }


                    links.forEach(
                        item =>
                            item.classList.remove(
                                "is-active"
                            )
                    );


                    link.classList.add(
                        "is-active"
                    );
                }
            );
        }
    );
}


/* =========================================================
   MOBILE MENU
========================================================= */

function setupMobileMenu() {

    const button =
        document.getElementById(
            "menuToggle"
        );


    const sidebar =
        document.getElementById(
            "sidebar"
        );


    if (
        !button ||
        !sidebar
    ) {

        return;
    }


    button.addEventListener(
        "click",
        () => {

            sidebar.classList.toggle(
                "open"
            );
        }
    );
}


/* =========================================================
   CLOCK
========================================================= */

function updateClock() {

    const clock =
        document.getElementById(
            "liveClock"
        );


    if (!clock) {

        return;
    }


    const now =
        new Date();


    clock.textContent =
        now.toLocaleString(
            "en-IN",
            {

                day:
                    "2-digit",

                month:
                    "short",

                year:
                    "numeric",

                hour:
                    "2-digit",

                minute:
                    "2-digit",

                second:
                    "2-digit"
            }
        );
}


/* =========================================================
   INCIDENT REPORT FORM
========================================================= */

function setupIncidentForm() {

    const form =
        document.getElementById(
            "incidentForm"
        );


    if (!form) {

        return;
    }


    form.addEventListener(
        "submit",
        event => {

            event.preventDefault();


            const location =
                document.getElementById(
                    "incidentLocation"
                ).value.trim();


            const description =
                document.getElementById(
                    "incidentDescription"
                ).value.trim();


            const photo =
                document.getElementById(
                    "incidentPhoto"
                );


            const reports =
                JSON.parse(
                    localStorage.getItem(
                        "rainGuardIncidents"
                    ) ||
                    "[]"
                );


            reports.push({

                location:
                    location,

                description:
                    description,

                photo:
                    photo.files.length
                        ? photo.files[0].name
                        : "",

                date:
                    new Date()
                        .toISOString()
            });


            localStorage.setItem(
                "rainGuardIncidents",
                JSON.stringify(
                    reports
                )
            );


            form.reset();


            const preview =
                document.getElementById(
                    "photoPreview"
                );


            if (preview) {

                preview.hidden =
                    true;
            }


            loadIncidentReports();


            showToast(
                "Incident report saved."
            );
        }
    );
}


/* =========================================================
   INCIDENT REPORT LIST
========================================================= */

function loadIncidentReports() {

    const list =
        document.getElementById(
            "reportList"
        );


    const count =
        document.getElementById(
            "reportCount"
        );


    const empty =
        document.getElementById(
            "reportEmpty"
        );


    if (!list) {

        return;
    }


    const reports =
        JSON.parse(
            localStorage.getItem(
                "rainGuardIncidents"
            ) ||
            "[]"
        );


    if (count) {

        count.textContent =
            reports.length;
    }


    list.querySelectorAll(
        ".report-item"
    ).forEach(
        item =>
            item.remove()
    );


    if (!reports.length) {

        if (empty) {

            empty.style.display =
                "block";
        }


        return;
    }


    if (empty) {

        empty.style.display =
            "none";
    }


    reports
        .slice()
        .reverse()
        .forEach(
            report => {

                const item =
                    document.createElement(
                        "li"
                    );


                item.className =
                    "report-item";


                item.innerHTML = `

                    <strong>
                        ${escapeHTML(
                            report.location
                        )}
                    </strong>

                    <p>
                        ${escapeHTML(
                            report.description
                        )}
                    </p>

                    <small>
                        ${new Date(
                            report.date
                        ).toLocaleString(
                            "en-IN"
                        )}
                    </small>

                `;


                list.appendChild(
                    item
                );
            }
        );
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(
    value
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        value || "";


    return div.innerHTML;
}


/* =========================================================
   PHOTO PREVIEW
========================================================= */

function setupPhotoPreview() {

    const input =
        document.getElementById(
            "incidentPhoto"
        );


    const preview =
        document.getElementById(
            "photoPreview"
        );


    const image =
        document.getElementById(
            "photoPreviewImg"
        );


    const name =
        document.getElementById(
            "photoPreviewName"
        );


    if (
        !input ||
        !preview
    ) {

        return;
    }


    input.addEventListener(
        "change",
        () => {

            const file =
                input.files[0];


            if (!file) {

                preview.hidden =
                    true;

                return;
            }


            preview.hidden =
                false;


            if (name) {

                name.textContent =
                    file.name;
            }


            if (image) {

                const reader =
                    new FileReader();


                reader.onload =
                    event => {

                        image.src =
                            event.target.result;
                    };


                reader.readAsDataURL(
                    file
                );
            }
        }
    );
}


/* =========================================================
   TOAST
========================================================= */

function showToast(
    message
) {

    const toast =
        document.getElementById(
            "toast"
        );


    if (!toast) {

        return;
    }


    toast.textContent =
        message;


    toast.classList.add(
        "show"
    );


    setTimeout(
        () => {

            toast.classList.remove(
                "show"
            );

        },
        3000
    );
}


/* =========================================================
   INITIALIZE AI RAINGUARD
========================================================= */

async function initializeRainGuard() {

    console.log(
        "AI RainGuard starting..."
    );


    updateClock();


    setInterval(
        updateClock,
        1000
    );


    setupNavigation();

    setupMobileMenu();

    setupStationSelector();

    setupIncidentForm();

    setupPhotoPreview();

    loadIncidentReports();


    /*
     * First check the deployed Render API.
     * This avoids showing "local API" when the
     * frontend is actually connected to Render.
     */

    await checkAPIHealth();


    /*
     * Then load the NASA rainfall CSV.
     */

    await loadRainfallData();


    /*
     * Build dashboard, map and alerts using
     * the connected prediction API.
     */

    if (rainfallData.length) {

        const predictions =
            await getCellPredictions(
                80
            );


        updateDashboard(
            predictions
        );


        await createRiskMap();


        generateAlerts(
            predictions
        );
    }


    console.log(
        "AI RainGuard initialized."
    );
}


/* =========================================================
   START APPLICATION
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    initializeRainGuard
);