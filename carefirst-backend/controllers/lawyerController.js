const DefaulterCase = require('../models/DefaulterCase');
const Notification  = require('../models/Notification');
const { withPatientDetails } = require('../utils/patientProfiles');

// ─── GET /api/lawyer/defaulter-cases ─────────────────────────────────────────
const getDefaulterCases = async (req, res) => {
  try {
    const cases = await DefaulterCase.find({ assignedLawyer: req.user._id })
      .populate('patient', 'name email phone')
      .populate('wallet')
      .sort({ escalatedAt: -1 });
    res.json(await withPatientDetails(cases));
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
    const [withDetails] = await withPatientDetails([c]);
    res.json(withDetails);
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

module.exports = { getDefaulterCases, getDefaulterCaseById, getNotifications, markRead, markAllRead };
