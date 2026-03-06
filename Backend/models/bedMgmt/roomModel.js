const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: String,
    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      required: true,
    },
    floorNumber: String,
    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
      default: null,
    },
    wardName: String,
    wardCode: String,
    roomNumber: {
      type: String,
      required: true,
    },
    roomName: {
      type: String,
      trim: true,
    },
    roomCode: {
      type: String,
      required: false,
      unique: true,
      uppercase: true,
    },
    roomCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomCategoryModel",
      required: [true, "Room category is required"],
    },
    totalBeds: {
      type: Number,
      required: true,
      min: 0,
    },
    availableBeds: {
      type: Number,
      default: 0,
    },
    occupiedBeds: {
      type: Number,
      default: 0,
    },
    bedRange: String,
    // ❌ REMOVED: services (pricing moved to TPA)
    // ❌ REMOVED: pricing object
    status: {
      type: String,
      enum: ["Active", "Inactive", "Under Maintenance", "Blocked"],
      default: "Active",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

RoomSchema.index({ building: 1, floor: 1 });
RoomSchema.index({ floor: 1, roomNumber: 1 });
RoomSchema.index({ ward: 1 });
RoomSchema.index({ roomCategory: 1, status: 1 });

RoomSchema.virtual("occupancyRate").get(function () {
  if (this.totalBeds === 0) return 0;
  return ((this.occupiedBeds / this.totalBeds) * 100).toFixed(2);
});

RoomSchema.pre("save", async function (next) {
  if (!this.roomCode || this.isModified("roomNumber")) {
    try {
      const floor = await mongoose.model("Floor").findById(this.floor);
      const building = await mongoose.model("Building").findById(this.building);

      if (this.ward) {
        const ward = await mongoose.model("Ward").findById(this.ward);
        this.roomCode = `${building.buildingCode}-${floor.floorNumber}-${ward.wardCode}-${this.roomNumber}`;
      } else {
        this.roomCode = `${building.buildingCode}-${floor.floorNumber}-${this.roomNumber}`;
      }
    } catch (error) {
      return next(error);
    }
  }

  if (this.isNew) {
    this.availableBeds = this.totalBeds;
  }

  next();
});

module.exports = mongoose.model("Room", RoomSchema);
