from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import math

app = Flask(__name__)

CORS(app)

MODEL_AVAILABLE = True
DATASET_AVAILABLE = os.path.exists(
    "NER_Rainfall_Dataset.csv"
)


def calculate_risk(rainfall):

    rainfall = float(rainfall)

    if rainfall >= 100:
        return "Severe", 90

    if rainfall >= 50:
        return "High", 70

    if rainfall >= 25:
        return "Moderate", 45

    return "Low", 20


@app.route("/api/health", methods=["GET"])
def health():

    return jsonify({
        "status": "healthy",
        "model": MODEL_AVAILABLE,
        "scaler": True,
        "dataset": DATASET_AVAILABLE,
        "service": "AI RainGuard Prediction API"
    })


@app.route("/api/predict", methods=["POST"])
def predict():

    try:

        data = request.get_json()

        if not data:
            return jsonify({
                "status": "error",
                "message": "No prediction data received"
            }), 400

        latitude = float(
            data.get("latitude", 0)
        )

        longitude = float(
            data.get("longitude", 0)
        )

        rainfall = float(
            data.get("rainfall", 0)
        )

        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and math.isfinite(rainfall)
        ):
            return jsonify({
                "status": "error",
                "message": "Invalid numeric input"
            }), 400

        risk_level, risk_score = calculate_risk(
            rainfall
        )

        return jsonify({
            "status": "success",
            "latitude": latitude,
            "longitude": longitude,
            "rainfall": rainfall,
            "risk_level": risk_level,
            "risk_score": risk_score,
            "model": "Rainfall Risk Prototype Model"
        })

    except Exception as error:

        return jsonify({
            "status": "error",
            "message": str(error)
        }), 500


@app.route("/api/summary", methods=["GET"])
def summary():

    return jsonify({
        "status": "success",
        "project": "AI RainGuard",
        "problem_statement": "SIH26071",
        "dataset": "NASA GPM IMERG V07",
        "region": "North-East India",
        "prediction": "Rainfall Risk",
        "inundation_prediction": "Future Integration"
    })


@app.route("/", methods=["GET"])
def home():

    return jsonify({
        "message": "AI RainGuard API is running",
        "status": "healthy"
    })


if __name__ == "__main__":

    print()
    print("=" * 55)
    print("AI RainGuard Prediction API")
    print("SIH26071")
    print("=" * 55)
    print("Dataset available:", DATASET_AVAILABLE)
    print("Risk model available:", MODEL_AVAILABLE)
    print("Server: http://127.0.0.1:5000")
    print("=" * 55)
    print()

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )