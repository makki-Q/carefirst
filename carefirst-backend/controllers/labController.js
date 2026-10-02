const LabProfile           = require('../models/LabProfile');
const TestReport           = require('../models/TestReport');
const Wallet               = require('../models/Wallet');
const Notification         = require('../models/Notification');
const CommunityApplication = require('../models/CommunityApplication');
const User                 = require('../models/User');
const { sendNotification } = require('../socket/notificationSocket');
const { fileUrl }          = require('../utils/fileUrl');
const { withPatientDetails } = require('../utils/patientProfiles');
const { findLabPayment }     = require('../utils/installmentPlan');

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
    const { labName, location, phone, bankDetails, jazzCash, easyPaisa, isCharityPartner } = req.body;
    const profile = await LabProfile.findOneAndUpdate(
      { user: req.user._id },
      { labName, location, phone, bankDetails, jazzCash, easyPaisa, isCharityPartner },
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
const uploadReport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { patientId, testName, notes } = req.body;
    if (!patientId || !testName) {
      return res.status(400).json({ message: 'patientId and testName are required' });
    }

    const patient = await User.findOne({ _id: patientId, role: 'patient' });
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const reportUrl = fileUrl('reports', req.file.filename);
    const report    = await TestReport.create({
      patient: patientId,
      lab:     req.user._id,
      testName,
      reportUrl,
      notes,
    });

    const notif = await Notification.create({
      recipient: patientId,
      title:     'Test Report Ready',
      message:   `Your ${testName} report has been uploaded by ${req.user.name}. You can view it in My Reports.`,
      type:      'test_report_uploaded',
      meta:      { reportId: report._id, testName },
    });
    sendNotification(patientId.toString(), notif);

    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

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
// Returns all unique patients linked to this lab (via wallets or community apps)
const getLabPatients = async (req, res) => {
  try {
    const [communityApps, wallets] = await Promise.all([
      CommunityApplication.find({ assignedLab: req.user._id }).populate('patient', 'name email phone').select('patient'),
      Wallet.find({ lab: req.user._id, status: { $in: ['active', 'completed', 'defaulter'] } })
        .populate('patient', 'name email phone').select('patient'),
    ]);

    const seen = new Set();
    const patients = [];
    for (const item of [...communityApps, ...wallets]) {
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
  uploadReport, getReports,
  getReceiptsPendingApproval, approveReceipt,
  getNeedyPatients, markTestConducted,
  getLabPatients,
  getNotifications, markRead,
};
