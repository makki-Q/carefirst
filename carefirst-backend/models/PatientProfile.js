const mongoose = require('mongoose');
const { CNIC_FORMAT } = require('../utils/cnic');

const patientProfileSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    cnic:    { type: String, required: true, unique: true, trim: true, match: [CNIC_FORMAT, 'CNIC must be in the format 12345-1234567-1'] },
    city:    { type: String, trim: true },
    address: { type: String, trim: true },

    // Admin checks the CNIC before community support / installment features are enabled
    cnicStatus:          { type: String, enum: ['unverified', 'verified', 'rejected'], default: 'unverified' },
    cnicRejectionReason: { type: String, trim: true },
    cnicReviewedAt:      { type: Date },
    cnicReviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PatientProfile', patientProfileSchema);
