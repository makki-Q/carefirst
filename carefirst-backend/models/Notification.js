const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'registration_approved',
  'registration_rejected',
  'receipt_uploaded',        // patient uploaded a receipt
  'receipt_lab_approved',    // lab confirmed receipt
  'receipt_admin_verified',  // admin marked installment paid
  'installment_overdue',     // reminder: due date passed, still pending
  'installment_due_soon',    // reminder: installment due in a few days
  'plan_submitted',          // patient applied for an installment plan
  'plan_approved',           // admin approved the application — service fee due
  'plan_rejected',           // admin rejected the application
  'service_fee_uploaded',    // patient uploaded the service fee screenshot
  'service_fee_rejected',    // admin could not verify the service fee screenshot
  'plan_activated',          // service fee verified, schedule generated
  'defaulter_escalated',     // case moved to lawyer
  'test_report_uploaded',    // lab uploaded patient's result
  'prescription_issued',     // doctor issued a prescription
  'community_approved',      // admin approved needy patient application
  'community_rejected',      // admin rejected needy patient application
  'community_submitted',     // patient submitted a community support application
  'cnic_verified',           // admin verified patient's CNIC
  'cnic_rejected',           // admin rejected patient's CNIC
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title:     { type: String, required: true },
    message:   { type: String, required: true },
    type:      { type: String, enum: NOTIFICATION_TYPES, required: true },
    read:      { type: Boolean, default: false },
    meta:      { type: mongoose.Schema.Types.Mixed }, // e.g. { walletId, caseId, reportId }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
