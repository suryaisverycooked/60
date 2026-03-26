// server.js — FIXED VERSION (Accurate Labels + Stable Damage Scoring)

console.log("Starting server...");

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const axios = require("axios");

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://six0-og6j.onrender.com",
      "https://front-sand-pi.vercel.app/"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ─────────────────────────────────────────
// DB SETUP
// ─────────────────────────────────────────
let connectDB;
try {
  connectDB = require("./db");
} catch {
  connectDB = async () => false;
}

let Report;
try {
  Report = require("./models/Report");
} catch {
  Report = null;
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─────────────────────────────────────────
// ✅ SAFE LABEL MAPPING (NO OVER-TRIGGER)
// ─────────────────────────────────────────
function mapRoboflowLabels(predictions) {
  if (!predictions.length) return "no damage";

  let text = "";

  predictions.forEach(p => {
    switch (p.class) {
      case "building_collapsed":
        text += "building collapse debris ";
        break;

      case "building_weardown":
        text += "building cracks minor_damage ";
        break;

      case "building_clean":
        text += "building clean ";
        break;

      case "road_crack":
        text += "road crack ";
        break;

      case "road_damage":
        text += "road damage ";
        break;

      case "road_clean":
        text += "road clean ";
        break;

      case "bridge_damage":
      case "bridge_fragile":
        text += "bridge damage ";
        break;

      case "flooding":
        text += "flood water ";
        break;

      case "drainage_problem":
        text += "drainage overflow ";
        break;

      case "fire_damage":
      case "smoke":
        text += "fire smoke ";
        break;

      case "vehicle_damage":
        text += "vehicle accident ";
        break;

      case "railway_bad":
        text += "railway damage ";
        break;

      case "tunnel_damage":
        text += "tunnel damage ";
        break;

      case "no_damage":
      case "railway_good":
      case "tunnel_good":
        text += "no damage ";
        break;

      case "landfill":
        text += "debris garbage ";
        break;

      default:
        text += p.class + " ";
    }
  });

  return text.trim();
}

// ─────────────────────────────────────────
// ✅ IMPROVED DAMAGE ENGINE (LESS FALSE POSITIVE)
// ─────────────────────────────────────────
function processDamage(text, confidence = 0) {
  text = (text || "").toLowerCase();

  let damageType = "Unknown";
  let severity = "Low";
  let score = 10;
  let infrastructure = "Unknown";

  // 🔴 CRITICAL (strict conditions only)
  if (
    text.includes("building") &&
    (text.includes("collapse") || text.includes("debris"))
  ) {
    score = 95;
    damageType = "Building Collapse";
    infrastructure = "building";
  }

  // 🟠 HIGH
  else if (text.includes("fire") || text.includes("smoke")) {
    score = 90;
    damageType = "Fire Damage";
    infrastructure = "building";
  }
  else if (text.includes("flood")) {
    score = 85;
    damageType = "Flooding";
    infrastructure = "drainage";
  }
  else if (text.includes("bridge")) {
    score = 75;
    damageType = "Bridge Damage";
    infrastructure = "bridge";
  }

  // 🟡 MODERATE
  else if (text.includes("building") && text.includes("cracks")) {
    score = 60;
    damageType = "Building Damage";
    infrastructure = "building";
  }
  else if (text.includes("vehicle")) {
    score = 65;
    damageType = "Vehicle Damage";
    infrastructure = "road";
  }

  // 🟢 LOW
  else if (text.includes("road") && text.includes("crack")) {
    score = 50;
    damageType = "Road Crack";
    infrastructure = "road";
  }
  else if (text.includes("road")) {
    score = 45;
    damageType = "Road Issue";
    infrastructure = "road";
  }

  // ✅ CONFIDENCE WEIGHTING
  const confidenceBoost = Math.round(confidence * 20);
  score += confidenceBoost;

  // Clamp
  if (score > 100) score = 100;

  // Severity mapping
  if (score >= 85) severity = "Critical";
  else if (score >= 65) severity = "High";
  else if (score >= 45) severity = "Moderate";

  return { damageType, severity, risk: score, infrastructure };
}

// ─────────────────────────────────────────
// ✅ ANALYZE ROUTE (FIXED CORE)
// ─────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { image, location, saveReport = true } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: "No image provided" });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const response = await axios({
      method: "POST",
      url: `https://serverless.roboflow.com/my-first-project-8vzut/4?api_key=1IyZhbzCNeGvs2pKSSYw`,
      data: base64Data,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
    });

    let predictions = [];

    if (response.data?.predictions) {
      predictions = Object.entries(response.data.predictions).map(
        ([label, obj]) => ({
          class: label,
          confidence: obj.confidence,
        })
      );
    }

    // ✅ FILTER
    const filtered = predictions.filter(p => (p.confidence || 0) > 0.5);

    // ✅ SORT PROPERLY
    const sorted = [...filtered].sort((a, b) => b.confidence - a.confidence);

    // ✅ PER-OBJECT ANALYSIS
    const analyses = sorted.map(p => {
      const text = mapRoboflowLabels([p]);
      return {
        label: p.class,
        confidence: p.confidence,
        ...processDamage(text, p.confidence),
      };
    });

    // ✅ PICK HIGHEST RISK OBJECT
    const final = analyses.sort((a, b) => b.risk - a.risk)[0] || {};

    const result = {
      success: true,
      caption: final.label || "unknown",
      confidence: final.confidence || 0,
      predictions,
      analyses, // optional debug insight
      ...final,
    };

    // SAVE REPORT
    if (saveReport && Report) {
      try {
        const report = new Report({
          reportId: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          location,
          imageBase64: image,
          analysis: result,
        });
        await report.save();
        result.reportId = report.reportId;
      } catch {}
    }

    res.json(result);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// ─────────────────────────────────────────
// OTHER ROUTES
// ─────────────────────────────────────────
app.use("/api/reports", require("./routes/reports"));

app.get("/", (req, res) => {
  res.json({ status: "running" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
});