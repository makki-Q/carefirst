// Imports the prepared Faisalabad dataset (dataset/clean/*.csv) into the database in MONGO_URI:
//
//   npm run import:dataset
//
// Adds 5 lab chains (with their branches and tests) and 28 doctors as active accounts
// (password: password123). It does not delete anything; running it again updates the same
// accounts (matched by e-mail) and their branches / tests (matched by name), so bookings keep
// pointing at the same branches. Prepare the CSVs first with dataset/scripts/prepare-*.js.
require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');

const User          = require('../models/User');
const LabProfile    = require('../models/LabProfile');
const DoctorProfile = require('../models/DoctorProfile');

const CLEAN    = path.join(__dirname, '..', '..', 'dataset', 'clean');
const PASSWORD = 'password123';
const WEEK     = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY      = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

const parseCsv = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter(r => r.some(Boolean));
  return data.map(r => Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
};
const slug = (s) => s.toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

// An active account for a dataset entry (created once, then kept)
const account = async ({ email, name, role, phone }) => {
  let user = await User.findOne({ email });
  if (!user) user = await User.create({ email, name, role, phone, password: PASSWORD, status: 'active' });
  else { user.name = name; if (phone) user.phone = phone; user.status = 'active'; await user.save(); }
  return user;
};

const importLabs = async () => {
  const chains   = parseCsv(path.join(CLEAN, 'lab_chains.csv'));
  const branches = parseCsv(path.join(CLEAN, 'lab_branches.csv'));
  const tests    = parseCsv(path.join(CLEAN, 'lab_tests.csv'));
  const out = [];

  for (const c of chains) {
    const user = await account({ email: `${c.chain_id}@labs.carefirst.test`, name: c.chain_name, role: 'lab', phone: c.phone });
    let profile = await LabProfile.findOne({ user: user._id });
    const myBranches = branches.filter(b => b.chain_id === c.chain_id);
    if (!profile) profile = new LabProfile({ user: user._id, labName: c.chain_name, location: myBranches[0]?.address || 'Faisalabad' });
    profile.labName = c.chain_name;
    profile.phone = c.phone;
    profile.bankDetails = { bankName: c.bank_name, accountNumber: c.account_number };
    profile.jazzCash = c.jazzcash || undefined;
    profile.easyPaisa = c.easypaisa || undefined;

    // Branches, matched by name so existing bookings keep theirs
    for (const b of myBranches) {
      const fields = {
        name: b.branch_name, address: b.address, area: b.area, phone: b.phone, hours: b.hours,
        coordinates: b.latitude && b.longitude ? { lat: Number(b.latitude), lng: Number(b.longitude) } : undefined,
      };
      const existing = profile.branches.find(x => x.name === b.branch_name);
      if (existing) Object.assign(existing, fields);
      else profile.branches.push(fields);
    }
    // A lab registered before with only its default branch: drop that default if it has no visits
    // (an imported chain should list its real branches only)
    profile.branches = profile.branches.filter(x => myBranches.some(b => b.branch_name === x.name) || profile.branches.length === 0);

    // Tests, matched by name; offered at every branch (the data has no per-branch list)
    for (const t of tests.filter(x => x.chain_id === c.chain_id)) {
      const fields = {
        name: t.test_name, category: t.category, price: Number(t.price_pkr), isActive: true,
        installmentEnabled:    t.installment_enabled === 'yes',
        installmentCount:      t.installment_enabled === 'yes' ? Number(t.installment_count) : 2,
        installmentTenureDays: t.installment_enabled === 'yes' ? Number(t.installment_tenure_days) : 30,
        branches: [],
      };
      const existing = profile.tests.find(x => x.name === t.test_name);
      if (existing) Object.assign(existing, fields);
      else profile.tests.push(fields);
    }
    await profile.save();
    out.push({ name: c.chain_name, email: user.email, branches: profile.branches.length, tests: profile.tests.length });
  }
  return out;
};

const importDoctors = async () => {
  const doctors = parseCsv(path.join(CLEAN, 'doctors.csv'));
  const out = [];
  for (const d of doctors) {
    const user = await account({ email: `${slug(d.name)}@doctors.carefirst.test`, name: d.name, role: 'doctor', phone: d.phone || undefined });
    const days = d.availability_days.split(',').map(x => DAY[x.trim()]).filter(Boolean);
    const bio = [d.title, d.other_specialties && `Also: ${d.other_specialties}`, d.clinic_name && `Practises at ${d.clinic_name}, Faisalabad`]
      .filter(Boolean).join('. ');
    await DoctorProfile.findOneAndUpdate(
      { user: user._id },
      {
        user: user._id,
        specialization: d.specialization,
        experience: d.experience_years ? Number(d.experience_years) : undefined,
        consultationFee: Number(d.consultation_fee_pkr),
        consultationDuration: Number(d.consultation_minutes),
        availability: WEEK.map(day => ({ day, slots: days.includes(day) ? [{ time: d.availability_hours }] : [] })),
        rating: d.rating ? Number(d.rating) : 0,
        bio,
        clinicName: d.clinic_name || undefined,
        clinicAddress: d.clinic_address,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    out.push({ name: d.name, email: user.email, specialization: d.specialization });
  }
  return out;
};

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Importing the Faisalabad dataset into "${mongoose.connection.db.databaseName}" (nothing is deleted)…`);
  const labs = await importLabs();
  const doctors = await importDoctors();
  console.log('\nLAB CHAINS (password: password123)');
  labs.forEach(l => console.log(`  ${l.name.padEnd(36)} ${l.email.padEnd(40)} ${l.branches} branch${l.branches === 1 ? '' : 'es'} · ${l.tests} tests`));
  console.log(`\nDOCTORS: ${doctors.length} (password: password123), e.g.`);
  doctors.slice(0, 5).forEach(d => console.log(`  ${d.name.padEnd(32)} ${d.email.padEnd(48)} ${d.specialization}`));
  console.log('  … e-mail = <first.middle.last>@doctors.carefirst.test');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Import failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
