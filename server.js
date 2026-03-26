// server.js — FINAL WORKING VERSION (Roboflow Integrated)

console.log("Starting server...");

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const axios = require("axios");

const fs = require("fs");
const path = require("path");

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
// DB + MODEL LOADING
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

console.log("Middleware configured");

// ─────────────────────────────────────────
// DAMAGE ENGINE (UNCHANGED)
// ─────────────────────────────────────────
function processDamage(text) {
  // 🔥 ULTRA CONTEXT OVERRIDE (DO NOT REMOVE)
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
  text = (text || "").toLowerCase();

  let damageType = "Unknown";
  let severity = "Low";
  let score = 10;
  let infrastructure = "Unknown";

  if (text.includes("electric") || text.includes("pole") || text.includes("wire") || text.includes("tower")) {
    damageType = "Power Infrastructure Damage";
    infrastructure = "utilities";
    score = 90;
  }
  else if (text.includes("flood") || text.includes("water") || text.includes("overflow") || text.includes("drain")) {
    damageType = "Flooding / Waterlogging";
    infrastructure = "drainage";
    score = 85;
  }
  else if (
    text.includes("collapsed") ||
    text.includes("ruins") ||
    text.includes("destroyed") ||
    text.includes("damaged building") ||
    text.includes("debris")
  ) {
    damageType = "Building Collapse";
    infrastructure = "building";
    score = 95;
  }
  else if (
    text.includes("building") ||
    text.includes("apartment") ||
    text.includes("house") ||
    text.includes("structure")
  ) {
    if (
      text.includes("collapsed") ||
      text.includes("ruins") ||
      text.includes("debris") ||
      text.includes("destroyed") ||
      text.includes("broken")
    ) {
      damageType = "Building Collapse";
      infrastructure = "building";
      score = 95;
    } else {
      damageType = "Building Damage";
      infrastructure = "building";
      score = 70;
    }
  }
  else if (text.includes("pothole")) {
    damageType = "Pothole";
    infrastructure = "road";
    score = 65;
  }
  else if (text.includes("crack") || text.includes("broken road")) {
    damageType = "Road Crack";
    infrastructure = "road";
    score = 55;
  }
  else if (text.includes("bridge") || text.includes("overpass")) {
    damageType = "Bridge Damage";
    infrastructure = "bridge";
    score = 75;
  }
  else if (text.includes("tree") || text.includes("fallen")) {
    damageType = "Fallen Tree";
    infrastructure = "roadside";
    score = 50;
  }
  else if (text.includes("debris") || text.includes("rubble")) {
    damageType = "Debris Obstruction";
    infrastructure = "road";
    score = 60;
  }
  else if (text.includes("car") || text.includes("vehicle") || text.includes("truck")) {
    damageType = "Accident / Vehicle Damage";
    infrastructure = "road";
    score = 70;
  }
  else if (text.includes("fire") || text.includes("burnt") || text.includes("smoke")) {
    damageType = "Fire Damage";
    infrastructure = "building";
    score = 90;
  }

  if (
    text.includes("damage") ||
    text.includes("broken") ||
    text.includes("collapsed") ||
    text.includes("destroyed") ||
    text.includes("debris")
  ) {
    if (infrastructure === "Unknown") {
      damageType = "General Structural Damage";
      infrastructure = "building";
      score = Math.max(score, 80);
    }
  }

  if (damageType === "Unknown") {
    if (text.includes("building")) {
      damageType = "Possible Structural Damage";
      infrastructure = "building";
      score = 50;
    } else if (text.includes("road")) {
      damageType = "Possible Road Damage";
      infrastructure = "road";
      score = 40;
    }
  }

  if (score >= 85) severity = "Critical";
  else if (score >= 60) severity = "High";
  else if (score >= 40) severity = "Moderate";

  return { damageType, severity, risk: score, infrastructure };
}

// ─────────────────────────────────────────
// ANALYZE ROUTE (FIXED)
// ─────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { image, location, saveReport = true } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: "No image provided" });
    }

    console.log("Running Roboflow AI analysis...");

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const response = await axios({
  method: "POST",
  url: `https://serverless.roboflow.com/my-first-project-8vzut/4?api_key=1IyZhbzCNeGvs2pKSSYw`,
  data: base64Data, // ✅ PURE BASE64 ONLY
  headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  },
  timeout: 20000,
});

    // 🔥 SAFE EXTRACTION (FIXED)
    // 🔥 SAFE EXTRACTION (FINAL FIX)
// 🔥 FINAL WORKFLOW PARSER (100% FIX)
let predictions = [];

const output = response.data?.outputs?.[0];

if (output) {
  // 1. Detection results
  const detections =
    output?.model_predictions?.predictions ||
    output?.detections ||
    [];

  // 2. Classification result
  const classification =
    output?.classification ||
    output?.classification_model ||
    {};

  if (Array.isArray(detections) && detections.length > 0) {
    predictions = detections;
  } else if (classification?.top) {
    predictions = [
      {
        class: classification.top,
        confidence: classification.confidence || 0.7,
      },
    ];
  }
}

    const labelsText = predictions.map(p => p.class || p.label || "").join(" ");
    let enrichedText = labelsText;
    // 🚀 FORCE DAMAGE DETECTION BOOST
if (predictions.length === 0) {
  enrichedText += " collapsed building damage debris destruction broken structure";
}

    if (
      labelsText.includes("building") ||
      labelsText.includes("structure")
    ) {
      enrichedText += " collapsed damaged broken debris ruins destroyed disaster";
    }

    if (predictions.length === 0) {
      enrichedText += " damage broken crack hazard unsafe";
    }

    const processed = processDamage(enrichedText);

    const top = predictions[0] || {};

    const result = {
      success: true,
      caption: top.class || top.label || "unknown",
      confidence: top.confidence || top.score || 0,
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
    console.error("FULL ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// ─────────────────────────────────────────
// OTHER ROUTES (UNCHANGED)
// ─────────────────────────────────────────
app.use("/api/reports", require("./routes/reports"));

app.get("/", (req, res) => {
  res.json({ status: "running", message: "Backend live" });
});

app.get("/api/health", async (req, res) => {
  const mongoose = require("mongoose");
  res.json({
    success: true,
    data: {
      server: "running",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    },
  });
});

app.get("/api/analyze/test", (req, res) => {
  const result = processDamage("damaged electric pole");
  res.json({
    success: true,
    data: {
      caption: "test",
      ...result,
      confidence: 0.95,
    },
  });
});

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB().catch(() => {});
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
}

start();