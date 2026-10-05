const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  price:    { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
  installmentEnabled:   { type: Boolean, default: false },
  installmentCount:     { type: Number, min: 1, default: 2 },
  installmentTenureDays:{ type: Number, enum: [15, 20, 25, 30], default: 30 },
  // Branches that offer this test (LabProfile.branches[]._id); empty = every branch
  branches: [{ type: mongoose.Schema.Types.ObjectId }],
});

// A lab account is a chain; each branch is a place patients visit (decided 2026-10-05, "Option B")
const branchSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, maxlength: 80 },  // e.g. "Chughtai Lab – Susan Road"
  address:  { type: String, required: true, trim: true, maxlength: 200 },
  area:     { type: String, trim: true, maxlength: 60 },
  phone:    { type: String, trim: true, maxlength: 30 },
  hours:    { type: String, trim: true, maxlength: 80 },
  // Map pin for True Cost Analysis (travel distance from the patient)
  coordinates: {
    lat: { type: Number, min: -90,  max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
});

const labProfileSchema = new mongoose.Schema(
  {
    user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    labName:         { type: String, required: true, trim: true },
    location:        { type: String, required: true, trim: true },
    licenseNumber:   { type: String, trim: true },
    phone:           { type: String, trim: true },
    bankDetails: {
      bankName:      String,
      accountNumber: String,
    },
    jazzCash:        { type: String, trim: true },
    easyPaisa:       { type: String, trim: true },
    // Community Support partner: takes care of needy patients the admin assigns.
    // The lab joins / leaves from its own portal (PUT /api/lab/community-support);
    // CareFirst collects no donations.
    isCharityPartner:    { type: Boolean, default: false },
    charityPartnerSince: { type: Date },
    // Legacy single map pin (before branches) — copied into the first branch at startup
    coordinates: {
      lat: { type: Number, min: -90,  max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    tests:           [testSchema],
    branches:        [branchSchema], // at least one; labs from before branches get one at startup
  },
  { timestamps: true }
);

module.exports = mongoose.model('LabProfile', labProfileSchema);
