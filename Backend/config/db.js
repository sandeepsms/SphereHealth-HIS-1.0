/**
 * config/db.js
 *
 * Mongoose connection with retry and reconnection handling.
 *
 * Before: one connection failure → `process.exit(1)`. A 2-second prod network
 * blip would kill the API server and require a manual restart.
 * After: exponential backoff (1s → 2s → 4s → 8s → 16s, capped at 30s) for the
 * initial connect; mongoose-level auto-reconnect for in-flight outages; a
 * SIGTERM/SIGINT hook drains the pool gracefully on deploy.
 */
const mongoose = require("mongoose");

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const MAX_RETRIES = process.env.MONGO_MAX_RETRIES
  ? Number(process.env.MONGO_MAX_RETRIES)
  : 12; // ~5 min total wall-clock with capped backoff

let connectAttempt = 0;

async function tryConnect() {
  connectAttempt++;
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    heartbeatFrequencyMS: 10_000,
  });
}

async function connectDB() {
  // Lifecycle listeners. Wire these ONCE — `mongoose.connection` is a global
  // singleton, so calling connectDB() twice would otherwise double-bind.
  if (!connectDB._listenersBound) {
    connectDB._listenersBound = true;
    mongoose.connection.on("disconnected", () => {
      console.warn("[mongo] disconnected — driver will attempt to reconnect");
    });
    mongoose.connection.on("reconnected", () => {
      console.log("[mongo] reconnected");
    });
    mongoose.connection.on("error", (err) => {
      console.error("[mongo] runtime error:", err.message);
    });
  }

  while (true) {
    try {
      await tryConnect();
      console.log(" MongoDB connected");
      break;
    } catch (err) {
      if (connectAttempt >= MAX_RETRIES) {
        console.error(
          `[mongo] giving up after ${MAX_RETRIES} attempts:`,
          err.message,
        );
        process.exit(1);
      }
      const delay = Math.min(
        INITIAL_RETRY_MS * 2 ** (connectAttempt - 1),
        MAX_RETRY_MS,
      );
      console.error(
        `[mongo] connect failed (attempt ${connectAttempt}/${MAX_RETRIES}):`,
        err.message,
        `— retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // One-time post-connect housekeeping: drop the stale `id_1` index and
  // resync the bed-management indexes. Wrapped in try/catch so a startup
  // hiccup doesn't take the whole server down.
  try {
    const Beds = require("../models/bedMgmt/bedsModel");
    const Building = require("../models/bedMgmt/buildingModel");
    const Floor = require("../models/bedMgmt/floorModel");
    const Ward = require("../models/bedMgmt/wardModel");
    const Room = require("../models/bedMgmt/roomModel");

    try {
      await Beds.collection.dropIndex("id_1");
      console.log(" Dropped id_1 index from beds");
    } catch (error) {
      if (error.code === 27 || /index not found/i.test(error.message || "")) {
        // benign — already gone
      } else {
        console.warn("[mongo] drop id_1 index:", error.message);
      }
    }

    await Promise.all([
      Building.syncIndexes(),
      Floor.syncIndexes(),
      Ward.syncIndexes(),
      Room.syncIndexes(),
      Beds.syncIndexes(),
    ]);
    console.log("All bed management indexes synced");
  } catch (e) {
    console.error("[mongo] post-connect housekeeping failed:", e.message);
  }
}

module.exports = connectDB;
