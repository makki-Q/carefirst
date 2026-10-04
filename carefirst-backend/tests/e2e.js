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

  const docReports = await get('/api/doctor/reports', { token: tokens.doctor });
  check('doctor sees reports of patients they prescribed for', docReports.data.length === 1, docReports.data);
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

  const blocked = await post(`/api/patient/wallets/${wallet._id}/installments/1/receipt`, { token: tokens.patient2, files: { receipt: ['r.png'] } });
  check('defaulter wallet blocks receipt upload (400)', blocked.status === 400, blocked);

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
  check("the patient's doctor can listen", (await speak(tokens.doctor, { source: 'report', id: ids.urduReport })).status === 200);

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
  const previewBody = { source: 'agreement-preview', labId: ids.lab, testId: ids.mriTest, guarantor: { ...guarantor, cnic: '35202-7777777-7' } };
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

  const doctorView = (await get('/api/doctor/reports', { token: tokens.doctor })).data.find(x => x._id === up.data._id);
  check("the patient's doctor sees the results table too", doctorView?.autoRead?.findings?.length === 3, doctorView?.autoRead);
  mock.docIntelResult = null;
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
    await testDefaulterEscalation();
    await testUrdu();
    await testAutoSummary();
    await testDueReminders();
    await testMisc();
  } catch (err) {
    failures.push(`crashed: ${err.message}`);
    console.error(err);
  } finally {
    server?.kill();
    mockServer?.close();
    fs.rmSync(AUDIO_DIR, { recursive: true, force: true });
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
