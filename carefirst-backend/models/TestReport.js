const mongoose = require('mongoose');

const testReportSchema = new mongoose.Schema(
  {
    patient:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lab:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testName:  { type: String, required: true, trim: true },
    reportUrl: { type: String, required: true },
    notes:     { type: String, trim: true },
    isRead:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TestReport', testReportSchema);
