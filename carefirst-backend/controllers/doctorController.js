const DoctorProfile        = require('../models/DoctorProfile');
const Prescription         = require('../models/Prescription');
const Notification         = require('../models/Notification');
const TestReport           = require('../models/TestReport');
const LabProfile           = require('../models/LabProfile');
const Appointment          = require('../models/Appointment');
const mongoose             = require('mongoose');
const { sendNotification } = require('../socket/notificationSocket');
const { withPatientDetails } = require('../utils/patientProfiles');
const { DEFAULT_CONSULTATION_MINUTES, formatTime12 } = require('../utils/schedule');

const notify = async (recipient, { title, message, type, meta }) => {
  const notif = await Notification.create({ recipient, title, message, type, meta });
  sendNotification(recipient.toString(), notif);
};

const apptWhen = (a) => {
  const day = new Date(`${a.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day}, ${formatTime12(a.time)}`;
};

const findOwnAppointment = (doctorId, id) =>
  mongoose.isValidObjectId(id)
    ? Appointment.findOne({ _id: id, doctor: doctorId }).populate('patient', 'name email phone')
    : null;

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
    const { specialization, experience, bio, clinicName, clinicAddress } = req.body;
    const update = { specialization, experience: Number(experience), bio };
    if (clinicName !== undefined)    update.clinicName    = clinicName;
    if (clinicAddress !== undefined) update.clinicAddress = clinicAddress;
    const profile = await DoctorProfile.findOneAndUpdate(
      { user: req.user._id },
      update,
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
      consultationFee:      profile?.consultationFee ?? 0,
      consultationDuration: profile?.consultationDuration ?? DEFAULT_CONSULTATION_MINUTES,
      availability:         profile?.availability    ?? [],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/availability ────────────────────────────────────────────
// Body: { availability: [{ day: "Monday", slots: [{ time: "09:00 AM – 01:00 PM" }, ...] }],
//         consultationDuration?: minutes (5–120) }
const updateAvailability = async (req, res) => {
  try {
    const { availability, consultationDuration } = req.body;
    if (!Array.isArray(availability)) {
      return res.status(400).json({ message: 'availability must be an array' });
    }
    const update = { availability };
    if (consultationDuration !== undefined) {
      const minutes = Number(consultationDuration);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) {
        return res.status(400).json({ message: 'Consultation duration must be between 5 and 120 minutes' });
      }
      update.consultationDuration = minutes;
    }

    const profile = await DoctorProfile.findOneAndUpdate(
      { user: req.user._id },
      update,
      { new: true, runValidators: true }
    );
    res.json({ availability: profile.availability, consultationDuration: profile.consultationDuration });
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
// Body: { appointmentId, tests: [{ testName, notes }], generalNotes }
// Written in a consultation: the appointment must have started and not be cancelled / no-show
const createPrescription = async (req, res) => {
  try {
    const { appointmentId, generalNotes } = req.body;
    const tests = (Array.isArray(req.body.tests) ? req.body.tests : [])
      .map(t => ({ testName: typeof t?.testName === 'string' ? t.testName.trim() : '', notes: typeof t?.notes === 'string' ? t.notes.trim() : '' }))
      .filter(t => t.testName);

    if (!appointmentId) return res.status(400).json({ message: 'Choose the appointment this prescription is for' });
    if (!tests.length)  return res.status(400).json({ message: 'At least one test is required' });

    const appt = await findOwnAppointment(req.user._id, appointmentId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });
    if (!['confirmed', 'completed'].includes(appt.status)) {
      return res.status(400).json({ message: `Cannot prescribe for a ${appt.status.replace('_', '-')} appointment` });
    }
    if (appt.startsAt > new Date()) return res.status(400).json({ message: 'This appointment has not started yet' });
    if (await Prescription.exists({ appointment: appt._id })) {
      return res.status(409).json({ message: 'A prescription has already been written for this appointment' });
    }

    const prescription = await Prescription.create({
      patient:     appt.patient._id,
      doctor:      req.user._id,
      appointment: appt._id,
      tests,
      generalNotes,
    });

    await notify(appt.patient._id, {
      title:   'New Prescription Issued',
      message: `${req.user.name} has issued a prescription with ${tests.length} test(s) from your appointment on ${apptWhen(appt)}. Use "Find labs" in My Reports to book them.`,
      type:    'prescription_issued',
      meta:    { prescriptionId: prescription._id, appointmentId: appt._id },
    });

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

// ─── GET /api/doctor/appointments ────────────────────────────────────────────
// All of this doctor's appointments (soonest first), with patient CNIC/city
// and the prescription written in each one
const getAppointments = async (req, res) => {
  try {
    const appts = await Appointment.find({ doctor: req.user._id })
      .populate('patient', 'name email phone')
      .sort({ startsAt: 1 });
    const prescriptions = await Prescription.find({ appointment: { $in: appts.map(a => a._id) } });
    const rx = {};
    prescriptions.forEach(p => { rx[p.appointment.toString()] = p; });
    res.json((await withPatientDetails(appts)).map(a => ({ ...a, prescription: rx[a._id.toString()] || null })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/appointments/:id/cancel ─────────────────────────────────
// Body: { reason } — required, sent to the patient. Allowed any time while confirmed.
const cancelAppointment = async (req, res) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ message: 'Please give a reason — it is sent to the patient' });

    const appt = await findOwnAppointment(req.user._id, req.params.id);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });
    if (appt.status !== 'confirmed') return res.status(400).json({ message: `This appointment is already ${appt.status.replace('_', '-')}` });

    appt.status             = 'cancelled';
    appt.cancelledBy        = 'doctor';
    appt.cancellationReason = reason;
    appt.cancelledAt        = new Date();
    await appt.save();

    await notify(appt.patient._id, {
      title:   'Appointment Cancelled by Doctor',
      message: `${req.user.name} cancelled your appointment on ${apptWhen(appt)}. Reason: ${reason} You can book another time from Find Doctors.`,
      type:    'appointment_cancelled',
      meta:    { appointmentId: appt._id },
    });

    const [enriched] = await withPatientDetails([appt]);
    res.json({ message: 'Appointment cancelled', appointment: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/doctor/appointments/:id/complete | /no-show ────────────────────
// Only after the appointment's start time
const closeAppointment = (status) => async (req, res) => {
  try {
    const appt = await findOwnAppointment(req.user._id, req.params.id);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });
    if (appt.status !== 'confirmed') return res.status(400).json({ message: `This appointment is already ${appt.status.replace('_', '-')}` });
    if (appt.startsAt > new Date()) return res.status(400).json({ message: 'You can close an appointment once its time has started' });

    appt.status   = status;
    appt.closedAt = new Date();
    await appt.save();

    const [enriched] = await withPatientDetails([appt]);
    res.json({ message: status === 'completed' ? 'Marked completed' : 'Marked no-show', appointment: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
const completeAppointment = closeAppointment('completed');
const markNoShow          = closeAppointment('no_show');

// ─── GET /api/doctor/patients ────────────────────────────────────────────────
// Everyone who has booked this doctor (cancelled bookings don't count)
const getPatients = async (req, res) => {
  try {
    const appts = await Appointment.find({ doctor: req.user._id, status: { $ne: 'cancelled' } })
      .populate('patient', 'name email phone')
      .sort({ startsAt: -1 });
    const now  = new Date();
    const byId = new Map();
    for (const a of appts) {
      if (!a.patient) continue;
      const id = a.patient._id.toString();
      if (!byId.has(id)) byId.set(id, { patient: a.patient.toObject(), appointments: 0, lastVisit: null, nextVisit: null });
      const entry = byId.get(id);
      entry.appointments += 1;
      if (a.startsAt <= now && a.status === 'completed' && !entry.lastVisit) entry.lastVisit = a.startsAt;
      if (a.startsAt > now && a.status === 'confirmed') entry.nextVisit = a.startsAt; // sorted desc → ends on the soonest
    }
    const rows = [...byId.values()];
    const withDetails = await withPatientDetails(rows);
    res.json(withDetails);
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
  getAppointments, cancelAppointment, completeAppointment, markNoShow, getPatients,
  getReports,
  getNotifications, markRead,
};
