// Turns the collected lab data into the files CareFirst imports:
//
//   node dataset/scripts/prepare-labs.js
//     reads   dataset/raw/instacare_lab_prices.csv, dataset/raw/instacare_lab_branches.csv
//     writes  dataset/clean/lab_chains.csv, lab_branches.csv, lab_tests.csv
//
// What is real and what is demo (decided with Makki, 2026-10-05):
//   real   chain / branch names and areas, test names and REGULAR prices (InstaCare),
//          chain phone numbers (each lab's own website or report), approximate map pins
//          (OpenStreetMap; branches the lab's own site doesn't list are flagged)
//   demo   bank / JazzCash / EasyPaisa details (clearly fake), installment plans for tests
//          above PKR 10,000 (CareFirst's own idea — no lab offers this today), test categories
//
// Re-run it after collecting again; the raw files are never changed.
const fs   = require('fs');
const path = require('path');

const RAW   = path.join(__dirname, '..', 'raw');
const CLEAN = path.join(__dirname, '..', 'clean');

// ─── CSV helpers ──────────────────────────────────────────────────────────────
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
  return data.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
};
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const writeCsv = (file, header, rows) =>
  fs.writeFileSync(file, [header, ...rows.map(r => header.map(k => r[k]))].map(r => r.map(csv).join(',')).join('\n') + '\n');

// ─── Chains: real phone numbers from each lab's own source; demo payment details ─
const CHAINS = {
  'Chughtai Lab': {
    id: 'chughtai-lab', phone: '03-111-456-789', website: 'https://chughtailab.com',
    phoneSource: "Chughtai Lab's Faisalabad page (chughtailab.com/regional-lab/chughtai-lab-faisalabad-2)",
  },
  'Islamabad Diagnostic Centre (IDC)': {
    id: 'idc', phone: '051-111-000-432', website: 'https://idc.net.pk',
    phoneSource: 'UAN printed on IDC Faisalabad reports',
  },
  'Citilab & Research Centre': {
    id: 'citilab', phone: '111-511-512', website: 'https://citilab.com.pk',
    phoneSource: 'UAN on citilab.com.pk/contact',
  },
  'Excel Labs': {
    id: 'excel-labs', phone: '051-88-44-000', website: 'https://excel-labs.com',
    phoneSource: 'helpline on excel-labs.com/find-location',
  },
  'Innova Labs and Diagnostics': {
    id: 'innova', phone: '042-111-466-682', website: 'https://innovalab.com.pk',
    phoneSource: 'main line on innovalab.com.pk/contact (Lahore head office)',
  },
};

// Branches the lab's OWN website lists (checked 2026-10-05), with their own phone / hours.
// Everything else comes only from InstaCare and is marked "not listed on the lab's website".
const CONFIRMED = {
  'Excel Lab Susan Road Point': { phone: '041-8543355', hours: 'Mon–Sat 8:00 AM – 10:00 PM, Sun 9:00 AM – 5:30 PM',
    address: 'Inside Green Pharmacy, Near Ideal Bakery, Susan Road, Faisalabad' },
  'Excel Lab Satiana Road': { phone: '041-8547070', hours: 'Mon–Sat 8:00 AM – 10:00 PM, Sun 9:00 AM – 5:30 PM',
    address: '339-B, Near Doctor Plaza, Adjacent Punjab Bank, Satiana Road, Faisalabad' },
};
// Chains whose own website we checked: a branch not in CONFIRMED is not listed there
// (Citilab and Innova list no Faisalabad branch at all; Excel lists only its 2 points above)
const LAB_WEBSITE_CHECKED = new Set(['Innova Labs and Diagnostics', 'Citilab & Research Centre', 'Excel Labs']);

// ─── Tests ────────────────────────────────────────────────────────────────────
const CATEGORY_RULES = [
  [/hba1c|glucose|creatinine/i, 'Biochemistry'], // before Radiology ("…for CT Scan") and Haematology ("…hemoglobin")
  [/\b(mri|mrcp|mr mammography|ct[ -]|ct$|x-?ray|ultra ?sound|usg|mammograph|angiograph)/i, 'Radiology'],
  [/\becg\b|ck-?mb|troponin/i, 'Cardiology'],
  [/pcr|viral load|rna\b/i, 'Molecular Diagnostics'],
  [/karyotyp|chromosom/i, 'Genetics'],
  [/biopsy|cytology|pap smear/i, 'Histopathology & Cytology'],
  [/hcv|hbs|hiv|typhidot|dengue|anti-?musk|hbsag/i, 'Serology & Immunology'],
  [/\b(t3|t4|tsh|lh|amh|hcg|progesterone|psa|vitamin|thyroid)\b|hormone|mullerian/i, 'Hormones & Special Chemistry'],
  [/\b(cbc|blood count|hb|hemoglobin|haemoglobin|platelet|wbc|tlc|rbc|mcv|mch|rdw|esr|g6 ?pd)\b/i, 'Haematology'],
  [/urine|stool|semen/i, 'Clinical Pathology'],
];
const categoryOf = (name) => (CATEGORY_RULES.find(([re]) => re.test(name)) || [null, 'Biochemistry'])[1];

// Tidy names: InstaCare uses some all-caps names; keep abbreviations
const KEEP_UPPER = /^(CBC|LFT|RFT|TSH|T3|T4|FT3|FT4|LH|AMH|PSA|HCV|HBV|HIV|HBS|HBSAG|PCR|RNA|MRI|MRCP|CT|USG|ECG|CK-MB|ESR|G6|PD|TLC|WBC|RBC|MCV|MCH|RDW-CV|LBC|PA|AG|II|3D|NS1|ANA)$/i;
const FIXES = [
  [/Anti Musk/i, 'Anti-MuSK'],
  [/\bLumber\b/i, 'Lumbar'],                  // InstaCare's typo
  [/\bPa View\b/, 'PA View'],
  [/\s*\((Blood|Urine) Test\)$/i, ''],         // "Complete Blood Count (CBC) (Blood Test)" → "… (CBC)"
  [/\.$/, ''],                                 // "MRI Brain."
];
const tidyName = (name) => {
  let n = name.replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase()) {
    n = n.split(' ').map(w => (KEEP_UPPER.test(w.replace(/[(),]/g, '')) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
  }
  for (const [re, to] of FIXES) n = n.replace(re, to);
  return n.trim();
};

// Installments only for tests above PKR 10,000 (regular price): 10–25K → 2, 25–50K → 3, above 50K → 4, every 30 days
const installmentPlan = (price) =>
  price <= 10000 ? { enabled: false, count: '', tenure: '' }
  : { enabled: true, count: price <= 25000 ? 2 : price <= 50000 ? 3 : 4, tenure: 30 };

// ─── Build ────────────────────────────────────────────────────────────────────
const prices = parseCsv(path.join(RAW, 'instacare_lab_prices.csv'));
const branches = parseCsv(path.join(RAW, 'instacare_lab_branches.csv'));
fs.mkdirSync(CLEAN, { recursive: true });

const chainRows = Object.entries(CHAINS).map(([name, c], i) => ({
  chain_id: c.id, chain_name: name, phone: c.phone, phone_source: c.phoneSource, website: c.website,
  bank_name: 'DEMO Bank (not a real account)', account_title: `${name} (demo)`,
  account_number: `DEMO-${String(i + 1).padStart(4, '0')}-0000`, jazzcash: '', easypaisa: '',
  payment_details: 'demo',
}));

const branchRows = branches.map(b => {
  const own = CONFIRMED[b.branch_name];
  return {
    chain_id: CHAINS[b.chain].id,
    branch_name: b.branch_name.replace(/Satayana Road Satayana Road/, 'Satiana Road'),
    address: own?.address || [b.street_address.replace(/\bast Floor\b/, '1st Floor'), b.area, b.city].filter(Boolean).join(', '),
    area: b.area,
    phone: own?.phone || CHAINS[b.chain].phone,
    hours: own?.hours || '',
    latitude: b.latitude, longitude: b.longitude, location_precision: b.location_precision,
    on_lab_website: own ? 'yes' : LAB_WEBSITE_CHECKED.has(b.chain) ? 'no' : 'not checked',
    source_url: b.source_url, collected_on: b.collected_on,
  };
});

const testRows = prices.map(p => {
  const regular = Number(p.regular_price_pkr);
  const plan = installmentPlan(regular);
  return {
    chain_id: CHAINS[p.chain].id,
    test_name: tidyName(p.test_name),
    also_known_as: p.also_known_as,
    category: categoryOf(`${p.test_name} ${p.test_slug}`),
    price_pkr: regular,                       // decided: the regular (walk-in) price
    instacare_discounted_price_pkr: p.discounted_price_pkr,
    installment_enabled: plan.enabled ? 'yes' : 'no',
    installment_count: plan.count,
    installment_tenure_days: plan.tenure,
    source_url: p.source_url, collected_on: p.collected_on,
  };
});

writeCsv(path.join(CLEAN, 'lab_chains.csv'), Object.keys(chainRows[0]), chainRows);
writeCsv(path.join(CLEAN, 'lab_branches.csv'), Object.keys(branchRows[0]), branchRows);
writeCsv(path.join(CLEAN, 'lab_tests.csv'), Object.keys(testRows[0]), testRows);

const byChain = (rows) => Object.entries(rows.reduce((m, r) => ((m[r.chain_id] = (m[r.chain_id] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`chains: ${chainRows.length}`);
console.log(`branches: ${branchRows.length} (${byChain(branchRows)}); without a map pin: ${branchRows.filter(b => !b.latitude).length}`);
console.log(`tests: ${testRows.length} (${byChain(testRows)}); on installments: ${testRows.filter(t => t.installment_enabled === 'yes').length}`);
