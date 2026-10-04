const mongoose = require('mongoose');

const testReportSchema = new mongoose.Schema(
  {
    patient:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lab:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testName:  { type: String, required: true, trim: true },
    reportUrl: { type: String, required: true },
    notes:     { type: String, trim: true },
    booking:   { type: mongoose.Schema.Types.ObjectId, ref: 'LabBooking' }, // the visit it came from, if booked

    // Plain-language summary for the patient (the report itself is a PDF / image).
    // The Urdu version is machine-translated (Azure) and can be corrected by the lab.
    summary:             { type: String, trim: true },
    summaryUrdu:         { type: String, trim: true },
    summaryUrduSource:   { type: String, enum: ['machine', 'lab', 'auto'] },
    summaryUrduEditedAt: { type: Date },
    // Who wrote the summary: the lab, or the automatic report reader (never overwrites the lab's)
    summarySource:       { type: String, enum: ['lab', 'auto'] },

    // Automatic reading of the report file (Azure Document Intelligence → reportInterpreter)
    autoRead: {
      status:   { type: String, enum: ['pending', 'processing', 'ready', 'failed', 'skipped'] },
      kind:     { type: String, enum: ['table', 'narrative', 'unreadable'] },
      findings: [{
        _id: false,
        name: String, result: String, unit: String, range: String,
        normalLow: Number, normalHigh: Number,
        status: { type: String, enum: ['high', 'low', 'abnormal', 'normal', 'unknown'] },
        basis:  String,
      }],
      pages:      Number,
      totalPages: Number,
      error:      String,
      readAt:     Date,
    },
    isRead:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TestReport', testReportSchema);
