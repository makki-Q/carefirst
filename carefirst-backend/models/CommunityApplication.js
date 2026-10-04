const mongoose = require('mongoose');

const communityApplicationSchema = new mongoose.Schema(
  {
    patient:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testRequired:    { type: String, required: true, trim: true },
    assignedLab:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    documents:       [{ type: String }], // file URLs (utility bills, bank statements)
    status:          { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, trim: true },
    slip: {
      slipId:      String, // e.g. CS-7KQ4-M9XD (utils/slips.js); printed on the PDF slip
      generatedAt: Date,
    },
    testConducted: { type: Boolean, default: false },
    conductedAt:   { type: Date },
    reviewedAt:    { type: Date },
    reviewedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommunityApplication', communityApplicationSchema);
