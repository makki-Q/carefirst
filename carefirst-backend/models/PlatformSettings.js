const mongoose = require('mongoose');

// One document (key 'platform') with settings the admin edits on the Settings page.
// Anything not saved here falls back to .env (see utils/platformSettings.js).
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'platform', unique: true },

    // Where patients pay the CareFirst service fee (the only money paid to CareFirst)
    careFirstAccount: {
      bankName:      { type: String, trim: true, maxlength: 60 },
      accountTitle:  { type: String, trim: true, maxlength: 80 },
      accountNumber: { type: String, trim: true, maxlength: 40 },
      jazzCash:      { type: String, trim: true, maxlength: 20 },
      easyPaisa:     { type: String, trim: true, maxlength: 20 },
    },
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 100 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
