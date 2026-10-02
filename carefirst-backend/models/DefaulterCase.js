const mongoose = require('mongoose');

const defaulterCaseSchema = new mongoose.Schema(
  {
    patient:            { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
    wallet:             { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
    assignedLawyer:     { type: mongoose.Schema.Types.ObjectId, ref: 'User'   },
    missedInstallments: { type: Number, default: 0 },
    totalOverdue:       { type: Number, default: 0 },
    legalAgreementText: { type: String },
    status:             { type: String, enum: ['active', 'resolved'], default: 'active' },
    escalatedAt:        { type: Date, default: Date.now },
    resolvedAt:         { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DefaulterCase', defaulterCaseSchema);
