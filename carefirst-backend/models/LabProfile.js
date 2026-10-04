const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  price:    { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
  installmentEnabled:   { type: Boolean, default: false },
  installmentCount:     { type: Number, min: 1, default: 2 },
  installmentTenureDays:{ type: Number, enum: [15, 20, 25, 30], default: 30 },
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
    // Map pin for True Cost Analysis (travel distance from the patient)
    coordinates: {
      lat: { type: Number, min: -90,  max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    tests:           [testSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('LabProfile', labProfileSchema);
