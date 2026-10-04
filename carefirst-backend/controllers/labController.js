const LabProfile           = require('../models/LabProfile');
const TestReport           = require('../models/TestReport');
const Wallet               = require('../models/Wallet');
const Notification         = require('../models/Notification');
const CommunityApplication = require('../models/CommunityApplication');
const User                 = require('../models/User');
const LabBooking           = require('../models/LabBooking');
const mongoose             = require('mongoose');
const { sendNotification } = require('../socket/notificationSocket');
const { fileUrl, removeUploadedFiles } = require('../utils/fileUrl');
const { withPatientDetails } = require('../utils/patientProfiles');
const { findLabPayment }     = require('../utils/installmentPlan');
const { isLatLng }           = require('../utils/travel');
const { translateToUrdu }     = require('../utils/azure');
const { processReport, processReportInBackground } = require('../utils/reportPipeline');
const { docIntelConfigured } = require('../utils/reportReader');

// ─── GET /api/lab/profile ─────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const profile = await LabProfile.findOne({ user: req.user._id });
    res.json({ user: req.user, profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/profile ─────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    // Joining Community Support has its own endpoint (PUT /api/lab/community-support)
    const { labName, location, phone, bankDetails, jazzCash, easyPaisa } = req.body;
    const update = { labName, location, phone, bankDetails, jazzCash, easyPaisa };

    // coordinates: { lat, lng } sets the map pin, null removes it
    if (req.body.coordinates === null) {
      update.$unset = { coordinates: 1 };
    } else if (req.body.coordinates !== undefined) {
      const lat = Number(req.body.coordinates?.lat);
      const lng = Number(req.body.coordinates?.lng);
      if (!isLatLng({ lat, lng })) return res.status(400).json({ message: 'Invalid map location' });
      update.coordinates = { lat, lng };
    }

    const profile = await LabProfile.findOneAndUpdate(
      { user: req.user._id },
      update,
      { new: true, runValidators: true }
    );
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/tests ───────────────────────────────────────────────────────
const getTests = async (req, res) => {
  try {
    const profile = await LabProfile.findOne({ user: req.user._id });
    res.json(profile?.tests || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/lab/tests ──────────────────────────────────────────────────────
const addTest = async (req, res) => {
  try {
    const { name, category, price, installmentEnabled, installmentCount, installmentTenureDays } = req.body;
    if (!name || !category || price === undefined) {
      return res.status(400).json({ message: 'name, category, and price are required' });
    }

    const profile = await LabProfile.findOne({ user: req.user._id });
    profile.tests.push({
      name, category, price: Number(price), isActive: true,
      installmentEnabled:   Boolean(installmentEnabled),
      installmentCount:     installmentEnabled ? (Number(installmentCount) || 2) : 2,
      installmentTenureDays:installmentEnabled ? (Number(installmentTenureDays) || 30) : 30,
    });
    await profile.save();

    const added = profile.tests[profile.tests.length - 1];
    res.status(201).json(added);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/tests/:testId ───────────────────────────────────────────────
const updateTest = async (req, res) => {
  try {
    const { name, category, price, isActive } = req.body;
    const profile = await LabProfile.findOne({ user: req.user._id });
    const test    = profile.tests.id(req.params.testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const { installmentEnabled, installmentCount, installmentTenureDays } = req.body;
    if (name                !== undefined) test.name                 = name;
    if (category            !== undefined) test.category             = category;
    if (price               !== undefined) test.price                = Number(price);
    if (isActive            !== undefined) test.isActive             = Boolean(isActive);
    if (installmentEnabled  !== undefined) test.installmentEnabled   = Boolean(installmentEnabled);
    if (installmentCount    !== undefined) test.installmentCount     = Number(installmentCount);
    if (installmentTenureDays !== undefined) test.installmentTenureDays = Number(installmentTenureDays);

    await profile.save();
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── DELETE /api/lab/tests/:testId ───────────────────────────────────────────
const deleteTest = async (req, res) => {
  try {
    const profile = await LabProfile.findOne({ user: req.user._id });
    const test    = profile.tests.id(req.params.testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    test.deleteOne();
    await profile.save();
    res.json({ message: 'Test removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/lab/reports/upload ─────────────────────────────────────────────
// Lab uploads the patient's test result (PDF / image)
// Body: { patientId, testName, notes } or { bookingId, notes } — a booking supplies
// the patient and test, needs its sample collected, and is completed by the report
const uploadReport = async (req, res) => {
  const reject = (status, message) => {
    removeUploadedFiles(req);
    return res.status(status).json({ message });
  };

  try {
    if (!req.file) return reject(400, 'No file uploaded');

    const { bookingId, notes } = req.body;
    let { patientId, testName } = req.body;
    let booking = null;
    if (bookingId) {
      if (!mongoose.isValidObjectId(bookingId)) return reject(404, 'Booking not found');
      booking = await LabBooking.findOne({ _id: bookingId, lab: req.user._id });
      if (!booking) return reject(404, 'Booking not found');
      if (booking.status === 'cancelled') return reject(400, 'This booking was cancelled');
      if (booking.status === 'confirmed') return reject(400, 'Mark the sample as collected before uploading the report');
      if (booking.report) return reject(409, 'This booking already has a report');
      patientId = booking.patient.toString();
      testName  = testName || booking.testName;
    }
    if (!patientId || !testName) return reject(400, 'patientId and testName are required');

    const patient = mongoose.isValidObjectId(patientId) && await User.findOne({ _id: patientId, role: 'patient' });
    if (!patient) return reject(404, 'Patient not found');

    // Plain-language summary for the patient, machine-translated to Urdu (lab can correct it later)
    const summary     = typeof req.body.summary === 'string' ? req.body.summary.trim() : '';
    const summaryUrdu = summary ? await translateToUrdu(summary) : null;

    const reportUrl = fileUrl('reports', req.file.filename);
    const report    = await TestReport.create({
      patient: patientId,
      lab:     req.user._id,
      testName,
      reportUrl,
      notes,
      booking: booking?._id,
      ...(summary && { summary, summarySource: 'lab' }),
      autoRead: { status: docIntelConfigured() ? 'pending' : 'skipped' },
      ...(summaryUrdu && { summaryUrdu, summaryUrduSource: 'machine' }),
    });

    if (booking) {
      booking.report = report._id;
      if (booking.status === 'sample_collected') {
        booking.status      = 'completed';
        booking.completedAt = new Date();
      }
      await booking.save();
    }

    const notif = await Notification.create({
      recipient: patientId,
      title:     'Test Report Ready',
      message:   `Your ${testName} report has been uploaded by ${req.user.name}. You can view it in My Reports.`,
      type:      'test_report_uploaded',
      meta:      { reportId: report._id, testName },
    });
    sendNotification(patientId.toString(), notif);

    // Read the file in the background → automatic summary for the patient (decision 9)
    if (docIntelConfigured()) processReportInBackground(report._id);
    res.status(201).json(report);
  } catch (err) {
    removeUploadedFiles(req);
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/reports/:id/summary ────────────────────────────────────────
// Body: { summary?, summaryUrdu? }
//   summaryUrdu  → the lab's own correction of the Urdu text
//   summary only → new English summary, translated again
const updateReportSummary = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Report not found' });
    const report = await TestReport.findOne({ _id: req.params.id, lab: req.user._id });
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const str = (v) => (typeof v === 'string' ? v.trim() : undefined);
    const summary     = str(req.body.summary);
    const summaryUrdu = str(req.body.summaryUrdu);
    if (summary === undefined && summaryUrdu === undefined) {
      return res.status(400).json({ message: 'Send summary and/or summaryUrdu' });
    }

    if (summary !== undefined) {
      report.summary = summary || undefined;
      report.summarySource = summary ? 'lab' : undefined;
    }
    if (summaryUrdu && !report.summarySource) report.summarySource = 'lab';
    if (summaryUrdu !== undefined) {
      report.summaryUrdu         = summaryUrdu || undefined;
      report.summaryUrduSource   = summaryUrdu ? 'lab' : undefined;
      report.summaryUrduEditedAt = summaryUrdu ? new Date() : undefined;
    } else if (summary) {
      const translated = await translateToUrdu(summary);
      if (!translated) return res.status(502).json({ message: 'Could not translate the summary right now. Please try again, or type the Urdu yourself.' });
      report.summaryUrdu         = translated;
      report.summaryUrduSource   = 'machine';
      report.summaryUrduEditedAt = undefined;
    } else {
      report.summaryUrdu = report.summaryUrduSource = report.summaryUrduEditedAt = undefined;
    }
    await report.save();

    await report.populate('patient', 'name email');
    res.json({ message: 'Summary updated', report });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/lab/reports/:id/read-again ────────────────────────────────────
// Re-runs the automatic reading (e.g. after it failed); waits for the result
const readReportAgain = async (req, res) => {
  try {
    if (!docIntelConfigured()) return res.status(503).json({ message: 'Automatic report reading is not set up on this server' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Report not found' });
    const existing = await TestReport.findOne({ _id: req.params.id, lab: req.user._id }).select('autoRead');
    if (!existing) return res.status(404).json({ message: 'Report not found' });
    if (['pending', 'processing'].includes(existing.autoRead?.status)) return res.status(409).json({ message: 'This report is being read right now' });

    const report = await processReport(existing._id);
    await report.populate('patient', 'name email');
    res.json({ message: report.autoRead.status === 'ready' ? 'Report read' : 'The report could not be read', report });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Bookings (patients' lab visits) ─────────────────────────────────────────

const visitDay = (date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const findBookings = (filter) =>
  LabBooking.find(filter)
    .populate('patient', 'name email phone')
    .populate('report', 'reportUrl createdAt')
    .sort({ visitDate: 1, createdAt: 1 });

// ─── GET /api/lab/bookings ───────────────────────────────────────────────────
const getBookings = async (req, res) => {
  try {
    res.json(await withPatientDetails(await findBookings({ lab: req.user._id })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/bookings/:id/sample-collected | /complete ──────────────────
// confirmed → sample_collected → completed
const advanceBooking = (from, to) => async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Booking not found' });
    const booking = await LabBooking.findOne({ _id: req.params.id, lab: req.user._id });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.status !== from) {
      return res.status(400).json({ message: `Only a ${from.replace('_', ' ')} booking can be marked ${to.replace('_', ' ')} (this one is ${booking.status.replace('_', ' ')})` });
    }

    booking.status = to;
    if (to === 'sample_collected') booking.sampleCollectedAt = new Date();
    if (to === 'completed')        booking.completedAt       = new Date();
    await booking.save();

    const notif = await Notification.create({
      recipient: booking.patient,
      title:     to === 'completed' ? 'Test Completed' : 'Sample Collected',
      message:   to === 'completed'
        ? `Your ${booking.testName} at ${req.user.name} is complete. The report will appear in My Reports once uploaded.`
        : `${req.user.name} collected your sample for ${booking.testName} (visit ${visitDay(booking.visitDate)}).`,
      type:      'lab_booking_updated',
      meta:      { bookingId: booking._id },
    });
    sendNotification(booking.patient.toString(), notif);

    const [enriched] = await withPatientDetails(await findBookings({ _id: booking._id }));
    res.json({ message: 'Booking updated', booking: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
const markSampleCollected = advanceBooking('confirmed', 'sample_collected');
const completeBooking     = advanceBooking('sample_collected', 'completed');

// ─── GET /api/lab/reports ────────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const reports = await TestReport.find({ lab: req.user._id })
      .populate('patient', 'name email')
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/receipts ───────────────────────────────────────────────────
// Returns down payments and installments with a patient-uploaded receipt awaiting lab approval
const getReceiptsPendingApproval = async (req, res) => {
  try {
    const wallets = await Wallet.find({ lab: req.user._id, status: 'active' })
      .populate('patient', 'name email phone')
      .sort({ updatedAt: -1 });

    const awaitingLab = (p) => Boolean(p?.receiptUrl && !p.labApproved);
    const pending = wallets.map(w => ({
      walletId:  w._id,
      patient:   w.patient,
      testName:  w.testName,
      pendingDownPayment: awaitingLab(w.downPayment) ? w.toObject().downPayment : null,
      pendingInstallments: w.installments
        .map((inst, idx) => ({ ...inst.toObject(), index: idx }))
        .filter(awaitingLab),
    })).filter(w => w.pendingDownPayment || w.pendingInstallments.length > 0);

    res.json(pending);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/receipts/:walletId/installments/:instIndex/approve ──────────
// ─── PUT /api/lab/receipts/:walletId/down-payment/approve ─────────────────────
const approveReceipt = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ _id: req.params.walletId, lab: req.user._id })
      .populate('patient', 'name email');
    if (!wallet) return res.status(404).json({ message: 'Wallet not found or not linked to your lab' });

    const target = findLabPayment(wallet, req.params.instIndex);
    if (!target) return res.status(404).json({ message: 'Installment index out of range' });
    const { payment, label, meta } = target;
    if (!payment.receiptUrl)   return res.status(400).json({ message: 'Patient has not uploaded a receipt' });
    if (payment.labApproved)   return res.status(400).json({ message: 'Receipt already approved by lab' });

    payment.labApproved   = true;
    payment.labApprovedAt = new Date();
    await wallet.save();

    // Notify patient
    const patientNotif = await Notification.create({
      recipient: wallet.patient._id,
      title:     'Receipt Confirmed by Lab',
      message:   `Your payment receipt for the ${label} has been confirmed by ${req.user.name}. Awaiting admin final verification.`,
      type:      'receipt_lab_approved',
      meta,
    });
    sendNotification(wallet.patient._id.toString(), patientNotif);

    // Notify all admins to do final verification
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      const adminNotif = await Notification.create({
        recipient: admin._id,
        title:     'Receipt Ready for Verification',
        message:   `Lab confirmed receipt for ${wallet.patient.name} — ${label} (PKR ${payment.amount.toLocaleString()}). Please verify.`,
        type:      'receipt_lab_approved',
        meta,
      });
      sendNotification(admin._id.toString(), adminNotif);
    }

    res.json({ message: 'Receipt approved by lab — pending admin verification', wallet });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/needy-patients ─────────────────────────────────────────────
const getNeedyPatients = async (req, res) => {
  try {
    const applications = await CommunityApplication.find({
      assignedLab: req.user._id,
      status:      'approved',
    })
      .populate('patient', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(await withPatientDetails(applications));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/earnings ───────────────────────────────────────────────────
// Money the lab received that is recorded on CareFirst (CareFirst never holds it):
//   - completed visits paid at the lab (test price, on the visit date)
//   - down payments and installments the lab confirmed (on the confirmation date)
// → { month, total, count, previousTotal, entries[] (newest first, this + last month) }
const PKT_OFFSET = 5 * 60 * 60 * 1000;
const monthOf = (d) => new Date(new Date(d).getTime() + PKT_OFFSET).toISOString().slice(0, 7);
const getEarnings = async (req, res) => {
  try {
    const month = monthOf(new Date());
    const [y, m] = month.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const since = new Date(Date.UTC(y, m - 2, 1) - PKT_OFFSET); // start of last month (PKT)

    const [visits, wallets] = await Promise.all([
      LabBooking.find({ lab: req.user._id, status: 'completed', paymentMethod: 'at_lab', visitDate: { $gte: `${prev}-01` } })
        .populate('patient', 'name').select('patient testName price visitDate slipNumber').lean(),
      Wallet.find({ lab: req.user._id, $or: [{ 'downPayment.labApprovedAt': { $gte: since } }, { 'installments.labApprovedAt': { $gte: since } }] })
        .populate('patient', 'name').select('patient testName downPayment installments').lean(),
    ]);

    const entries = [];
    for (const v of visits) {
      entries.push({ kind: 'visit', at: new Date(`${v.visitDate}T12:00:00+05:00`), patient: v.patient?.name || '—', testName: v.testName,
        detail: `Visit paid at the lab · slip ${v.slipNumber || '—'}`, amount: Math.round(v.price || 0) });
    }
    for (const w of wallets) {
      if (w.downPayment?.labApprovedAt && w.downPayment.labApprovedAt >= since) {
        entries.push({ kind: 'downPayment', at: w.downPayment.labApprovedAt, patient: w.patient?.name || '—', testName: w.testName,
          detail: 'Down payment (installment plan)', amount: w.downPayment.amount || 0 });
      }
      for (const inst of w.installments || []) {
        if (inst.labApprovedAt && inst.labApprovedAt >= since) {
          entries.push({ kind: 'installment', at: inst.labApprovedAt, patient: w.patient?.name || '—', testName: w.testName,
            detail: `Installment #${inst.number} (installment plan)`, amount: inst.amount || 0 });
        }
      }
    }
    entries.sort((a, b) => new Date(b.at) - new Date(a.at));

    const inMonth = entries.filter(e => monthOf(e.at) === month);
    const total = inMonth.reduce((sum, e) => sum + e.amount, 0);
    const previousTotal = entries.filter(e => monthOf(e.at) === prev).reduce((sum, e) => sum + e.amount, 0);
    res.json({
      month,
      total,
      count: inMonth.length,
      visitsCompleted: inMonth.filter(e => e.kind === 'visit').length,
      planPayments: inMonth.filter(e => e.kind !== 'visit').length,
      previousTotal,
      entries,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/community-support ──────────────────────────────────────────
// Body: { join: true | false }. Joining takes effect at once (admins are told);
// leaving is refused while assigned patients still wait for their test.
const setCommunitySupport = async (req, res) => {
  try {
    if (typeof req.body.join !== 'boolean') return res.status(400).json({ message: 'join must be true or false' });
    const profile = await LabProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Lab profile not found' });

    if (req.body.join === Boolean(profile.isCharityPartner)) {
      return res.json({ message: req.body.join ? 'Already a Community Support partner' : 'Not a Community Support partner', profile });
    }

    if (!req.body.join) {
      const waiting = await CommunityApplication.countDocuments({ assignedLab: req.user._id, status: 'approved', testConducted: { $ne: true } });
      if (waiting > 0) {
        return res.status(409).json({
          message: `${waiting} needy patient${waiting === 1 ? ' is' : 's are'} still waiting for their test. Mark ${waiting === 1 ? 'it' : 'them'} conducted before leaving Community Support.`,
          waiting,
        });
      }
    }

    profile.isCharityPartner = req.body.join;
    profile.charityPartnerSince = req.body.join ? new Date() : undefined;
    await profile.save();

    const admins = await User.find({ role: 'admin' }).select('_id');
    for (const admin of admins) {
      const notif = await Notification.create({
        recipient: admin._id,
        title:     req.body.join ? 'Lab Joined Community Support' : 'Lab Left Community Support',
        message:   req.body.join
          ? `${profile.labName} joined Community Support and can now be assigned needy patients.`
          : `${profile.labName} left Community Support and will not be assigned new needy patients.`,
        type:      req.body.join ? 'community_partner_joined' : 'community_partner_left',
        meta:      { labId: req.user._id },
      });
      sendNotification(admin._id.toString(), notif);
    }

    res.json({ message: req.body.join ? 'You joined Community Support' : 'You left Community Support', profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/lab/needy-patients/:id/mark-conducted ──────────────────────────
const markTestConducted = async (req, res) => {
  try {
    const app = await CommunityApplication.findOne({
      _id:         req.params.id,
      assignedLab: req.user._id,
      status:      'approved',
    }).populate('patient', 'name email');

    if (!app)                 return res.status(404).json({ message: 'Application not found' });
    if (app.testConducted)    return res.status(400).json({ message: 'Test already marked as conducted' });

    app.testConducted = true;
    app.conductedAt   = new Date();
    await app.save();

    const notif = await Notification.create({
      recipient: app.patient._id,
      title:     'Community Support Test Conducted',
      message:   `Your ${app.testRequired} test has been conducted. Your report will be uploaded shortly.`,
      type:      'test_report_uploaded',
      meta:      { applicationId: app._id },
    });
    sendNotification(app.patient._id.toString(), notif);

    res.json({ message: 'Test marked as conducted', application: app });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/patients ────────────────────────────────────────────────────
// Returns all unique patients linked to this lab (via bookings, wallets or community apps)
const getLabPatients = async (req, res) => {
  try {
    const [communityApps, wallets, bookings] = await Promise.all([
      CommunityApplication.find({ assignedLab: req.user._id }).populate('patient', 'name email phone').select('patient'),
      Wallet.find({ lab: req.user._id, status: { $in: ['active', 'completed', 'defaulter'] } })
        .populate('patient', 'name email phone').select('patient'),
      LabBooking.find({ lab: req.user._id, status: { $ne: 'cancelled' } })
        .populate('patient', 'name email phone').select('patient'),
    ]);

    const seen = new Set();
    const patients = [];
    for (const item of [...bookings, ...communityApps, ...wallets]) {
      if (item.patient && !seen.has(item.patient._id.toString())) {
        seen.add(item.patient._id.toString());
        patients.push(item.patient);
      }
    }

    res.json(patients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/lab/notifications ──────────────────────────────────────────────
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

// ─── PUT /api/lab/notifications/:id/read ─────────────────────────────────────
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
  getTests, addTest, updateTest, deleteTest,
  uploadReport, getReports, updateReportSummary, readReportAgain,
  getReceiptsPendingApproval, approveReceipt,
  getNeedyPatients, markTestConducted, setCommunitySupport, getEarnings,
  getLabPatients,
  getBookings, markSampleCollected, completeBooking,
  getNotifications, markRead,
};
