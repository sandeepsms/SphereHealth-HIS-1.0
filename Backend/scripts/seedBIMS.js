/**
 * SphereHealth HIS — BIMS Building Structure Seed Script
 * Run: node Backend/scripts/seedBIMS.js
 *
 * Creates: BIMS Building → Ground Floor + First Floor → Wards → Rooms → Beds
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const Building = require("../models/bedMgmt/buildingModel");
const Floor = require("../models/bedMgmt/floorModel");
const Ward = require("../models/bedMgmt/wardModel");
const Room = require("../models/bedMgmt/roomModel");
const Beds = require("../models/bedMgmt/bedsModel");
const RoomCategory = require("../models/bedMgmt/roomCategoryModel");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";

// ── Room category definitions ────────────────────────────────────────────────
const ROOM_CATEGORIES = [
  { categoryName: "Emergency Room",  categoryCode: "EMRG", roomType: "Emergency",    classification: "Standard" },
  { categoryName: "ICU Room",        categoryCode: "ICU",  roomType: "ICU",          classification: "Premium"  },
  { categoryName: "Private Room",    categoryCode: "PVT",  roomType: "Private Room", classification: "Deluxe"   },
  { categoryName: "Pediatric Ward",  categoryCode: "PEDI", roomType: "Pediatric",    classification: "Standard" },
  { categoryName: "Treatment Room",  categoryCode: "TRMT", roomType: "Other",        classification: "Standard" },
  { categoryName: "General Ward",    categoryCode: "GENW", roomType: "General Ward", classification: "Economy"  },
];

// ── BIMS structure ────────────────────────────────────────────────────────────
const STRUCTURE = {
  buildingName: "BIMS",
  buildingCode: "BIMS",
  totalFloors: 2,
  floors: [
    {
      floorNumber: "G",
      floorName: "Ground Floor",
      wards: [
        { wardName: "Emergency Area",  wardCode: "BIMS-G-EMRG", wardType: "Emergency", totalBeds: 2, categoryCode: "EMRG" },
        { wardName: "ICU",             wardCode: "BIMS-G-ICU",  wardType: "ICU",       totalBeds: 2, categoryCode: "ICU"  },
        { wardName: "Private Room",    wardCode: "BIMS-G-PVT",  wardType: "Private",   totalBeds: 2, categoryCode: "PVT"  },
        { wardName: "Pedia Ward",      wardCode: "BIMS-G-PEDI", wardType: "Pediatric", totalBeds: 3, categoryCode: "PEDI" },
        { wardName: "Treatment Room",  wardCode: "BIMS-G-TRMT", wardType: "General",   totalBeds: 1, categoryCode: "TRMT" },
      ],
    },
    {
      floorNumber: "1",
      floorName: "First Floor",
      wards: [
        { wardName: "Male General Ward",   wardCode: "BIMS-1-MGW", wardType: "Male Ward",   totalBeds: 6, categoryCode: "GENW" },
        { wardName: "Female General Ward", wardCode: "BIMS-1-FGW", wardType: "Female Ward", totalBeds: 3, categoryCode: "GENW" },
      ],
    },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function padNum(n, len = 2) {
  return String(n).padStart(len, "0");
}

async function findOrCreateCategory(catDef) {
  let cat = await RoomCategory.findOne({ categoryCode: catDef.categoryCode });
  if (cat) {
    console.log(`  ⏭️  Category exists: ${catDef.categoryName}`);
    return cat;
  }
  cat = await RoomCategory.create(catDef);
  console.log(`  ✅ Category created: ${catDef.categoryName}`);
  return cat;
}

async function findOrCreateFloor(building, floorDef) {
  let floor = await Floor.findOne({ building: building._id, floorNumber: floorDef.floorNumber });
  if (floor) {
    console.log(`  ⏭️  Floor exists: ${floorDef.floorName}`);
    return floor;
  }
  floor = await Floor.create({
    building: building._id,
    buildingName: building.buildingName,
    floorNumber: floorDef.floorNumber,
    floorName: floorDef.floorName,
    totalWards: floorDef.wards.length,
  });
  console.log(`  ✅ Floor created: ${floorDef.floorName}`);
  return floor;
}

async function findOrCreateWard(building, floor, wardDef) {
  let ward = await Ward.findOne({ wardCode: wardDef.wardCode });
  if (ward) {
    console.log(`    ⏭️  Ward exists: ${wardDef.wardName}`);
    return ward;
  }
  ward = await Ward.create({
    building: building._id,
    buildingName: building.buildingName,
    floor: floor._id,
    floorNumber: floor.floorNumber,
    floorName: floor.floorName,
    wardName: wardDef.wardName,
    wardCode: wardDef.wardCode,
    wardType: wardDef.wardType,
    totalBeds: wardDef.totalBeds,
    totalRooms: 1,
    isActive: true,
  });
  console.log(`    ✅ Ward created: ${wardDef.wardName} (${wardDef.totalBeds} beds)`);
  return ward;
}

async function findOrCreateRoom(building, floor, ward, roomCategory, bedCount, roomIdx) {
  const roomNumber = `${ward.wardCode}-R${padNum(roomIdx)}`;
  let room = await Room.findOne({ ward: ward._id, roomNumber });
  if (room) {
    console.log(`      ⏭️  Room exists: ${roomNumber}`);
    return room;
  }
  room = await Room.create({
    building: building._id,
    buildingName: building.buildingName,
    floor: floor._id,
    floorNumber: floor.floorNumber,
    ward: ward._id,
    wardName: ward.wardName,
    wardCode: ward.wardCode,
    roomNumber,
    roomName: `${ward.wardName} Room ${roomIdx}`,
    roomCategory: roomCategory._id,
    totalBeds: bedCount,
    availableBeds: bedCount,
    occupiedBeds: 0,
    status: "Active",
    isActive: true,
  });
  console.log(`      ✅ Room created: ${roomNumber} (${bedCount} beds)`);
  return room;
}

async function createBedIfMissing(building, floor, ward, room, bedNum) {
  const bedNumber = `${ward.wardCode}-B${padNum(bedNum)}`;
  const existing = await Beds.findOne({ room: room._id, bedNumber });
  if (existing) {
    console.log(`        ⏭️  Bed exists: ${bedNumber}`);
    return;
  }
  await Beds.create({
    bedNumber,
    building: building._id,
    buildingName: building.buildingName,
    floor: floor._id,
    floorNumber: floor.floorNumber,
    ward: ward._id,
    wardName: ward.wardName,
    wardCode: ward.wardCode,
    room: room._id,
    roomNumber: room.roomNumber,
    roomName: room.roomName,
    roomCode: room.roomCode,
    status: "Available",
    isActive: true,
  });
  console.log(`        ✅ Bed created: ${bedNumber}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB:", MONGO_URI);

    // 1. Find or create building
    let building = await Building.findOne({ buildingCode: STRUCTURE.buildingCode });
    if (building) {
      console.log(`⏭️  Building exists: ${building.buildingName} (${building._id})`);
    } else {
      building = await Building.create({
        buildingName: STRUCTURE.buildingName,
        buildingCode: STRUCTURE.buildingCode,
        totalFloors: STRUCTURE.totalFloors,
        isActive: true,
      });
      console.log(`✅ Building created: ${building.buildingName}`);
    }

    // 2. Ensure room categories exist
    console.log("\n── Room Categories ──────────────────────────────────────────");
    const categoryMap = {};
    for (const catDef of ROOM_CATEGORIES) {
      const cat = await findOrCreateCategory(catDef);
      categoryMap[catDef.categoryCode] = cat;
    }

    // 3. Create floors → wards → rooms → beds
    for (const floorDef of STRUCTURE.floors) {
      console.log(`\n── ${floorDef.floorName} ──────────────────────────────────────────`);
      const floor = await findOrCreateFloor(building, floorDef);

      for (const wardDef of floorDef.wards) {
        const ward = await findOrCreateWard(building, floor, wardDef);
        const roomCat = categoryMap[wardDef.categoryCode];
        const room = await findOrCreateRoom(building, floor, ward, roomCat, wardDef.totalBeds, 1);

        for (let b = 1; b <= wardDef.totalBeds; b++) {
          await createBedIfMissing(building, floor, ward, room, b);
        }
      }
    }

    console.log("\n🎉 BIMS structure seeded successfully!");
    console.log(`\n📊 Summary:`);
    console.log(`   Building : BIMS`);
    console.log(`   Floors   : 2 (Ground + First)`);
    console.log(`   Wards    : 7`);
    console.log(`   Total beds: 19 (G: 2+2+2+3+1=10, 1F: 6+3=9)`);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    if (err.errors) {
      Object.entries(err.errors).forEach(([k, v]) => console.error(`   ${k}: ${v.message}`));
    }
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

seed();
