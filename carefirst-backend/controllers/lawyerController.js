const mongoose      = require('mongoose');
const DefaulterCase = require('../models/DefaulterCase');
const Notification  = require('../models/Notification');
const LabProfile    = require('../models/LabProfile');
const Wallet        = require('../models/Wallet');
const { clearDefaultIfPaid } = require('../utils/defaulters');
const { withAgreementPaper } = require('../utils/agreementPaper');
const { withPatientDetails } = require('../utils/patientProfiles');

// Adds wallet.labName (the lab's registered name) to cases with a populated wallet
const withLabNames = async (cases) => {
  const labIds = cases.map(c => c.wallet?.lab?._id || c.wallet?.lab).filter(Boolean);
  const names = {};
  (await LabProfile.find({ user: { $in: labIds } }).select('user labName').lean())
    .forEach(p => { names[p.user.toString()] = p.labName; });
  const papers = await withAgreementPaper(cases.map(c => c.wallet).filter(Boolean)); // the filled stamp paper
  const byId = Object.fromEntries(papers.map(w => [w._id.toString(), w]));
  return cases.map(c => {
    const labId = (c.wallet?.lab?._id || c.wallet?.lab)?.toString();
    return c.wallet ? { ...c, wallet: { ...byId[c.wallet._id.toString()], labName: names[labId] || '' } } : c;
  });
};

// ─── GET /api/lawyer/defaulter-cases ─────────────────────────────────────────
const getDefaulterCases = async (req, res) => {
  try {
    const cases = await DefaulterCase.find({ assignedLawyer: req.user._id })
      .populate('patient', 'name email phone')
      .populate('wallet')
      .sort({ escalatedAt: -1 });
    res.json(await withLabNames(await withPatientDetails(cases)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lawyer/defaulter-cases/:id ─────────────────────────────────────
const getDefaulterCaseById = async (req, res) => {
  try {
    const c = await DefaulterCase.findOne({ _id: req.params.id, assignedLawyer: req.user._id })
      .populate('patient', 'name email phone')
      .populate({
        path:     'wallet',
        populate: { path: 'lab', select: 'name email' },
      });
    if (!c) return res.status(404).json({ message: 'Case not found or not assigned to you' });
    const [withDetails] = await withLabNames(await withPatientDetails([c]));
    res.json(withDetails);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lawyer/defaulter-cases/:id/close ───────────────────────────────
// Body: { note } — the overdue installments were settled outside CareFirst. They are recorded as
// settled (with the note), the plan and the patient's account go back to normal (decision 14).
const closeCase = async (req, res) => {
  try {
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    if (note.length < 5) return res.status(400).json({ message: 'Please write how the case was settled' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Case not found or not assigned to you' });
    const c = await DefaulterCase.findOne({ _id: req.params.id, assignedLawyer: req.user._id });
    if (!c) return res.status(404).json({ message: 'Case not found or not assigned to you' });
    if (c.status !== 'active') return res.status(400).json({ message: 'This case is already closed' });

    const wallet = await Wallet.findById(c.wallet).populate('patient', 'name');
    if (wallet && wallet.status === 'defaulter') {
      const at = new Date();
      wallet.installments.filter(i => i.status === 'overdue').forEach(i => {
        i.status = 'paid';
        i.settledOffline = { at, by: req.user._id, note };
      });
      await wallet.save();
      await clearDefaultIfPaid(wallet, { resolution: 'settled', note, by: req.user._id });
    } else {
      Object.assign(c, { status: 'resolved', resolvedAt: new Date(), resolution: 'settled', resolutionNote: note, resolvedBy: req.user._id });
      await c.save();
    }
    const updated = await DefaulterCase.findById(c._id);
    res.json({ message: 'Case closed — the patient\'s account is back to normal', case: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lawyer/notifications ───────────────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const notifs = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lawyer/notifications/:id/read ──────────────────────────────────
const markRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true }
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lawyer/notifications/read-all ──────────────────────────────────
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getDefaulterCases, getDefaulterCaseById, closeCase, getNotifications, markRead, markAllRead };
