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
      names.forEach(item => typeof item === 'string'
        ? payload.append(field, new Blob([PNG]), item)
        : payload.append(field, new Blob([item.data]), item.name));
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
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data, type, json: type.includes('application/json') };
};

const get  = (p, opts) => call('GET', p, opts);
const post = (p, opts) => call('POST', p, opts);
const put  = (p, opts) => call('PUT', p, opts);
const del  = (p, opts) => call('DELETE', p, opts);

const listUploads = () => new Set(
  UPLOAD_DIRS.flatMap(dir => (fs.existsSync(dir) ? fs.readdirSync(dir).map(f => path.join(dir, f)) : []))
);

// ─── Fake external services (OSRM routing, Azure) ─────────────────────────────
// The server under test is pointed here, so tests run offline and never touch
// the real services or spend Azure quota.
const http = require('http');
const MOCK_PORT = 5098;
const MOCK      = `http://127.0.0.1:${MOCK_PORT}`;
const mock = { osrmDown: false, osrmCalls: 0, translatorDown: false, translations: 0, speechDown: false, speechCalls: 0, lastSsml: '',
  docIntelResult: null, docIntelCalls: 0, docIntelOps: {} }; // docIntelResult null → the reading fails
let mockServer;
const AUDIO_DIR = path.join(require('os').tmpdir(), `carefirst-e2e-audio-${process.pid}`);
const CNIC_DIR  = path.join(require('os').tmpdir(), `carefirst-e2e-cnic-${process.pid}`);
const cnicFileCount = () => (fs.existsSync(CNIC_DIR) ? fs.readdirSync(CNIC_DIR).length : 0);

// Fake road distance = straight line × 1.5 (the server's own fallback uses × 1.3)
const fakeRoadKm = (a, b) => require('../utils/travel').haversineKm(a, b) * 1.5;

const handleMock = async (req, res) => {
  const url = new URL(req.url, MOCK);
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');

  // Azure Translator: "[ur] <English>" so tests can recognise the translation
  if (req.method === 'POST' && url.pathname === '/translate') {
    if (req.headers['ocp-apim-subscription-key'] !== 'test-translator-key') return send(401, { error: 'bad key' });
    if (mock.translatorDown) return send(500, { error: 'down' });
    mock.translations++;
    return send(200, JSON.parse(body).map(item => ({ translations: [{ text: `[ur] ${item.Text}`, to: 'ur' }] })));
  }

  // Azure Document Intelligence: returns mock.docIntelResult for every page group
  if (req.method === 'POST' && url.pathname === '/documentintelligence/documentModels/prebuilt-layout:analyze') {
    if (req.headers['ocp-apim-subscription-key'] !== 'test-docintel-key') return send(401, { error: 'bad key' });
    mock.docIntelCalls++;
    mock.docIntelLastBytes = Buffer.from(JSON.parse(body).base64Source, 'base64').length;
    if (!mock.docIntelResult) return send(500, { error: 'down' });
    const id = mock.docIntelCalls;
    mock.docIntelOps[id] = mock.docIntelResult;
    res.writeHead(202, { 'Operation-Location': `${MOCK}/docintel-ops/${id}` });
    return res.end();
  }
  const op = url.pathname.match(/^\/docintel-ops\/(\d+)$/);
  if (op) return send(200, { status: 'succeeded', analyzeResult: mock.docIntelOps[op[1]] });

  // Azure Speech: fake MP3 bytes
  if (req.method === 'POST' && url.pathname === '/cognitiveservices/v1') {
    if (req.headers['ocp-apim-subscription-key'] !== 'test-speech-key') return send(401, { error: 'bad key' });
    if (mock.speechDown) return send(500, { error: 'down' });
    mock.speechCalls++;
    mock.lastSsml = body;
    return send(200, Buffer.from(`ID3fake-mp3-${mock.speechCalls}`), 'audio/mpeg');
  }

  const table = url.pathname.match(/^\/table\/v1\/driving\/(.+)$/);
  if (table) {
    mock.osrmCalls++;
    if (mock.osrmDown) return send(503, { code: 'Unavailable' });
    const pts = table[1].split(';').map(p => { const [lng, lat] = p.split(',').map(Number); return { lat, lng }; });
    const km = pts.map(p => fakeRoadKm(pts[0], p));
    return send(200, { code: 'Ok', distances: [km.map(k => k * 1000)], durations: [km.map(k => k * 90)] });
  }
  send(404, { message: 'mock: unknown route' });
};

const startMock = () => new Promise(resolve => {
  mockServer = http.createServer(handleMock).listen(MOCK_PORT, '127.0.0.1', resolve);
});

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
      OSRM_URL:       MOCK,
      // Pinned so local .env changes (fee, rates) never change what the tests expect
      SERVICE_FEE_PKR:       '500',
      DOWN_PAYMENT_PERCENT:  '20',
      TRAVEL_RATE_MOTORBIKE: '8',
      TRAVEL_RATE_CAR:       '25',
      TRAVEL_RATE_RIDE:      '50',
      // Fake Azure — overrides the real keys in .env so tests never spend quota
      AZURE_TRANSLATOR_KEY:      'test-translator-key',
      AZURE_TRANSLATOR_REGION:   'test',
      AZURE_TRANSLATOR_ENDPOINT: MOCK,
      AZURE_SPEECH_KEY:          'test-speech-key',
      AZURE_SPEECH_REGION:       'test',
      AZURE_SPEECH_ENDPOINT:     MOCK,
      AUDIO_CACHE_DIR:           AUDIO_DIR,
      CNIC_STORAGE_DIR:          CNIC_DIR,
      AZURE_DOCINTEL_KEY:        'test-docintel-key',
      AZURE_DOCINTEL_ENDPOINT:   MOCK,
      AZURE_DOCINTEL_POLL_MS:    '20',
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

  const report = await post('/api/lab/reports/upload', {
    token: tokens.lab,
    body:  { patientId: ids.patient, testName: 'CBC', notes: 'Normal' },
    files: { report: ['cbc.png'] },
  });
  check('lab uploads a report', report.status === 201 && report.data.reportUrl?.startsWith(`${BASE}/uploads/reports/`), report);
  ids.firstReport = report.data._id;

  const reports = await get('/api/patient/reports', { token: tokens.patient });
  check('patient sees report with lab name', reports.data[0]?.labName === users.lab.labName, reports.data);

  const read = await put(`/api/patient/reports/${report.data._id}/read`, { token: tokens.patient });
  check('patient marks report read', read.status === 200, read);

  const badId = await put('/api/patient/reports/not-an-id/read', { token: tokens.patient });
  check('invalid report id returns 404', badId.status === 404, badId);
};

// ─── Step 3 — doctor appointments ────────────────────────────────────────────
const testAppointments = async () => {
  section('Doctor appointments');
  const Appointment = require('../models/Appointment');
  const { pktDate, addDays, pktInstant } = require('../utils/schedule');
  const today    = pktDate();
  const tomorrow = addDays(today, 1);
  const book = (token, time, date = tomorrow, doctorId = ids.doctor) =>
    post('/api/patient/appointments', { token, body: { doctorId, date, time } });

  // Every day: 12:00–12:30 AM (always in the past today) and 9–11 AM, 30-minute consultations
  const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map(day => ({ day, slots: [{ time: '12:00 AM – 12:30 AM' }, { time: '09:00 AM – 11:00 AM' }] }));
  const badDuration = await put('/api/doctor/availability', { token: tokens.doctor, body: { availability: week, consultationDuration: 3 } });
  check('consultation duration outside 5–120 minutes is rejected (400)', badDuration.status === 400, badDuration);
  const avail = await put('/api/doctor/availability', { token: tokens.doctor, body: { availability: week, consultationDuration: 30 } });
  check('doctor saves availability with a 30-minute duration', avail.status === 200 && avail.data.consultationDuration === 30, avail.data);

  const slots = await get(`/api/public/doctors/${ids.doctor}/slots`);
  const tomorrowSlots = () => slots.data.days?.find(d => d.date === tomorrow)?.times.map(t => t.time);
  check('slots cover 14 days and split ranges by the duration',
    slots.status === 200 && slots.data.days.length === 14 && slots.data.consultationFee === 2000 &&
    JSON.stringify(tomorrowSlots()) === '["00:00","09:00","09:30","10:00","10:30"]', slots.data.days?.[1]);
  check("today's slots never include past times", !slots.data.days[0].times.some(t => t.time === '00:00'), slots.data.days[0]);
  check('unknown doctor has no slots (404)', (await get(`/api/public/doctors/${ids.lab}/slots`)).status === 404);

  const booked = await book(tokens.patient, '09:00');
  check('patient books a free slot → confirmed with the fee',
    booked.status === 201 && booked.data.status === 'confirmed' && booked.data.fee === 2000 &&
    new Date(booked.data.startsAt).getTime() === pktInstant(tomorrow, '09:00').getTime() &&
    booked.data.doctorSpecialization === 'Cardiology', booked);
  ids.apptBooked = booked.data._id;

  const docNotifs = await get('/api/doctor/notifications', { token: tokens.doctor });
  const patNotifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('doctor and patient are notified of the booking',
    docNotifs.data.some(n => n.type === 'appointment_booked') && patNotifs.data.some(n => n.type === 'appointment_booked' && n.message.includes('PKR 2,000')));

  const after = await get(`/api/public/doctors/${ids.doctor}/slots`);
  check('a booked slot disappears from the free slots',
    !after.data.days.find(d => d.date === tomorrow).times.some(t => t.time === '09:00'));

  const taken = await book(tokens.patient2, '09:00');
  check('another patient cannot book a taken slot (409)', taken.status === 409, taken);

  const same = await book(tokens.patient, '09:00');
  check('the same patient cannot double-book (409)', same.status === 409, same);

  const [raceA, raceB] = await Promise.all([book(tokens.patient, '09:30'), book(tokens.patient2, '09:30')]);
  check('two simultaneous bookings for one slot: exactly one wins',
    [raceA.status, raceB.status].sort().join() === '201,409', [raceA.status, raceB.status]);
  const winner = raceA.status === 201 ? raceA.data : raceB.data;

  let dbBlocked = false;
  try {
    await Appointment.create({ patient: ids.patient2, doctor: ids.doctor, date: tomorrow, time: '09:00', startsAt: pktInstant(tomorrow, '09:00'), durationMinutes: 30 });
  } catch (err) { dbBlocked = err.code === 11000; }
  check('the database itself rejects a second confirmed booking for a slot', dbBlocked);

  check('a time outside availability is rejected (400)', (await book(tokens.patient, '09:15')).status === 400);
  check('a date beyond 14 days is rejected (400)', (await book(tokens.patient, '09:00', addDays(today, 20))).status === 400);
  check('a past date is rejected (400)', (await book(tokens.patient, '09:00', addDays(today, -1))).status === 400);
  const past = await book(tokens.patient, '00:00', today);
  check('a time that already passed today is rejected (400)', past.status === 400 && /passed/.test(past.data.message), past);
  check('booking an unknown doctor returns 404', (await book(tokens.patient, '09:00', tomorrow, ids.lab)).status === 404);

  section('Appointment cancellation & closing');
  const toCancel = await book(tokens.patient, '10:00');
  const cancel = await put(`/api/patient/appointments/${toCancel.data._id}/cancel`, { token: tokens.patient });
  check('patient cancels more than 2 hours ahead', cancel.status === 200 && cancel.data.appointment.status === 'cancelled' && cancel.data.appointment.cancelledBy === 'patient', cancel);
  check('cancelling twice is refused (400)', (await put(`/api/patient/appointments/${toCancel.data._id}/cancel`, { token: tokens.patient })).status === 400);
  const rebook = await book(tokens.patient2, '10:00');
  check('a cancelled slot can be booked again', rebook.status === 201, rebook);
  check('doctor is told about the cancellation',
    (await get('/api/doctor/notifications', { token: tokens.doctor })).data.some(n => n.type === 'appointment_cancelled'));

  // Appointments at fixed offsets from now, inserted directly
  const at = async (minutesFromNow, patient = ids.patient) => {
    const startsAt = new Date(Math.floor((Date.now() + minutesFromNow * 60000) / 60000) * 60000);
    const pkt = new Date(startsAt.getTime() + 5 * 3600000);
    const time = `${String(pkt.getUTCHours()).padStart(2, '0')}:${String(pkt.getUTCMinutes()).padStart(2, '0')}`;
    return (await Appointment.create({ patient, doctor: ids.doctor, date: pktDate(startsAt), time, startsAt, durationMinutes: 30, fee: 2000 }))._id.toString();
  };
  const soon = await at(60);
  const late = await put(`/api/patient/appointments/${soon}/cancel`, { token: tokens.patient });
  check('patient cannot cancel within 2 hours of the start (400)', late.status === 400 && /2 hours/.test(late.data.message), late);
  check("patient cannot cancel someone else's appointment (404)",
    (await put(`/api/patient/appointments/${soon}/cancel`, { token: tokens.patient2 })).status === 404);

  const noReason = await put(`/api/doctor/appointments/${soon}/cancel`, { token: tokens.doctor, body: {} });
  check('doctor must give a reason to cancel (400)', noReason.status === 400, noReason);
  const docCancel = await put(`/api/doctor/appointments/${soon}/cancel`, { token: tokens.doctor, body: { reason: 'Called into surgery.' } });
  check('doctor cancels any time, even within 2 hours', docCancel.status === 200 && docCancel.data.appointment.cancellationReason === 'Called into surgery.', docCancel);
  check('patient receives the doctor\'s reason',
    (await get('/api/patient/notifications', { token: tokens.patient })).data.some(n => n.type === 'appointment_cancelled' && n.message.includes('Called into surgery.')));

  const early = await put(`/api/doctor/appointments/${ids.apptBooked}/complete`, { token: tokens.doctor });
  check('an appointment cannot be closed before it starts (400)', early.status === 400, early);

  ids.apptDone = await at(-60);
  const done = await put(`/api/doctor/appointments/${ids.apptDone}/complete`, { token: tokens.doctor });
  check('doctor marks a started appointment completed', done.status === 200 && done.data.appointment.status === 'completed', done);
  check('closing twice is refused (400)', (await put(`/api/doctor/appointments/${ids.apptDone}/no-show`, { token: tokens.doctor })).status === 400);
  const missed = await at(-30, ids.patient2);
  const noShow = await put(`/api/doctor/appointments/${missed}/no-show`, { token: tokens.doctor });
  check('doctor marks a no-show', noShow.status === 200 && noShow.data.appointment.status === 'no_show', noShow);
  check('patient cannot cancel a completed appointment (400)',
    (await put(`/api/patient/appointments/${ids.apptDone}/cancel`, { token: tokens.patient })).status === 400);

  const docAppts = await get('/api/doctor/appointments', { token: tokens.doctor });
  check('doctor sees all appointments with patient CNIC',
    docAppts.data.length === 7 && docAppts.data.some(a => a.patient?.cnic === '35202-1234567-9'), docAppts.data.length);
  const patients = await get('/api/doctor/patients', { token: tokens.doctor });
  const p1 = patients.data.find?.(p => p.patient._id === ids.patient);
  check('patient list comes from appointments (cancelled ones excluded)',
    patients.data.length === 2 && p1?.appointments === (winner.patient === ids.patient ? 3 : 2) && p1?.lastVisit && p1?.nextVisit, patients.data);
  check('patient sees their appointments with specialization',
    (await get('/api/patient/appointments', { token: tokens.patient })).data.every(a => a.doctorSpecialization === 'Cardiology'));

  section('Prescriptions from appointments');
  const rxBody = (appointmentId) => ({ appointmentId, tests: [{ testName: 'MRI Brain', notes: 'Recurring headaches' }, { testName: ' ' }] });
  check('prescription needs an appointment (400)',
    (await post('/api/doctor/prescriptions', { token: tokens.doctor, body: { patientId: ids.patient, tests: [{ testName: 'CBC' }] } })).status === 400);
  check('cannot prescribe before the appointment starts (400)',
    (await post('/api/doctor/prescriptions', { token: tokens.doctor, body: rxBody(ids.apptBooked) })).status === 400);
  check('cannot prescribe for a no-show (400)',
    (await post('/api/doctor/prescriptions', { token: tokens.doctor, body: rxBody(missed) })).status === 400);
  const rx = await post('/api/doctor/prescriptions', { token: tokens.doctor, body: rxBody(ids.apptDone) });
  check('doctor prescribes for a completed appointment (blank tests dropped)',
    rx.status === 201 && rx.data.patient === ids.patient && rx.data.appointment === ids.apptDone && rx.data.tests.length === 1, rx);
  check('one prescription per appointment (409)',
    (await post('/api/doctor/prescriptions', { token: tokens.doctor, body: rxBody(ids.apptDone) })).status === 409);

  const rxList = await get('/api/patient/prescriptions', { token: tokens.patient });
  check('patient sees prescription with doctor specialization',
    rxList.data[0]?.doctorSpecialization === 'Cardiology' && rxList.data[0]?.appointment === ids.apptDone, rxList.data);
  const apptWithRx = (await get('/api/patient/appointments', { token: tokens.patient })).data.find(a => a._id === ids.apptDone);
  check("the appointment shows the prescription written in it", apptWithRx?.prescription?.tests?.[0]?.testName === 'MRI Brain', apptWithRx);

  // ── Sharing reports with doctors (decision 13): a doctor sees only what the patient shared ──
  const docReports = await get('/api/doctor/reports', { token: tokens.doctor });
  check('a doctor sees no report until the patient shares it — even after prescribing', docReports.status === 200 && docReports.data.length === 0, docReports.data);
  const shareDocs = await get('/api/patient/report-doctors', { token: tokens.patient });
  check('the patient can share with the doctor they visited',
    shareDocs.status === 200 && shareDocs.data.length === 1 && shareDocs.data[0].doctorId === ids.doctor && shareDocs.data[0].specialization === 'Cardiology', shareDocs.data);
  check('not with a doctor they never booked (400)',
    (await put(`/api/patient/reports/${ids.firstReport}/share`, { token: tokens.patient, body: { doctorId: ids.patient2 } })).status === 400);
  check('not with an invalid doctor id (400)',
    (await put(`/api/patient/reports/${ids.firstReport}/share`, { token: tokens.patient, body: { doctorId: 'nope' } })).status === 400);
  check("another patient cannot share this patient's report (404)",
    (await put(`/api/patient/reports/${ids.firstReport}/share`, { token: tokens.patient2, body: { doctorId: ids.doctor } })).status === 404);

  const notifsBefore = (await get('/api/doctor/notifications', { token: tokens.doctor })).data.filter(n => n.type === 'report_shared').length;
  const shared = await put(`/api/patient/reports/${ids.firstReport}/share`, { token: tokens.patient, body: { doctorId: ids.doctor } });
  check('patient shares a report with their doctor',
    shared.status === 200 && shared.data.sharedWith.length === 1 && shared.data.sharedWith[0].doctor.name === users.doctor.name, shared.data);
  const again = await put(`/api/patient/reports/${ids.firstReport}/share`, { token: tokens.patient, body: { doctorId: ids.doctor } });
  check('sharing twice keeps one entry', again.status === 200 && again.data.sharedWith.length === 1 && /Already shared/.test(again.data.message), again.data);
  const shareNotifs = (await get('/api/doctor/notifications', { token: tokens.doctor })).data.filter(n => n.type === 'report_shared');
  check('the doctor is notified once', shareNotifs.length === notifsBefore + 1 && shareNotifs[0].message.includes('CBC report'), shareNotifs);
  const docSees = (await get('/api/doctor/reports', { token: tokens.doctor })).data;
  check('the doctor now sees that report (with when it was shared, not with whom else)',
    docSees.length === 1 && docSees[0]._id === ids.firstReport && docSees[0].sharedAt && docSees[0].sharedWith === undefined && docSees[0].patient?.name, docSees);
  const mine = (await get('/api/patient/reports', { token: tokens.patient })).data.find(r => r._id === ids.firstReport);
  check('the patient sees who the report is shared with', mine?.sharedWith?.[0]?.doctor?.name === users.doctor.name, mine?.sharedWith);
  const stop = await del(`/api/patient/reports/${ids.firstReport}/share/${ids.doctor}`, { token: tokens.patient });
  check('patient stops sharing', stop.status === 200 && stop.data.sharedWith.length === 0, stop.data);
  check('the doctor no longer sees it', (await get('/api/doctor/reports', { token: tokens.doctor })).data.length === 0);
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

  // Only labs that joined Community Support (from their own portal) can be assigned
  const notPartner = await put(`/api/admin/community-applications/${app.data._id}/approve`, { token: tokens.admin, body: { assignedLabId: ids.lab } });
  check('a lab that has not joined Community Support cannot be assigned (400)', notPartner.status === 400 && /joined Community Support/.test(notPartner.data.message), notPartner);
  check('joining needs join: true or false (400)', (await put('/api/lab/community-support', { token: tokens.lab, body: { join: 'yes' } })).status === 400);
  const join = await put('/api/lab/community-support', { token: tokens.lab, body: { join: true } });
  check('the lab joins Community Support from its portal', join.status === 200 && join.data.profile.isCharityPartner === true && join.data.profile.charityPartnerSince, join.data);
  check('admins are told a lab joined',
    (await get('/api/admin/notifications', { token: tokens.admin })).data.some(n => n.type === 'community_partner_joined' && n.message.includes(users.lab.labName)));
  await put('/api/lab/profile', { token: tokens.lab, body: { isCharityPartner: false } });
  check('the general profile update cannot change partnership', (await get('/api/lab/profile', { token: tokens.lab })).data.profile.isCharityPartner === true);
  let partners = await get('/api/admin/partner-labs', { token: tokens.admin });
  check('the admin sees the partner lab (no donation details)',
    partners.status === 200 && partners.data.length === 1 && partners.data[0]._id === ids.lab && partners.data[0].assigned === 0 && !('jazzCash' in partners.data[0]), partners.data);

  const approve = await put(`/api/admin/community-applications/${app.data._id}/approve`, { token: tokens.admin, body: { assignedLabId: ids.lab } });
  check('admin approves and generates a slip', approve.status === 200 && /^CS-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(approve.data.application.slip?.slipId), approve);
  ids.communityApp = app.data._id;
  ids.communitySlip = approve.data.application.slip.slipId;

  const needy = await get('/api/lab/needy-patients', { token: tokens.lab });
  check('lab sees needy patient with CNIC', needy.data[0]?.patient?.cnic === '35202-1234567-9', needy.data);

  const leaveEarly = await put('/api/lab/community-support', { token: tokens.lab, body: { join: false } });
  check('the lab cannot leave while an assigned patient waits for the test (409)',
    leaveEarly.status === 409 && leaveEarly.data.waiting === 1, leaveEarly.data);
  partners = await get('/api/admin/partner-labs', { token: tokens.admin });
  check('the partner list counts assigned patients', partners.data[0]?.assigned === 1 && partners.data[0]?.conducted === 0, partners.data);

  const conducted = await put(`/api/lab/needy-patients/${app.data._id}/mark-conducted`, { token: tokens.lab });
  check('lab marks test conducted', conducted.status === 200, conducted);

  const leave = await put('/api/lab/community-support', { token: tokens.lab, body: { join: false } });
  check('once every test is conducted the lab can leave', leave.status === 200 && leave.data.profile.isCharityPartner === false, leave.data);
  check('… then it is no longer listed for the admin', (await get('/api/admin/partner-labs', { token: tokens.admin })).data.length === 0);
  check('admins are told a lab left',
    (await get('/api/admin/notifications', { token: tokens.admin })).data.some(n => n.type === 'community_partner_left'));
  check('the patient it already helped keeps the approval and slip',
    (await get('/api/lab/needy-patients', { token: tokens.lab })).data.some(n => n.slip?.slipId === ids.communitySlip));

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
const planBody  = () => ({ labId: ids.lab, testId: ids.mriTest, patientAddress: 'House 12, Model Town, Lahore', guarantor });
const CNIC_PICTURES = { patientCnicFront: ['pf.png'], patientCnicBack: ['pb.png'], guarantorCnicFront: ['gf.png'], guarantorCnicBack: ['gb.png'] };
// The application is multipart: the details as JSON in `data` + the four CNIC pictures
const applyPlan = (token, body, files = CNIC_PICTURES) =>
  post('/api/patient/installment-plans', { token, body: { data: JSON.stringify(body) }, files });
const PatientProfileModel = () => require('../models/PatientProfile');

const testPlanApplication = async () => {
  section('Installment plan application');
  const config = await get('/api/patient/installment-plans/config', { token: tokens.patient });
  check('config returns fee, down-payment rule and limit',
    config.data.serviceFee === 500 && config.data.downPaymentPercent === 20 &&
    config.data.maxOpenPlans === 2 && config.data.openPlans === 1 && config.data.careFirstAccount, config.data);

  const unverified = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: planBody() });
  check('an unverified CNIC does not block applying (the admin checks the CNIC pictures)',
    unverified.status !== 403 && /payment details/.test(unverified.data.message), unverified);
  await PatientProfileModel().updateOne({ user: ids.patient2 }, { cnicStatus: 'rejected' });
  const rejectedCnic = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: planBody() });
  check('a CNIC the admin rejected must be corrected first (403)', rejectedCnic.status === 403 && /Profile/.test(rejectedCnic.data.message), rejectedCnic);
  await PatientProfileModel().updateOne({ user: ids.patient2 }, { cnicStatus: 'unverified' });

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
    ['missing guarantor address', { ...guarantor, address: ' ' }],
  ];
  for (const [label, g] of cases) {
    const r = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: { ...planBody(), guarantor: g } });
    check(`${label} is rejected (400)`, r.status === 400, r);
  }
  const noAddress = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: { ...planBody(), patientAddress: '' } });
  check('missing patient address is rejected (400)', noAddress.status === 400 && /your home address/.test(noAddress.data.message), noAddress);

  const preview = await post('/api/patient/installment-plans/preview', { token: tokens.patient, body: planBody() });
  check('preview: 20% down payment and whole-rupee installments with remainder last',
    preview.status === 200 && preview.data.downPayment === 5000 &&
    JSON.stringify(preview.data.installments) === '[6666,6666,6668]' && preview.data.installmentTenureDays === 30, preview.data);
  check('agreement names patient CNIC and address, guarantor, lab, service fee and the CNIC pictures',
    ['35202-1234567-9', 'House 12, Model Town, Lahore', 'Kamran Khan', '35202-5555555-5', 'E2E Diagnostics', 'PKR 500', 'PKR 6,668', 'CNIC\npictures uploaded']
      .every(s => preview.data.agreementText?.includes(s)), preview.data.agreementText);

  const notAccepted = await applyPlan(tokens.patient, { ...planBody(), agreementText: preview.data.agreementText });
  check('applying without accepting the agreement is rejected (400)', notAccepted.status === 400, notAccepted);

  const tampered = await applyPlan(tokens.patient, { ...planBody(), acceptAgreement: true, agreementText: preview.data.agreementText + ' ' });
  check('agreement text that does not match the terms is rejected (409)', tampered.status === 409, tampered);

  const accepted = { ...planBody(), acceptAgreement: true, agreementText: preview.data.agreementText };
  const noData = await post('/api/patient/installment-plans', { token: tokens.patient, body: { other: 'x' }, files: CNIC_PICTURES });
  check('an application without its details is rejected (400)', noData.status === 400, noData);
  const { guarantorCnicBack, ...threePictures } = CNIC_PICTURES;
  const missingPicture = await applyPlan(tokens.patient, accepted, threePictures);
  check('a missing CNIC picture is rejected (400) and nothing is kept',
    missingPicture.status === 400 && /back of the guarantor's CNIC/.test(missingPicture.data.message) && cnicFileCount() === 0, [missingPicture, cnicFileCount()]);
  const pdfPicture = await applyPlan(tokens.patient, accepted, { ...threePictures, guarantorCnicBack: ['cnic.pdf'] });
  check('CNIC pictures must be JPG or PNG (400)', pdfPicture.status === 400 && cnicFileCount() === 0, [pdfPicture, cnicFileCount()]);

  const apply = await applyPlan(tokens.patient, accepted);
  check('patient applies → pending_approval with stored agreement',
    apply.status === 201 && apply.data.status === 'pending_approval' &&
    apply.data.agreement?.text === preview.data.agreementText && apply.data.agreement?.acceptedAt &&
    apply.data.guarantor?.phone === '03001234567' && apply.data.installments.length === 0, apply.data);
  check('the application stores the patient CNIC + address and four private CNIC pictures',
    apply.data.patientCnic === '35202-1234567-9' && apply.data.patientAddress === 'House 12, Model Town, Lahore' &&
    ['patientFront', 'patientBack', 'guarantorFront', 'guarantorBack'].every(k => apply.data.cnicPictures?.[k]) && cnicFileCount() === 4, apply.data);
  const publicTry = await fetch(`${BASE}/uploads/${apply.data.cnicPictures.patientFront}`);
  check('CNIC pictures are not served from /uploads', publicTry.status === 404, publicTry.status);
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

  // A second patient (CNIC not verified yet) applies so there is one application to reject
  const body2 = { ...planBody(), guarantor: { ...guarantor, cnic: '35202-6666666-6' } };
  const preview2 = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: body2 });
  const apply2 = await applyPlan(tokens.patient2, { ...body2, acceptAgreement: true, agreementText: preview2.data.agreementText });
  check('second patient applies with an unverified CNIC', apply2.status === 201, apply2);

  const cnicChange = await put('/api/patient/profile', { token: tokens.patient2, body: { cnic: '35202-1212121-2' } });
  check('the CNIC cannot change while an application is under review (409)', cnicChange.status === 409, cnicChange);

  const picture = (token, walletId, name) =>
    fetch(`${BASE}/api/documents/wallets/${walletId}/cnic/${name}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const own = await picture(tokens.patient2, apply2.data._id, 'patient-front');
  check('the patient can open their own CNIC picture',
    own.status === 200 && /image\/png/.test(own.headers.get('content-type')) && /no-store/.test(own.headers.get('cache-control')), own.status);
  check('the admin can open every CNIC picture',
    (await Promise.all(['patient-front', 'patient-back', 'guarantor-front', 'guarantor-back'].map(n => picture(tokens.admin, apply2.data._id, n)))).every(r => r.status === 200));
  check('another patient cannot (404)', (await picture(tokens.patient, apply2.data._id, 'patient-front')).status === 404);
  check('a lab cannot (404)', (await picture(tokens.lab, apply2.data._id, 'guarantor-front')).status === 404);
  check('a lawyer without a case on the plan cannot (404)', (await picture(tokens.lawyer, apply2.data._id, 'guarantor-front')).status === 404);
  check('signed-out users cannot (401)', (await picture(null, apply2.data._id, 'patient-front')).status === 401);
  check('unknown picture names return 404', (await picture(tokens.admin, apply2.data._id, 'selfie')).status === 404);

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
  check("a rejected application leaves the patient's CNIC unverified", p2Config.data.cnicStatus === 'unverified', p2Config.data);

  // The first patient's CNIC is not verified yet either: approving the plan verifies it
  await PatientProfileModel().updateOne({ user: ids.patient }, { cnicStatus: 'unverified', cnic: '35202-1234567-8' });
  const changed = await put(`/api/admin/wallets/${ids.plan}/approve`, { token: tokens.admin });
  check("approval is refused if the patient's CNIC no longer matches the application (409)", changed.status === 409, changed);
  await PatientProfileModel().updateOne({ user: ids.patient }, { cnic: '35202-1234567-9' });

  const approve = await put(`/api/admin/wallets/${ids.plan}/approve`, { token: tokens.admin });
  check('admin approves → awaiting_fee',
    approve.status === 200 && approve.data.wallet.status === 'awaiting_fee' && approve.data.wallet.planApprovedAt, approve);
  const pProfile = await get('/api/patient/profile', { token: tokens.patient });
  check("approving the plan also verifies the patient's CNIC",
    approve.data.cnicVerified === true && pProfile.data.profile.cnicStatus === 'verified' && pProfile.data.profile.cnicReviewedAt, pProfile.data.profile);

  const again = await put(`/api/admin/wallets/${ids.plan}/approve`, { token: tokens.admin });
  check('approving twice is refused (400)', again.status === 400, again);

  const pNotifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('patient is told to pay the service fee', pNotifs.data.some(n => n.type === 'plan_approved' && n.message.includes('PKR 500')), pNotifs.data);
  check('… and that their CNIC is verified', pNotifs.data.some(n => n.type === 'cnic_verified' && /installment plan application/.test(n.message)), pNotifs.data);

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

// ─── Step 3 — lab bookings ───────────────────────────────────────────────────
const testLabBookings = async () => {
  section('Lab bookings');
  const Wallet = require('../models/Wallet');
  const { pktDate, addDays } = require('../utils/schedule');
  const today    = pktDate();
  const tomorrow = addDays(today, 1);
  const book = (body, token = tokens.patient) =>
    post('/api/patient/lab-bookings', { token, body: { labId: ids.lab, testId: ids.cbcTest, visitDate: tomorrow, ...body } });

  const cbc = await book({});
  ids.cbcBooking = cbc.data._id;
  check('patient books a test visit → confirmed, pay at the lab',
    cbc.status === 201 && cbc.data.status === 'confirmed' && cbc.data.paymentMethod === 'at_lab' &&
    cbc.data.price === 1500 && cbc.data.labName === 'E2E Diagnostics', cbc);
  check('lab and patient are notified of the booking',
    (await get('/api/lab/notifications', { token: tokens.lab })).data.some(n => n.type === 'lab_booking_created') &&
    (await get('/api/patient/notifications', { token: tokens.patient })).data.some(n => n.type === 'lab_booking_created' && n.message.includes('PKR 1,500')));

  check('a visit date beyond 14 days is rejected (400)', (await book({ visitDate: addDays(today, 15) })).status === 400);
  check('a past visit date is rejected (400)', (await book({ visitDate: addDays(today, -1) })).status === 400);
  check('an unknown test returns 404', (await book({ testId: ids.lab })).status === 404);

  // Paying through an installment plan (ids.plan: the patient's completed MRI plan at this lab)
  check('a plan for a different test cannot pay for this one (400)', (await book({ walletId: ids.plan })).status === 400);
  check("another patient's plan cannot be used (404)",
    (await book({ testId: ids.mriTest, walletId: ids.plan }, tokens.patient2)).status === 404);
  const pending = await Wallet.create({ patient: ids.patient, lab: ids.lab, labTest: ids.mriTest, testName: 'MRI Brain', totalAmount: 25000, status: 'pending_approval' });
  check('a plan that is not active yet cannot pay (400)', (await book({ testId: ids.mriTest, walletId: pending._id.toString() })).status === 400);
  await Wallet.deleteOne({ _id: pending._id });

  const mri = await book({ testId: ids.mriTest, walletId: ids.plan });
  check('patient books MRI paid through their installment plan',
    mri.status === 201 && mri.data.paymentMethod === 'installment' && mri.data.wallet === ids.plan, mri);
  check('one plan covers one booking (409)', (await book({ testId: ids.mriTest, walletId: ids.plan })).status === 409);

  ids.cancelledBooking = mri.data._id;
  const cancelMri = await put(`/api/patient/lab-bookings/${mri.data._id}/cancel`, { token: tokens.patient });
  check('patient cancels before the visit date', cancelMri.status === 200 && cancelMri.data.booking.status === 'cancelled', cancelMri);
  check('lab is told about the cancellation',
    (await get('/api/lab/notifications', { token: tokens.lab })).data.some(n => n.type === 'lab_booking_cancelled'));
  check('cancelling twice is refused (400)', (await put(`/api/patient/lab-bookings/${mri.data._id}/cancel`, { token: tokens.patient })).status === 400);
  const mri2 = await book({ testId: ids.mriTest, walletId: ids.plan });
  check('a cancelled booking frees the plan for a new one', mri2.status === 201, mri2);

  const todayVisit = await book({ visitDate: today });
  check('a visit can be booked for today', todayVisit.status === 201, todayVisit);
  const lateCancel = await put(`/api/patient/lab-bookings/${todayVisit.data._id}/cancel`, { token: tokens.patient });
  check('patient cannot cancel on the visit date (400)', lateCancel.status === 400, lateCancel);
  check("patient cannot cancel someone else's booking (404)",
    (await put(`/api/patient/lab-bookings/${cbc.data._id}/cancel`, { token: tokens.patient2 })).status === 404);

  section('Lab booking chain');
  const list = await get('/api/lab/bookings', { token: tokens.lab });
  check('lab sees its bookings with patient CNIC and payment method',
    list.data.length === 4 && list.data.every(b => b.patient?.cnic === '35202-1234567-9') &&
    list.data.some(b => b.paymentMethod === 'installment' && b.status === 'confirmed'), list.data.map(b => [b.testName, b.status]));
  check('booked patients are in the lab patient list',
    (await get('/api/lab/patients', { token: tokens.lab })).data.some(p => p._id === ids.patient));

  const before = listUploads().size;
  const tooEarly = await post('/api/lab/reports/upload', { token: tokens.lab, body: { bookingId: todayVisit.data._id }, files: { report: ['r.png'] } });
  check('report upload needs the sample collected first (400)', tooEarly.status === 400 && /sample/.test(tooEarly.data.message), tooEarly);
  await new Promise(r => setTimeout(r, 100));
  check('the refused report file is deleted', listUploads().size === before);
  check('a booking cannot be completed before sample collection (400)',
    (await put(`/api/lab/bookings/${todayVisit.data._id}/complete`, { token: tokens.lab })).status === 400);

  const sample = await put(`/api/lab/bookings/${todayVisit.data._id}/sample-collected`, { token: tokens.lab });
  check('lab marks the sample collected', sample.status === 200 && sample.data.booking.status === 'sample_collected', sample);
  check('patient is told the sample was collected',
    (await get('/api/patient/notifications', { token: tokens.patient })).data.some(n => n.type === 'lab_booking_updated'));
  check('collecting twice is refused (400)',
    (await put(`/api/lab/bookings/${todayVisit.data._id}/sample-collected`, { token: tokens.lab })).status === 400);
  check('an invalid booking id returns 404',
    (await put('/api/lab/bookings/not-an-id/sample-collected', { token: tokens.lab })).status === 404);

  const report = await post('/api/lab/reports/upload', { token: tokens.lab, body: { bookingId: todayVisit.data._id, notes: 'All normal' }, files: { report: ['cbc2.png'] } });
  check('report uploaded for a booking takes patient and test from it',
    report.status === 201 && report.data.patient === ids.patient && report.data.testName === 'CBC' && report.data.booking === todayVisit.data._id, report);
  const mine = (await get('/api/patient/lab-bookings', { token: tokens.patient })).data.find(b => b._id === todayVisit.data._id);
  check('the report completes the booking and is linked to it', mine?.status === 'completed' && mine?.report?.reportUrl === report.data.reportUrl, mine);
  check('a booking gets one report (409)',
    (await post('/api/lab/reports/upload', { token: tokens.lab, body: { bookingId: todayVisit.data._id }, files: { report: ['x.png'] } })).status === 409);

  await put(`/api/lab/bookings/${mri2.data._id}/sample-collected`, { token: tokens.lab });
  const done = await put(`/api/lab/bookings/${mri2.data._id}/complete`, { token: tokens.lab });
  check('lab completes a booking without a report yet', done.status === 200 && done.data.booking.status === 'completed', done);
  check('a completed booking cannot be cancelled (400)',
    (await put(`/api/patient/lab-bookings/${mri2.data._id}/cancel`, { token: tokens.patient })).status === 400);
};

// ─── Step 4 — True Cost Analysis ─────────────────────────────────────────────
const testTrueCost = async () => {
  section('True Cost Analysis');
  const { haversineKm } = require('../utils/travel');

  // A second lab that never sets a map pin
  const reg = await post('/api/auth/register', { body: { name: 'Far Rep', email: 'far.e2e@example.com', password: 'secret123', role: 'lab', labName: 'No Pin Labs', location: 'Jhang' } });
  await put(`/api/admin/registrations/${reg.data.user?.id}/approve`, { token: tokens.admin });
  ids.lab2 = reg.data.user?.id;
  tokens.lab2 = (await post('/api/auth/login', { body: { email: 'far.e2e@example.com', password: 'secret123' } })).data.token;
  await post('/api/lab/tests', { token: tokens.lab2, body: { name: 'CBC', category: 'Blood', price: 900 } });

  const labPin = { lat: 31.7167, lng: 72.9785 };
  const patient = { lat: 31.4504, lng: 73.1350 };

  check('an invalid map location is rejected (400)',
    (await put('/api/lab/profile', { token: tokens.lab, body: { coordinates: { lat: 200, lng: 73 } } })).status === 400);
  const pin = await put('/api/lab/profile', { token: tokens.lab, body: { coordinates: labPin } });
  check('lab saves its map location', pin.status === 200 && pin.data.coordinates?.lat === labPin.lat && pin.data.jazzCash === '0301-7654321', pin.data);

  const pub = await get('/api/public/tests');
  check('public tests say which labs have a location',
    pub.data.find(l => l.labId === ids.lab)?.hasLocation === true && pub.data.find(l => l.labId === ids.lab2)?.hasLocation === false, pub.data.map(l => [l.labName, l.hasLocation]));

  check('true cost needs a location (400)', (await get('/api/public/true-cost')).status === 400);
  check('an unknown travel mode is rejected (400)', (await get(`/api/public/true-cost?lat=${patient.lat}&lng=${patient.lng}&mode=plane`)).status === 400);

  const roadKm = fakeRoadKm(patient, labPin);
  const car = await get(`/api/public/true-cost?lat=${patient.lat}&lng=${patient.lng}&mode=car`);
  const c1 = car.data.labs?.find(l => l.labId === ids.lab);
  check('road distance and drive time come from the routing service',
    car.status === 200 && c1?.source === 'road' && c1.distanceKm === Math.round(roadKm * 10) / 10 && c1.durationMin === Math.round(roadKm * 1.5), c1);
  check('travel cost = km × 2 (round trip) × car rate (PKR 25)',
    car.data.ratePerKm === 25 && c1?.travelCost === Math.round(roadKm * 2 * 25), [c1?.travelCost, Math.round(roadKm * 2 * 25)]);
  check('a lab without a location has no travel cost',
    car.data.labs.find(l => l.labId === ids.lab2)?.source === 'no_location' && car.data.labs.find(l => l.labId === ids.lab2)?.travelCost === null);

  const bike = await get(`/api/public/true-cost?lat=${patient.lat}&lng=${patient.lng}`);
  check('motorbike is the default mode (PKR 8/km) and all modes are listed',
    bike.data.mode === 'motorbike' && bike.data.ratePerKm === 8 && bike.data.modes.map(m => m.key).join() === 'motorbike,car,ride' &&
    bike.data.labs.find(l => l.labId === ids.lab)?.travelCost === Math.round(roadKm * 2 * 8), bike.data);

  mock.osrmDown = true;
  const down = await get(`/api/public/true-cost?lat=${patient.lat}&lng=${patient.lng}&mode=ride`);
  mock.osrmDown = false;
  const approxKm = haversineKm(patient, labPin) * 1.3;
  const d1 = down.data.labs?.find(l => l.labId === ids.lab);
  check('if routing fails, straight line × 1.3 is used and marked approximate',
    down.status === 200 && d1?.source === 'approx' && d1.distanceKm === Math.round(approxKm * 10) / 10 && d1.travelCost === Math.round(approxKm * 2 * 50), d1);

  const cleared = await put('/api/lab/profile', { token: tokens.lab2, body: { coordinates: null } });
  check('a lab can clear its location', cleared.status === 200 && !cleared.data.coordinates?.lat, cleared.data);
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

  ids.overdueWallet = wallet._id.toString();
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

  // ── The defaulter is restricted to My Wallet (decision 14) ──
  const me = await get('/api/patient/profile', { token: tokens.patient2 });
  check('the profile says the account is restricted and what is overdue',
    me.data.restriction?.overdueCount === 1 && me.data.restriction.overdueTotal === 3000 && me.data.restriction.plans[0].testName === 'Overdue Plan', me.data.restriction);
  const blockedBooking = await post('/api/patient/appointments', { token: tokens.patient2, body: { doctorId: ids.doctor, date: '2030-01-07', time: '09:00' } });
  check('a defaulter cannot book a doctor (403)', blockedBooking.status === 403 && blockedBooking.data.restricted === true, blockedBooking);
  check('… nor a lab visit (403)', (await post('/api/patient/lab-bookings', { token: tokens.patient2, body: { labId: ids.lab, testId: ids.mriTest, visitDate: '2030-01-07' } })).status === 403);
  check('… nor apply for another installment plan (403)',
    (await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: { labId: ids.lab, testId: ids.mriTest } })).status === 403);
  const uploadsBefore = listUploads().size;
  const blockedCommunity = await post('/api/patient/community-applications', { token: tokens.patient2, body: { testRequired: 'CBC' }, files: { documents: ['bill.png'] } });
  check('… nor apply for community support — and the documents are not kept (403)', blockedCommunity.status === 403 && listUploads().size === uploadsBefore, blockedCommunity);
  check('their reports can still be read', (await get('/api/patient/reports', { token: tokens.patient2 })).status === 200);
  const usersList = (await get('/api/admin/users?limit=1000', { token: tokens.admin })).data.users;
  check('admin Manage Users marks the patient as a defaulter',
    usersList.find(u => u._id === ids.patient2)?.isDefaulter === true && usersList.find(u => u._id === ids.patient)?.isDefaulter === false);
  const adminList = (await get('/api/admin/defaulter-cases', { token: tokens.admin })).data[0];
  check("admin's defaulter list has the patient's CNIC, e-mail and the lab",
    adminList?.patient?.cnic === '35202-7654321-3' && adminList.patient.email === users.patient2.email && adminList.wallet?.labName === users.lab.labName && adminList.status === 'active', adminList);

  // ── Paying the overdue installment: patient → lab → admin, with rejections on the way ──
  const inst = (token) => `/api/patient/wallets/${wallet._id}/installments/0/receipt`;
  const up1 = await post(inst(), { token: tokens.patient2, files: { receipt: ['overdue1.png'] } });
  check('a defaulter can upload the receipt of an overdue installment', up1.status === 200, up1);
  const labQueue = (await get('/api/lab/receipts', { token: tokens.lab })).data.find(w => w.walletId === wallet._id.toString());
  check('the lab sees it, marked as an escalated plan', labQueue?.defaulter === true && labQueue.pendingInstallments.length === 1, labQueue);
  const labReject = (body) => put(`/api/lab/receipts/${wallet._id}/installments/0/reject`, { token: tokens.lab, body });
  check('the lab must give a reason to reject (400)', (await labReject({})).status === 400);
  const lr = await labReject({ reason: 'No payment with this reference reached our account.' });
  let w = await Wallet.findById(wallet._id);
  check('the lab rejects the receipt — it is cleared with the reason',
    lr.status === 200 && !w.installments[0].receiptUrl && w.installments[0].rejectionReason === 'No payment with this reference reached our account.' && w.installments[0].rejectedBy === 'lab', w.installments[0]);
  const p2Notes = (await get('/api/patient/notifications', { token: tokens.patient2 })).data;
  check('the patient is told why', p2Notes.some(n => n.type === 'receipt_rejected' && n.message.includes('No payment with this reference')));
  check('another lab cannot reject it (404)', (await put(`/api/lab/receipts/${wallet._id}/installments/0/reject`, { token: tokens.lab2, body: { reason: 'x' } })).status === 404);
  check('there is no down-payment receipt to reject (400)',
    (await put(`/api/lab/receipts/${wallet._id}/down-payment/reject`, { token: tokens.lab, body: { reason: 'x' } })).status === 400);

  await post(inst(), { token: tokens.patient2, files: { receipt: ['overdue2.png'] } });
  w = await Wallet.findById(wallet._id);
  check('re-uploading clears the rejection', w.installments[0].receiptUrl && !w.installments[0].rejectionReason);
  await put(`/api/lab/receipts/${wallet._id}/installments/0/approve`, { token: tokens.lab });
  check('the lab cannot reject a receipt it already confirmed (400)', (await labReject({ reason: 'oops' })).status === 400);
  const ar = await put(`/api/admin/wallets/${wallet._id}/installments/0/reject`, { token: tokens.admin, body: { reason: 'The screenshot is cut off.' } });
  w = await Wallet.findById(wallet._id);
  check("the admin rejects it — the receipt and the lab's confirmation are cleared",
    ar.status === 200 && !w.installments[0].receiptUrl && !w.installments[0].labApproved && w.installments[0].rejectedBy === 'admin', w.installments[0]);
  check('the lab is told too', (await get('/api/lab/notifications', { token: tokens.lab })).data.some(n => n.type === 'receipt_rejected' && n.message.includes('cut off')));
  check('still restricted while it is not verified', (await get('/api/patient/profile', { token: tokens.patient2 })).data.restriction?.overdueCount === 1);

  await post(inst(), { token: tokens.patient2, files: { receipt: ['overdue3.png'] } });
  await put(`/api/lab/receipts/${wallet._id}/installments/0/approve`, { token: tokens.lab });
  const verified = await put(`/api/admin/wallets/${wallet._id}/installments/0/verify`, { token: tokens.admin });
  w = await Wallet.findById(wallet._id);
  const closed = (await get('/api/admin/defaulter-cases', { token: tokens.admin })).data.find(c => c.wallet?._id === wallet._id.toString());
  check('once the overdue installment is verified the plan is active again and the case closes as paid',
    verified.status === 200 && w.status === 'active' && w.installments[0].status === 'paid' && closed?.status === 'resolved' && closed.resolution === 'paid' && closed.resolvedAt, [w.status, closed]);
  check('the account is back to normal', (await get('/api/patient/profile', { token: tokens.patient2 })).data.restriction === null);
  check('the patient is told', (await get('/api/patient/notifications', { token: tokens.patient2 })).data.some(n => n.type === 'defaulter_cleared' && n.title === 'Account Restored'));
  check('the lawyer is told the case is closed', (await get('/api/lawyer/notifications', { token: tokens.lawyer })).data.some(n => n.type === 'defaulter_cleared' && n.title === 'Defaulter Case Closed'));
  check('the admin cannot reject a verified payment (400)',
    (await put(`/api/admin/wallets/${wallet._id}/installments/0/reject`, { token: tokens.admin, body: { reason: 'late' } })).status === 400);
  const preview = await post('/api/patient/installment-plans/preview', { token: tokens.patient2, body: { labId: ids.lab, testId: ids.mriTest } });
  check('the patient can use everything again (no 403)', preview.status !== 403, preview);
  await runDefaulterCheck();
  check('the job does not re-open the paid case', (await get('/api/admin/defaulter-cases', { token: tokens.admin })).data.filter(c => c.status === 'active').length === 0);

  // ── Escalated plans are still tracked; the lawyer can close a case settled outside CareFirst ──
  const settled = await Wallet.create({
    patient: ids.patient2, lab: ids.lab, testName: 'Settled Plan', totalAmount: 4000, status: 'active',
    installments: [
      { number: 1, dueDate: new Date(Date.now() - 5 * 86400000), amount: 2000 },
      { number: 2, dueDate: new Date(Date.now() + 20 * 86400000), amount: 2000 },
    ],
  });
  await runDefaulterCheck();
  await Wallet.updateOne({ _id: settled._id }, { $set: { 'installments.1.dueDate': new Date(Date.now() - 4 * 86400000) } });
  await runDefaulterCheck();
  let kase2 = (await get('/api/lawyer/defaulter-cases', { token: tokens.lawyer })).data.find(c => c.wallet?._id === settled._id.toString());
  check('an installment falling overdue after escalation is added to the open case', kase2?.missedInstallments === 2 && kase2.totalOverdue === 4000, kase2);
  const close = (body, token = tokens.lawyer) => put(`/api/lawyer/defaulter-cases/${kase2?._id}/close`, { token, body });
  check('the lawyer must say how it was settled (400)', (await close({ note: 'ok' })).status === 400);
  const lc = await close({ note: 'Paid in full at the lab on 2 Oct; lab manager confirmed by phone.' });
  const sw = await Wallet.findById(settled._id);
  check('the lawyer closes the case — overdue installments recorded as settled, plan active, account normal',
    lc.status === 200 && lc.data.case.status === 'resolved' && lc.data.case.resolution === 'settled' &&
    sw.status === 'active' && sw.installments.every(i => i.status === 'paid' && i.settledOffline?.note) &&
    (await get('/api/patient/profile', { token: tokens.patient2 })).data.restriction === null, [lc.data, sw.status]);
  check('a closed case cannot be closed again (400)', (await close({ note: 'second time please' })).status === 400);
  check('the admin is told it was settled', (await get('/api/admin/notifications', { token: tokens.admin })).data.some(n => n.type === 'defaulter_cleared' && n.message.includes('settled')));
  // these two test plans would otherwise use up patient 2's open-plan limit in later sections
  await Wallet.updateMany({ _id: { $in: [wallet._id, settled._id] } }, { status: 'completed' });

  const readAll = await put('/api/lawyer/notifications/read-all', { token: tokens.lawyer });
  const lawyerNotifs = await get('/api/lawyer/notifications', { token: tokens.lawyer });
  check('lawyer marks all notifications read',
    readAll.status === 200 && lawyerNotifs.data.length > 0 && lawyerNotifs.data.every(n => n.read), lawyerNotifs.data);
};

// ─── Step 4 — Urdu translation + speech (fake Azure) ─────────────────────────
const testUrdu = async () => {
  section('Urdu agreement and report summaries');
  const speak = (token, body) => post('/api/tts', { token, body });

  const status = await get('/api/tts/status', { token: tokens.patient });
  check('TTS status reports speech + translator configured and both voices',
    status.data.speech === true && status.data.translator === true && status.data.voices.join() === 'uzma,asad' && status.data.defaultVoice === 'uzma', status.data);

  const plan = (await get('/api/patient/wallets', { token: tokens.patient })).data.find(w => w._id === ids.plan);
  check('the stored agreement has an Urdu version with the same details',
    ['35202-1234567-9', 'Kamran Khan', '25,000 روپے', '5,000 روپے', 'E2E Diagnostics', 'انگریزی متن ہی معتبر'].every(x => plan?.agreement?.textUrdu?.includes(x)), plan?.agreement?.textUrdu);

  // Report summaries — translated on upload
  const before = mock.translations;
  const rep = await post('/api/lab/reports/upload', {
    token: tokens.lab, body: { patientId: ids.patient, testName: 'CBC', summary: 'Your blood count is normal.' }, files: { report: ['cbc3.png'] },
  });
  check('report summary is machine-translated to Urdu on upload',
    rep.status === 201 && rep.data.summary === 'Your blood count is normal.' && rep.data.summaryUrdu === '[ur] Your blood count is normal.' &&
    rep.data.summaryUrduSource === 'machine' && mock.translations === before + 1, rep.data);
  ids.urduReport = rep.data._id;

  const plain = await post('/api/lab/reports/upload', { token: tokens.lab, body: { patientId: ids.patient, testName: 'CBC' }, files: { report: ['cbc4.png'] } });
  check('a report without a summary is not translated', plain.status === 201 && !plain.data.summaryUrdu && mock.translations === before + 1, plain.data);

  const mine = (await get('/api/patient/reports', { token: tokens.patient })).data.find(r => r._id === ids.urduReport);
  check('patient sees the English and Urdu summary', mine?.summary && mine?.summaryUrdu === '[ur] Your blood count is normal.', mine);

  // Audio
  const calls = mock.speechCalls;
  const a1 = await speak(tokens.patient, { source: 'report', id: ids.urduReport });
  check('patient gets Urdu audio of their report summary (Uzma by default)',
    a1.status === 200 && a1.type.includes('audio/mpeg') && mock.speechCalls === calls + 1 &&
    mock.lastSsml.includes('ur-PK-UzmaNeural') && mock.lastSsml.includes('[ur] Your blood count is normal.'), [a1.status, a1.type, mock.lastSsml]);
  const a2 = await speak(tokens.patient, { source: 'report', id: ids.urduReport });
  check('the same audio is served from the cache', a2.status === 200 && mock.speechCalls === calls + 1);
  const a3 = await speak(tokens.patient, { source: 'report', id: ids.urduReport, voice: 'asad' });
  check('the Asad voice is generated separately', a3.status === 200 && mock.speechCalls === calls + 2 && mock.lastSsml.includes('ur-PK-AsadNeural'));

  check('an unknown voice is rejected (400)', (await speak(tokens.patient, { source: 'report', id: ids.urduReport, voice: 'robot' })).status === 400);
  check('an unknown source is rejected (400)', (await speak(tokens.patient, { source: 'free-text', id: ids.urduReport })).status === 400);
  check('an invalid id returns 404', (await speak(tokens.patient, { source: 'report', id: 'nope' })).status === 404);
  check('a report without an Urdu summary returns 409', (await speak(tokens.patient, { source: 'report', id: plain.data._id })).status === 409);
  check('signing in is required (401)', (await post('/api/tts', { body: { source: 'report', id: ids.urduReport } })).status === 401);

  check("another patient cannot hear this patient's report (404)", (await speak(tokens.patient2, { source: 'report', id: ids.urduReport })).status === 404);
  check('the lab that uploaded it can listen', (await speak(tokens.lab, { source: 'report', id: ids.urduReport })).status === 200);
  check('another lab cannot (404)', (await speak(tokens.lab2, { source: 'report', id: ids.urduReport })).status === 404);
  check('a doctor the report is not shared with cannot listen (404)', (await speak(tokens.doctor, { source: 'report', id: ids.urduReport })).status === 404);
  await put(`/api/patient/reports/${ids.urduReport}/share`, { token: tokens.patient, body: { doctorId: ids.doctor } });
  check('the doctor it is shared with can listen', (await speak(tokens.doctor, { source: 'report', id: ids.urduReport })).status === 200);

  // Lab corrections
  const fix = await put(`/api/lab/reports/${ids.urduReport}/summary`, { token: tokens.lab, body: { summaryUrdu: 'آپ کا خون کا ٹیسٹ نارمل ہے۔' } });
  check('lab corrects the Urdu summary', fix.status === 200 && fix.data.report.summaryUrdu === 'آپ کا خون کا ٹیسٹ نارمل ہے۔' && fix.data.report.summaryUrduSource === 'lab' && fix.data.report.summaryUrduEditedAt, fix.data);
  const a4 = await speak(tokens.patient, { source: 'report', id: ids.urduReport });
  check('corrected text gets new audio', a4.status === 200 && mock.speechCalls === calls + 3 && mock.lastSsml.includes('آپ کا خون کا ٹیسٹ نارمل ہے۔'));

  const retr = await put(`/api/lab/reports/${ids.urduReport}/summary`, { token: tokens.lab, body: { summary: 'Haemoglobin is slightly low.' } });
  check('a new English summary is translated again', retr.status === 200 && retr.data.report.summaryUrdu === '[ur] Haemoglobin is slightly low.' && retr.data.report.summaryUrduSource === 'machine', retr.data);
  check("another lab cannot edit the summary (404)",
    (await put(`/api/lab/reports/${ids.urduReport}/summary`, { token: tokens.lab2, body: { summaryUrdu: 'x' } })).status === 404);
  check('an empty update is rejected (400)', (await put(`/api/lab/reports/${ids.urduReport}/summary`, { token: tokens.lab, body: {} })).status === 400);

  mock.translatorDown = true;
  const failRetr = await put(`/api/lab/reports/${ids.urduReport}/summary`, { token: tokens.lab, body: { summary: 'Platelets are normal.' } });
  check('if translation fails, the lab is told (502)', failRetr.status === 502, failRetr);
  const failUp = await post('/api/lab/reports/upload', { token: tokens.lab, body: { patientId: ids.patient, testName: 'CBC', summary: 'All normal.' }, files: { report: ['cbc5.png'] } });
  check('a report still uploads when translation fails (no Urdu yet)', failUp.status === 201 && failUp.data.summary === 'All normal.' && !failUp.data.summaryUrdu, failUp.data);
  mock.translatorDown = false;

  // Agreement audio
  const ag = await speak(tokens.patient, { source: 'agreement', id: ids.plan });
  check('patient hears the Urdu agreement', ag.status === 200 && mock.lastSsml.includes('اقساط کے منصوبے کا معاہدہ') && mock.lastSsml.includes('<break'), mock.lastSsml.slice(0, 200));
  check('admin can hear it', (await speak(tokens.admin, { source: 'agreement', id: ids.plan })).status === 200);
  check("another patient cannot (404)", (await speak(tokens.patient2, { source: 'agreement', id: ids.plan })).status === 404);
  check('a lawyer without the case cannot (404)', (await speak(tokens.lawyer, { source: 'agreement', id: ids.plan })).status === 404);
  check("the assigned lawyer's case wallet has no Urdu agreement (409)",
    (await speak(tokens.lawyer, { source: 'agreement', id: ids.overdueWallet })).status === 409);

  // Before applying: audio of the agreement preview, rebuilt on the server from the plan inputs
  const previewBody = { source: 'agreement-preview', labId: ids.lab, testId: ids.mriTest, patientAddress: 'Chiniot', guarantor: { ...guarantor, cnic: '35202-7777777-7' } };
  const prev = await speak(tokens.patient2, previewBody);
  check('patient can hear the Urdu agreement before applying',
    prev.status === 200 && mock.lastSsml.includes('35202-7777777-7') && mock.lastSsml.includes('35202-7654321-3'), [prev.status, prev.data]);
  check('preview audio follows the same validation (400)',
    (await speak(tokens.patient2, { ...previewBody, guarantor: { ...guarantor, name: 'x'.repeat(81) } })).status === 400);
  check('only patients can request preview audio (404)', (await speak(tokens.doctor, previewBody)).status === 404);

  mock.speechDown = true;
  const down = await speak(tokens.patient, { source: 'agreement', id: ids.plan, voice: 'asad' });
  mock.speechDown = false;
  check('if the speech service fails, a clear 502 is returned', down.status === 502 && down.json, down);
};

// ─── Automatic report summary (fake Document Intelligence) ───────────────────
const CBC_LAYOUT = {
  content: 'CBC Report\nPatient Name: Test\nAge/Sex: 30 Year(s)/Female',
  tables: [{
    rowCount: 4, columnCount: 4,
    cells: [
      ['TEST', 'NORMAL VALUE', 'UNIT', '44202-20-06 20-Jun-2019'],
      ['Hb', '11.5 - 16', 'g/dl', '8.8'],
      ['Platelet Count', '150 - 400', 'x10^9/l', '295'],
      ['WBC Count (TLC)', '4 - 11', 'x10^9/l', '6.6'],
    ].flatMap((row, ri) => row.map((content, ci) => ({ rowIndex: ri, columnIndex: ci, content, ...(ri === 0 ? { kind: 'columnHeader' } : {}) }))),
  }],
};
const NARRATIVE_LAYOUT = { content: 'Histopathology Report\nGross: received in formalin are two soft tissue pieces measuring 1.5 cm. '.repeat(5), tables: [] };

const testAutoSummary = async () => {
  section('Automatic report summary');
  const { PDFDocument } = require('pdf-lib');
  const reportOf = async (id) => (await get('/api/patient/reports', { token: tokens.patient })).data.find(r => r._id === id);
  const waitRead = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = await reportOf(id);
      if (r && !['pending', 'processing'].includes(r.autoRead?.status)) return r;
      await new Promise(res => setTimeout(res, 50));
    }
    return reportOf(id);
  };
  const upload = (body, file = 'cbc.png') =>
    post('/api/lab/reports/upload', { token: tokens.lab, body: { patientId: ids.patient, testName: 'CBC', ...body }, files: { report: [file] } });

  mock.docIntelResult = CBC_LAYOUT;
  const up = await upload({});
  check('upload answers straight away; the reading runs in the background', up.status === 201 && up.data.autoRead?.status === 'pending', up.data.autoRead);
  const r = await waitRead(up.data._id);
  check('the report is read and compared with the printed ranges',
    r.autoRead.status === 'ready' && r.autoRead.kind === 'table' && r.autoRead.findings.length === 3 &&
    r.autoRead.findings.find(f => f.name === 'Hb').status === 'low', r.autoRead);
  check('the patient gets an automatic English summary that sends them to their doctor',
    r.summarySource === 'auto' && r.summary.includes('Hb 8.8 g/dl (low; normal 11.5 to 16)') && r.summary.includes('share this report with your doctor and visit them'), r.summary);
  check('… and an Urdu one written from the template (no machine translation)',
    r.summaryUrduSource === 'auto' && r.summaryUrdu.includes('ہیموگلوبن 8.8 g/dl') && r.summaryUrdu.includes('اپنے ڈاکٹر'), r.summaryUrdu);
  const notifs = await get('/api/patient/notifications', { token: tokens.patient });
  check('the patient is notified that the summary is ready',
    notifs.data.some(n => n.type === 'report_summary_ready' && n.meta?.reportId === up.data._id && n.message.includes('1 result is outside the normal range')), notifs.data[0]);
  const audio = await post('/api/tts', { token: tokens.patient, body: { source: 'report', id: up.data._id } });
  check('the patient can listen to the automatic Urdu summary', audio.status === 200 && mock.lastSsml.includes('ہیموگلوبن'), audio.status);

  const own = await upload({ summary: 'Mild anaemia, please see your doctor.' });
  const ownRead = await waitRead(own.data._id);
  check("a lab-written summary is kept; the reading only adds the results table",
    ownRead.autoRead.status === 'ready' && ownRead.summarySource === 'lab' && ownRead.summary === 'Mild anaemia, please see your doctor.' && ownRead.autoRead.findings.length === 3, ownRead);

  // A 3-page PDF goes to Document Intelligence in two pieces (the free tier reads 2 pages per request)
  const doc = await PDFDocument.create();
  [1, 2, 3].forEach(() => doc.addPage([200, 200]));
  const callsBefore = mock.docIntelCalls;
  const pdf = await upload({}, { name: 'three-pages.pdf', data: Buffer.from(await doc.save()) });
  const pdfRead = await waitRead(pdf.data._id);
  check('a 3-page PDF is read in two requests, every page included',
    pdfRead.autoRead.status === 'ready' && mock.docIntelCalls - callsBefore === 2 && pdfRead.autoRead.pages === 3 && pdfRead.autoRead.totalPages === 3, [mock.docIntelCalls - callsBefore, pdfRead.autoRead]);

  // A phone photo over the free tier's ~4 MB limit is read from a smaller copy; the original is kept
  const sharp = require('sharp');
  const photo = await sharp(require('crypto').randomBytes(1500 * 1100 * 3), { raw: { width: 1500, height: 1100, channels: 3 } }).png().toBuffer();
  const big = await upload({}, { name: 'phone-photo.png', data: photo });
  const bigRead = await waitRead(big.data._id);
  const stored = await fetch(bigRead.reportUrl);
  check('a photo over 4 MB is shrunk for reading, and the patient still gets the original file',
    photo.length > 4 * 1024 * 1024 && bigRead.autoRead.status === 'ready' && mock.docIntelLastBytes < 4 * 1024 * 1024 &&
    (await stored.arrayBuffer()).byteLength === photo.length, [photo.length, mock.docIntelLastBytes, bigRead.autoRead]);

  mock.docIntelResult = NARRATIVE_LAYOUT;
  const written = await waitRead((await upload({}, 'biopsy.png')).data._id);
  check('a written report is not summarised — the patient is sent to their doctor',
    written.autoRead.kind === 'narrative' && written.summary.includes('A doctor needs to explain it'), written.summary);

  mock.docIntelResult = null;
  const failed = await waitRead((await upload({}, 'blurry.png')).data._id);
  check('if the report cannot be read, it says so and adds no summary',
    failed.autoRead.status === 'failed' && !failed.summary && !failed.summaryUrdu, failed.autoRead);
  check('… so there is nothing to listen to (409)',
    (await post('/api/tts', { token: tokens.patient, body: { source: 'report', id: failed._id } })).status === 409);

  mock.docIntelResult = CBC_LAYOUT;
  const again = await post(`/api/lab/reports/${failed._id}/read-again`, { token: tokens.lab });
  check('the lab can read it again once the service works',
    again.status === 200 && again.data.report.autoRead.status === 'ready' && again.data.report.summarySource === 'auto', again.data.report?.autoRead);
  check('another lab cannot (404)', (await post(`/api/lab/reports/${failed._id}/read-again`, { token: tokens.lab2 })).status === 404);

  await put(`/api/patient/reports/${up.data._id}/share`, { token: tokens.patient, body: { doctorId: ids.doctor } });
  const doctorView = (await get('/api/doctor/reports', { token: tokens.doctor })).data.find(x => x._id === up.data._id);
  check("the patient's doctor sees the results table too", doctorView?.autoRead?.findings?.length === 3, doctorView?.autoRead);
  mock.docIntelResult = null;
};

const testCnicPicturesForLawyer = async () => {
  section('CNIC pictures for the lawyer');
  const Wallet = require('../models/Wallet');
  // The escalated test wallet was inserted directly; give it the pictures of a real application
  const { cnicPictures } = await Wallet.findById(ids.plan).lean();
  await Wallet.updateOne({ _id: ids.overdueWallet }, { cnicPictures });
  const picture = (token, walletId, name) =>
    fetch(`${BASE}/api/documents/wallets/${walletId}/cnic/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  check("the assigned lawyer can open the defaulter's and guarantor's CNIC pictures",
    (await Promise.all(['patient-front', 'patient-back', 'guarantor-front', 'guarantor-back'].map(n => picture(tokens.lawyer, ids.overdueWallet, n)))).every(r => r.status === 200));
  check("… but not those of a plan that isn't their case (404)", (await picture(tokens.lawyer, ids.plan, 'patient-front')).status === 404);
  const lawyerCase = (await get('/api/lawyer/defaulter-cases', { token: tokens.lawyer })).data.find(c => c.wallet?._id === ids.overdueWallet);
  check('the case gives the lawyer the wallet with its pictures', lawyerCase?.wallet?.cnicPictures?.guarantorBack, lawyerCase?.wallet);
  check("the case names the plan's lab", lawyerCase?.wallet?.labName === users.lab.labName, lawyerCase?.wallet?.labName);
};

const testSlips = async () => {
  section('Slips (PDF)');
  const { PDFDocument } = require('pdf-lib');
  const SLIP = (prefix) => new RegExp(`^${prefix}-[2-9A-Z]{4}-[2-9A-Z]{4}$`);
  const slip = (token, p) => fetch(`${BASE}/api/documents/slips/${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const pdfOf = async (res) => {
    const bytes = Buffer.from(await res.arrayBuffer());
    if (res.status !== 200 || !/application\/pdf/.test(res.headers.get('content-type')) || bytes.subarray(0, 4).toString() !== '%PDF') return null;
    return PDFDocument.load(bytes);
  };

  // Slip numbers on every booking, visible to the lab / doctor for checking
  const appts = (await get('/api/patient/appointments', { token: tokens.patient })).data;
  const live = appts.find(a => a.status !== 'cancelled');
  const cancelledAppt = appts.find(a => a.status === 'cancelled');
  check('every appointment has a slip number', appts.length > 0 && appts.every(a => SLIP('AP').test(a.slipNumber)), appts.map(a => a.slipNumber));
  const docAppts = (await get('/api/doctor/appointments', { token: tokens.doctor })).data;
  check('the doctor sees the same slip number', docAppts.find(a => a._id === live._id)?.slipNumber === live.slipNumber);
  const labBookings = (await get('/api/lab/bookings', { token: tokens.lab })).data;
  const cbc = labBookings.find(b => b._id === ids.cbcBooking);
  check('lab bookings have slip numbers the lab can see', SLIP('LB').test(cbc?.slipNumber), cbc);
  const needy = (await get('/api/lab/needy-patients', { token: tokens.lab })).data;
  check('the assigned lab sees the community slip number', needy.some(n => n.slip?.slipId === ids.communitySlip), needy);

  // Appointment slip
  const apptPdf = await pdfOf(await slip(tokens.patient, `appointment/${live._id}`));
  check('the patient downloads a one-page appointment slip PDF', apptPdf?.getPageCount() === 1 && apptPdf.getTitle().includes(live.slipNumber), apptPdf?.getTitle());
  check('the doctor can download it too', (await pdfOf(await slip(tokens.doctor, `appointment/${live._id}`))) !== null);
  check('an admin can download it too', (await pdfOf(await slip(tokens.admin, `appointment/${live._id}`))) !== null);
  check('another patient cannot (404)', (await slip(tokens.patient2, `appointment/${live._id}`)).status === 404);
  check('a lab cannot (404)', (await slip(tokens.lab, `appointment/${live._id}`)).status === 404);
  check('signed-out users cannot (401)', (await slip(null, `appointment/${live._id}`)).status === 401);
  check('a cancelled appointment has no slip (409)', cancelledAppt && (await slip(tokens.patient, `appointment/${cancelledAppt._id}`)).status === 409);
  check('unknown ids return 404', (await slip(tokens.admin, 'appointment/123')).status === 404);

  // Lab visit slip
  const labPdf = await pdfOf(await slip(tokens.patient, `lab-booking/${ids.cbcBooking}`));
  check('the patient downloads a lab visit slip PDF', labPdf?.getPageCount() === 1 && labPdf.getTitle().includes(cbc.slipNumber), labPdf?.getTitle());
  const dl = await slip(tokens.lab, `lab-booking/${ids.cbcBooking}`);
  check('the lab can download it, as a named attachment',
    /attachment; filename="CareFirst-slip-LB-/.test(dl.headers.get('content-disposition')) && (await pdfOf(dl)) !== null, dl.headers.get('content-disposition'));
  check('another lab cannot (404)', (await slip(tokens.lab2, `lab-booking/${ids.cbcBooking}`)).status === 404);
  check('a doctor cannot (404)', (await slip(tokens.doctor, `lab-booking/${ids.cbcBooking}`)).status === 404);
  check('a cancelled visit has no slip (409)', (await slip(tokens.patient, `lab-booking/${ids.cancelledBooking}`)).status === 409);

  // Community support slip with the uploaded documents after it
  const commPdf = await pdfOf(await slip(tokens.patient, `community/${ids.communityApp}`));
  check('the community slip has the slip page + the 2 uploaded documents',
    commPdf?.getPageCount() === 3 && commPdf.getTitle().includes(ids.communitySlip), commPdf?.getPageCount());
  check('the assigned lab can download it', (await pdfOf(await slip(tokens.lab, `community/${ids.communityApp}`))) !== null);
  check('another lab cannot (404)', (await slip(tokens.lab2, `community/${ids.communityApp}`)).status === 404);
  check('another patient cannot (404)', (await slip(tokens.patient2, `community/${ids.communityApp}`)).status === 404);

  // Bookings from before slips existed get a number at startup
  const Appointment = require('../models/Appointment');
  const { backfillSlipNumbers } = require('../utils/slips');
  const { insertedId } = await Appointment.collection.insertOne({
    patient: new mongoose.Types.ObjectId(ids.patient), doctor: new mongoose.Types.ObjectId(ids.doctor),
    date: '2026-01-05', time: '09:00', startsAt: new Date('2026-01-05T04:00:00Z'), durationMinutes: 30, status: 'completed',
  });
  await backfillSlipNumbers();
  check('older bookings get a slip number', SLIP('AP').test((await Appointment.findById(insertedId).lean()).slipNumber));
  await Appointment.deleteOne({ _id: insertedId });

  // Clinic address (printed on the appointment slip)
  const clinic = await put('/api/doctor/profile', { token: tokens.doctor, body: { specialization: 'Cardiology', experience: 10, clinicName: 'Heart Care Clinic', clinicAddress: '12 College Road, Chiniot' } });
  check('the doctor sets a clinic name and address', clinic.status === 200 && clinic.data.clinicAddress === '12 College Road, Chiniot', clinic.data);
  const pubDoc = (await get('/api/public/doctors')).data.find(d => d.doctorId === ids.doctor);
  check('Find Doctors shows the clinic', pubDoc?.clinicName === 'Heart Care Clinic' && pubDoc?.clinicAddress === '12 College Road, Chiniot', pubDoc);
  const withClinic = (await get('/api/patient/appointments', { token: tokens.patient })).data.find(a => a._id === live._id);
  check("the patient's appointment shows where the clinic is", withClinic?.doctorClinic === 'Heart Care Clinic, 12 College Road, Chiniot', withClinic?.doctorClinic);
};

const testDueReminders = async () => {
  section('Due-soon reminders (nightly job)');
  const Wallet = require('../models/Wallet');
  const { runDueReminders } = require('../jobs/defaulterJob');
  const due = (days) => new Date(Date.now() + days * 86400000);

  const wallet = await Wallet.create({
    patient: ids.patient2, lab: ids.lab, testName: 'Reminder Plan', totalAmount: 4000, status: 'active',
    installments: [
      { number: 1, dueDate: due(3),  amount: 1000 },
      { number: 2, dueDate: due(1),  amount: 1000 },
      { number: 3, dueDate: due(10), amount: 1000 },
      { number: 4, dueDate: due(2),  amount: 1000, receiptUrl: 'http://x/receipt.png' },
    ],
  });
  // Plans that are not active get no reminders
  await Wallet.create({
    patient: ids.patient2, lab: ids.lab, testName: 'Pending Plan', totalAmount: 1000, status: 'pending_approval',
    installments: [{ number: 1, dueDate: due(1), amount: 1000 }],
  });

  const reminders = async () => (await get('/api/patient/notifications', { token: tokens.patient2 }))
    .data.filter(n => n.type === 'installment_due_soon');

  await runDueReminders();
  let sent = await reminders();
  check('reminders sent 3 days and 1 day before due, not for later or already-receipted ones',
    sent.length === 2 &&
    sent.some(n => n.meta.installmentNumber === 1 && n.message.includes('in 3 days')) &&
    sent.some(n => n.meta.installmentNumber === 2 && n.message.includes('tomorrow')), sent);

  await runDueReminders();
  check('re-running the job does not repeat reminders', (await reminders()).length === 2);

  await Wallet.updateOne({ _id: wallet._id }, { $set: { 'installments.0.dueDate': due(1) } });
  await runDueReminders();
  sent = await reminders();
  check('the 1-day reminder follows the 3-day one', sent.length === 3 && sent.filter(n => n.meta.installmentNumber === 1).length === 2, sent);
};

const testAdminInsights = async () => {
  section('Admin dashboard, reports & settings (real data)');
  const User = require('../models/User');
  const TestReport = require('../models/TestReport');
  const Wallet = require('../models/Wallet');

  // Platform Reports: counted from the database for a Pakistan calendar month
  const rep = await get('/api/admin/reports', { token: tokens.admin });
  const row = (k) => rep.data.rows?.find(r => r.key === k);
  const thisMonth = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 7);
  check('reports default to the current month and list months to pick', rep.status === 200 && rep.data.month === thisMonth && rep.data.months?.[0] === thisMonth, rep.data.month);
  check('new patients this month are counted', row('patients')?.count === await User.countDocuments({ role: 'patient' }), row('patients'));
  check('reports uploaded this month are counted', row('reports')?.count === await TestReport.countDocuments({}), row('reports'));
  const feesVerified = await Wallet.countDocuments({ 'serviceFee.adminVerified': true });
  check('service fees verified show the count and the PKR received',
    feesVerified > 0 && row('serviceFees')?.count === feesVerified && row('serviceFees').details === `PKR ${(feesVerified * 500).toLocaleString('en-US')}` &&
    rep.data.cards.find(c => c.key === 'serviceFees')?.count === feesVerified * 500, row('serviceFees'));
  check('community support and defaulter cases are counted', row('community')?.count >= 1 && row('defaulters')?.count >= 1, [row('community'), row('defaulters')]);
  check('nothing claims revenue or donations', !JSON.stringify(rep.data).match(/donation|revenue/i));
  check('a bad or future month falls back to this month',
    (await get('/api/admin/reports?month=2026-13', { token: tokens.admin })).data.month === thisMonth &&
    (await get('/api/admin/reports?month=2999-01', { token: tokens.admin })).data.month === thisMonth);
  const last = await get('/api/admin/reports?month=2025-01', { token: tokens.admin });
  check('an earlier month is counted separately (nothing happened then)', last.data.month === '2025-01' && last.data.rows.every(r => r.count === 0), last.data.rows);
  check('only admins can see reports (403)', (await get('/api/admin/reports', { token: tokens.lab })).status === 403);

  // Dashboard overview
  const ov = await get('/api/admin/overview', { token: tokens.admin });
  check('dashboard totals come from the database',
    ov.status === 200 && ov.data.totals.patient === await User.countDocuments({ role: 'patient' }) &&
    ov.data.totals.users === await User.countDocuments({ role: { $ne: 'admin' } }), ov.data.totals);
  const times = (ov.data.activity || []).map(a => new Date(a.at).getTime());
  check('recent activity is real and newest first',
    times.length > 0 && times.every((t, i) => i === 0 || times[i - 1] >= t) && ov.data.activity.every(a => a.who && a.text), ov.data.activity);

  // Settings: CareFirst account for service fees
  const before = await get('/api/admin/settings', { token: tokens.admin });
  check('settings start from the .env values (not saved yet)', before.status === 200 && before.data.saved === false && before.data.supportEmail, before.data);
  const save = (body) => put('/api/admin/settings', { token: tokens.admin, body });
  check('at least one way to pay is required (400)', (await save({ careFirstAccount: {} })).status === 400);
  check('a bank account needs a bank name and title (400)', (await save({ careFirstAccount: { accountNumber: 'PK36SCBL0000001123456702' } })).status === 400);
  check('wallet numbers must look like 0300-1234567 (400)', (await save({ careFirstAccount: { jazzCash: '12345' } })).status === 400);
  check('the support email must be valid (400)', (await save({ careFirstAccount: { jazzCash: '0300-1234567' }, supportEmail: 'nope' })).status === 400);
  const saved = await save({
    careFirstAccount: { bankName: 'Meezan Bank', accountTitle: 'CareFirst Health', accountNumber: 'PK36 MEZN 0001 2345 6789', jazzCash: '0301-7654321', easyPaisa: '' },
    supportEmail: 'Help@CareFirst.pk',
  });
  check('the admin saves the CareFirst account', saved.status === 200 && saved.data.saved === true && saved.data.careFirstAccount.bankName === 'Meezan Bank' && saved.data.supportEmail === 'help@carefirst.pk', saved.data);
  const cfg = await get('/api/patient/installment-plans/config', { token: tokens.patient });
  check('patients now see the saved account to pay the service fee',
    cfg.data.careFirstAccount?.accountNumber === 'PK36 MEZN 0001 2345 6789' && cfg.data.careFirstAccount?.jazzCash === '0301-7654321' &&
    cfg.data.careFirstAccount?.easyPaisa === '' && cfg.data.supportEmail === 'help@carefirst.pk', cfg.data);
  // Lab earnings: only payments recorded on CareFirst, recomputed here from the database
  const LabBooking = require('../models/LabBooking');
  const pktMonth = (d) => new Date(new Date(d).getTime() + 5 * 3600000).toISOString().slice(0, 7);
  const visits = await LabBooking.find({ lab: ids.lab, status: 'completed', paymentMethod: 'at_lab' }).lean();
  const wallets = await Wallet.find({ lab: ids.lab }).lean();
  let expected = visits.filter(v => v.visitDate.startsWith(thisMonth)).reduce((t, v) => t + v.price, 0);
  for (const w of wallets) {
    if (w.downPayment?.labApprovedAt && pktMonth(w.downPayment.labApprovedAt) === thisMonth) expected += w.downPayment.amount;
    for (const i of w.installments || []) if (i.labApprovedAt && pktMonth(i.labApprovedAt) === thisMonth) expected += i.amount;
  }
  const earn = await get('/api/lab/earnings', { token: tokens.lab });
  check('lab earnings = visits paid at the lab + plan payments it confirmed this month',
    earn.status === 200 && expected > 0 && earn.data.total === expected && earn.data.entries.length >= earn.data.count, [earn.data.total, expected]);
  check('another lab sees none of it', (await get('/api/lab/earnings', { token: tokens.lab2 })).data.total === 0);
  check('only labs can see lab earnings (403)', (await get('/api/lab/earnings', { token: tokens.patient })).status === 403);

  check('only admins can change settings (403)', (await put('/api/admin/settings', { token: tokens.patient, body: { careFirstAccount: { jazzCash: '0300-1234567' } } })).status === 403);
};

const testLabBranches = async () => {
  section('Lab branches (one account per chain)');
  const LabProfile = require('../models/LabProfile');
  const LabBooking = require('../models/LabBooking');
  const { pktDate, addDays } = require('../utils/schedule');
  const tomorrow = addDays(pktDate(), 1);

  const list = await get('/api/lab/branches', { token: tokens.lab });
  check('a lab starts with one branch from its registration', list.status === 200 && list.data.length === 1 && list.data[0].name === users.lab.labName, list.data);
  const main = list.data[0];

  check('a branch needs a name and address (400)', (await post('/api/lab/branches', { token: tokens.lab, body: { name: 'X' } })).status === 400);
  check('branch names are unique within the lab (409)', (await post('/api/lab/branches', { token: tokens.lab, body: { name: main.name, address: 'Somewhere' } })).status === 409);
  const added = await post('/api/lab/branches', { token: tokens.lab, body: {
    name: 'E2E Diagnostics – Satiana Road', address: '12 Satiana Road, Faisalabad', area: 'Satiana Road',
    phone: '041-1234567', hours: 'Mon–Sat 8 AM – 10 PM', coordinates: { lat: 31.3935, lng: 73.1173 },
  } });
  check('the lab adds a second branch with its own pin', added.status === 201 && added.data.hasLocation && added.data.phone === '041-1234567', added.data);
  const satiana = added.data;
  check('a branch is edited', (await put(`/api/lab/branches/${satiana.branchId}`, { token: tokens.lab, body: { hours: 'Daily 9 AM – 9 PM' } })).data.hours === 'Daily 9 AM – 9 PM');
  check("the old single-pin profile update is refused once there are several branches (400)",
    (await put('/api/lab/profile', { token: tokens.lab, body: { coordinates: { lat: 31.4, lng: 73.1 } } })).status === 400);

  // CBC only at the new branch
  check('an unknown branch on a test is refused (400)', (await put(`/api/lab/tests/${ids.cbcTest}`, { token: tokens.lab, body: { branches: [ids.lab] } })).status === 400);
  const limited = await put(`/api/lab/tests/${ids.cbcTest}`, { token: tokens.lab, body: { branches: [satiana.branchId] } });
  check('a test can be limited to some branches', limited.status === 200 && limited.data.branches.length === 1, limited.data);
  const pub = (await get('/api/public/tests')).data.find(l => l.labId === ids.lab);
  check('patients see the branches and where each test is offered',
    pub.branches.length === 2 && pub.tests.find(t => t._id === ids.cbcTest).branchIds.join() === satiana.branchId &&
    pub.tests.find(t => t._id === ids.mriTest).branchIds.length === 2, pub);

  // Booking at a branch
  const book = (body) => post('/api/patient/lab-bookings', { token: tokens.patient2, body: { labId: ids.lab, visitDate: tomorrow, ...body } });
  const cbc = await book({ testId: ids.cbcTest });
  check('a test offered at one branch is booked there automatically', cbc.status === 201 && cbc.data.branch === satiana.branchId && cbc.data.branchName === satiana.name, cbc.data);
  check('a test offered at several branches needs the branch chosen (400)', (await book({ testId: ids.mriTest })).status === 400);
  check("a branch that doesn't offer the test can't be chosen (400)", (await book({ testId: ids.cbcTest, branchId: main.branchId })).status === 400);
  const mri = await book({ testId: ids.mriTest, branchId: main.branchId });
  check('the patient books MRI at the main branch', mri.status === 201 && mri.data.branchName === main.name && mri.data.branchAddress === main.address, mri.data);

  // The patient changes branch; the lab takes the visit at its branch
  const moved = await put(`/api/patient/lab-bookings/${mri.data._id}/branch`, { token: tokens.patient2, body: { branchId: satiana.branchId } });
  check('the patient moves the visit to another branch', moved.status === 200 && moved.data.booking.branchName === satiana.name && moved.data.booking.transfers[0].by === 'patient', moved.data);
  check('the lab is told', (await get('/api/lab/notifications', { token: tokens.lab })).data.some(n => n.title === 'Visit Moved to Another Branch'));
  check("the CBC visit can't move to a branch that doesn't offer CBC (400)",
    (await put(`/api/lab/bookings/${cbc.data._id}/transfer`, { token: tokens.lab, body: { branchId: main.branchId } })).status === 400);
  const back = await put(`/api/lab/bookings/${mri.data._id}/transfer`, { token: tokens.lab, body: { branchId: main.branchId } });
  check('wrong branch: the lab takes the visit at its own branch', back.status === 200 && back.data.booking.branchName === main.name && back.data.booking.transfers.length === 2, back.data);
  check('the patient is told where the visit is now',
    (await get('/api/patient/notifications', { token: tokens.patient2 })).data.some(n => n.title === 'Lab Visit Moved' && n.message.includes(main.name)));
  check('another lab cannot move it (404)', (await put(`/api/lab/bookings/${mri.data._id}/transfer`, { token: tokens.lab2, body: { branchId: main.branchId } })).status === 404);
  const slip = await fetch(`${BASE}/api/documents/slips/lab-booking/${mri.data._id}`, { headers: { Authorization: `Bearer ${tokens.patient2}` } });
  check('the slip is still available after the move', slip.status === 200);

  // Removing branches
  check("a branch with open visits can't be removed (409)", (await del(`/api/lab/branches/${main.branchId}`, { token: tokens.lab })).status === 409);
  check("a lab's last branch can't be removed (400)",
    (await del(`/api/lab/branches/${(await get('/api/lab/branches', { token: tokens.lab2 })).data[0].branchId}`, { token: tokens.lab2 })).status === 400);
  await put(`/api/lab/bookings/${mri.data._id}/sample-collected`, { token: tokens.lab });
  check('a visit whose sample is collected stays where it is (400)',
    (await put(`/api/lab/bookings/${mri.data._id}/transfer`, { token: tokens.lab, body: { branchId: satiana.branchId } })).status === 400);

  // True Cost per branch
  const tc = await get('/api/public/true-cost?lat=31.40&lng=73.10&mode=car');
  const mine = tc.data.labs.find(l => l.labId === ids.lab);
  check('True Cost gives every branch its distance and the lab its nearest branch',
    mine.branches.length === 2 && mine.branches.every(b => b.distanceKm !== null) &&
    mine.branchId === mine.branches.slice().sort((a, b) => a.distanceKm - b.distanceKm)[0].branchId, mine);

  // Labs and visits from before branches get one at startup
  const { backfillLabBranches } = require('../utils/labBranches');
  const old = await LabProfile.collection.insertOne({ user: new mongoose.Types.ObjectId(), labName: 'Old Lab', location: 'Jail Road, Faisalabad', coordinates: { lat: 31.42, lng: 73.08 }, tests: [] });
  const oldVisit = await LabBooking.collection.insertOne({ patient: new mongoose.Types.ObjectId(), lab: (await LabProfile.findById(old.insertedId)).user, labTest: new mongoose.Types.ObjectId(), testName: 'CBC', price: 1, visitDate: tomorrow, status: 'confirmed' });
  await backfillLabBranches();
  const oldLab = await LabProfile.findById(old.insertedId).lean();
  check('an older lab gets a branch from its address and pin',
    oldLab.branches.length === 1 && oldLab.branches[0].address === 'Jail Road, Faisalabad' && oldLab.branches[0].coordinates.lat === 31.42, oldLab.branches);
  check("an older visit gets its lab's branch", String((await LabBooking.findById(oldVisit.insertedId).lean()).branch) === String(oldLab.branches[0]._id));
  await LabProfile.deleteOne({ _id: old.insertedId });
  await LabBooking.deleteOne({ _id: oldVisit.insertedId });
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
    await startMock();
    await startServer();
    await testAccounts();
    await testCnicReview();
    await testLabAndDoctor();
    await testAppointments();
    await testCommunitySupport();
    await testInstallmentReceipts();
    await testPlanApplication();
    await testPlanReview();
    await testDownPaymentAndCompletion();
    await testLabBookings();
    await testTrueCost();
    await testSlips();
    await testDefaulterEscalation();
    await testCnicPicturesForLawyer();
    await testUrdu();
    await testAutoSummary();
    await testDueReminders();
    await testAdminInsights();
    await testLabBranches();
    await testMisc();
  } catch (err) {
    failures.push(`crashed: ${err.message}`);
    console.error(err);
  } finally {
    server?.kill();
    mockServer?.close();
    fs.rmSync(AUDIO_DIR, { recursive: true, force: true });
    fs.rmSync(CNIC_DIR, { recursive: true, force: true });
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
