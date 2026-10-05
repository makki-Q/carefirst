// Prepares faisalabad_doctors_public.csv for CareFirst:
//
//   node dataset/scripts/prepare-doctors.js      → dataset/clean/doctors.csv
//
// Decided with Makki (2026-10-05): real names; online-only doctors and non-doctors left out;
// consultation fee and clinic timings filled in (typical Faisalabad fee for the specialty,
// evening clinic Mon–Sat 5–9 PM) and shown in the app like any other doctor's.
// The `filled_in` column records which values were filled in rather than collected.
const fs   = require('fs');
const path = require('path');

const SRC   = path.join(__dirname, '..', 'faisalabad_doctors_public.csv');
const CLEAN = path.join(__dirname, '..', 'clean');

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
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

// Aggregator helplines and a placeholder number — not the doctors' own phones
const NOT_DOCTOR_PHONES = new Set(['0415068065', '04238900939', '03001234567']);
const NOT_DOCTORS = /^(nutritionist|dietitian|psychology|psychologist)$/i;

// Typical Faisalabad consultation fee (PKR) and appointment length (minutes) per specialty
const FEES = [
  [/neurosurgeon|oncologist|spinal surgeon/i, 3000, 20],
  [/cardiologist|neurologist|gastroenterologist|pulmonologist/i, 2500, 20],
  [/[Gg]ynecologist|[Oo]bstetrician|\bENT\b/, 2000, 20], // "ENT" as a word, not inside "Dentist"
  [/internal medicine|consultant physician|pediatrician|maxillofacial/i, 1500, 20],
  [/dentist/i, 1000, 30],
  [/general physician|family physician/i, 1000, 15],
];
const feeFor = (specialties) => {
  for (const [re, fee, minutes] of FEES) if (re.test(specialties)) return { fee, minutes };
  return { fee: 1500, minutes: 20 };
};

// "Health Care Clinic" from ".../h/health-care-clinic-faisalabad/13320", else the first address part
const clinicName = (row) => {
  const first = row.clinic_or_hospital_address.split(',')[0].trim();
  if (/hospital|clinic|complex|centre|center|dental|lab/i.test(first)) return first;
  const slug = (row.source_url.match(/\/h\/([a-z0-9-]+)\//) || [])[1];
  if (!slug) return '';
  const words = slug.replace(/-(faisalabad|fsd|faisal-abad)$/, '').split('-');
  return words.map(w => (w === 'idc' ? 'IDC' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
};

const phone = (raw) => {
  const digits = raw.replace(/\D/g, '');
  if (!digits || NOT_DOCTOR_PHONES.has(digits)) return '';
  return /^03\d{9}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
};

const rows = parseCsv(SRC);
const kept = [], skipped = [];
for (const r of rows) {
  const specialties = r.specialty.split(';').map(x => x.trim()).filter(Boolean);
  if (/online consultation/i.test(r.clinic_or_hospital_address)) { skipped.push(`${r.doctor_name} (online only)`); continue; }
  if (specialties.every(x => NOT_DOCTORS.test(x)) || !/\bdr\.?\b/i.test(r.doctor_name)) { skipped.push(`${r.doctor_name} (not a doctor)`); continue; }

  const title = (r.doctor_name.match(/^(Assoc\. Prof\.|Prof\.|Asst\. Prof\.)\s+/) || [])[1] || '';
  const name = r.doctor_name.replace(/^(Assoc\. Prof\.|Prof\.|Asst\. Prof\.)\s+/, '').trim();
  const { fee, minutes } = feeFor(specialties[0]); // the main specialty sets the fee
  kept.push({
    name,
    title: title.replace('Assoc. Prof.', 'Associate Professor').replace('Asst. Prof.', 'Assistant Professor').replace(/^Prof\.$/, 'Professor'),
    specialization: specialties[0],
    other_specialties: specialties.slice(1).join('; '),
    experience_years: r.experience_years,
    rating: r.rating_5,
    review_count: r.review_count,
    clinic_name: clinicName(r),
    clinic_address: r.clinic_or_hospital_address,
    phone: phone(r.phone),
    consultation_fee_pkr: fee,
    consultation_minutes: minutes,
    availability_days: 'Mon,Tue,Wed,Thu,Fri,Sat',
    availability_hours: '05:00 PM – 09:00 PM',
    filled_in: 'consultation_fee_pkr; consultation_minutes; availability',
    source: r.source,
    source_url: r.source_url,
    collected_on: r.last_checked,
  });
}

fs.mkdirSync(CLEAN, { recursive: true });
const header = Object.keys(kept[0]);
fs.writeFileSync(path.join(CLEAN, 'doctors.csv'), [header, ...kept.map(r => header.map(k => r[k]))].map(r => r.map(csv).join(',')).join('\n') + '\n');
console.log(`doctors: ${kept.length} kept, ${skipped.length} left out (${skipped.join(', ')})`);
console.log(`phones kept: ${kept.filter(d => d.phone).length}; clinics named: ${kept.filter(d => d.clinic_name).length}`);
