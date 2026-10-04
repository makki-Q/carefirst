const path          = require('path');
const fs            = require('fs');
const mongoose      = require('mongoose');
const Wallet        = require('../models/Wallet');
const DefaulterCase = require('../models/DefaulterCase');
const { CNIC_DIR }  = require('../middleware/upload');
const Appointment          = require('../models/Appointment');
const LabBooking           = require('../models/LabBooking');
const CommunityApplication = require('../models/CommunityApplication');
const PatientProfile       = require('../models/PatientProfile');
const DoctorProfile        = require('../models/DoctorProfile');
const LabProfile           = require('../models/LabProfile');
const { buildSlipPdf, fmtDateTime } = require('../utils/slipPdf');
const { formatTime12, PATIENT_CANCEL_HOURS } = require('../utils/schedule');

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

// ─── Slips (PDF) ──────────────────────────────────────────────────────────────

const pkr = (n) => `PKR ${Math.round(n || 0).toLocaleString('en-US')}`;
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const cnicLine = (profile) => profile?.cnic ? `${profile.cnic}${profile.cnicStatus === 'verified' ? ' (verified)' : ''}` : '—';

const patientRows = async (patient) => {
  const profile = await PatientProfile.findOne({ user: patient._id }).lean();
  return { profile, rows: [['Name', patient.name], ['CNIC', cnicLine(profile)], ['Phone', patient.phone || '—']] };
};

const labRows = async (labUser) => {
  const lab = await LabProfile.findOne({ user: labUser._id }).select('labName location phone').lean();
  return [['Laboratory', lab?.labName || labUser.name], ['Address', lab?.location || '—'], ['Phone', lab?.phone || labUser.phone || '—']];
};

const sendPdf = (res, slipNumber, bytes) => {
  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="CareFirst-slip-${slipNumber}.pdf"`,
    'Cache-Control':       'private, no-store',
  });
  res.send(bytes);
};

// ─── GET /api/documents/slips/appointment/:id ────────────────────────────────
// Patient, the doctor, or an admin. Not for cancelled appointments.
const getAppointmentSlip = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const appt = await Appointment.findById(req.params.id).populate('patient', 'name phone').populate('doctor', 'name phone');
    if (!appt) return notFound(res);
    const user = req.user;
    const allowed = user.role === 'admin' ||
      (user.role === 'patient' && same(appt.patient._id, user._id)) ||
      (user.role === 'doctor' && same(appt.doctor._id, user._id));
    if (!allowed) return notFound(res);
    if (appt.status === 'cancelled') return res.status(409).json({ message: 'This appointment was cancelled, so it has no slip' });

    const { rows: patient } = await patientRows(appt.patient);
    const doctor = await DoctorProfile.findOne({ user: appt.doctor._id }).select('specialization clinicName clinicAddress').lean();
    const status = { confirmed: 'Confirmed', completed: 'Completed', no_show: 'Missed' }[appt.status] || appt.status;

    const bytes = await buildSlipPdf({
      title:      'Appointment Slip',
      slipNumber: appt.slipNumber,
      status,
      statusNote: `Booked ${fmtDateTime(appt.createdAt)}`,
      sections: [
        { heading: 'Appointment', boldFirst: true, rows: [
          ['Date', fmtDay(appt.date)],
          ['Time', `${formatTime12(appt.time)} (about ${appt.durationMinutes} minutes)`],
          ['Consultation fee', `${pkr(appt.fee)} — paid at the clinic`],
        ] },
        { heading: 'Doctor', boldFirst: true, rows: [
          ['Doctor', appt.doctor.name],
          ['Specialization', doctor?.specialization || '—'],
          ['Clinic', doctor?.clinicName || '—'],
          ['Clinic address', doctor?.clinicAddress || 'Not on CareFirst yet — call the clinic for directions'],
          ['Phone', appt.doctor.phone || '—'],
        ] },
        { heading: 'Patient', boldFirst: true, rows: patient },
      ],
      notes: [
        'This is an in-person visit at the clinic. Please arrive 10 minutes early.',
        'Bring your CNIC and this slip (printed or on your phone).',
        `Need to cancel? Do it on CareFirst at least ${PATIENT_CANCEL_HOURS} hours before the appointment so someone else can use the time.`,
        'The consultation fee is paid directly at the clinic.',
      ],
      verifyNote: "Verification: the doctor's CareFirst dashboard shows this slip number on the appointment.",
    });
    sendPdf(res, appt.slipNumber, bytes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/documents/slips/lab-booking/:id ────────────────────────────────
// Patient, the lab, or an admin. Not for cancelled visits.
const getLabBookingSlip = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const booking = await LabBooking.findById(req.params.id).populate('patient', 'name phone').populate('lab', 'name phone');
    if (!booking) return notFound(res);
    const user = req.user;
    const allowed = user.role === 'admin' ||
      (user.role === 'patient' && same(booking.patient._id, user._id)) ||
      (user.role === 'lab' && same(booking.lab._id, user._id));
    if (!allowed) return notFound(res);
    if (booking.status === 'cancelled') return res.status(409).json({ message: 'This lab visit was cancelled, so it has no slip' });

    const { rows: patient } = await patientRows(booking.patient);
    const status = { confirmed: 'Confirmed', sample_collected: 'Sample collected', completed: 'Completed' }[booking.status] || booking.status;
    const payment = booking.paymentMethod === 'installment'
      ? 'Covered by your CareFirst installment plan — pay the lab according to your plan schedule'
      : `Pay ${pkr(booking.price)} at the lab`;

    const bytes = await buildSlipPdf({
      title:      'Lab Visit Slip',
      slipNumber: booking.slipNumber,
      status,
      statusNote: `Booked ${fmtDateTime(booking.createdAt)}`,
      sections: [
        { heading: 'Test', boldFirst: true, rows: [
          ['Test', booking.testName],
          ['Visit date', fmtDay(booking.visitDate)],
          ['Price', pkr(booking.price)],
          ['Payment', payment],
        ] },
        { heading: 'Laboratory', boldFirst: true, rows: await labRows(booking.lab) },
        { heading: 'Patient', boldFirst: true, rows: patient },
      ],
      notes: [
        'Visit the lab on the date above during its opening hours — no appointment time is needed.',
        'Bring your CNIC and this slip (printed or on your phone).',
        'Ask the lab if the test needs any preparation (for example fasting).',
        'Your report will appear in My Reports on CareFirst when the lab uploads it.',
      ],
      verifyNote: "Verification: the lab's CareFirst dashboard shows this slip number on the booking.",
    });
    sendPdf(res, booking.slipNumber, bytes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/documents/slips/community/:id ──────────────────────────────────
// Approved community support application: patient, the assigned lab, or an admin.
// The documents the patient uploaded follow the slip page.
const getCommunitySlip = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const app = await CommunityApplication.findById(req.params.id).populate('patient', 'name phone').populate('assignedLab', 'name phone');
    if (!app) return notFound(res);
    const user = req.user;
    const allowed = user.role === 'admin' ||
      (user.role === 'patient' && same(app.patient._id, user._id)) ||
      (user.role === 'lab' && same(app.assignedLab?._id, user._id));
    if (!allowed) return notFound(res);
    if (app.status !== 'approved' || !app.slip?.slipId) {
      return res.status(409).json({ message: 'The slip is available once the application is approved' });
    }

    const { rows: patient, profile } = await patientRows(app.patient);
    const address = [profile?.address, profile?.city].filter(Boolean).join(', ');
    const docs = app.documents || [];
    const lab = app.assignedLab ? await labRows(app.assignedLab) : [['Laboratory', '—']];

    const bytes = await buildSlipPdf({
      title:      'Community Support Slip',
      slipNumber: app.slip.slipId,
      status:     app.testConducted ? 'Test conducted' : 'Approved',
      statusNote: `Approved ${fmtDateTime(app.reviewedAt || app.slip.generatedAt)}`,
      sections: [
        { heading: 'Patient in need', boldFirst: true, rows: [...patient, ['Address', address || '—']] },
        { heading: 'Approved support', boldFirst: true, rows: [
          ['Test', app.testRequired],
          ...lab.map(([label, value]) => [label === 'Laboratory' ? 'Assigned lab' : `Lab ${label.toLowerCase()}`, value]),
          ['Documents checked', docs.length
            ? `${docs.length} document${docs.length === 1 ? '' : 's'} uploaded by the patient — attached on the following pages`
            : 'None attached'],
        ] },
      ],
      notes: [
        "CareFirst's admin reviewed this patient's supporting documents and approved them as a patient in need of support for the test above.",
        'A charity partner lab conducts the test for the patient under the CareFirst Community Support programme.',
        'Bring your CNIC and this slip (printed or on your phone) to the assigned lab.',
        'The lab marks the test as conducted on CareFirst; the report appears in My Reports.',
      ],
      verifyNote: "Verification: the assigned lab's CareFirst dashboard (Needy Patients) shows this slip number.",
    }, { attachments: docs });
    sendPdf(res, app.slip.slipId, bytes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getCnicPicture, getAppointmentSlip, getLabBookingSlip, getCommunitySlip };
