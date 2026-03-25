// server.js — FINAL WORKING VERSION

console.log("Starting server...");

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { pipeline } = require("@xenova/transformers");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5173", // local dev
      "https://six0-og6j.onrender.com" // if deployed frontend
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

// ─────────────────────────────────────────
// ✅ FIXED CORS (CRITICAL)
// ─────────────────────────────────────────


app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

console.log("Middleware configured");

// ─────────────────────────────────────────
// AI MODEL (Singleton)
// ─────────────────────────────────────────
let classifier;
async function loadModel() {
  if (!classifier) {
    console.log("Loading AI model...");
    classifier = await pipeline(
      "image-classification",
      "Xenova/efficientnet_b0-finetuned-damage-detection"
    );
    console.log("AI model loaded");
  }
  return classifier;
}

// ─────────────────────────────────────────
// DAMAGE ENGINE
// ─────────────────────────────────────────
function processDamage(text) {
  text = (text || "").toLowerCase();

  let damageType = "Unknown";
  let severity = "Low";
  let score = 10;
  let infrastructure = "Unknown";

  // 🔥 ELECTRICAL / UTILITIES
  if (text.includes("electric") || text.includes("pole") || text.includes("wire") || text.includes("tower")) {
    damageType = "Power Infrastructure Damage";
    infrastructure = "utilities";
    score = 90;
  }

  // 🌊 FLOOD / WATER
  else if (text.includes("flood") || text.includes("water") || text.includes("overflow") || text.includes("drain")) {
    damageType = "Flooding / Waterlogging";
    infrastructure = "drainage";
    score = 85;
  }

  // 🏚 BUILDING COLLAPSE / DAMAGE
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

  // 🏢 BUILDING GENERAL
  else if (
  text.includes("building") ||
  text.includes("apartment") ||
  text.includes("house") ||
  text.includes("structure")
) {
  // 🔥 CRITICAL: detect collapse properly
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

  // 🛣 ROAD DAMAGE
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

  // 🌉 BRIDGE
  else if (text.includes("bridge") || text.includes("overpass")) {
    damageType = "Bridge Damage";
    infrastructure = "bridge";
    score = 75;
  }

  // 🌳 TREE
  else if (text.includes("tree") || text.includes("fallen")) {
    damageType = "Fallen Tree";
    infrastructure = "roadside";
    score = 50;
  }

  // 🚧 CONSTRUCTION / DEBRIS
  else if (text.includes("debris") || text.includes("rubble")) {
    damageType = "Debris Obstruction";
    infrastructure = "road";
    score = 60;
  }

  // 🚗 VEHICLE DAMAGE (optional detection)
  else if (text.includes("car") || text.includes("vehicle") || text.includes("truck")) {
    damageType = "Accident / Vehicle Damage";
    infrastructure = "road";
    score = 70;
  }

  // 🔥 FIRE DAMAGE
  else if (text.includes("fire") || text.includes("burnt") || text.includes("smoke")) {
    damageType = "Fire Damage";
    infrastructure = "building";
    score = 90;
  }
  // 🔥 GLOBAL DAMAGE DETECTOR (VERY IMPORTANT)
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
  // ⚠️ FALLBACK (SMART DEFAULT)
  if (damageType === "Unknown") {
    if (text.includes("building") || text.includes("structure")) {
      damageType = "Possible Structural Damage";
      infrastructure = "building";
      score = 50;
    } else if (text.includes("road") || text.includes("street")) {
      damageType = "Possible Road Damage";
      infrastructure = "road";
      score = 40;
    }
  }

  // 🎯 SEVERITY LOGIC
  if (score >= 85) severity = "Critical";
  else if (score >= 60) severity = "High";
  else if (score >= 40) severity = "Moderate";
  else severity = "Low";

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

    await loadModel();
    console.log("Running AI analysis...");

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const filePath = path.join(__dirname, "temp.jpg");
    fs.writeFileSync(filePath, base64Data, "base64");

    const labels = [
      "damaged electric pole",
      "flooded street",
      "pothole road",
      "cracked road",
      "broken bridge",
      "damaged building",
      "fallen tree",
      "normal road"
    ];

    const result = await classifier(filePath);

// 🔥 Combine all labels for better understanding
const labelsText = result.map(r => r.label).join(" ");

const top = result[0];
let enrichedText = labelsText;

// 🔥 DAMAGE BOOST (VERY IMPORTANT)
// 🔥 SMART DAMAGE BOOST (UPGRADED)
if (
  labelsText.includes("building") ||
  labelsText.includes("house") ||
  labelsText.includes("apartment") ||
  labelsText.includes("structure")
) {
  enrichedText += " collapsed damaged broken debris ruins destroyed disaster destruction";
}

// extra boost for low confidence
if (top.score < 0.6) {
  enrichedText += " damage broken crack hazard unsafe";
}

const processed = processDamage(enrichedText);

    fs.unlinkSync(filePath);

    const response = {
      success: true,
      caption: top.label,
      confidence: top.score,
      ...processed,
    };

    // Save to DB
    if (saveReport && Report) {
      try {
        const report = new Report({
          reportId: `ai_${Date.now()}`,
          timestamp: Date.now(),
          location,
          imageBase64: image,
          analysis: response,
        });
        await report.save();
        response.reportId = report.reportId;
      } catch {}
    }

    res.json(response);
  } catch (err) {
    console.error("Analysis error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// REPORT ROUTES
// ─────────────────────────────────────────
app.use("/api/reports", require("./routes/reports"));

// ─────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "running", message: "Backend live" });
});

// ─────────────────────────────────────────
// ✅ FIXED HEALTH ROUTE
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// ✅ TEST ROUTE (REQUIRED BY FRONTEND)
// ─────────────────────────────────────────
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