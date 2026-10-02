const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctor:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tests: [
      {
        testName: { type: String, required: true, trim: true },
        notes:    { type: String, trim: true },
      },
    ],
    generalNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
