// server.js — FINAL VERSION (Roboflow + Label Mapping + Stable)

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
      "https://six0-og6j.onrender.com"
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
// 🎯 ROBOFLOW LABEL → TEXT MAPPING
// ─────────────────────────────────────────
function mapRoboflowLabels(predictions) {
  if (!predictions.length) return "no damage clean";

  let text = "";

  predictions.forEach(p => {
    switch (p.class) {
      case "building_collapsed":
        text += " collapsed building debris destroyed ";
        break;

      case "building_weardown":
        text += " damaged building cracks broken ";
        break;

      case "building_clean":
        text += " clean building ";
        break;

      case "road_crack":
        text += " crack road ";
        break;

      case "road_damage":
        text += " broken road damage ";
        break;

      case "road_clean":
        text += " clean road ";
        break;

      case "bridge_damage":
      case "bridge_fragile":
        text += " damaged bridge ";
        break;

      case "flooding":
        text += " flood water ";
        break;

      case "drainage_problem":
        text += " drainage overflow water ";
        break;

      case "fire_damage":
      case "smoke":
        text += " fire smoke burn ";
        break;

      case "vehicle_damage":
        text += " vehicle accident ";
        break;

      case "railway_bad":
        text += " damaged railway ";
        break;

      case "tunnel_damage":
        text += " damaged tunnel ";
        break;

      case "no_damage":
      case "railway_good":
      case "tunnel_good":
        text += " no damage clean ";
        break;

      case "landfill":
        text += " debris garbage ";
        break;

      case "Unrelated":
        text += " unknown ";
        break;

      default:
        text += p.class + " ";
    }
  });

  return text.trim();
}

// ─────────────────────────────────────────
// DAMAGE ENGINE (UNCHANGED)
// ─────────────────────────────────────────
function processDamage(text) {
  text = (text || "").toLowerCase();

  if (
    text.includes("building") ||
    text.includes("apartment") ||
    text.includes("house") ||
    text.includes("structure")
  ) {
    if (
      text.includes("collapse") ||
      text.includes("collapsed") ||
      text.includes("tilted") ||
      text.includes("leaning") ||
      text.includes("fallen") ||
      text.includes("destroyed") ||
      text.includes("ruins") ||
      text.includes("debris") ||
      text.includes("broken")
    ) {
      return {
        damageType: "Building Collapse",
        severity: "Critical",
        risk: 95,
        infrastructure: "building",
      };
    }
  }

  let damageType = "Unknown";
  let severity = "Low";
  let score = 10;
  let infrastructure = "Unknown";

  if (text.includes("electric") || text.includes("pole") || text.includes("wire")) {
    damageType = "Power Infrastructure Damage";
    infrastructure = "utilities";
    score = 90;
  }
  else if (text.includes("flood")) {
    damageType = "Flooding";
    infrastructure = "drainage";
    score = 85;
  }
  else if (text.includes("building")) {
    damageType = "Building Damage";
    infrastructure = "building";
    score = 70;
  }
  else if (text.includes("crack")) {
    damageType = "Road Crack";
    infrastructure = "road";
    score = 55;
  }
  else if (text.includes("road")) {
    damageType = "Road Issue";
    infrastructure = "road";
    score = 50;
  }
  else if (text.includes("bridge")) {
    damageType = "Bridge Damage";
    infrastructure = "bridge";
    score = 75;
  }
  else if (text.includes("vehicle")) {
    damageType = "Vehicle Damage";
    infrastructure = "road";
    score = 70;
  }
  else if (text.includes("fire") || text.includes("smoke")) {
    damageType = "Fire Damage";
    infrastructure = "building";
    score = 90;
  }

  if (score >= 85) severity = "Critical";
  else if (score >= 60) severity = "High";
  else if (score >= 40) severity = "Moderate";

  return { damageType, severity, risk: score, infrastructure };
}

// ─────────────────────────────────────────
// ANALYZE ROUTE
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

    // ✅ FILTER LOW CONFIDENCE
    const filtered = predictions.filter(p => (p.confidence || 0) > 0.5);

    // ✅ USE ROBOfLOW LABELS PROPERLY
    const enrichedText = mapRoboflowLabels(filtered);

    const processed = processDamage(enrichedText);

    const top = filtered[0] || predictions[0] || {};

    const result = {
      success: true,
      caption: top.class || "unknown",
      confidence: top.confidence || 0,
      predictions,
      ...processed,
    };

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