// Admin dashboard overview, Platform Reports and Settings — all from real data
const User                 = require('../models/User');
const Wallet               = require('../models/Wallet');
const DefaulterCase        = require('../models/DefaulterCase');
const CommunityApplication = require('../models/CommunityApplication');
const Appointment          = require('../models/Appointment');
const LabBooking           = require('../models/LabBooking');
const TestReport           = require('../models/TestReport');
const Prescription         = require('../models/Prescription');
const LabProfile           = require('../models/LabProfile');
const PlatformSettings     = require('../models/PlatformSettings');
const { pktDate }          = require('../utils/schedule');
const { getPlatformSettings, ACCOUNT_FIELDS } = require('../utils/platformSettings');

const PKT_OFFSET = 5 * 60 * 60 * 1000;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const currentMonth = () => new Date(Date.now() + PKT_OFFSET).toISOString().slice(0, 7);
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
// Pakistan calendar month → [start, end) instants
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return { $gte: new Date(Date.UTC(y, m - 1, 1) - PKT_OFFSET), $lt: new Date(Date.UTC(y, m, 1) - PKT_OFFSET) };
};

// Count + PKR total of payments verified by the admin in a month
const verifiedPayments = async (range) => {
  const [down, inst, fees] = await Promise.all([
    Wallet.aggregate([
      { $match: { 'downPayment.adminVerifiedAt': range } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$downPayment.amount' } } },
    ]),
    Wallet.aggregate([
      { $unwind: '$installments' },
      { $match: { 'installments.adminVerifiedAt': range } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$installments.amount' } } },
    ]),
    Wallet.aggregate([
      { $match: { 'serviceFee.adminVerifiedAt': range } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$serviceFee.amount' } } },
    ]),
  ]);
  return {
    labPayments: { count: (down[0]?.count || 0) + (inst[0]?.count || 0), amount: (down[0]?.amount || 0) + (inst[0]?.amount || 0) },
    serviceFees: { count: fees[0]?.count || 0, amount: fees[0]?.amount || 0 },
  };
};

// Every number on Platform Reports for one month
const monthMetrics = async (ym) => {
  const range = monthRange(ym);
  const days  = { $gte: `${ym}-01`, $lt: `${shiftMonth(ym, 1)}-01` }; // "YYYY-MM-DD" strings
  const [
    patients, providers, appointments, apptCompleted, apptNoShow, labVisits, labCompleted,
    reports, reportsAuto, prescriptions, applications, activated, community, communityApproved,
    conducted, defaulters, payments,
  ] = await Promise.all([
    User.countDocuments({ role: 'patient', createdAt: range }),
    User.countDocuments({ role: { $in: ['doctor', 'lab', 'lawyer'] }, createdAt: range }),
    Appointment.countDocuments({ startsAt: range, status: { $ne: 'cancelled' } }),
    Appointment.countDocuments({ startsAt: range, status: 'completed' }),
    Appointment.countDocuments({ startsAt: range, status: 'no_show' }),
    LabBooking.countDocuments({ visitDate: days, status: { $ne: 'cancelled' } }),
    LabBooking.countDocuments({ visitDate: days, status: 'completed' }),
    TestReport.countDocuments({ createdAt: range }),
    TestReport.countDocuments({ createdAt: range, 'autoRead.status': 'ready' }),
    Prescription.countDocuments({ createdAt: range }),
    Wallet.countDocuments({ createdAt: range, agreement: { $exists: true } }),
    Wallet.countDocuments({ activatedAt: range }),
    CommunityApplication.countDocuments({ createdAt: range }),
    CommunityApplication.countDocuments({ reviewedAt: range, status: 'approved' }),
    CommunityApplication.countDocuments({ conductedAt: range }),
    DefaulterCase.countDocuments({ escalatedAt: range }),
    verifiedPayments(range),
  ]);
  return {
    patients, providers, appointments, apptCompleted, apptNoShow, labVisits, labCompleted,
    reports, reportsAuto, prescriptions, applications, activated, community, communityApproved,
    conducted, defaulters, payments,
  };
};

const pkr = (n) => `PKR ${Math.round(n || 0).toLocaleString('en-US')}`;

// ─── GET /api/admin/reports?month=YYYY-MM ────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const now = currentMonth();
    const month = MONTH.test(req.query.month || '') && req.query.month <= now ? req.query.month : now;
    const prev  = shiftMonth(month, -1);
    const [cur, last] = await Promise.all([monthMetrics(month), monthMetrics(prev)]);

    // Months to choose from: since the first account, at most the last 12
    const first = await User.findOne({ role: { $ne: 'admin' } }).sort({ createdAt: 1 }).select('createdAt').lean();
    const firstMonth = first ? new Date(first.createdAt.getTime() + PKT_OFFSET).toISOString().slice(0, 7) : now;
    const months = [];
    for (let m = now; m >= firstMonth && months.length < 12; m = shiftMonth(m, -1)) months.push(m);

    const row = (key, label, get, details) => ({ key, label, count: get(cur), previous: get(last), details: details ? details(cur) : '' });
    res.json({
      month,
      previousMonth: prev,
      months,
      cards: [
        { key: 'appointments', label: 'Doctor appointments', count: cur.appointments,             previous: last.appointments },
        { key: 'labVisits',    label: 'Lab visits',          count: cur.labVisits,                previous: last.labVisits },
        { key: 'reports',      label: 'Reports uploaded',    count: cur.reports,                  previous: last.reports },
        { key: 'serviceFees',  label: 'Service fees received', count: cur.payments.serviceFees.amount, previous: last.payments.serviceFees.amount, money: true },
      ],
      rows: [
        row('patients',      'New patients',                     m => m.patients),
        row('providers',     'New doctors, labs & lawyers',      m => m.providers),
        row('appointments',  'Doctor appointments',              m => m.appointments, m => `${m.apptCompleted} completed · ${m.apptNoShow} no-show`),
        row('prescriptions', 'Prescriptions written',            m => m.prescriptions),
        row('labVisits',     'Lab visits',                       m => m.labVisits, m => `${m.labCompleted} completed`),
        row('reports',       'Test reports uploaded',            m => m.reports, m => `${m.reportsAuto} read automatically`),
        row('applications',  'Installment applications',         m => m.applications, m => `${m.activated} plans activated`),
        row('labPayments',   'Plan payments verified (to labs)', m => m.payments.labPayments.count, m => pkr(m.payments.labPayments.amount)),
        row('serviceFees',   'Service fees verified (to CareFirst)', m => m.payments.serviceFees.count, m => pkr(m.payments.serviceFees.amount)),
        row('community',     'Community support applications',   m => m.community, m => `${m.communityApproved} approved · ${m.conducted} tests conducted`),
        row('defaulters',    'Defaulter cases escalated',        m => m.defaulters),
      ],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/overview ─────────────────────────────────────────────────
// Dashboard numbers and the latest activity on the platform
const getOverview = async (req, res) => {
  try {
    const today = pktDate();
    const [roles, appointmentsToday, labVisitsToday, openPlans, users, reports, apps, wallets, appts, cases] = await Promise.all([
      User.aggregate([{ $match: { role: { $ne: 'admin' } } }, { $group: { _id: '$role', count: { $sum: 1 } } }]),
      Appointment.countDocuments({ date: today, status: { $ne: 'cancelled' } }),
      LabBooking.countDocuments({ visitDate: today, status: { $ne: 'cancelled' } }),
      Wallet.countDocuments({ status: { $in: ['active', 'defaulter'] } }),
      User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).limit(8).select('name role createdAt').lean(),
      TestReport.find().sort({ createdAt: -1 }).limit(8).select('lab testName createdAt').populate('lab', 'name').lean(),
      CommunityApplication.find().sort({ createdAt: -1 }).limit(8).select('patient testRequired createdAt').populate('patient', 'name').lean(),
      Wallet.find({ agreement: { $exists: true } }).sort({ createdAt: -1 }).limit(8).select('patient testName createdAt').populate('patient', 'name').lean(),
      Appointment.find().sort({ createdAt: -1 }).limit(8).select('patient doctor createdAt').populate('patient', 'name').populate('doctor', 'name').lean(),
      DefaulterCase.find().sort({ escalatedAt: -1 }).limit(8).select('patient escalatedAt').populate('patient', 'name').lean(),
    ]);

    const labNames = {};
    (await LabProfile.find({ user: { $in: reports.map(r => r.lab?._id).filter(Boolean) } }).select('user labName').lean())
      .forEach(p => { labNames[p.user.toString()] = p.labName; });

    const totals = { users: 0, patient: 0, doctor: 0, lab: 0, lawyer: 0 };
    roles.forEach(r => { totals[r._id] = r.count; totals.users += r.count; });

    const activity = [
      ...users.map(u => ({ kind: 'registration', who: u.name, text: `registered as a ${u.role}`, at: u.createdAt })),
      ...reports.map(r => ({ kind: 'report', who: labNames[r.lab?._id?.toString()] || r.lab?.name || 'A lab', text: `uploaded a ${r.testName} report`, at: r.createdAt })),
      ...apps.map(a => ({ kind: 'community', who: a.patient?.name || 'A patient', text: `applied for community support (${a.testRequired})`, at: a.createdAt })),
      ...wallets.map(w => ({ kind: 'plan', who: w.patient?.name || 'A patient', text: `applied for an installment plan (${w.testName})`, at: w.createdAt })),
      ...appts.map(a => ({ kind: 'appointment', who: a.patient?.name || 'A patient', text: `booked an appointment with ${a.doctor?.name || 'a doctor'}`, at: a.createdAt })),
      ...cases.map(c => ({ kind: 'defaulter', who: c.patient?.name || 'A patient', text: 'was escalated to a lawyer as a defaulter', at: c.escalatedAt })),
    ]
      .filter(a => a.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

    res.json({ totals, appointmentsToday, labVisitsToday, openPlans, activity });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/admin/settings ─────────────────────────────────────────────────
const getSettings = async (req, res) => {
  try {
    res.json(await getPlatformSettings());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/admin/settings ─────────────────────────────────────────────────
// Body: { careFirstAccount: { bankName, accountTitle, accountNumber, jazzCash, easyPaisa }, supportEmail }
const WALLET_NUMBER = /^03\d{2}-?\d{7}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const updateSettings = async (req, res) => {
  try {
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const input = req.body.careFirstAccount || {};
    const account = {};
    for (const f of ACCOUNT_FIELDS) account[f] = str(input[f]);
    const supportEmail = str(req.body.supportEmail).toLowerCase();

    if (account.accountNumber && !account.bankName) return res.status(400).json({ message: 'Enter the bank name for the account number' });
    if (account.bankName && !account.accountNumber) return res.status(400).json({ message: 'Enter the bank account number (or IBAN)' });
    if (account.accountNumber && !account.accountTitle) return res.status(400).json({ message: 'Enter the account title (the name on the bank account)' });
    if (!account.accountNumber && !account.jazzCash && !account.easyPaisa) {
      return res.status(400).json({ message: 'Add a bank account or a JazzCash / EasyPaisa number so patients can pay the service fee' });
    }
    for (const [f, label] of [['jazzCash', 'JazzCash'], ['easyPaisa', 'EasyPaisa']]) {
      if (account[f] && !WALLET_NUMBER.test(account[f].replace(/\s/g, ''))) {
        return res.status(400).json({ message: `Enter the ${label} number like 0300-1234567` });
      }
    }
    if (account.accountNumber && !/^[A-Za-z0-9 -]{6,40}$/.test(account.accountNumber)) {
      return res.status(400).json({ message: 'The account number can only have letters, digits, spaces and dashes (6–40 characters)' });
    }
    if (supportEmail && !EMAIL.test(supportEmail)) return res.status(400).json({ message: 'Enter a valid support email' });

    await PlatformSettings.findOneAndUpdate(
      { key: 'platform' },
      { careFirstAccount: account, supportEmail: supportEmail || undefined, updatedBy: req.user._id },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ message: 'Settings saved', ...(await getPlatformSettings()) });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getReports, getOverview, getSettings, updateSettings };
