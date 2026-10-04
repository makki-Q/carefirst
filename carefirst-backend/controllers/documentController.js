const path          = require('path');
const fs            = require('fs');
const mongoose      = require('mongoose');
const Wallet        = require('../models/Wallet');
const DefaulterCase = require('../models/DefaulterCase');
const { CNIC_DIR }  = require('../middleware/upload');

const notFound = (res) => res.status(404).json({ message: 'Not found' });
const same = (a, b) => Boolean(a && b && a.toString() === b.toString());

// URL name → Wallet.cnicPictures key
const PICTURES = {
  'patient-front':   'patientFront',
  'patient-back':    'patientBack',
  'guarantor-front': 'guarantorFront',
  'guarantor-back':  'guarantorBack',
};

// ─── GET /api/documents/wallets/:walletId/cnic/:picture ──────────────────────
// A CNIC picture from an installment application. Only the patient who applied,
// an admin, or the lawyer assigned to the plan's defaulter case may see it.
const getCnicPicture = async (req, res) => {
  try {
    const key = PICTURES[req.params.picture];
    if (!key || !mongoose.isValidObjectId(req.params.walletId)) return notFound(res);

    const wallet = await Wallet.findById(req.params.walletId).select('patient cnicPictures');
    if (!wallet) return notFound(res);

    const user = req.user;
    const allowed =
      user.role === 'admin' ||
      (user.role === 'patient' && same(wallet.patient, user._id)) ||
      (user.role === 'lawyer' && await DefaulterCase.exists({ wallet: wallet._id, assignedLawyer: user._id }));
    if (!allowed) return notFound(res);

    const filename = wallet.cnicPictures?.[key];
    const file = filename && path.join(CNIC_DIR, path.basename(filename));
    if (!file || !fs.existsSync(file)) return notFound(res);

    res.set('Cache-Control', 'private, no-store');
    res.sendFile(file);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getCnicPicture };
