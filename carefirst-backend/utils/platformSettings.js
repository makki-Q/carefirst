const PlatformSettings = require('../models/PlatformSettings');
const { CAREFIRST_ACCOUNT } = require('../config/installments');

const DEFAULT_SUPPORT_EMAIL = 'support@carefirst.pk';
const ACCOUNT_FIELDS = ['bankName', 'accountTitle', 'accountNumber', 'jazzCash', 'easyPaisa'];

// → { careFirstAccount, supportEmail, saved, updatedAt }
// Saved by the admin on the Settings page, otherwise the .env values (CAREFIRST_*)
const getPlatformSettings = async () => {
  const doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
  const saved = Boolean(doc?.careFirstAccount);
  const careFirstAccount = {};
  for (const f of ACCOUNT_FIELDS) careFirstAccount[f] = (saved ? doc.careFirstAccount[f] : CAREFIRST_ACCOUNT[f]) || '';
  return {
    careFirstAccount,
    supportEmail: doc?.supportEmail || DEFAULT_SUPPORT_EMAIL,
    saved,
    updatedAt: doc?.updatedAt || null,
  };
};

module.exports = { getPlatformSettings, ACCOUNT_FIELDS, DEFAULT_SUPPORT_EMAIL };
