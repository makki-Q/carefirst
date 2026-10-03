const mongoose = require('mongoose');

// Lifecycle: pending_approval → (rejected | awaiting_fee) → active → (completed | defaulter)
//   awaiting_fee = admin approved the application; CareFirst service fee not yet verified
const WALLET_STATUSES = ['pending_approval', 'rejected', 'awaiting_fee', 'active', 'completed', 'defaulter'];

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

  // "Due soon" reminders already sent (days before due date, see config/installments.js)
  remindersSent: [{ type: Number }],
});

const walletSchema = new mongoose.Schema(
  {
    patient:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lab:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    labTest:  { type: mongoose.Schema.Types.ObjectId }, // LabProfile.tests[] subdocument id
    testName: { type: String, required: true },

    totalAmount: { type: Number, required: true },

    // Plan terms copied from the lab test when the patient applied
    installmentCount:      { type: Number, min: 1 },
    installmentTenureDays: { type: Number }, // gap between installments

    // Paid to the lab — same chain as an installment: patient → lab → admin
    downPayment: {
      amount:            { type: Number, default: 0 },
      receiptUrl:        { type: String },
      receiptUploadedAt: { type: Date },
      labApproved:       { type: Boolean, default: false },
      labApprovedAt:     { type: Date },
      adminVerified:     { type: Boolean, default: false },
      adminVerifiedAt:   { type: Date },
      adminVerifiedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },

    // Paid to CareFirst — admin verifies directly (no lab step)
    serviceFee: {
      amount:            { type: Number, default: 0 },
      receiptUrl:        { type: String },
      receiptUploadedAt: { type: Date },
      rejectionReason:   { type: String },
      adminVerified:     { type: Boolean, default: false },
      adminVerifiedAt:   { type: Date },
      adminVerifiedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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

    // Legal agreement exactly as the patient read and accepted it
    // (textUrdu: the Urdu version shown / read aloud next to it; English is binding)
    agreement: {
      text:       { type: String },
      textUrdu:   { type: String },
      acceptedAt: { type: Date },
    },

    status:          { type: String, enum: WALLET_STATUSES, default: 'pending_approval' },
    planApprovedAt:  { type: Date },
    planApprovedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String },
    rejectedAt:      { type: Date },
    rejectedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    activatedAt:     { type: Date }, // service fee verified, schedule generated
  },
  { timestamps: true }
);

// Fee verified + down payment verified + every installment paid
walletSchema.methods.isFullyPaid = function () {
  return Boolean(
    this.serviceFee?.adminVerified &&
    this.downPayment?.adminVerified &&
    this.installments.length > 0 &&
    this.installments.every(i => i.status === 'paid')
  );
};

// Recalculate remaining balance every time the wallet is saved.
// The service fee is separate from the test price, so it is not part of the balance.
walletSchema.pre('save', function (next) {
  const paidInstallmentsTotal = this.installments
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);

  const downPaid = this.downPayment?.adminVerified ? (this.downPayment?.amount || 0) : 0;

  this.remainingBalance = this.totalAmount - downPaid - paidInstallmentsTotal;
  next();
});

module.exports = mongoose.model('Wallet', walletSchema);
