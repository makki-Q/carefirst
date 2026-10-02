const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  number:         { type: Number, required: true },
  dueDate:        { type: Date,   required: true },
  amount:         { type: Number, required: true },
  status:         { type: String, enum: ['pending', 'overdue', 'paid'], default: 'pending' },

  // Step 1 — patient uploads proof of payment
  receiptUrl:        { type: String },
  receiptUploadedAt: { type: Date },

  // Step 2 — lab confirms they received the cash
  labApproved:    { type: Boolean, default: false },
  labApprovedAt:  { type: Date },

  // Step 3 — admin gives final verification, marks paid
  adminVerified:   { type: Boolean, default: false },
  adminVerifiedAt: { type: Date },
  adminVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const walletSchema = new mongoose.Schema(
  {
    patient:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lab:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testName: { type: String, required: true },

    totalAmount: { type: Number, required: true },

    downPayment: {
      amount:       { type: Number, default: 0 },
      receiptUrl:   { type: String },
      paidAt:       Date,
      adminVerified:{ type: Boolean, default: false },
      verifiedAt:   Date,
    },

    serviceFee: {
      amount:       { type: Number, default: 0 },
      receiptUrl:   { type: String },
      paidAt:       Date,
      adminVerified:{ type: Boolean, default: false },
      verifiedAt:   Date,
    },

    remainingBalance: { type: Number },

    installments: [installmentSchema],

    // Collected when patient applies for installment plan
    guarantor: {
      name:     String,
      cnic:     String,
      phone:    String,
      relation: String,
      address:  String,
    },

    status:          { type: String, enum: ['active', 'completed', 'defaulter'], default: 'active' },
    planApprovedAt:  { type: Date },
    planApprovedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Recalculate remaining balance every time the wallet is saved
walletSchema.pre('save', function (next) {
  const paidInstallmentsTotal = this.installments
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);

  const downPaid = this.downPayment?.adminVerified ? (this.downPayment?.amount || 0) : 0;
  const feePaid  = this.serviceFee?.adminVerified  ? (this.serviceFee?.amount  || 0) : 0;

  this.remainingBalance = this.totalAmount - downPaid - feePaid - paidInstallmentsTotal;
  next();
});

module.exports = mongoose.model('Wallet', walletSchema);
