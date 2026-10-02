const mongoose             = require('mongoose');
const PatientProfile       = require('../models/PatientProfile');
const Prescription         = require('../models/Prescription');
const TestReport           = require('../models/TestReport');
const Wallet               = require('../models/Wallet');
const CommunityApplication = require('../models/CommunityApplication');
const Notification         = require('../models/Notification');
const DoctorProfile        = require('../models/DoctorProfile');
const LabProfile           = require('../models/LabProfile');
const User                 = require('../models/User');
const Appointment          = require('../models/Appointment');
const { sendNotification } = require('../socket/notificationSocket');
const {
  BOOKING_WINDOW_DAYS, PATIENT_CANCEL_HOURS, DEFAULT_CONSULTATION_MINUTES,
  isValidDate, isValidTime, isWithinBookingWindow, slotTimes, weekdayOf, pktInstant, formatTime12,
} = require('../utils/schedule');
const { normalizeCnic }    = require('../utils/cnic');
const { fileUrl, removeUploadedFiles } = require('../utils/fileUrl');
const { generateInstallmentAgreement } = require('../utils/legalAgreementTemplate');
const {
  OPEN_PLAN_STATUSES, labPaymentDetails, hasPaymentDetails, planAmounts, findLabPayment,
} = require('../utils/installmentPlan');
const {
  SERVICE_FEE, DOWN_PAYMENT_PERCENT, MAX_OPEN_PLANS, GRACE_DAYS, CAREFIRST_ACCOUNT,
} = require('../config/installments');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// { [labUserId]: { labName, location } }
const getLabInfoMap = async (labUserIds) => {
  const ids = [...new Set(labUserIds.filter(Boolean).map(id => id.toString()))];
  if (ids.length === 0) return {};
  const profiles = await LabProfile.find({ user: { $in: ids } }).select('user labName location');
  const map = {};
  profiles.forEach(lp => { map[lp.user.toString()] = { labName: lp.labName, location: lp.location }; });
  return map;
};

// Adds labName / labLocation to docs whose `field` is a populated lab user
const withLabInfo = async (docs, field) => {
  const map = await getLabInfoMap(docs.map(d => d[field]?._id));
  return docs.map(d => {
    const obj  = d.toObject();
    const info = obj[field]?._id ? map[obj[field]._id.toString()] : null;
    return { ...obj, labName: info?.labName || obj[field]?.name || '—', labLocation: info?.location || '' };
  });
};

const notifyUser = async (recipient, { title, message, type, meta }) => {
  const notif = await Notification.create({ recipient, title, message, type, meta });
  sendNotification(recipient.toString(), notif);
};

const notifyAdmins = async (payload) => {
  const admins = await User.find({ role: 'admin' }).select('_id');
  for (const admin of admins) await notifyUser(admin._id, payload);
};

// Adds the lab's payment channels (labPayment) to wallets with a populated `lab`
const withLabPayment = async (wallets) => {
  const labIds   = [...new Set(wallets.map(w => w.lab?._id?.toString()).filter(Boolean))];
  const profiles = await LabProfile.find({ user: { $in: labIds } }).select('user bankDetails jazzCash easyPaisa');
  const map = {};
  profiles.forEach(lp => { map[lp.user.toString()] = labPaymentDetails(lp); });
  return wallets.map(w => ({ ...w, labPayment: map[w.lab?._id?.toString()] || labPaymentDetails(null) }));
};

const enrichWallets = async (wallets) => withLabPayment(await withLabInfo(wallets, 'lab'));

const PHONE_FORMAT = /^\+?\d{10,13}$/;

// Validates an installment-plan application and works out its terms.
// Returns { error: { status, message } } or { terms, agreementText }.
const buildPlanApplication = async (user, body) => {
  const fail = (status, message) => ({ error: { status, message } });

  const profile = await PatientProfile.findOne({ user: user._id });
  if (profile?.cnicStatus !== 'verified') {
    return fail(403, 'Your CNIC must be verified by the admin before you can apply for an installment plan');
  }

  const openPlans = await Wallet.countDocuments({ patient: user._id, status: { $in: OPEN_PLAN_STATUSES } });
  if (openPlans >= MAX_OPEN_PLANS) {
    return fail(409, `You can have at most ${MAX_OPEN_PLANS} open installment plans (including applications under review)`);
  }

  const { labId, testId } = body;
  if (!mongoose.isValidObjectId(labId) || !mongoose.isValidObjectId(testId)) return fail(404, 'Test not found');

  const labUser    = await User.findOne({ _id: labId, role: 'lab', status: 'active' });
  const labProfile = labUser && await LabProfile.findOne({ user: labUser._id });
  const test       = labProfile?.tests.id(testId);
  if (!test || !test.isActive) return fail(404, 'Test not found');
  if (!test.installmentEnabled) return fail(400, 'This test is not available on installments');
  if (!hasPaymentDetails(labProfile)) {
    return fail(400, 'This lab has not added its payment details yet, so it cannot accept installment plans');
  }

  const g = body.guarantor || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const guarantor = {
    name:     str(g.name),
    cnic:     normalizeCnic(g.cnic),
    phone:    str(g.phone).replace(/[\s-]/g, ''),
    relation: str(g.relation),
    address:  str(g.address),
  };
  if (!guarantor.name)     return fail(400, "Please enter the guarantor's full name");
  if (!guarantor.cnic)     return fail(400, "Please enter the guarantor's valid 13-digit CNIC");
  if (guarantor.cnic === profile.cnic) return fail(400, 'The guarantor must be someone other than you');
  if (!PHONE_FORMAT.test(guarantor.phone)) return fail(400, "Please enter the guarantor's phone number (e.g. 03001234567)");
  if (!guarantor.relation) return fail(400, 'Please enter how the guarantor is related to you');

  const totalAmount = Math.round(test.price);
  const { downPayment, installments } = planAmounts(totalAmount, test.installmentCount);

  const terms = {
    labId:                 labUser._id,
    labName:               labProfile.labName,
    testId:                test._id,
    testName:              test.name,
    totalAmount,
    downPayment,
    downPaymentPercent:    DOWN_PAYMENT_PERCENT,
    installments,
    installmentTenureDays: test.installmentTenureDays,
    serviceFee:            SERVICE_FEE,
    guarantor,
  };

  const agreementText = generateInstallmentAgreement({
    patient:     user,
    patientCnic: profile.cnic,
    guarantor,
    labName:     terms.labName,
    testName:    terms.testName,
    totalAmount,
    downPayment,
    installments,
    tenureDays:  terms.installmentTenureDays,
    serviceFee:  SERVICE_FEE,
    graceDays:   GRACE_DAYS,
  });

  return { terms, agreementText };
};

// ─── GET /api/patient/profile ─────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const profile = await PatientProfile.findOne({ user: req.user._id });
    res.json({ user: req.user, profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/patient/profile ─────────────────────────────────────────────────
// Body: { name, phone, city, address, cnic }
// CNIC can only change while it is not yet verified; a change resets it to 'unverified'
const updateProfile = async (req, res) => {
  try {
    const { name, phone, city, address, cnic } = req.body;
    const profile = await PatientProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Patient profile not found' });

    if (cnic !== undefined) {
      const normalized = normalizeCnic(cnic);
      if (!normalized) return res.status(400).json({ message: 'A valid 13-digit CNIC is required (e.g. 35202-1234567-8)' });

      if (normalized !== profile.cnic) {
        if (profile.cnicStatus === 'verified') {
          return res.status(400).json({ message: 'Your CNIC is already verified and cannot be changed. Contact support.' });
        }
        if (await PatientProfile.exists({ cnic: normalized, user: { $ne: req.user._id } })) {
          return res.status(409).json({ message: 'This CNIC is already registered' });
        }
        profile.cnic                = normalized;
        profile.cnicStatus          = 'unverified';
        profile.cnicRejectionReason = undefined;
        profile.cnicReviewedAt      = undefined;
        profile.cnicReviewedBy      = undefined;
      }
    }
    if (city    !== undefined) profile.city    = city;
    if (address !== undefined) profile.address = address;
    await profile.save();

    const userUpdates = {};
    if (typeof name === 'string' && name.trim()) userUpdates.name = name.trim();
    if (phone !== undefined) userUpdates.phone = phone;
    const user = Object.keys(userUpdates).length
      ? await User.findByIdAndUpdate(req.user._id, userUpdates, { new: true, runValidators: true }).select('-password')
      : req.user;

    res.json({ user, profile });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'This CNIC is already registered' });
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/prescriptions ───────────────────────────────────────────
const getPrescriptions = async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ patient: req.user._id })
      .populate('doctor', 'name phone')
      .sort({ createdAt: -1 });

    const doctorIds = [...new Set(prescriptions.map(p => p.doctor?._id?.toString()).filter(Boolean))];
    const profiles  = await DoctorProfile.find({ user: { $in: doctorIds } }).select('user specialization');
    const specMap   = {};
    profiles.forEach(dp => { specMap[dp.user.toString()] = dp.specialization; });

    res.json(prescriptions.map(p => {
      const obj = p.toObject();
      return { ...obj, doctorSpecialization: obj.doctor?._id ? specMap[obj.doctor._id.toString()] || '' : '' };
    }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/reports ─────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const reports = await TestReport.find({ patient: req.user._id })
      .populate('lab', 'name')
      .sort({ createdAt: -1 });
    res.json(await withLabInfo(reports, 'lab'));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/patient/reports/:id/read ────────────────────────────────────────
const markReportRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Report not found' });
    const report = await TestReport.findOneAndUpdate(
      { _id: req.params.id, patient: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/wallets ─────────────────────────────────────────────────
const getWallets = async (req, res) => {
  try {
    const wallets = await Wallet.find({ patient: req.user._id })
      .populate('lab', 'name')
      .sort({ createdAt: -1 });
    res.json(await enrichWallets(wallets));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/installment-plans/config ────────────────────────────────
// Fee, down-payment rule, plan limit and CareFirst's account for the service fee
const getInstallmentConfig = async (req, res) => {
  try {
    const [profile, openPlans] = await Promise.all([
      PatientProfile.findOne({ user: req.user._id }).select('cnicStatus'),
      Wallet.countDocuments({ patient: req.user._id, status: { $in: OPEN_PLAN_STATUSES } }),
    ]);
    res.json({
      serviceFee:         SERVICE_FEE,
      downPaymentPercent: DOWN_PAYMENT_PERCENT,
      maxOpenPlans:       MAX_OPEN_PLANS,
      graceDays:          GRACE_DAYS,
      careFirstAccount:   CAREFIRST_ACCOUNT,
      openPlans,
      cnicStatus:         profile?.cnicStatus || 'unverified',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/installment-plans/preview ──────────────────────────────
// Body: { labId, testId, guarantor: { name, cnic, phone, relation, address } }
// Returns the plan terms and the agreement text the patient must accept
const previewInstallmentPlan = async (req, res) => {
  try {
    const { error, terms, agreementText } = await buildPlanApplication(req.user, req.body);
    if (error) return res.status(error.status).json({ message: error.message });
    res.json({ ...terms, agreementText });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/installment-plans ──────────────────────────────────────
// Body: preview body + { acceptAgreement: true, agreementText } — the text the
// patient was shown, which must still match the current terms
const applyForInstallmentPlan = async (req, res) => {
  try {
    if (req.body.acceptAgreement !== true) {
      return res.status(400).json({ message: 'You must read and accept the agreement to apply' });
    }

    const { error, terms, agreementText } = await buildPlanApplication(req.user, req.body);
    if (error) return res.status(error.status).json({ message: error.message });
    if (req.body.agreementText !== agreementText) {
      return res.status(409).json({ message: 'The plan terms have changed. Please review the agreement again.' });
    }

    const wallet = await Wallet.create({
      patient:               req.user._id,
      lab:                   terms.labId,
      labTest:               terms.testId,
      testName:              terms.testName,
      totalAmount:           terms.totalAmount,
      installmentCount:      terms.installments.length,
      installmentTenureDays: terms.installmentTenureDays,
      downPayment:           { amount: terms.downPayment },
      serviceFee:            { amount: terms.serviceFee },
      guarantor:             terms.guarantor,
      agreement:             { text: agreementText, acceptedAt: new Date() },
      status:                'pending_approval',
    });

    await notifyAdmins({
      title:   'New Installment Plan Application',
      message: `${req.user.name} applied to pay for ${terms.testName} at ${terms.labName} (PKR ${terms.totalAmount.toLocaleString()}) in ${terms.installments.length} installments.`,
      type:    'plan_submitted',
      meta:    { walletId: wallet._id },
    });

    await wallet.populate('lab', 'name');
    const [enriched] = await enrichWallets([wallet]);
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/wallets/:walletId/installments/:instIndex/receipt ──────
// ─── POST /api/patient/wallets/:walletId/down-payment/receipt ─────────────────
// Multipart field: receipt (pdf/jpg/png). Patient paid the lab directly and
// uploads proof; the lab confirms it next, then admin gives final verification.
const uploadPaymentReceipt = async (req, res) => {
  const reject = (status, message) => {
    removeUploadedFiles(req);
    return res.status(status).json({ message });
  };

  try {
    if (!req.file) return reject(400, 'Please attach the payment receipt (PDF, JPG or PNG)');
    if (!mongoose.isValidObjectId(req.params.walletId)) return reject(404, 'Wallet not found');

    const wallet = await Wallet.findOne({ _id: req.params.walletId, patient: req.user._id });
    if (!wallet) return reject(404, 'Wallet not found');
    if (wallet.status === 'defaulter') {
      return reject(400, 'This plan has been escalated to the legal team. Please contact CareFirst support.');
    }
    if (wallet.status === 'completed') return reject(400, 'This plan is already fully paid');
    if (wallet.status !== 'active')    return reject(400, 'This plan is not active yet');

    const target = findLabPayment(wallet, req.params.instIndex);
    if (!target) return reject(404, 'Installment not found');
    const { payment, label, meta } = target;
    if (payment.status === 'paid' || payment.adminVerified) return reject(400, `This ${label} is already paid`);
    if (payment.labApproved) return reject(400, 'The lab has already confirmed this receipt');

    const isReplacement       = Boolean(payment.receiptUrl);
    payment.receiptUrl        = fileUrl('receipts', req.file.filename);
    payment.receiptUploadedAt = new Date();
    await wallet.save();

    await notifyUser(wallet.lab, {
      title:   isReplacement ? 'Receipt Re-uploaded' : 'New Payment Receipt',
      message: `${req.user.name} uploaded a receipt for the ${label} (PKR ${payment.amount.toLocaleString()}) — ${wallet.testName}. Please confirm you received the payment.`,
      type:    'receipt_uploaded',
      meta,
    });

    await wallet.populate('lab', 'name');
    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Receipt uploaded. Awaiting lab confirmation.', wallet: enriched });
  } catch (err) {
    removeUploadedFiles(req);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/wallets/:walletId/service-fee/receipt ──────────────────
// Multipart field: receipt. Patient paid the CareFirst service fee after the
// plan was approved; admin verifies it directly (no lab step). Replaceable until verified.
const uploadServiceFeeReceipt = async (req, res) => {
  const reject = (status, message) => {
    removeUploadedFiles(req);
    return res.status(status).json({ message });
  };

  try {
    if (!req.file) return reject(400, 'Please attach the payment screenshot (PDF, JPG or PNG)');
    if (!mongoose.isValidObjectId(req.params.walletId)) return reject(404, 'Wallet not found');

    const wallet = await Wallet.findOne({ _id: req.params.walletId, patient: req.user._id });
    if (!wallet) return reject(404, 'Wallet not found');
    if (wallet.serviceFee.adminVerified)  return reject(400, 'The service fee is already verified');
    if (wallet.status !== 'awaiting_fee') return reject(400, 'The service fee can be paid once your application is approved');

    const isReplacement = Boolean(wallet.serviceFee.receiptUrl);
    wallet.serviceFee.receiptUrl        = fileUrl('receipts', req.file.filename);
    wallet.serviceFee.receiptUploadedAt = new Date();
    wallet.serviceFee.rejectionReason   = undefined;
    await wallet.save();

    await notifyAdmins({
      title:   isReplacement ? 'Service Fee Receipt Re-uploaded' : 'Service Fee Receipt Uploaded',
      message: `${req.user.name} uploaded the PKR ${wallet.serviceFee.amount.toLocaleString()} service fee receipt for the ${wallet.testName} plan. Please verify it to activate the plan.`,
      type:    'service_fee_uploaded',
      meta:    { walletId: wallet._id },
    });

    await wallet.populate('lab', 'name');
    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Receipt uploaded. Awaiting CareFirst verification.', wallet: enriched });
  } catch (err) {
    removeUploadedFiles(req);
    res.status(500).json({ message: err.message });
  }
};

// ─── Appointments ─────────────────────────────────────────────────────────────

const apptWhen = (a) => {
  const day = new Date(`${a.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day}, ${formatTime12(a.time)}`;
};

// Adds doctorSpecialization and the prescription written in each appointment
const enrichAppointments = async (appts) => {
  const doctorIds = [...new Set(appts.map(a => a.doctor?._id?.toString()).filter(Boolean))];
  const [profiles, prescriptions] = await Promise.all([
    DoctorProfile.find({ user: { $in: doctorIds } }).select('user specialization'),
    Prescription.find({ appointment: { $in: appts.map(a => a._id) } }),
  ]);
  const spec = {};
  profiles.forEach(p => { spec[p.user.toString()] = p.specialization; });
  const rx = {};
  prescriptions.forEach(p => { rx[p.appointment.toString()] = p; });
  return appts.map(a => {
    const obj = a.toObject();
    return {
      ...obj,
      doctorSpecialization: spec[obj.doctor?._id?.toString()] || '',
      prescription: rx[obj._id.toString()] || null,
    };
  });
};

// ─── GET /api/patient/appointments ────────────────────────────────────────────
const getAppointments = async (req, res) => {
  try {
    const appts = await Appointment.find({ patient: req.user._id })
      .populate('doctor', 'name phone')
      .sort({ startsAt: -1 });
    res.json(await enrichAppointments(appts));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/appointments ───────────────────────────────────────────
// Body: { doctorId, date: "YYYY-MM-DD", time: "HH:MM" } — auto-confirmed
const bookAppointment = async (req, res) => {
  try {
    const { doctorId, date, time } = req.body;
    if (!mongoose.isValidObjectId(doctorId)) return res.status(404).json({ message: 'Doctor not found' });
    if (!isValidDate(date) || !isValidTime(time)) return res.status(400).json({ message: 'Please pick a date and time' });

    const doctor  = await User.findOne({ _id: doctorId, role: 'doctor', status: 'active' });
    const profile = doctor && await DoctorProfile.findOne({ user: doctor._id });
    if (!profile) return res.status(404).json({ message: 'Doctor not found' });

    if (!isWithinBookingWindow(date)) {
      return res.status(400).json({ message: `Appointments can be booked for the next ${BOOKING_WINDOW_DAYS} days only` });
    }
    const duration = profile.consultationDuration || DEFAULT_CONSULTATION_MINUTES;
    const ranges   = (profile.availability.find(a => a.day === weekdayOf(date))?.slots || []).map(s => s.time);
    if (!slotTimes(ranges, duration).includes(time)) {
      return res.status(400).json({ message: 'The doctor is not available at that time' });
    }
    const startsAt = pktInstant(date, time);
    if (startsAt <= new Date()) return res.status(400).json({ message: 'That time has already passed' });

    if (await Appointment.exists({ patient: req.user._id, date, time, status: 'confirmed' })) {
      return res.status(409).json({ message: 'You already have another appointment at that time' });
    }

    await Appointment.init(); // make sure the one-booking-per-slot index exists
    let appt;
    try {
      appt = await Appointment.create({
        patient: req.user._id, doctor: doctor._id, date, time, startsAt,
        durationMinutes: duration, fee: profile.consultationFee || 0,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: 'Sorry, that slot was just booked by someone else. Please pick another time.' });
      }
      throw err;
    }

    const when = apptWhen(appt);
    await notifyUser(doctor._id, {
      title:   'New Appointment',
      message: `${req.user.name} booked an appointment with you on ${when}.`,
      type:    'appointment_booked',
      meta:    { appointmentId: appt._id },
    });
    await notifyUser(req.user._id, {
      title:   'Appointment Confirmed',
      message: `Your appointment with ${doctor.name} on ${when} is confirmed. The consultation fee (PKR ${appt.fee.toLocaleString()}) is paid at the clinic.`,
      type:    'appointment_booked',
      meta:    { appointmentId: appt._id },
    });

    await appt.populate('doctor', 'name phone');
    const [enriched] = await enrichAppointments([appt]);
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/patient/appointments/:id/cancel ─────────────────────────────────
// Allowed up to PATIENT_CANCEL_HOURS before the start
const cancelAppointment = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Appointment not found' });
    const appt = await Appointment.findOne({ _id: req.params.id, patient: req.user._id }).populate('doctor', 'name phone');
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });
    if (appt.status !== 'confirmed') return res.status(400).json({ message: `This appointment is already ${appt.status.replace('_', '-')}` });

    const deadline = new Date(appt.startsAt.getTime() - PATIENT_CANCEL_HOURS * 60 * 60 * 1000);
    if (new Date() > deadline) {
      return res.status(400).json({ message: `Appointments can only be cancelled up to ${PATIENT_CANCEL_HOURS} hours before they start. Please contact the clinic.` });
    }

    appt.status      = 'cancelled';
    appt.cancelledBy = 'patient';
    appt.cancelledAt = new Date();
    await appt.save();

    await notifyUser(appt.doctor._id, {
      title:   'Appointment Cancelled',
      message: `${req.user.name} cancelled their appointment on ${apptWhen(appt)}. The slot is open again.`,
      type:    'appointment_cancelled',
      meta:    { appointmentId: appt._id },
    });

    const [enriched] = await enrichAppointments([appt]);
    res.json({ message: 'Appointment cancelled', appointment: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/community-applications ──────────────────────────────────
const getCommunityApplications = async (req, res) => {
  try {
    const apps = await CommunityApplication.find({ patient: req.user._id })
      .populate('assignedLab', 'name phone')
      .sort({ createdAt: -1 });
    res.json(await withLabInfo(apps, 'assignedLab'));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/patient/community-applications ─────────────────────────────────
// Multipart: testRequired + documents[] (utility bills, bank statements — up to 5)
const createCommunityApplication = async (req, res) => {
  const reject = (status, message) => {
    removeUploadedFiles(req);
    return res.status(status).json({ message });
  };

  try {
    const testRequired = typeof req.body.testRequired === 'string' ? req.body.testRequired.trim() : '';
    if (!testRequired) return reject(400, 'Please enter the test you need support for');
    if (!req.files?.length) return reject(400, 'Please upload at least one supporting document (utility bill, bank statement)');

    const profile = await PatientProfile.findOne({ user: req.user._id });
    if (profile?.cnicStatus !== 'verified') {
      return reject(403, 'Your CNIC must be verified by the admin before you can apply for community support');
    }

    if (await CommunityApplication.exists({ patient: req.user._id, status: 'pending' })) {
      return reject(409, 'You already have an application under review');
    }

    const app = await CommunityApplication.create({
      patient:   req.user._id,
      testRequired,
      documents: req.files.map(f => fileUrl('community-docs', f.filename)),
    });

    await notifyAdmins({
      title:   'New Community Support Application',
      message: `${req.user.name} applied for community support for "${testRequired}" with ${req.files.length} document(s).`,
      type:    'community_submitted',
      meta:    { applicationId: app._id },
    });

    res.status(201).json(app);
  } catch (err) {
    removeUploadedFiles(req);
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/patient/notifications ───────────────────────────────────────────
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

// ─── PUT /api/patient/notifications/:id/read ──────────────────────────────────
const markRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Notification not found' });
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true }
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/patient/notifications/read-all ──────────────────────────────────
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getProfile, updateProfile,
  getPrescriptions,
  getReports, markReportRead,
  getWallets, uploadPaymentReceipt, uploadServiceFeeReceipt,
  getInstallmentConfig, previewInstallmentPlan, applyForInstallmentPlan,
  getAppointments, bookAppointment, cancelAppointment,
  getCommunityApplications, createCommunityApplication,
  getNotifications, markRead, markAllRead,
};
