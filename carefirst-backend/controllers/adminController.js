const User                  = require('../models/User');
const LabProfile            = require('../models/LabProfile');
const DoctorProfile         = require('../models/DoctorProfile');
const LawyerProfile         = require('../models/LawyerProfile');
const PatientProfile        = require('../models/PatientProfile');
const Wallet                = require('../models/Wallet');
const DefaulterCase         = require('../models/DefaulterCase');
const Notification          = require('../models/Notification');
const CommunityApplication  = require('../models/CommunityApplication');
const mongoose              = require('mongoose');
const generateToken         = require('../utils/generateToken');
const { sendNotification }  = require('../socket/notificationSocket');
const { v4: uuid }          = require('crypto');
const { getPatientProfileMap, withPatientDetails } = require('../utils/patientProfiles');
const { splitInstallments, buildSchedule, findLabPayment } = require('../utils/installmentPlan');

const notify = async (recipient, { title, message, type, meta }) => {
  const notif = await Notification.create({ recipient, title, message, type, meta });
  sendNotification(recipient.toString(), notif);
};

const findWallet = (walletId) =>
  mongoose.isValidObjectId(walletId)
    ? Wallet.findById(walletId).populate('patient', 'name email phone').populate('lab', 'name email')
    : null;

// Wallets as plain objects with patient CNIC details and the lab's name
const enrichWallets = async (wallets) => {
  const labIds   = [...new Set(wallets.map(w => w.lab?._id?.toString()).filter(Boolean))];
  const profiles = await LabProfile.find({ user: { $in: labIds } }).select('user labName');
  const labNames = {};
  profiles.forEach(lp => { labNames[lp.user.toString()] = lp.labName; });
  return (await withPatientDetails(wallets)).map(w => ({
    ...w,
    labName: labNames[w.lab?._id?.toString()] || w.lab?.name || '—',
  }));
};

const pkr = (n) => `PKR ${(n || 0).toLocaleString()}`;

// ─── POST /api/admin/login ────────────────────────────────────────────────────
const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const admin = await User.findOne({ role: 'admin' });
    if (!admin) return res.status(500).json({ message: 'Admin account not seeded yet — restart server' });

    const token = generateToken(admin._id, 'admin');
    res.json({
      token,
      user: { id: admin._id, name: admin.name, email: admin.email, role: 'admin' },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/registrations?status=pending ──────────────────────────────
const getRegistrations = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    // Patients are active on signup (CNIC is reviewed separately), so only providers need approval
    const users = await User.find({ role: { $nin: ['admin', 'patient'] }, status }).sort({ createdAt: -1 });

    const enriched = await Promise.all(
      users.map(async (u) => {
        let profile = null;
        if (u.role === 'lab')    profile = await LabProfile.findOne({ user: u._id });
        if (u.role === 'doctor') profile = await DoctorProfile.findOne({ user: u._id });
        if (u.role === 'lawyer') profile = await LawyerProfile.findOne({ user: u._id });
        return { ...u.toObject(), profile };
      })
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/registrations/:userId/approve ────────────────────────────
const approveRegistration = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'active' }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const notif = await Notification.create({
      recipient: user._id,
      title:     'Registration Approved',
      message:   'Your CareFirst account has been approved. You can now log in.',
      type:      'registration_approved',
    });
    sendNotification(user._id.toString(), notif);

    res.json({ message: 'User approved successfully', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/registrations/:userId/reject ─────────────────────────────
const rejectRegistration = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'rejected' }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const notif = await Notification.create({
      recipient: user._id,
      title:     'Registration Rejected',
      message:   reason || 'Your registration could not be approved at this time.',
      type:      'registration_rejected',
    });
    sendNotification(user._id.toString(), notif);

    res.json({ message: 'User rejected', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/users?role=&status=&page=&limit= ────────────────────────
const getUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 20 } = req.query;
    const filter = { role: { $ne: 'admin' } };
    if (role   && role   !== 'all') filter.role   = role;
    if (status && status !== 'all') filter.status = status;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    // Patients carry their CNIC + verification status for the admin users table
    const patientProfiles = await getPatientProfileMap(users.filter(u => u.role === 'patient').map(u => u._id));
    const enriched = users.map(u => {
      const obj = u.toObject();
      if (u.role === 'patient') obj.profile = patientProfiles[u._id.toString()] || null;
      return obj;
    });

    res.json({ users: enriched, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/users/:userId/suspend ────────────────────────────────────
const suspendUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'suspended' }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User suspended', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/users/:userId/activate ───────────────────────────────────
const activateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'active' }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User activated', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/patients/:userId/cnic/verify ─────────────────────────────
const verifyPatientCnic = async (req, res) => {
  try {
    const profile = await PatientProfile.findOne({ user: req.params.userId });
    if (!profile) return res.status(404).json({ message: 'Patient not found' });
    if (profile.cnicStatus === 'verified') return res.status(400).json({ message: 'CNIC is already verified' });

    profile.cnicStatus          = 'verified';
    profile.cnicRejectionReason = undefined;
    profile.cnicReviewedAt      = new Date();
    profile.cnicReviewedBy      = req.user._id;
    await profile.save();

    const notif = await Notification.create({
      recipient: profile.user,
      title:     'CNIC Verified',
      message:   'Your CNIC has been verified. You can now apply for community support and installment plans.',
      type:      'cnic_verified',
    });
    sendNotification(profile.user.toString(), notif);

    res.json({ message: 'CNIC verified', profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/patients/:userId/cnic/reject ─────────────────────────────
const rejectPatientCnic = async (req, res) => {
  try {
    const profile = await PatientProfile.findOne({ user: req.params.userId });
    if (!profile) return res.status(404).json({ message: 'Patient not found' });
    if (profile.cnicStatus === 'verified') return res.status(400).json({ message: 'CNIC is already verified' });

    const reason = (req.body.reason || '').trim() || 'The CNIC you provided could not be verified.';
    profile.cnicStatus          = 'rejected';
    profile.cnicRejectionReason = reason;
    profile.cnicReviewedAt      = new Date();
    profile.cnicReviewedBy      = req.user._id;
    await profile.save();

    const notif = await Notification.create({
      recipient: profile.user,
      title:     'CNIC Not Verified',
      message:   `${reason} Please correct your CNIC from your profile.`,
      type:      'cnic_rejected',
    });
    sendNotification(profile.user.toString(), notif);

    res.json({ message: 'CNIC rejected', profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/wallets?status=&page=&limit= ─────────────────────────────
const getWallets = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const [wallets, total] = await Promise.all([
      Wallet.find(filter)
        .populate('patient', 'name email phone')
        .populate('lab',     'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      Wallet.countDocuments(filter),
    ]);

    res.json({ wallets: await enrichWallets(wallets), total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/wallets/:walletId ────────────────────────────────────────
const getWalletById = async (req, res) => {
  try {
    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    const [enriched] = await enrichWallets([wallet]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/wallets/:walletId/approve ────────────────────────────────
// Approves an installment application; the patient then pays the service fee
const approvePlan = async (req, res) => {
  try {
    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if (wallet.status !== 'pending_approval') return res.status(400).json({ message: 'This application has already been reviewed' });

    wallet.status         = 'awaiting_fee';
    wallet.planApprovedAt = new Date();
    wallet.planApprovedBy = req.user._id;
    await wallet.save();

    await notify(wallet.patient._id, {
      title:   'Installment Plan Approved',
      message: `Your installment plan for ${wallet.testName} has been approved. Pay the ${pkr(wallet.serviceFee.amount)} CareFirst service fee and upload the screenshot from My Wallet to activate it.`,
      type:    'plan_approved',
      meta:    { walletId: wallet._id },
    });

    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Plan approved — awaiting service fee', wallet: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/wallets/:walletId/reject ─────────────────────────────────
// Body: { reason }
const rejectPlan = async (req, res) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ message: 'Please give a reason for rejecting the application' });

    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if (wallet.status !== 'pending_approval') return res.status(400).json({ message: 'This application has already been reviewed' });

    wallet.status          = 'rejected';
    wallet.rejectionReason = reason;
    wallet.rejectedAt      = new Date();
    wallet.rejectedBy      = req.user._id;
    await wallet.save();

    await notify(wallet.patient._id, {
      title:   'Installment Plan Not Approved',
      message: `Your installment plan application for ${wallet.testName} was not approved. Reason: ${reason}`,
      type:    'plan_rejected',
      meta:    { walletId: wallet._id },
    });

    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Application rejected', wallet: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/wallets/:walletId/service-fee/verify ─────────────────────
// Fee received by CareFirst → plan becomes active and the schedule is generated
const verifyServiceFee = async (req, res) => {
  try {
    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if (wallet.status !== 'awaiting_fee')  return res.status(400).json({ message: 'This plan is not waiting for a service fee' });
    if (!wallet.serviceFee.receiptUrl)     return res.status(400).json({ message: 'Patient has not uploaded the service fee receipt yet' });

    const now = new Date();
    wallet.serviceFee.adminVerified   = true;
    wallet.serviceFee.adminVerifiedAt = now;
    wallet.serviceFee.adminVerifiedBy = req.user._id;
    wallet.serviceFee.rejectionReason = undefined;

    const amounts = splitInstallments(wallet.totalAmount - wallet.downPayment.amount, wallet.installmentCount);
    wallet.installments = buildSchedule(amounts, wallet.installmentTenureDays, now);
    wallet.activatedAt  = now;
    if (wallet.downPayment.amount === 0) {
      // DOWN_PAYMENT_PERCENT=0 — nothing to collect
      wallet.downPayment.adminVerified   = true;
      wallet.downPayment.adminVerifiedAt = now;
    }
    wallet.status       = 'active';
    await wallet.save();

    const first = wallet.installments[0];
    const firstDue = first.dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
    await notify(wallet.patient._id, {
      title:   'Installment Plan Active',
      message: `Your service fee is verified and your plan for ${wallet.testName} is now active. ` +
               (wallet.downPayment.adminVerified ? '' : `Pay the ${pkr(wallet.downPayment.amount)} down payment to the lab and upload the receipt. `) +
               `Installment #1 (${pkr(first.amount)}) is due on ${firstDue}.`,
      type:    'plan_activated',
      meta:    { walletId: wallet._id },
    });
    await notify(wallet.lab._id, {
      title:   'New Installment Plan',
      message: `${wallet.patient.name} has an active installment plan with your lab for ${wallet.testName} (${pkr(wallet.totalAmount)}): ${pkr(wallet.downPayment.amount)} down payment and ${wallet.installments.length} installments every ${wallet.installmentTenureDays} days, paid to your lab. You will be asked to confirm each receipt.`,
      type:    'plan_activated',
      meta:    { walletId: wallet._id },
    });

    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Service fee verified — plan is now active', wallet: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/wallets/:walletId/service-fee/reject ─────────────────────
// Body: { reason } — screenshot could not be matched to a payment; patient re-uploads
const rejectServiceFee = async (req, res) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ message: 'Please give a reason' });

    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if (wallet.status !== 'awaiting_fee') return res.status(400).json({ message: 'This plan is not waiting for a service fee' });
    if (!wallet.serviceFee.receiptUrl)    return res.status(400).json({ message: 'There is no service fee receipt to reject' });

    wallet.serviceFee.receiptUrl        = undefined;
    wallet.serviceFee.receiptUploadedAt = undefined;
    wallet.serviceFee.rejectionReason   = reason;
    await wallet.save();

    await notify(wallet.patient._id, {
      title:   'Service Fee Not Verified',
      message: `We could not verify your service fee payment for ${wallet.testName}. Reason: ${reason} Please upload a valid screenshot from My Wallet.`,
      type:    'service_fee_rejected',
      meta:    { walletId: wallet._id },
    });

    const [enriched] = await enrichWallets([wallet]);
    res.json({ message: 'Service fee receipt rejected', wallet: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/wallets/:walletId/installments/:instIndex/verify ─────────
// ─── PUT /api/admin/wallets/:walletId/down-payment/verify ─────────────────────
const verifyInstallment = async (req, res) => {
  try {
    const wallet = await findWallet(req.params.walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    const target = findLabPayment(wallet, req.params.instIndex);
    if (!target) return res.status(404).json({ message: 'Installment index out of range' });
    const { payment, isInstallment, label, meta } = target;
    if (!payment.receiptUrl)   return res.status(400).json({ message: 'Patient has not uploaded a receipt yet' });
    if (!payment.labApproved)  return res.status(400).json({ message: 'Lab has not approved the receipt yet' });
    if (payment.adminVerified) return res.status(400).json({ message: 'Payment already verified' });

    payment.adminVerified   = true;
    payment.adminVerifiedAt = new Date();
    payment.adminVerifiedBy = req.user._id;
    if (isInstallment) payment.status = 'paid';

    if (wallet.isFullyPaid()) wallet.status = 'completed';

    await wallet.save(); // pre-save hook recalculates remainingBalance

    const notif = await Notification.create({
      recipient: wallet.patient._id,
      title:     'Payment Verified',
      message:   `Your ${label} of PKR ${payment.amount.toLocaleString()} has been verified by admin and marked as paid.` +
                 (wallet.status === 'completed' ? ' Your installment plan is now fully paid.' : ''),
      type:      'receipt_admin_verified',
      meta,
    });
    sendNotification(wallet.patient._id.toString(), notif);

    res.json({ message: `${isInstallment ? 'Installment' : 'Down payment'} verified and marked paid`, wallet });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/defaulter-cases ──────────────────────────────────────────
const getDefaulterCases = async (req, res) => {
  try {
    const cases = await DefaulterCase.find()
      .populate('patient',        'name email phone')
      .populate('wallet')
      .populate('assignedLawyer', 'name email')
      .sort({ escalatedAt: -1 });
    res.json(cases);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/community-applications?status= ───────────────────────────
const getCommunityApplications = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const applications = await CommunityApplication.find(filter)
      .populate('patient',     'name email phone')
      .populate('assignedLab', 'name email')
      .sort({ createdAt: -1 });
    res.json(await withPatientDetails(applications));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/community-applications/:id/approve ───────────────────────
const approveCommunityApplication = async (req, res) => {
  try {
    const { assignedLabId } = req.body;
    if (!assignedLabId) return res.status(400).json({ message: 'assignedLabId is required' });

    const lab = await User.findOne({ _id: assignedLabId, role: 'lab', status: 'active' });
    if (!lab) return res.status(404).json({ message: 'Lab not found or inactive' });

    const app = await CommunityApplication.findById(req.params.id).populate('patient', 'name email');
    if (!app)                    return res.status(404).json({ message: 'Application not found' });
    if (app.status !== 'pending') return res.status(400).json({ message: 'Application already reviewed' });

    const slipId = `SLP-${Date.now().toString().slice(-6)}`;
    app.status      = 'approved';
    app.assignedLab = assignedLabId;
    app.reviewedAt  = new Date();
    app.reviewedBy  = req.user._id;
    app.slip        = { slipId, generatedAt: new Date() };
    await app.save();

    const notif = await Notification.create({
      recipient: app.patient._id,
      title:     'Community Support Approved',
      message:   `Your community support application has been approved. Slip ID: ${slipId}. Visit the assigned lab to proceed.`,
      type:      'community_approved',
      meta:      { applicationId: app._id, slipId },
    });
    sendNotification(app.patient._id.toString(), notif);

    res.json({ message: 'Application approved', application: app });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/community-applications/:id/reject ────────────────────────
const rejectCommunityApplication = async (req, res) => {
  try {
    const { reason } = req.body;
    const app = await CommunityApplication.findById(req.params.id).populate('patient', 'name email');
    if (!app)                    return res.status(404).json({ message: 'Application not found' });
    if (app.status !== 'pending') return res.status(400).json({ message: 'Application already reviewed' });

    app.status          = 'rejected';
    app.rejectionReason = reason || 'Application did not meet eligibility criteria.';
    app.reviewedAt      = new Date();
    app.reviewedBy      = req.user._id;
    await app.save();

    const notif = await Notification.create({
      recipient: app.patient._id,
      title:     'Community Support Rejected',
      message:   app.rejectionReason,
      type:      'community_rejected',
      meta:      { applicationId: app._id },
    });
    sendNotification(app.patient._id.toString(), notif);

    res.json({ message: 'Application rejected', application: app });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/notifications ────────────────────────────────────────────
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

// ─── PUT /api/admin/notifications/:id/read ───────────────────────────────────
const markNotificationRead = async (req, res) => {
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
  adminLogin,
  getRegistrations, approveRegistration, rejectRegistration,
  getUsers, suspendUser, activateUser,
  verifyPatientCnic, rejectPatientCnic,
  getWallets, getWalletById, verifyInstallment,
  approvePlan, rejectPlan, verifyServiceFee, rejectServiceFee,
  getDefaulterCases,
  getCommunityApplications, approveCommunityApplication, rejectCommunityApplication,
  getNotifications, markNotificationRead,
};
