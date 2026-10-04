const mongoose = require('mongoose');
const { withSlipNumber, SLIP_PREFIX } = require('../utils/slips');

// A patient's visit to a lab for one test. Auto-confirmed; paid at the lab or
// through one of the patient's installment plans for that test.
const labBookingSchema = new mongoose.Schema(
  {
    patient:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lab:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    labTest:  { type: mongoose.Schema.Types.ObjectId, required: true }, // LabProfile.tests[] subdocument id
    testName: { type: String, required: true },
    price:    { type: Number, required: true },   // test price when booked
    visitDate: { type: String, required: true },  // PKT calendar day, "YYYY-MM-DD" (no time)

    paymentMethod: { type: String, enum: ['at_lab', 'installment'], default: 'at_lab' },
    wallet:        { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' }, // when paid by installment plan

    status: { type: String, enum: ['confirmed', 'sample_collected', 'completed', 'cancelled'], default: 'confirmed' },
    cancelledAt:       { type: Date },
    sampleCollectedAt: { type: Date },
    completedAt:       { type: Date },
    report:            { type: mongoose.Schema.Types.ObjectId, ref: 'TestReport' },
  },
  { timestamps: true }
);

labBookingSchema.index({ lab: 1, visitDate: 1 });
labBookingSchema.index({ patient: 1, createdAt: -1 });
labBookingSchema.plugin(withSlipNumber(SLIP_PREFIX.labBooking)); // slipNumber, printed on the PDF slip

module.exports = mongoose.model('LabBooking', labBookingSchema);
