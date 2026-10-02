// End-to-end API test — run with `npm run test:e2e`.
//
// Spawns server.js on port 5099 against a throwaway database, drives the API
// the way the dashboards do, asserts every response, then drops the database
// and deletes the files it uploaded. Never point this at the real database.

const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const mongoose  = require('mongoose');

const PORT      = 5099;
const BASE      = `http://localhost:${PORT}`;
const MONGO_URI = process.env.E2E_MONGO_URI || 'mongodb://127.0.0.1:27017/carefirst_e2e_test';
const ADMIN     = { username: 'e2e-admin', password: 'e2e-admin-pass' };

const BACKEND_DIR = path.join(__dirname, '..');
const UPLOAD_DIRS = ['reports', 'receipts', 'community-docs'].map(d => path.join(BACKEND_DIR, 'uploads', d));

if (!/_e2e_test$/.test(new URL(MONGO_URI).pathname)) {
  console.error(`Refusing to run: database name in ${MONGO_URI} must end with _e2e_test`);
  process.exit(1);
}

// ─── Assertions ───────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];

const check = (name, condition, detail) => {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
};

const section = (title) => console.log(`\n${title}`);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// files: { field: [filename, ...] } — sent as multipart with `body` as text fields
const call = async (method, urlPath, { token, body, files, raw } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (files) {
    payload = new FormData();
    Object.entries(body || {}).forEach(([k, v]) => payload.append(k, v));
    Object.entries(files).forEach(([field, names]) => {
      names.forEach(name => payload.append(field, new Blob([PNG]), name));
    });
  } else if (raw !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res  = await fetch(BASE + urlPath, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data, json: res.headers.get('content-type')?.includes('application/json') };
};

const get  = (p, opts) => call('GET', p, opts);
const post = (p, opts) => call('POST', p, opts);
const put  = (p, opts) => call('PUT', p, opts);

const listUploads = () => new Set(
  UPLOAD_DIRS.flatMap(dir => (fs.existsSync(dir) ? fs.readdirSync(dir).map(f => path.join(dir, f)) : []))
);

// ─── Server lifecycle ─────────────────────────────────────────────────────────
let server;
let serverLog = '';

const startServer = async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT:           String(PORT),
      MONGO_URI,
      JWT_SECRET:     'e2e-test-secret',
      JWT_EXPIRES_IN: '1h',
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      BASE_URL:       BASE,
    },
  });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on port ${PORT}:\n${serverLog}`);
};

// ─── Test data ────────────────────────────────────────────────────────────────
const users = {
  patient:  { name: 'Ayesha Khan',  email: 'Ayesha.E2E@Example.com', password: 'secret123', role: 'patient', cnic: '3520212345671', city: 'Lahore', address: 'Model Town' },
  patient2: { name: 'Bilal Ahmed',  email: 'bilal.e2e@example.com',  password: 'secret123', role: 'patient', cnic: '35202-7654321-3' },
  lab:      { name: 'Chughtai Rep', email: 'lab.e2e@example.com',    password: 'secret123', role: 'lab',     labName: 'E2E Diagnostics', location: 'Lahore' },
  doctor:   { name: 'Sara Malik',   email: 'doc.e2e@example.com',    password: 'secret123', role: 'doctor',  specialization: 'Cardiology', experience: 7 },
  lawyer:   { name: 'Usman Tariq',  email: 'law.e2e@example.com',    password: 'secret123', role: 'lawyer',  barNumber: 'LHC-1234' },
};
const tokens = {};
const ids    = {};

// ─── Step 1 — accounts, CNIC review, patient features ────────────────────────
const testAccounts = async () => {
  section('Health & registration');
  const health = await get('/api/health');
  check('health check responds', health.status === 200 && health.data.status === 'ok', health);

  const reg = await post('/api/auth/register', { body: users.patient });
  check('patient registers and is active', reg.status === 201 && reg.data.user.status === 'active', reg);
  ids.patient = reg.data.user?.id;

  const reg2 = await post('/api/auth/register', { body: users.patient2 });
  check('second patient registers', reg2.status === 201, reg2);
  ids.patient2 = reg2.data.user?.id;

  const dupCnic = await post('/api/auth/register', { body: { ...users.patient, email: 'other@example.com', cnic: '35202-1234567-1' } });
  check('duplicate CNIC is rejected (409)', dupCnic.status === 409, dupCnic);

  const badCnic = await post('/api/auth/register', { body: { ...users.patient, email: 'bad@example.com', cnic: '12345' } });
  check('invalid CNIC is rejected (400)', badCnic.status === 400, badCnic);

  const noCnic = await post('/api/auth/register', { body: { ...users.patient, email: 'nocnic@example.com', cnic: undefined } });
  check('patient without CNIC is rejected (400)', noCnic.status === 400, noCnic);

  const dupEmail = await post('/api/auth/register', { body: { ...users.patient, email: 'ayesha.e2e@example.com', cnic: '3520211111111' } });
  check('duplicate email (case-insensitive) is rejected (409)', dupEmail.status === 409, dupEmail);

  const badRole = await post('/api/auth/register', { body: { ...users.patient, role: 'admin', email: 'x@example.com' } });
  check('admin role cannot self-register (400)', badRole.status === 400, badRole);

  for (const role of ['lab', 'doctor', 'lawyer']) {
    const r = await post('/api/auth/register', { body: users[role] });
    check(`${role} registers as pending`, r.status === 201 && r.data.user.status === 'pending', r);
    ids[role] = r.data.user?.id;
  }

  const pendingLogin = await post('/api/auth/login', { body: { email: users.lab.email, password: users.lab.password } });
  check('pending provider cannot log in (403)', pendingLogin.status === 403, pendingLogin);

  section('Admin login & approvals');
  const badAdmin = await post('/api/admin/login', { body: { username: ADMIN.username, password: 'wrong' } });
  check('admin login with wrong password fails (401)', badAdmin.status === 401, badAdmin);

  const admin = await post('/api/admin/login', { body: ADMIN });
  check('admin logs in', admin.status === 200 && admin.data.token, admin);
  tokens.admin = admin.data.token;

  const viaAuth = await post('/api/auth/login', { body: { email: 'admin@carefirst.pk', password: ADMIN.password } });
  check('admin cannot use the regular login (400)', viaAuth.status === 400, viaAuth);

  const regs = await get('/api/admin/registrations', { token: tokens.admin });
  check('registrations list has the 3 providers and no patients',
    regs.status === 200 && regs.data.length === 3 && regs.data.every(u => u.role !== 'patient'), regs.data);

  for (const role of ['lab', 'doctor', 'lawyer']) {
    const r = await put(`/api/admin/registrations/${ids[role]}/approve`, { token: tokens.admin });
    check(`admin approves ${role}`, r.status === 200 && r.data.user.status === 'active', r);
  }

  section('Logins & guards');
  const pLogin = await post('/api/auth/login', { body: { email: users.patient.email.toUpperCase(), password: users.patient.password } });
  check('patient logs in with differently-cased email', pLogin.status === 200 && pLogin.data.token, pLogin);
  tokens.patient = pLogin.data.token;

  for (const role of ['patient2', 'lab', 'doctor', 'lawyer']) {
    const r = await post('/api/auth/login', { body: { email: users[role].email, password: users[role].password } });
    check(`${role} logs in`, r.status === 200 && r.data.token, r);
    tokens[role] = r.data.token;
  }

  const wrongPw = await post('/api/auth/login', { body: { email: users.patient.email, password: 'nope' } });
  check('wrong password fails (401)', wrongPw.status === 401, wrongPw);

  const me = await get('/api/auth/me', { token: tokens.patient });
  check('GET /auth/me returns patient profile with normalized CNIC',
    me.status === 200 && me.data.profile?.cnic === '35202-1234567-1', me.data);

  const noToken = await get('/api/patient/profile');
  check('missing token is rejected (401)', noToken.status === 401, noToken);

  const wrongRole = await get('/api/admin/wallets', { token: tokens.patient });
  check('patient cannot reach admin routes (403)', wrongRole.status === 403, wrongRole);
};

const testCnicReview = async () => {
  section('Patient profile & CNIC review');
  const profile = await get('/api/patient/profile', { token: tokens.patient });
  check('patient profile starts unverified', profile.status === 200 && profile.data.profile.cnicStatus === 'unverified', profile.data);

  const upd = await put('/api/patient/profile', { token: tokens.patient, body: { city: 'Chiniot', phone: '03001234567' } });
  check('patient updates city and phone', upd.status === 200 && upd.data.profile.city === 'Chiniot' && upd.data.user.phone === '03001234567', upd.data);

  const usersList = await get('/api/admin/users?role=patient', { token: tokens.admin });
  const listed = usersList.data.users?.find(u => u._id === ids.patient);
  check('admin users list includes patient CNIC status', listed?.profile?.cnicStatus === 'unverified', usersList.data);

  const rej = await put(`/api/admin/patients/${ids.patient}/cnic/reject`, { token: tokens.admin, body: { reason: 'Number does not match NADRA.' } });
  check('admin rejects CNIC', rej.status === 200 && rej.data.profile.cnicStatus === 'rejected', rej);

  const dup = await put('/api/patient/profile', { token: tokens.patient, body: { cnic: users.patient2.cnic } });
  check("patient cannot take another patient's CNIC (409)", dup.status === 409, dup);

  const fix = await put('/api/patient/profile', { token: tokens.patient, body: { cnic: '35202-1234567-9' } });
  check('corrected CNIC goes back to unverified', fix.status === 200 && fix.data.profile.cnicStatus === 'unverified' && fix.data.profile.cnic === '35202-1234567-9', fix.data);

  const ver = await put(`/api/admin/patients/${ids.patient}/cnic/verify`, { token: tokens.admin });
  check('admin verifies CNIC', ver.status === 200 && ver.data.profile.cnicStatus === 'verified', ver);

  const again = await put(`/api/admin/patients/${ids.patient}/cnic/verify`, { token: tokens.admin });
  check('verifying twice is rejected (400)', again.status === 400, again);

  const locked = await put('/api/patient/profile', { token: tokens.patient, body: { cnic: '3520200000001' } });
  check('verified CNIC is locked (400)', locked.status === 400, locked);

  const notifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient got CNIC rejected + verified notifications',
    ['cnic_rejected', 'cnic_verified'].every(t => notifs.data.some(n => n.type === t)), notifs.data);
};

const testLabAndDoctor = async () => {
  section('Lab catalog, doctor, prescriptions, reports');
  const test = await post('/api/lab/tests', {
    token: tokens.lab,
    body:  { name: 'MRI Brain', category: 'Radiology', price: 25000, installmentEnabled: true, installmentCount: 3, installmentTenureDays: 30 },
  });
  check('lab adds an installment-enabled test', test.status === 201 && test.data.installmentEnabled === true, test);
  ids.mriTest = test.data._id;

  const cheap = await post('/api/lab/tests', { token: tokens.lab, body: { name: 'CBC', category: 'Blood', price: 1500 } });
  check('lab adds a regular test', cheap.status === 201 && cheap.data.installmentEnabled === false, cheap);
  ids.cbcTest = cheap.data._id;

  const pub = await get('/api/public/tests');
  const lab = pub.data.find?.(l => l.labId === ids.lab);
  check('public tests list the active lab and its tests', lab?.tests.length === 2, pub.data);

  const avail = await put('/api/doctor/availability', {
    token: tokens.doctor,
    body:  { availability: [{ day: 'Monday', slots: [{ time: '09:00 AM' }] }, { day: 'Tuesday', slots: [] }] },
  });
  check('doctor sets availability', avail.status === 200, avail);
  await put('/api/doctor/fee', { token: tokens.doctor, body: { consultationFee: 2000 } });

  const docs = await get('/api/public/doctors');
  const doc = docs.data.find?.(d => d.doctorId === ids.doctor);
  check('public doctors show fee and available days only',
    doc?.consultationFee === 2000 && JSON.stringify(doc.availableDays) === '["Monday"]', docs.data);

  const rx = await post('/api/doctor/prescriptions', {
    token: tokens.doctor,
    body:  { patientId: ids.patient, tests: [{ testName: 'MRI Brain', notes: 'Recurring headaches' }] },
  });
  check('doctor issues a prescription', rx.status === 201, rx);

  const rxList = await get('/api/patient/prescriptions', { token: tokens.patient });
  check('patient sees prescription with doctor specialization',
    rxList.data[0]?.doctorSpecialization === 'Cardiology', rxList.data);

  const report = await post('/api/lab/reports/upload', {
    token: tokens.lab,
    body:  { patientId: ids.patient, testName: 'CBC', notes: 'Normal' },
    files: { report: ['cbc.png'] },
  });
  check('lab uploads a report', report.status === 201 && report.data.reportUrl?.startsWith(`${BASE}/uploads/reports/`), report);

  const reports = await get('/api/patient/reports', { token: tokens.patient });
  check('patient sees report with lab name', reports.data[0]?.labName === users.lab.labName, reports.data);

  const read = await put(`/api/patient/reports/${report.data._id}/read`, { token: tokens.patient });
  check('patient marks report read', read.status === 200, read);

  const badId = await put('/api/patient/reports/not-an-id/read', { token: tokens.patient });
  check('invalid report id returns 404', badId.status === 404, badId);

  const docReports = await get('/api/doctor/reports', { token: tokens.doctor });
  check("doctor sees reports of patients they prescribed for", docReports.data.length === 1, docReports.data);
};

const testCommunitySupport = async () => {
  section('Community support');
  const before = listUploads().size;
  const unverified = await post('/api/patient/community-applications', {
    token: tokens.patient2,
    body:  { testRequired: 'CBC' },
    files: { documents: ['bill.png'] },
  });
  check('unverified CNIC cannot apply (403)', unverified.status === 403, unverified);
  await new Promise(r => setTimeout(r, 100));
  check('rejected upload is deleted from disk', listUploads().size === before);

  const noDocs = await post('/api/patient/community-applications', { token: tokens.patient, body: { testRequired: 'CBC' }, files: {} });
  check('application without documents is rejected (400)', noDocs.status === 400, noDocs);

  const badType = await post('/api/patient/community-applications', {
    token: tokens.patient,
    body:  { testRequired: 'CBC' },
    files: { documents: ['notes.txt'] },
  });
  check('wrong file type returns a JSON 400', badType.status === 400 && badType.json, badType);

  const app = await post('/api/patient/community-applications', {
    token: tokens.patient,
    body:  { testRequired: 'CBC' },
    files: { documents: ['bill.png', 'statement.png'] },
  });
  check('verified patient applies with 2 documents', app.status === 201 && app.data.documents.length === 2, app);

  const second = await post('/api/patient/community-applications', {
    token: tokens.patient,
    body:  { testRequired: 'MRI' },
    files: { documents: ['bill.png'] },
  });
  check('only one pending application at a time (409)', second.status === 409, second);

  const adminList = await get('/api/admin/community-applications?status=pending', { token: tokens.admin });
  check('admin sees application with patient CNIC',
    adminList.data[0]?.patient?.cnic === '35202-1234567-9', adminList.data);

  const approve = await put(`/api/admin/community-applications/${app.data._id}/approve`, { token: tokens.admin, body: { assignedLabId: ids.lab } });
  check('admin approves and generates a slip', approve.status === 200 && approve.data.application.slip?.slipId, approve);

  const needy = await get('/api/lab/needy-patients', { token: tokens.lab });
  check('lab sees needy patient with CNIC', needy.data[0]?.patient?.cnic === '35202-1234567-9', needy.data);

  const conducted = await put(`/api/lab/needy-patients/${app.data._id}/mark-conducted`, { token: tokens.lab });
  check('lab marks test conducted', conducted.status === 200, conducted);

  const mine = await get('/api/patient/community-applications', { token: tokens.patient });
  check('patient sees approved application with lab name',
    mine.data[0]?.status === 'approved' && mine.data[0]?.labName === users.lab.labName, mine.data);
};

// Wallet inserted directly (as before Step 2) to exercise the receipt chain
const testInstallmentReceipts = async () => {
  section('Installment receipt chain (direct wallet)');
  const Wallet = require('../models/Wallet');
  const due = (days) => new Date(Date.now() + days * 86400000);
  const wallet = await Wallet.create({
    patient: ids.patient, lab: ids.lab, testName: 'Direct Plan', totalAmount: 9000, status: 'active',
    installments: [
      { number: 1, dueDate: due(10), amount: 4500 },
      { number: 2, dueDate: due(40), amount: 4500 },
    ],
  });
  ids.directWallet = wallet._id.toString();

  const wallets = await get('/api/patient/wallets', { token: tokens.patient });
  check('patient sees wallet with lab name',
    wallets.data.some(w => w._id === ids.directWallet && w.labName === users.lab.labName), wallets.data);

  const noFile = await post(`/api/patient/wallets/${ids.directWallet}/installments/0/receipt`, { token: tokens.patient, files: {} });
  check('receipt upload without file is rejected (400)', noFile.status === 400, noFile);

  const other = await post(`/api/patient/wallets/${ids.directWallet}/installments/0/receipt`, { token: tokens.patient2, files: { receipt: ['r.png'] } });
  check("patient cannot upload to someone else's wallet (404)", other.status === 404, other);

  const up = await post(`/api/patient/wallets/${ids.directWallet}/installments/0/receipt`, { token: tokens.patient, files: { receipt: ['r.png'] } });
  check('patient uploads installment receipt', up.status === 200 && up.data.wallet.installments[0].receiptUrl, up);

  const replace = await post(`/api/patient/wallets/${ids.directWallet}/installments/0/receipt`, { token: tokens.patient, files: { receipt: ['r2.png'] } });
  check('receipt can be replaced before lab confirms',
    replace.status === 200 && replace.data.wallet.installments[0].receiptUrl !== up.data.wallet.installments[0].receiptUrl, replace);

  const labQueue = await get('/api/lab/receipts', { token: tokens.lab });
  const queued = labQueue.data.find?.(w => w.walletId === ids.directWallet);
  check('lab sees the receipt awaiting confirmation', queued?.pendingInstallments?.[0]?.index === 0, labQueue.data);

  const early = await put(`/api/admin/wallets/${ids.directWallet}/installments/0/verify`, { token: tokens.admin });
  check('admin cannot verify before lab confirms (400)', early.status === 400, early);

  const labOk = await put(`/api/lab/receipts/${ids.directWallet}/installments/0/approve`, { token: tokens.lab });
  check('lab confirms the receipt', labOk.status === 200 && labOk.data.wallet.installments[0].labApproved, labOk);

  const tooLate = await post(`/api/patient/wallets/${ids.directWallet}/installments/0/receipt`, { token: tokens.patient, files: { receipt: ['r3.png'] } });
  check('receipt cannot be replaced after lab confirms (400)', tooLate.status === 400, tooLate);

  const verify = await put(`/api/admin/wallets/${ids.directWallet}/installments/0/verify`, { token: tokens.admin });
  check('admin verifies → installment paid',
    verify.status === 200 && verify.data.wallet.installments[0].status === 'paid' && verify.data.wallet.remainingBalance === 4500, verify);

  const notifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient notified of lab confirmation and admin verification',
    ['receipt_lab_approved', 'receipt_admin_verified'].every(t => notifs.data.some(n => n.type === t)));
};

// ─── Step 2 — installment plans ──────────────────────────────────────────────
const guarantor = { name: 'Kamran Khan', cnic: '35202-5555555-5', phone: '0300 1234567', relation: 'Brother', address: 'Lahore' };
const planBody  = () => ({ labId: ids.lab, testId: ids.mriTest, guarantor });

const testPlanApplication = async () => {
  section('Installment plan application');
  const config = await get('/api/patient/installment-plans/config', { token: tokens.patient });
  check('config returns fee, down-payment rule and limit',
    config.data.serviceFee === 500 && config.data.downPaymentPercent === 20 &&
    config.data.maxOpenPlans === 2 && config.data.openPlans === 1 && config.data.careFirstAccount, config.data);

  const unverified = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: planBody() });
  check('unverified CNIC cannot apply (403)', unverified.status === 403, unverified);

  let pub = await get('/api/public/tests');
  check('lab without payment details does not accept installments',
    pub.data.find(l => l.labId === ids.lab)?.acceptsInstallments === false, pub.data);

  const noDetails = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: planBody() });
  check('application blocked while lab has no payment details (400)', noDetails.status === 400 && /payment details/.test(noDetails.data.message), noDetails);

  const labUpd = await put('/api/lab/profile', { token: tokens.lab, body: { jazzCash: '0301-7654321', bankDetails: { bankName: 'HBL', accountNumber: '1234-5678' } } });
  check('lab adds payment details', labUpd.status === 200 && labUpd.data.jazzCash === '0301-7654321', labUpd);

  pub = await get('/api/public/tests');
  check('lab now accepts installments', pub.data.find(l => l.labId === ids.lab)?.acceptsInstallments === true, pub.data);

  const notEnabled = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: { ...planBody(), testId: ids.cbcTest } });
  check('test without installments is rejected (400)', notEnabled.status === 400, notEnabled);

  const badTest = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: { ...planBody(), testId: ids.lab } });
  check('unknown test returns 404', badTest.status === 404, badTest);

  const cases = [
    ['missing guarantor name', { ...guarantor, name: ' ' }],
    ['invalid guarantor CNIC', { ...guarantor, cnic: '123' }],
    ["guarantor with the patient's own CNIC", { ...guarantor, cnic: '3520212345679' }],
    ['invalid guarantor phone', { ...guarantor, phone: '12' }],
    ['missing relation', { ...guarantor, relation: '' }],
  ];
  for (const [label, g] of cases) {
    const r = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: { ...planBody(), guarantor: g } });
    check(`${label} is rejected (400)`, r.status === 400, r);
  }

  const preview = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: planBody() });
  check('preview: 20% down payment and whole-rupee installments with remainder last',
    preview.status === 200 && preview.data.downPayment === 5000 &&
    JSON.stringify(preview.data.installments) === '[6666,6666,6668]' && preview.data.installmentTenureDays === 30, preview.data);
  check('agreement names patient CNIC, guarantor, lab and service fee',
    ['35202-1234567-9', 'Kamran Khan', '35202-5555555-5', 'E2E Diagnostics', 'PKR 500', 'PKR 6,668']
      .every(s => preview.data.agreementText?.includes(s)), preview.data.agreementText);

  const notAccepted = await post('/api/patient/installment-plans', { token: tokens.patient, body: { ...planBody(), agreementText: preview.data.agreementText } });
  check('applying without accepting the agreement is rejected (400)', notAccepted.status === 400, notAccepted);

  const tampered = await post('/api/patient/installment-plans', {
    token: tokens.patient,
    body:  { ...planBody(), acceptAgreement: true, agreementText: preview.data.agreementText + ' ' },
  });
  check('agreement text that does not match the terms is rejected (409)', tampered.status === 409, tampered);

  const apply = await post('/api/patient/installment-plans', {
    token: tokens.patient,
    body:  { ...planBody(), acceptAgreement: true, agreementText: preview.data.agreementText },
  });
  check('patient applies → pending_approval with stored agreement',
    apply.status === 201 && apply.data.status === 'pending_approval' &&
    apply.data.agreement?.text === preview.data.agreementText && apply.data.agreement?.acceptedAt &&
    apply.data.guarantor?.phone === '03001234567' && apply.data.installments.length === 0, apply.data);
  check("wallet carries the lab's payment details", apply.data.labPayment?.jazzCash === '0301-7654321', apply.data.labPayment);
  ids.plan = apply.data._id;

  const adminNotifs = await get('/api/admin/notifications', { token: tokens.admin });
  check('admins are notified of the application', adminNotifs.data.some(n => n.type === 'plan_submitted' && n.meta?.walletId === ids.plan));

  const early = await post(`/api/patient/wallets/${ids.plan}/installments/0/receipt`, { token: tokens.patient, files: { receipt: ['r.png'] } });
  check('no installment receipts on a plan that is not active (400)', early.status === 400, early);

  // Direct wallet + this application = 2 open plans
  const second = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: planBody() });
  check('third open plan is blocked by the 2-plan limit (409)', second.status === 409, second);
};

const testPlanReview = async () => {
  section('Admin review, service fee & activation');
  const feeTooEarly = await post(`/api/patient/wallets/${ids.plan}/service-fee/receipt`, { token: tokens.patient, files: { receipt: ['fee.png'] } });
  check('service fee cannot be paid before approval (400)', feeTooEarly.status === 400, feeTooEarly);

  const pending = await get('/api/admin/wallets?status=pending_approval', { token: tokens.admin });
  const listed = pending.data.wallets?.find(w => w._id === ids.plan);
  check('admin sees the application with patient CNIC, lab name and agreement',
    listed?.patient?.cnic === '35202-1234567-9' && listed?.labName === 'E2E Diagnostics' && listed?.agreement?.text, listed);

  // A second patient applies so there is one application to reject
  await put(`/api/admin/patients/${ids.patient2}/cnic/verify`, { token: tokens.admin });
  const body2 = { ...planBody(), guarantor: { ...guarantor, cnic: '35202-6666666-6' } };
  const preview2 = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: body2 });
  const apply2 = await post('/api/patient/installment-plans', {
    token: tokens.patient2,
    body:  { ...body2, acceptAgreement: true, agreementText: preview2.data.agreementText },
  });
  check('second patient applies', apply2.status === 201, apply2);

  const noReason = await put(`/api/admin/wallets/${apply2.data._id}/reject`, { token: tokens.admin, body: {} });
  check('rejecting without a reason is refused (400)', noReason.status === 400, noReason);

  const rejected = await put(`/api/admin/wallets/${apply2.data._id}/reject`, { token: tokens.admin, body: { reason: 'Guarantor could not be reached.' } });
  check('admin rejects the application with a reason',
    rejected.status === 200 && rejected.data.wallet.status === 'rejected' && rejected.data.wallet.rejectionReason === 'Guarantor could not be reached.', rejected);

  const p2Notifs = await get('/api/patient/notifications', { token: tokens.patient2 });
  check('patient is told why the plan was rejected',
    p2Notifs.data.some(n => n.type === 'plan_rejected' && n.message.includes('Guarantor could not be reached.')), p2Notifs.data);

  const approveRejected = await put(`/api/admin/wallets/${apply2.data._id}/approve`, { token: tokens.admin });
  check('a rejected application cannot be approved (400)', approveRejected.status === 400, approveRejected);

  const p2Config = await get('/api/patient/installment-plans/config', { token: tokens.patient2 });
  check('rejected applications do not count toward the limit', p2Config.data.openPlans === 0, p2Config.data);

  const approve = await put(`/api/admin/wallets/${ids.plan}/approve`, { token: tokens.admin });
  check('admin approves → awaiting_fee',
    approve.status === 200 && approve.data.wallet.status === 'awaiting_fee' && approve.data.wallet.planApprovedAt, approve);

  const again = await put(`/api/admin/wallets/${ids.plan}/approve`, { token: tokens.admin });
  check('approving twice is refused (400)', again.status === 400, again);

  const pNotifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient is told to pay the service fee', pNotifs.data.some(n => n.type === 'plan_approved' && n.message.includes('PKR 500')), pNotifs.data);

  const verifyEarly = await put(`/api/admin/wallets/${ids.plan}/service-fee/verify`, { token: tokens.admin });
  check('fee cannot be verified before a receipt is uploaded (400)', verifyEarly.status === 400, verifyEarly);

  const fee = await post(`/api/patient/wallets/${ids.plan}/service-fee/receipt`, { token: tokens.patient, files: { receipt: ['fee.png'] } });
  check('patient uploads the service fee screenshot', fee.status === 200 && fee.data.wallet.serviceFee.receiptUrl, fee);

  const adminNotifs = await get('/api/admin/notifications', { token: tokens.admin });
  check('admins are notified of the fee receipt', adminNotifs.data.some(n => n.type === 'service_fee_uploaded'));

  const feeReject = await put(`/api/admin/wallets/${ids.plan}/service-fee/reject`, { token: tokens.admin, body: { reason: 'Amount does not match.' } });
  check('admin rejects an unclear fee screenshot',
    feeReject.status === 200 && !feeReject.data.wallet.serviceFee.receiptUrl &&
    feeReject.data.wallet.serviceFee.rejectionReason === 'Amount does not match.' && feeReject.data.wallet.status === 'awaiting_fee', feeReject);

  const reup = await post(`/api/patient/wallets/${ids.plan}/service-fee/receipt`, { token: tokens.patient, files: { receipt: ['fee2.png'] } });
  check('patient re-uploads; rejection reason clears',
    reup.status === 200 && reup.data.wallet.serviceFee.receiptUrl && !reup.data.wallet.serviceFee.rejectionReason, reup);

  const verify = await put(`/api/admin/wallets/${ids.plan}/service-fee/verify`, { token: tokens.admin });
  const w = verify.data.wallet;
  check('admin verifies the fee → plan active with 3 installments',
    verify.status === 200 && w.status === 'active' && w.serviceFee.adminVerified && w.activatedAt &&
    JSON.stringify(w.installments.map(i => i.amount)) === '[6666,6666,6668]', verify);
  const DAY = 86400000;
  check('installments are due every 30 days from activation',
    w?.installments.every((i, n) => new Date(i.dueDate) - new Date(w.activatedAt) === 30 * DAY * (n + 1)), w?.installments);
  check('balance excludes the service fee', w?.remainingBalance === 25000, w?.remainingBalance);

  const labNotifs = await get('/api/lab/notifications', { token: tokens.lab });
  check('lab is notified of the new plan', labNotifs.data.some(n => n.type === 'plan_activated' && n.meta?.walletId === ids.plan), labNotifs.data);

  const pNotifs2 = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient is told the plan is active', pNotifs2.data.some(n => n.type === 'plan_activated'), pNotifs2.data);

  const feeAfter = await post(`/api/patient/wallets/${ids.plan}/service-fee/receipt`, { token: tokens.patient, files: { receipt: ['fee3.png'] } });
  check('fee receipt cannot be replaced after verification (400)', feeAfter.status === 400, feeAfter);

  const badId = await put('/api/admin/wallets/not-an-id/approve', { token: tokens.admin });
  check('invalid wallet id returns 404', badId.status === 404, badId);
};

const testDownPaymentAndCompletion = async () => {
  section('Down payment & plan completion');
  const up = await post(`/api/patient/wallets/${ids.plan}/down-payment/receipt`, { token: tokens.patient, files: { receipt: ['down.png'] } });
  check('patient uploads the down payment receipt', up.status === 200 && up.data.wallet.downPayment.receiptUrl, up);

  const labNotifs = await get('/api/lab/notifications', { token: tokens.lab });
  check('lab is asked to confirm the down payment',
    labNotifs.data.some(n => n.type === 'receipt_uploaded' && n.meta?.payment === 'down_payment' && n.message.includes('PKR 5,000')), labNotifs.data);

  const queue = await get('/api/lab/receipts', { token: tokens.lab });
  const queued = queue.data.find?.(w => w.walletId === ids.plan);
  check('lab receipt queue shows the down payment', queued?.pendingDownPayment?.amount === 5000 && queued.pendingInstallments.length === 0, queue.data);

  const early = await put(`/api/admin/wallets/${ids.plan}/down-payment/verify`, { token: tokens.admin });
  check('admin cannot verify the down payment before the lab (400)', early.status === 400, early);

  const labOk = await put(`/api/lab/receipts/${ids.plan}/down-payment/approve`, { token: tokens.lab });
  check('lab confirms the down payment', labOk.status === 200 && labOk.data.wallet.downPayment.labApproved, labOk);

  const replace = await post(`/api/patient/wallets/${ids.plan}/down-payment/receipt`, { token: tokens.patient, files: { receipt: ['down2.png'] } });
  check('down payment receipt cannot be replaced after lab confirms (400)', replace.status === 400, replace);

  const verify = await put(`/api/admin/wallets/${ids.plan}/down-payment/verify`, { token: tokens.admin });
  check('admin verifies the down payment → balance drops by 5,000',
    verify.status === 200 && verify.data.wallet.downPayment.adminVerified && verify.data.wallet.remainingBalance === 20000 &&
    verify.data.wallet.status === 'active', verify);

  for (let i = 0; i < 3; i++) {
    await post(`/api/patient/wallets/${ids.plan}/installments/${i}/receipt`, { token: tokens.patient, files: { receipt: [`inst${i}.png`] } });
    await put(`/api/lab/receipts/${ids.plan}/installments/${i}/approve`, { token: tokens.lab });
    const r = await put(`/api/admin/wallets/${ids.plan}/installments/${i}/verify`, { token: tokens.admin });
    if (i < 2) check(`installment #${i + 1} paid, plan still active`, r.status === 200 && r.data.wallet.status === 'active', r);
    else check('last installment paid → plan completed with zero balance',
      r.status === 200 && r.data.wallet.status === 'completed' && r.data.wallet.remainingBalance === 0, r);
  }

  const pNotifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient is told the plan is fully paid', pNotifs.data.some(n => n.message.includes('fully paid')), pNotifs.data);

  const config = await get('/api/patient/installment-plans/config', { token: tokens.patient });
  check('completed plan no longer counts toward the limit', config.data.openPlans === 1, config.data);
};

const testDefaulterEscalation = async () => {
  section('Defaulter escalation (nightly job)');
  const Wallet = require('../models/Wallet');
  const { runDefaulterCheck } = require('../jobs/defaulterJob');

  const wallet = await Wallet.create({
    patient: ids.patient2, lab: ids.lab, testName: 'Overdue Plan', totalAmount: 6000, status: 'active',
    guarantor: { name: 'Kamran', cnic: '35202-1111111-1', phone: '03000000000', relation: 'Brother' },
    installments: [
      { number: 1, dueDate: new Date(Date.now() - 5 * 86400000), amount: 3000 },
      { number: 2, dueDate: new Date(Date.now() + 25 * 86400000), amount: 3000 },
    ],
  });

  await runDefaulterCheck();

  const after = await Wallet.findById(wallet._id);
  check('overdue wallet becomes defaulter', after.status === 'defaulter' && after.installments[0].status === 'overdue', after);

  const cases = await get('/api/lawyer/defaulter-cases', { token: tokens.lawyer });
  const kase = cases.data.find?.(c => c.wallet?._id === wallet._id.toString());
  check('case assigned to the lawyer with patient CNIC and legal text',
    kase && kase.patient.cnic === '35202-7654321-3' && kase.legalAgreementText.includes('Kamran'), cases.data);

  const one = await get(`/api/lawyer/defaulter-cases/${kase?._id}`, { token: tokens.lawyer });
  check('lawyer opens case detail', one.status === 200 && one.data.wallet.lab, one);

  const adminCases = await get('/api/admin/defaulter-cases', { token: tokens.admin });
  check('admin sees the defaulter case', adminCases.data.length === 1, adminCases.data);

  await runDefaulterCheck();
  check('re-running the job does not duplicate the case',
    (await get('/api/admin/defaulter-cases', { token: tokens.admin })).data.length === 1);

  const blocked = await post(`/api/patient/wallets/${wallet._id}/installments/1/receipt`, { token: tokens.patient2, files: { receipt: ['r.png'] } });
  check('defaulter wallet blocks receipt upload (400)', blocked.status === 400, blocked);

  const readAll = await put('/api/lawyer/notifications/read-all', { token: tokens.lawyer });
  const lawyerNotifs = await get('/api/lawyer/notifications', { token: tokens.lawyer });
  check('lawyer marks all notifications read',
    readAll.status === 200 && lawyerNotifs.data.length > 0 && lawyerNotifs.data.every(n => n.read), lawyerNotifs.data);
};

const testMisc = async () => {
  section('Notifications & error handling');
  const readAll = await put('/api/patient/notifications/read-all', { token: tokens.patient });
  const notifs  = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient marks all notifications read', readAll.status === 200 && notifs.data.every(n => n.read));

  const badNotif = await put('/api/patient/notifications/xyz/read', { token: tokens.patient });
  check('invalid notification id returns 404', badNotif.status === 404, badNotif);

  const unknown = await get('/api/nope');
  check('unknown route returns JSON 404', unknown.status === 404 && unknown.json, unknown);

  const badJson = await call('POST', '/api/auth/login', { raw: '{"email":' });
  check('malformed JSON body returns JSON 400', badJson.status === 400 && badJson.json, badJson);
};

// ─── Runner ───────────────────────────────────────────────────────────────────
const main = async () => {
  const uploadsBefore = listUploads();
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();

  try {
    await startServer();
    await testAccounts();
    await testCnicReview();
    await testLabAndDoctor();
    await testCommunitySupport();
    await testInstallmentReceipts();
    await testPlanApplication();
    await testPlanReview();
    await testDownPaymentAndCompletion();
    await testDefaulterEscalation();
    await testMisc();
  } catch (err) {
    failures.push(`crashed: ${err.message}`);
    console.error(err);
  } finally {
    server?.kill();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const file of listUploads()) {
      if (!uploadsBefore.has(file)) fs.unlinkSync(file);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed:\n' + failures.map(f => `  - ${f}`).join('\n'));
    if (process.env.E2E_SHOW_SERVER_LOG) console.log(`\nServer log:\n${serverLog}`);
    process.exit(1);
  }
};

main();
