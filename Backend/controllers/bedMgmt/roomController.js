const roomService = require("../../services/bedMgmt/roomService");

/**
 * @desc    Create a new room
 * @route   POST /api/bed-mgmt/rooms
 * @access  Private/Admin
 */
exports.createRoom = async (req, res) => {
  try {
    const room = await roomService.createRoom(req.body);

    res.status(201).json({
      success: true,
      message: "Room created successfully",
      data: room,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get all rooms
 * @route   GET /api/bed-mgmt/rooms
 * @access  Private
 */
exports.getAllRooms = async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms(req.query);

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get room details (MISSING FUNCTION - NOW ADDED)
 * @route   GET /api/bed-mgmt/rooms/details/:id
 * @access  Private
 */
/**
 * Get room details
 */
exports.getRoomDetails = async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.id);

    res.status(200).json({
      success: true,
      data: room,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get room by ID
 * @route   GET /api/bed-mgmt/rooms/:id
 * @access  Private
 */
exports.getRoomById = async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.id);

    res.status(200).json({
      success: true,
      data: room,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Update room
 * @route   PUT /api/bed-mgmt/rooms/:id
 * @access  Private/Admin
 */
exports.updateRoom = async (req, res) => {
  try {
    const room = await roomService.updateRoom(req.params.id, req.body);

    res.status(200).json({
      success: true,
      message: "Room updated successfully",
      data: room,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Delete room
 * @route   DELETE /api/bed-mgmt/rooms/:id
 * @access  Private/Admin
 */
exports.deleteRoom = async (req, res) => {
  try {
    const room = await roomService.deleteRoom(req.params.id);

    res.status(200).json({
      success: true,
      message: "Room deleted successfully",
      data: room,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Update room services
 * @route   PUT /api/bed-mgmt/rooms/:id/services
 * @access  Private/Admin
 */
exports.updateRoomServices = async (req, res) => {
  try {
    const room = await roomService.updateRoomServices(
      req.params.id,
      req.body.services
    );

    res.status(200).json({
      success: true,
      message: "Room services updated successfully",
      data: room,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get rooms by category
 * @route   GET /api/bed-mgmt/rooms/category/:categoryId
 * @access  Private
 */
exports.getRoomsByCategory = async (req, res) => {
  try {
    const rooms = await roomService.getRoomsByCategory(
      req.params.categoryId,
      req.query
    );

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get available rooms by category
 * @route   GET /api/bed-mgmt/rooms/category/:categoryId/available
 * @access  Private
 */
exports.getAvailableRoomsByCategory = async (req, res) => {
  try {
    const rooms = await roomService.getAvailableRoomsByCategory(
      req.params.categoryId
    );

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get room statistics by category
 * @route   GET /api/bed-mgmt/rooms/category/:categoryId/stats
 * @access  Private
 */
exports.getRoomStatsByCategory = async (req, res) => {
  try {
    const stats = await roomService.getRoomStatsByCategory(
      req.params.categoryId
    );

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Update bed occupancy
 * @route   PUT /api/bed-mgmt/rooms/:id/occupancy
 * @access  Private
 */
exports.updateBedOccupancy = async (req, res) => {
  try {
    const room = await roomService.updateBedOccupancy(
      req.params.id,
      req.body.occupiedBeds
    );

    res.status(200).json({
      success: true,
      message: "Bed occupancy updated successfully",
      data: room,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get rooms with low availability
 * @route   GET /api/bed-mgmt/rooms/availability/low
 * @access  Private
 */
exports.getRoomsWithLowAvailability = async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 1;
    const rooms = await roomService.getRoomsWithLowAvailability(threshold);

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Get fully occupied rooms
 * @route   GET /api/bed-mgmt/rooms/availability/full
 * @access  Private
 */
exports.getFullyOccupiedRooms = async (req, res) => {
  try {
    const rooms = await roomService.getFullyOccupiedRooms();

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
