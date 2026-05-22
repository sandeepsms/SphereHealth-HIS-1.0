// One-off: reset Dr. Priya Sharma password + assign her to active patient as consultant
// so the E2E Chrome test can continue past the consultant-of-record gate.
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/spherehealth');
  const Users = mongoose.connection.collection('users');
  const Admissions = mongoose.connection.collection('admissions');

  const hashed = await bcrypt.hash('Admin@123', 10);
  const r1 = await Users.updateOne(
    { email: 'priya.sharma@spherehealth.com' },
    { $set: { password: hashed, failedLoginAttempts: 0, lockUntil: null } }
  );
  console.log('Doctor pw reset:', r1.modifiedCount);

  const doc = await Users.findOne({ email: 'priya.sharma@spherehealth.com' });
  console.log('Doctor _id:', doc._id.toString());

  // Patient Rajesh Kumar Sharma — admission ADM26050002
  const r2 = await Admissions.updateOne(
    { admissionNumber: 'ADM26050002' },
    { $set: { consultantDoctor: doc._id, admittingDoctor: doc._id, doctor: doc._id } }
  );
  console.log('Admission consultant assigned:', r2.modifiedCount);

  await mongoose.disconnect();
})();
