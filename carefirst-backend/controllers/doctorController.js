const DoctorProfile        = require('../models/DoctorProfile');
const Prescription         = require('../models/Prescription');
const Notification         = require('../models/Notification');
const TestReport           = require('../models/TestReport');
const LabProfile           = require('../models/LabProfile');
const User                 = require('../models/User');
const { sendNotification } = require('../socket/notificationSocket');

// ─── GET /api/doctor/profile ──────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user._id });
    res.json({ user: req.user, profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/profile ──────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { specialization, experience, bio } = req.body;
    const profile = await DoctorProfile.findOneAndUpdate(
      { user: req.user._id },
      { specialization, experience: Number(experience), bio },
      { new: true, runValidators: true, upsert: true }
    );
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/doctor/availability ────────────────────────────────────────────
const getAvailability = async (req, res) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user._id });
    res.json({
      consultationFee: profile?.consultationFee ?? 0,
      availability:    profile?.availability    ?? [],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/availability ────────────────────────────────────────────
// Body: { availability: [{ day: "Monday", slots: [{ time: "09:00 AM" }, ...] }] }
const updateAvailability = async (req, res) => {
  try {
    const { availability } = req.body;
    if (!Array.isArray(availability)) {
      return res.status(400).json({ message: 'availability must be an array' });
    }

    const profile = await DoctorProfile.findOneAndUpdate(
      { user: req.user._id },
      { availability },
      { new: true, runValidators: true }
    );
    res.json({ availability: profile.availability });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/fee ──────────────────────────────────────────────────────
const updateFee = async (req, res) => {
  try {
    const { consultationFee } = req.body;
    if (consultationFee === undefined || consultationFee < 0) {
      return res.status(400).json({ message: 'A valid consultationFee is required' });
    }

    const profile = await DoctorProfile.findOneAndUpdate(
      { user: req.user._id },
      { consultationFee: Number(consultationFee) },
      { new: true }
    );
    res.json({ consultationFee: profile.consultationFee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/doctor/prescriptions ──────────────────────────────────────────
// Body: { patientId, tests: [{ testName, notes }], generalNotes }
const createPrescription = async (req, res) => {
  try {
    const { patientId, tests, generalNotes } = req.body;

    if (!patientId)      return res.status(400).json({ message: 'patientId is required' });
    if (!tests?.length)  return res.status(400).json({ message: 'At least one test is required' });

    const patient = await User.findOne({ _id: patientId, role: 'patient' });
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const prescription = await Prescription.create({
      patient: patientId,
      doctor:  req.user._id,
      tests,
      generalNotes,
    });

    const notif = await Notification.create({
      recipient: patientId,
      title:     'New Prescription Issued',
      message:   `Dr. ${req.user.name} has issued a prescription with ${tests.length} test(s). View it in your reports.`,
      type:      'prescription_issued',
      meta:      { prescriptionId: prescription._id },
    });
    sendNotification(patientId.toString(), notif);

    res.status(201).json(prescription);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/doctor/prescriptions?patientId= ────────────────────────────────
const getPrescriptions = async (req, res) => {
  try {
    const { patientId } = req.query;
    const filter = { doctor: req.user._id };
    if (patientId) filter.patient = patientId;

    const prescriptions = await Prescription.find(filter)
      .populate('patient', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/doctor/notifications ───────────────────────────────────────────
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

// ─── GET /api/doctor/reports ──────────────────────────────────────────────────
// Returns all lab test reports for patients this doctor has prescribed for
const getReports = async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ doctor: req.user._id }).select('patient');
    const patientIds = [...new Set(prescriptions.map(p => p.patient.toString()))];

    if (patientIds.length === 0) return res.json([]);

    const reports = await TestReport.find({ patient: { $in: patientIds } })
      .populate('patient', 'name email phone')
      .populate('lab', 'name')
      .sort({ createdAt: -1 });

    const labUserIds = [...new Set(reports.map(r => r.lab?._id?.toString()).filter(Boolean))];
    const labProfiles = await LabProfile.find({ user: { $in: labUserIds } }).select('user labName');
    const labNameMap = {};
    labProfiles.forEach(lp => { labNameMap[lp.user.toString()] = lp.labName; });

    const enriched = reports.map(r => ({
      ...r.toObject(),
      labName: r.lab?._id ? (labNameMap[r.lab._id.toString()] || r.lab.name) : '—',
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/notifications/:id/read ──────────────────────────────────
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

module.exports = {
  getProfile, updateProfile,
  getAvailability, updateAvailability, updateFee,
  createPrescription, getPrescriptions,
  getReports,
  getNotifications, markRead,
};
