const mongoose = require("mongoose");

const TransferHistorySchema = new mongoose.Schema(
  {
    fromBed: { type: mongoose.Schema.Types.ObjectId, ref: "Bed" },
    toBed: { type: mongoose.Schema.Types.ObjectId, ref: "Bed" },
    reason: String,
    date: { type: Date, default: Date.now },
  },
  { _id: false },
);

const AdmissionSchema = new mongoose.Schema(
  {
    UHID: {
      type: String,
      required: [true, "UHID is required"],
      trim: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient ID is required"],
    },
    patientName: {
      type: String,
      required: [true, "Patient name is required"],
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
    },
    email: String,

    bedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bed",
      required: [true, "Bed ID is required"],
    },
    bedNumber: String,
    roomNumber: String,
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    wardId: { type: mongoose.Schema.Types.ObjectId, ref: "Ward" },
    floorId: { type: mongoose.Schema.Types.ObjectId, ref: "Floor" },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },

    department: {
      type: String,
      required: [true, "Department is required"],
      trim: true,
    },

    admissionDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expectedDischargeDate: Date,
    reasonForAdmission: {
      type: String,
      required: [true, "Reason for admission is required"],
    },

    admissionType: {
      type: String,
      enum: ["Emergency", "Planned", "Transfer", "Day Care"],
      default: "Emergency",
    },

    attendingDoctor: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["Active", "Discharged", "Transferred", "Cancelled"],
      default: "Active",
    },

    estimatedCost: Number,
    totalCost: Number,
    advancePaid: Number,

    actualDischargeDate: Date,
    dischargeNotes: String,
    dischargeSummary: String,
    conditionOnDischarge: {
      type: String,
      enum: ["Stable", "Improved", "Critical", "LAMA"],
      default: null,
    },
    followUpInstructions: String,

    cancelReason: String,
    cancelledAt: Date,

    transferHistory: [TransferHistorySchema],
  },
  { timestamps: true },
);

AdmissionSchema.index({ UHID: 1 });
AdmissionSchema.index({ patientId: 1 });
AdmissionSchema.index({ bedId: 1 });
AdmissionSchema.index({ department: 1 });
AdmissionSchema.index({ status: 1 });
AdmissionSchema.index({ admissionDate: -1 });
AdmissionSchema.index({ admissionType: 1 });
AdmissionSchema.index({ attendingDoctor: 1 });

module.exports =
  mongoose.models.Admission || mongoose.model("Admission", AdmissionSchema);

//   <html lang="en">

// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Patient Admission & Bed Management</title>
//     <script src="https://cdn.tailwindcss.com"></script>
//     <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
//     <style>
//         * {
//             margin: 0;
//             padding: 0;
//             box-sizing: border-box;
//         }

//         body {
//             font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
//             background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//             min-height: 100vh;
//         }

//         .glass {
//             background: rgba(255, 255, 255, 0.95);
//             backdrop-filter: blur(10px);
//             border: 1px solid rgba(255, 255, 255, 0.18);
//             box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
//         }

//         .bed-card {
//             transition: all 0.3s ease;
//             cursor: pointer;
//             position: relative;
//             overflow: hidden;
//         }

//         .bed-card:hover {
//             transform: translateY(-5px);
//             box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
//         }

//         .bed-available {
//             border-left: 4px solid #10b981;
//         }

//         .bed-occupied {
//             border-left: 4px solid #ef4444;
//         }

//         .bed-reserved {
//             border-left: 4px solid #f59e0b;
//         }

//         .room-section {
//             animation: fadeIn 0.5s ease-in;
//         }

//         @keyframes fadeIn {
//             from {
//                 opacity: 0;
//                 transform: translateY(20px);
//             }

//             to {
//                 opacity: 1;
//                 transform: translateY(0);
//             }
//         }

//         .modal {
//             display: none;
//             position: fixed;
//             top: 0;
//             left: 0;
//             width: 100%;
//             height: 100%;
//             background: rgba(0, 0, 0, 0.6);
//             backdrop-filter: blur(5px);
//             z-index: 1000;
//             animation: fadeIn 0.3s ease;
//         }

//         .modal.active {
//             display: flex;
//             align-items: center;
//             justify-content: center;
//         }

//         .modal-content {
//             background: white;
//             border-radius: 16px;
//             max-width: 600px;
//             width: 90%;
//             max-height: 90vh;
//             overflow-y: auto;
//             animation: slideUp 0.3s ease;
//         }

//         @keyframes slideUp {
//             from {
//                 transform: translateY(50px);
//                 opacity: 0;
//             }

//             to {
//                 transform: translateY(0);
//                 opacity: 1;
//             }
//         }

//         .status-badge {
//             display: inline-flex;
//             align-items: center;
//             gap: 6px;
//             padding: 6px 12px;
//             border-radius: 20px;
//             font-size: 12px;
//             font-weight: 600;
//         }

//         .status-available {
//             background: #d1fae5;
//             color: #065f46;
//         }

//         .status-occupied {
//             background: #fee2e2;
//             color: #991b1b;
//         }

//         .status-reserved {
//             background: #fef3c7;
//             color: #92400e;
//         }

//         input:focus,
//         select:focus,
//         textarea:focus {
//             outline: none;
//             border-color: #667eea;
//             box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
//         }

//         .stat-card {
//             background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//             color: white;
//             border-radius: 16px;
//             padding: 24px;
//             transition: transform 0.3s ease;
//         }

//         .stat-card:hover {
//             transform: scale(1.05);
//         }

//         .search-box {
//             position: relative;
//         }

//         .search-box input {
//             padding-left: 45px;
//         }

//         .search-box i {
//             position: absolute;
//             left: 16px;
//             top: 50%;
//             transform: translateY(-50%);
//             color: #9ca3af;
//         }
//     </style>
// </head>

// <body>
//     <div class="min-h-screen p-4 md:p-8">
//         <!-- Header -->
//         <div class="glass rounded-2xl p-6 mb-6">
//             <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
//                 <div>
//                     <h1 class="text-3xl font-bold text-gray-800 flex items-center gap-3">
//                         <i class="fas fa-hospital text-purple-600"></i>
//                         Bed Management System
//                     </h1>
//                     <p class="text-gray-600 mt-1">Manage patient admissions and room allocations</p>
//                 </div>
//                 <button onclick="showPatientSearch()" class="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg transition-all">
//                     <i class="fas fa-user-plus mr-2"></i>
//                     Admit New Patient
//                 </button>
//             </div>
//         </div>

//         <!-- Stats -->
//         <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
//             <div class="stat-card">
//                 <div class="flex items-center justify-between">
//                     <div>
//                         <p class="text-white/80 text-sm">Total Beds</p>
//                         <p class="text-3xl font-bold mt-1" id="totalBeds">24</p>
//                     </div>
//                     <i class="fas fa-bed text-4xl text-white/30"></i>
//                 </div>
//             </div>
//             <div class="stat-card" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
//                 <div class="flex items-center justify-between">
//                     <div>
//                         <p class="text-white/80 text-sm">Available</p>
//                         <p class="text-3xl font-bold mt-1" id="availableBeds">12</p>
//                     </div>
//                     <i class="fas fa-check-circle text-4xl text-white/30"></i>
//                 </div>
//             </div>
//             <div class="stat-card" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
//                 <div class="flex items-center justify-between">
//                     <div>
//                         <p class="text-white/80 text-sm">Occupied</p>
//                         <p class="text-3xl font-bold mt-1" id="occupiedBeds">10</p>
//                     </div>
//                     <i class="fas fa-user-injured text-4xl text-white/30"></i>
//                 </div>
//             </div>
//             <div class="stat-card" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
//                 <div class="flex items-center justify-between">
//                     <div>
//                         <p class="text-white/80 text-sm">Reserved</p>
//                         <p class="text-3xl font-bold mt-1" id="reservedBeds">2</p>
//                     </div>
//                     <i class="fas fa-clock text-4xl text-white/30"></i>
//                 </div>
//             </div>
//         </div>

//         <!-- Filters -->
//         <div class="glass rounded-2xl p-6 mb-6">
//             <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
//                 <div class="search-box">
//                     <i class="fas fa-search"></i>
//                     <input type="text" id="searchInput" placeholder="Search rooms or beds..." class="w-full px-4 py-3 border rounded-xl">
//                 </div>
//                 <select id="floorFilter" class="px-4 py-3 border rounded-xl" onchange="filterBeds()">
//                     <option value="">All Floors</option>
//                     <option value="1">Floor 1</option>
//                     <option value="2">Floor 2</option>
//                     <option value="3">Floor 3</option>
//                 </select>
//                 <select id="statusFilter" class="px-4 py-3 border rounded-xl" onchange="filterBeds()">
//                     <option value="">All Status</option>
//                     <option value="available">Available</option>
//                     <option value="occupied">Occupied</option>
//                     <option value="reserved">Reserved</option>
//                 </select>
//                 <select id="roomTypeFilter" class="px-4 py-3 border rounded-xl" onchange="filterBeds()">
//                     <option value="">All Room Types</option>
//                     <option value="general">General Ward</option>
//                     <option value="private">Private Room</option>
//                     <option value="icu">ICU</option>
//                 </select>
//             </div>
//         </div>

//         <!-- Rooms and Beds -->
//         <div id="roomsContainer">
//             <!-- Rooms will be dynamically generated -->
//         </div>
//     </div>

//     <!-- Patient Search Modal -->
//     <div id="patientSearchModal" class="modal">
//         <div class="modal-content">
//             <div class="p-6 border-b">
//                 <div class="flex items-center justify-between">
//                     <h2 class="text-2xl font-bold text-gray-800">Search & Admit Patient</h2>
//                     <button onclick="closeModal('patientSearchModal')" class="text-gray-500 hover:text-gray-700">
//                         <i class="fas fa-times text-2xl"></i>
//                     </button>
//                 </div>
//             </div>
//             <div class="p-6">
//                 <div class="mb-4">
//                     <label class="block text-sm font-semibold text-gray-700 mb-2">Search Patient by ID or Name</label>
//                     <div class="relative">
//                         <input type="text" id="patientSearchInput" placeholder="Enter Patient ID or Name" class="w-full px-4 py-3 border rounded-xl" oninput="searchPatients()">
//                         <i class="fas fa-search absolute right-4 top-4 text-gray-400"></i>
//                     </div>
//                 </div>
//                 <div id="patientResults" class="space-y-2 max-h-96 overflow-y-auto">
//                     <!-- Patient results will appear here -->
//                 </div>
//             </div>
//         </div>
//     </div>

//     <!-- Admission Form Modal -->
//     <div id="admissionModal" class="modal">
//         <div class="modal-content">
//             <div class="p-6 border-b bg-gradient-to-r from-purple-600 to-pink-600">
//                 <div class="flex items-center justify-between text-white">
//                     <h2 class="text-2xl font-bold">Admit Patient</h2>
//                     <button onclick="closeModal('admissionModal')" class="hover:bg-white/20 rounded-lg p-2">
//                         <i class="fas fa-times text-2xl"></i>
//                     </button>
//                 </div>
//             </div>
//             <form id="admissionForm" class="p-6 space-y-4">
//                 <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
//                     <p class="text-sm text-gray-600">Admitting to:</p>
//                     <p class="font-bold text-lg text-gray-800" id="selectedBedInfo"></p>
//                 </div>

//                 <div id="selectedPatientInfo" class="bg-gray-50 rounded-xl p-4 mb-4">
//                     <!-- Selected patient info will appear here -->
//                 </div>

//                 <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
//                     <div>
//                         <label class="block text-sm font-semibold text-gray-700 mb-2">Admission Date</label>
//                         <input type="datetime-local" id="admissionDate" class="w-full px-4 py-3 border rounded-xl" required>
//                     </div>
//                     <div>
//                         <label class="block text-sm font-semibold text-gray-700 mb-2">Expected Discharge</label>
//                         <input type="date" id="dischargeDate" class="w-full px-4 py-3 border rounded-xl">
//                     </div>
//                 </div>

//                 <div>
//                     <label class="block text-sm font-semibold text-gray-700 mb-2">Admission Type</label>
//                     <select id="admissionType" class="w-full px-4 py-3 border rounded-xl" required>
//                         <option value="">Select Type</option>
//                         <option value="emergency">Emergency</option>
//                         <option value="planned">Planned</option>
//                         <option value="transfer">Transfer</option>
//                     </select>
//                 </div>

//                 <div>
//                     <label class="block text-sm font-semibold text-gray-700 mb-2">Attending Doctor</label>
//                     <select id="attendingDoctor" class="w-full px-4 py-3 border rounded-xl" required>
//                         <option value="">Select Doctor</option>
//                         <option value="dr-sharma">Dr. Sharma (Cardiology)</option>
//                         <option value="dr-patel">Dr. Patel (Neurology)</option>
//                         <option value="dr-kumar">Dr. Kumar (General Medicine)</option>
//                         <option value="dr-singh">Dr. Singh (Surgery)</option>
//                     </select>
//                 </div>

//                 <div>
//                     <label class="block text-sm font-semibold text-gray-700 mb-2">Diagnosis</label>
//                     <textarea id="diagnosis" rows="3" class="w-full px-4 py-3 border rounded-xl" placeholder="Enter preliminary diagnosis"></textarea>
//                 </div>

//                 <div>
//                     <label class="block text-sm font-semibold text-gray-700 mb-2">Special Instructions</label>
//                     <textarea id="instructions" rows="2" class="w-full px-4 py-3 border rounded-xl" placeholder="Any special care instructions..."></textarea>
//                 </div>

//                 <div class="flex gap-3 pt-4">
//                     <button type="submit" class="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg transition-all">
//                         <i class="fas fa-check mr-2"></i>
//                         Confirm Admission
//                     </button>
//                     <button type="button" onclick="closeModal('admissionModal')" class="px-6 py-3 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50 transition-all">
//                         Cancel
//                     </button>
//                 </div>
//             </form>
//         </div>
//     </div>

//     <!-- Patient Details Modal -->
//     <div id="patientDetailsModal" class="modal">
//         <div class="modal-content">
//             <div class="p-6 border-b bg-gradient-to-r from-blue-600 to-cyan-600">
//                 <div class="flex items-center justify-between text-white">
//                     <h2 class="text-2xl font-bold">Patient Details</h2>
//                     <button onclick="closeModal('patientDetailsModal')" class="hover:bg-white/20 rounded-lg p-2">
//                         <i class="fas fa-times text-2xl"></i>
//                     </button>
//                 </div>
//             </div>
//             <div id="patientDetailsContent" class="p-6">
//                 <!-- Patient details will be loaded here -->
//             </div>
//         </div>
//     </div>

//     <script>
//         // Sample data - In production, this would come from your backend
//         let beds = [
//             // Floor 1 - General Ward
//             {
//                 id: 'B101',
//                 room: '101',
//                 floor: 1,
//                 type: 'general',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B102',
//                 room: '101',
//                 floor: 1,
//                 type: 'general',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B103',
//                 room: '102',
//                 floor: 1,
//                 type: 'general',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P001',
//                     name: 'Rajesh Kumar',
//                     age: 45,
//                     gender: 'Male',
//                     admissionDate: '2024-01-15',
//                     doctor: 'Dr. Sharma'
//                 }
//             },
//             {
//                 id: 'B104',
//                 room: '102',
//                 floor: 1,
//                 type: 'general',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B105',
//                 room: '103',
//                 floor: 1,
//                 type: 'general',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P002',
//                     name: 'Priya Singh',
//                     age: 32,
//                     gender: 'Female',
//                     admissionDate: '2024-01-16',
//                     doctor: 'Dr. Patel'
//                 }
//             },
//             {
//                 id: 'B106',
//                 room: '103',
//                 floor: 1,
//                 type: 'general',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B107',
//                 room: '104',
//                 floor: 1,
//                 type: 'general',
//                 status: 'reserved',
//                 patient: null
//             },
//             {
//                 id: 'B108',
//                 room: '104',
//                 floor: 1,
//                 type: 'general',
//                 status: 'available',
//                 patient: null
//             },

//             // Floor 2 - Private Rooms
//             {
//                 id: 'B201',
//                 room: '201',
//                 floor: 2,
//                 type: 'private',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P003',
//                     name: 'Amit Verma',
//                     age: 55,
//                     gender: 'Male',
//                     admissionDate: '2024-01-14',
//                     doctor: 'Dr. Kumar'
//                 }
//             },
//             {
//                 id: 'B202',
//                 room: '202',
//                 floor: 2,
//                 type: 'private',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B203',
//                 room: '203',
//                 floor: 2,
//                 type: 'private',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P004',
//                     name: 'Sneha Patel',
//                     age: 28,
//                     gender: 'Female',
//                     admissionDate: '2024-01-17',
//                     doctor: 'Dr. Singh'
//                 }
//             },
//             {
//                 id: 'B204',
//                 room: '204',
//                 floor: 2,
//                 type: 'private',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B205',
//                 room: '205',
//                 floor: 2,
//                 type: 'private',
//                 status: 'reserved',
//                 patient: null
//             },
//             {
//                 id: 'B206',
//                 room: '206',
//                 floor: 2,
//                 type: 'private',
//                 status: 'available',
//                 patient: null
//             },

//             // Floor 3 - ICU
//             {
//                 id: 'B301',
//                 room: '301',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P005',
//                     name: 'Mohan Das',
//                     age: 62,
//                     gender: 'Male',
//                     admissionDate: '2024-01-13',
//                     doctor: 'Dr. Sharma'
//                 }
//             },
//             {
//                 id: 'B302',
//                 room: '301',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P006',
//                     name: 'Lakshmi Iyer',
//                     age: 48,
//                     gender: 'Female',
//                     admissionDate: '2024-01-15',
//                     doctor: 'Dr. Kumar'
//                 }
//             },
//             {
//                 id: 'B303',
//                 room: '302',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B304',
//                 room: '302',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'available',
//                 patient: null
//             },
//             {
//                 id: 'B305',
//                 room: '303',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'occupied',
//                 patient: {
//                     id: 'P007',
//                     name: 'Suresh Rao',
//                     age: 71,
//                     gender: 'Male',
//                     admissionDate: '2024-01-12',
//                     doctor: 'Dr. Patel'
//                 }
//             },
//             {
//                 id: 'B306',
//                 room: '303',
//                 floor: 3,
//                 type: 'icu',
//                 status: 'available',
//                 patient: null
//             },
//         ];

//         // Sample registered patients (from your registration system)
//         let registeredPatients = [{
//                 id: 'P008',
//                 name: 'Anjali Sharma',
//                 age: 35,
//                 gender: 'Female',
//                 phone: '9876543210',
//                 address: 'Mumbai',
//                 bloodGroup: 'O+'
//             },
//             {
//                 id: 'P009',
//                 name: 'Vikram Singh',
//                 age: 42,
//                 gender: 'Male',
//                 phone: '9876543211',
//                 address: 'Delhi',
//                 bloodGroup: 'A+'
//             },
//             {
//                 id: 'P010',
//                 name: 'Meera Reddy',
//                 age: 29,
//                 gender: 'Female',
//                 phone: '9876543212',
//                 address: 'Bangalore',
//                 bloodGroup: 'B+'
//             },
//             {
//                 id: 'P011',
//                 name: 'Karan Malhotra',
//                 age: 51,
//                 gender: 'Male',
//                 phone: '9876543213',
//                 address: 'Chennai',
//                 bloodGroup: 'AB+'
//             },
//             {
//                 id: 'P012',
//                 name: 'Pooja Gupta',
//                 age: 38,
//                 gender: 'Female',
//                 phone: '9876543214',
//                 address: 'Kolkata',
//                 bloodGroup: 'O-'
//             },
//         ];

//         let selectedBed = null;
//         let selectedPatient = null;

//         // Initialize
//         document.addEventListener('DOMContentLoaded', function() {
//             renderRooms();
//             updateStats();

//             // Set current date/time for admission
//             const now = new Date();
//             now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
//             document.getElementById('admissionDate').value = now.toISOString().slice(0, 16);
//         });

//         // Search input with debounce
//         let searchTimeout;
//         document.getElementById('searchInput').addEventListener('input', function() {
//             clearTimeout(searchTimeout);
//             searchTimeout = setTimeout(() => {
//                 filterBeds();
//             }, 300);
//         });

//         function renderRooms() {
//             const container = document.getElementById('roomsContainer');
//             container.innerHTML = '';

//             // Group beds by floor and room
//             const grouped = {};
//             beds.forEach(bed => {
//                 const key = `Floor ${bed.floor}`;
//                 if (!grouped[key]) grouped[key] = {};
//                 if (!grouped[key][bed.room]) grouped[key][bed.room] = [];
//                 grouped[key][bed.room].push(bed);
//             });

//             // Render each floor
//             Object.keys(grouped).sort().forEach(floor => {
//                 const floorDiv = document.createElement('div');
//                 floorDiv.className = 'glass rounded-2xl p-6 mb-6 room-section';

//                 const roomTypeLabel = floor.includes('3') ? 'ICU' : floor.includes('2') ? 'Private Rooms' : 'General Ward';

//                 floorDiv.innerHTML = `
//                     <div class="flex items-center justify-between mb-6">
//                         <h2 class="text-2xl font-bold text-gray-800">
//                             <i class="fas fa-building mr-2 text-purple-600"></i>
//                             ${floor} - ${roomTypeLabel}
//                         </h2>
//                     </div>
//                     <div class="grid grid-cols-1 lg:grid-cols-2 gap-6" id="floor-${floor}">
//                     </div>
//                 `;

//                 container.appendChild(floorDiv);

//                 const floorContainer = document.getElementById(`floor-${floor}`);

//                 // Render each room
//                 Object.keys(grouped[floor]).sort().forEach(room => {
//                     const roomBeds = grouped[floor][room];
//                     const roomDiv = document.createElement('div');
//                     roomDiv.className = 'border border-gray-200 rounded-xl p-4 bg-white';

//                     roomDiv.innerHTML = `
//                         <h3 class="font-bold text-lg text-gray-700 mb-4 flex items-center gap-2">
//                             <i class="fas fa-door-open text-purple-600"></i>
//                             Room ${room}
//                         </h3>
//                         <div class="space-y-3">
//                             ${roomBeds.map(bed => renderBedCard(bed)).join('')}
//                         </div>
//                     `;

//                     floorContainer.appendChild(roomDiv);
//                 });
//             });
//         }

//         function renderBedCard(bed) {
//             const statusClass = `bed-${bed.status}`;
//             const statusLabel = bed.status.charAt(0).toUpperCase() + bed.status.slice(1);

//             return `
//                 <div class="bed-card ${statusClass} bg-gray-50 rounded-lg p-4 border" onclick="bedClicked('${bed.id}')">
//                     <div class="flex items-center justify-between mb-2">
//                         <div class="flex items-center gap-2">
//                             <i class="fas fa-bed text-2xl ${bed.status === 'available' ? 'text-green-600' : bed.status === 'occupied' ? 'text-red-600' : 'text-orange-600'}"></i>
//                             <span class="font-bold text-gray-800">${bed.id}</span>
//                         </div>
//                         <span class="status-badge status-${bed.status}">
//                             <i class="fas fa-circle text-xs"></i>
//                             ${statusLabel}
//                         </span>
//                     </div>
//                     ${bed.patient ? `
//                         <div class="mt-3 pt-3 border-t border-gray-200">
//                             <p class="font-semibold text-gray-800">${bed.patient.name}</p>
//                             <p class="text-sm text-gray-600">ID: ${bed.patient.id} | ${bed.patient.age}Y ${bed.patient.gender}</p>
//                             <p class="text-sm text-gray-600 mt-1">
//                                 <i class="fas fa-user-md text-purple-600"></i>
//                                 ${bed.patient.doctor}
//                             </p>
//                             <p class="text-xs text-gray-500 mt-1">Admitted: ${bed.patient.admissionDate}</p>
//                         </div>
//                     ` : `
//                         <p class="text-sm text-gray-500 mt-2">Click to ${bed.status === 'available' ? 'admit patient' : 'view details'}</p>
//                     `}
//                 </div>
//             `;
//         }

//         function bedClicked(bedId) {
//             const bed = beds.find(b => b.id === bedId);
//             selectedBed = bed;

//             if (bed.status === 'occupied') {
//                 showPatientDetails(bed.patient);
//             } else if (bed.status === 'available') {
//                 showPatientSearch();
//             } else {
//                 alert('This bed is reserved');
//             }
//         }

//         function showPatientSearch() {
//             document.getElementById('patientSearchModal').classList.add('active');
//             document.getElementById('patientSearchInput').value = '';
//             document.getElementById('patientResults').innerHTML = `
//                 <div class="text-center py-8 text-gray-500">
//                     <i class="fas fa-search text-4xl mb-3"></i>
//                     <p>Search for a patient to admit</p>
//                 </div>
//             `;
//         }

//         function searchPatients() {
//             const query = document.getElementById('patientSearchInput').value.toLowerCase();
//             const resultsDiv = document.getElementById('patientResults');

//             if (!query) {
//                 resultsDiv.innerHTML = `
//                     <div class="text-center py-8 text-gray-500">
//                         <i class="fas fa-search text-4xl mb-3"></i>
//                         <p>Search for a patient to admit</p>
//                     </div>
//                 `;
//                 return;
//             }

//             const filtered = registeredPatients.filter(p =>
//                 p.id.toLowerCase().includes(query) ||
//                 p.name.toLowerCase().includes(query)
//             );

//             if (filtered.length === 0) {
//                 resultsDiv.innerHTML = `
//                     <div class="text-center py-8 text-gray-500">
//                         <i class="fas fa-user-slash text-4xl mb-3"></i>
//                         <p>No patients found</p>
//                     </div>
//                 `;
//                 return;
//             }

//             resultsDiv.innerHTML = filtered.map(patient => `
//                 <div class="border border-gray-200 rounded-xl p-4 hover:bg-purple-50 hover:border-purple-300 cursor-pointer transition-all" onclick='selectPatient(${JSON.stringify(patient)})'>
//                     <div class="flex items-center justify-between">
//                         <div>
//                             <p class="font-bold text-gray-800">${patient.name}</p>
//                             <p class="text-sm text-gray-600">ID: ${patient.id} | ${patient.age}Y ${patient.gender}</p>
//                             <p class="text-sm text-gray-600">Blood: ${patient.bloodGroup} | Phone: ${patient.phone}</p>
//                         </div>
//                         <i class="fas fa-arrow-right text-purple-600"></i>
//                     </div>
//                 </div>
//             `).join('');
//         }

//         function selectPatient(patient) {
//             selectedPatient = patient;

//             if (!selectedBed) {
//                 // If bed not selected, show bed selection
//                 alert('Please select a bed first');
//                 closeModal('patientSearchModal');
//                 return;
//             }

//             closeModal('patientSearchModal');
//             showAdmissionForm();
//         }

//         function showAdmissionForm() {
//             document.getElementById('admissionModal').classList.add('active');
//             document.getElementById('selectedBedInfo').textContent = `${selectedBed.id} - Room ${selectedBed.room}, Floor ${selectedBed.floor}`;
//             document.getElementById('selectedPatientInfo').innerHTML = `
//                 <div class="flex items-center gap-4">
//                     <div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
//                         <i class="fas fa-user text-2xl text-purple-600"></i>
//                     </div>
//                     <div>
//                         <p class="font-bold text-lg text-gray-800">${selectedPatient.name}</p>
//                         <p class="text-sm text-gray-600">ID: ${selectedPatient.id} | ${selectedPatient.age}Y ${selectedPatient.gender}</p>
//                         <p class="text-sm text-gray-600">Blood Group: ${selectedPatient.bloodGroup} | Phone: ${selectedPatient.phone}</p>
//                     </div>
//                 </div>
//             `;
//         }

//         function showPatientDetails(patient) {
//             const modal = document.getElementById('patientDetailsModal');
//             const content = document.getElementById('patientDetailsContent');

//             content.innerHTML = `
//                 <div class="space-y-4">
//                     <div class="flex items-center gap-4 pb-4 border-b">
//                         <div class="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
//                             <i class="fas fa-user text-3xl text-blue-600"></i>
//                         </div>
//                         <div>
//                             <h3 class="text-2xl font-bold text-gray-800">${patient.name}</h3>
//                             <p class="text-gray-600">Patient ID: ${patient.id}</p>
//                         </div>
//                     </div>

//                     <div class="grid grid-cols-2 gap-4">
//                         <div>
//                             <p class="text-sm text-gray-600">Age</p>
//                             <p class="font-semibold text-gray-800">${patient.age} Years</p>
//                         </div>
//                         <div>
//                             <p class="text-sm text-gray-600">Gender</p>
//                             <p class="font-semibold text-gray-800">${patient.gender}</p>
//                         </div>
//                         <div>
//                             <p class="text-sm text-gray-600">Admission Date</p>
//                             <p class="font-semibold text-gray-800">${patient.admissionDate}</p>
//                         </div>
//                         <div>
//                             <p class="text-sm text-gray-600">Bed</p>
//                             <p class="font-semibold text-gray-800">${selectedBed.id}</p>
//                         </div>
//                     </div>

//                     <div class="bg-purple-50 rounded-xl p-4">
//                         <p class="text-sm text-gray-600 mb-1">Attending Doctor</p>
//                         <p class="font-bold text-purple-800 text-lg">${patient.doctor}</p>
//                     </div>

//                     <div class="flex gap-3 pt-4">
//                         <button onclick="dischargePat('${selectedBed.id}')" class="flex-1 bg-red-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-red-700 transition-all">
//                             <i class="fas fa-sign-out-alt mr-2"></i>
//                             Discharge Patient
//                         </button>
//                         <button onclick="closeModal('patientDetailsModal')" class="px-6 py-3 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50 transition-all">
//                             Close
//                         </button>
//                     </div>
//                 </div>
//             `;

//             modal.classList.add('active');
//         }

//         document.getElementById('admissionForm').addEventListener('submit', function(e) {
//             e.preventDefault();

//             const admissionData = {
//                 bedId: selectedBed.id,
//                 patient: selectedPatient,
//                 admissionDate: document.getElementById('admissionDate').value,
//                 dischargeDate: document.getElementById('dischargeDate').value,
//                 admissionType: document.getElementById('admissionType').value,
//                 doctor: document.getElementById('attendingDoctor').value,
//                 diagnosis: document.getElementById('diagnosis').value,
//                 instructions: document.getElementById('instructions').value
//             };

//             // Update bed status
//             const bed = beds.find(b => b.id === selectedBed.id);
//             bed.status = 'occupied';
//             bed.patient = {
//                 ...selectedPatient,
//                 admissionDate: new Date(admissionData.admissionDate).toISOString().split('T')[0],
//                 doctor: admissionData.doctor.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('. ')
//             };

//             // In production, send this to your backend
//             console.log('Admission Data:', admissionData);

//             closeModal('admissionModal');
//             renderRooms();
//             updateStats();

//             alert(`Patient ${selectedPatient.name} successfully admitted to ${selectedBed.id}!`);

//             selectedBed = null;
//             selectedPatient = null;
//         });

//         function dischargePat(bedId) {
//             if (confirm('Are you sure you want to discharge this patient?')) {
//                 const bed = beds.find(b => b.id === bedId);
//                 bed.status = 'available';
//                 bed.patient = null;

//                 closeModal('patientDetailsModal');
//                 renderRooms();
//                 updateStats();

//                 alert('Patient discharged successfully!');
//             }
//         }

//         function filterBeds() {
//             const searchTerm = document.getElementById('searchInput').value.toLowerCase();
//             const floorFilter = document.getElementById('floorFilter').value;
//             const statusFilter = document.getElementById('statusFilter').value;
//             const roomTypeFilter = document.getElementById('roomTypeFilter').value;

//             let filtered = beds;

//             if (searchTerm) {
//                 filtered = filtered.filter(b =>
//                     b.id.toLowerCase().includes(searchTerm) ||
//                     b.room.includes(searchTerm) ||
//                     (b.patient && b.patient.name.toLowerCase().includes(searchTerm))
//                 );
//             }

//             if (floorFilter) {
//                 filtered = filtered.filter(b => b.floor == floorFilter);
//             }

//             if (statusFilter) {
//                 filtered = filtered.filter(b => b.status === statusFilter);
//             }

//             if (roomTypeFilter) {
//                 filtered = filtered.filter(b => b.type === roomTypeFilter);
//             }

//             // Temporarily update beds array for rendering
//             const originalBeds = [...beds];
//             beds = filtered;
//             renderRooms();
//             beds = originalBeds;
//         }

//         function updateStats() {
//             const total = beds.length;
//             const available = beds.filter(b => b.status === 'available').length;
//             const occupied = beds.filter(b => b.status === 'occupied').length;
//             const reserved = beds.filter(b => b.status === 'reserved').length;

//             document.getElementById('totalBeds').textContent = total;
//             document.getElementById('availableBeds').textContent = available;
//             document.getElementById('occupiedBeds').textContent = occupied;
//             document.getElementById('reservedBeds').textContent = reserved;
//         }

//         function closeModal(modalId) {
//             document.getElementById(modalId).classList.remove('active');
//         }

//         // Close modal on outside click
//         document.querySelectorAll('.modal').forEach(modal => {
//             modal.addEventListener('click', function(e) {
//                 if (e.target === this) {
//                     closeModal(this.id);
//                 }
//             });
//         });
//     </script>
// </body>

// </html>
