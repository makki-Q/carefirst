// Unit tests for the lab report reader + summary — `npm run test:unit`.
// Fixtures are synthetic Document Intelligence "layout" results shaped like real Pakistani
// lab reports (no patient data): Chughtai-style CBC, scanned reports with OCR noise,
// graded / sex-specific ranges, urine word results, non-table results, written reports.
const assert = require('assert');
const { interpretReport, parseResult, pickBand } = require('../utils/reportInterpreter');
const { summarizeReport } = require('../utils/reportSummary');

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
};

// Build a Document Intelligence table from rows; the first `headerRows` rows are column headers
const table = (rows, headerRows = 1) => ({
  rowCount: rows.length,
  columnCount: Math.max(...rows.map(r => r.length)),
  cells: rows.flatMap((r, ri) => r.map((content, ci) => ({ rowIndex: ri, columnIndex: ci, content, ...(ri < headerRows ? { kind: 'columnHeader' } : {}) }))),
});
const find = (r, name) => r.findings.find(f => f.name === name);

console.log('\nReport reader');

test('CBC with a sample number as the result heading', () => {
  const r = interpretReport({
    content: 'Patient Name: X\nAge/Sex: 19 Year(s)/Female',
    tables: [table([
      ['TEST', 'NORMAL VALUE', 'UNIT', '44202-20-06 20-Jun-2019 1:20'],
      ['Hb', '11.5 - 16', 'g/dl', '8.8'],
      ['Platelet Count', '150 - 400', 'x10^9/l', '295'],
      ['WBC Count (TLC)', '4 - 11', 'x10^9/l', '12.4'],
    ])],
  });
  assert.strictEqual(r.kind, 'table');
  assert.strictEqual(r.sex, 'female');
  assert.strictEqual(find(r, 'Hb').status, 'low');
  assert.strictEqual(find(r, 'Hb').unit, 'g/dl');
  assert.strictEqual(find(r, 'Platelet Count').status, 'normal');
  assert.strictEqual(find(r, 'WBC Count (TLC)').status, 'high');
});

test("the lab's own High / Low column wins", () => {
  const r = interpretReport({ content: '', tables: [table([
    ['Investigation', 'Result', '', 'Reference Value', 'Unit'],
    ['Cholesterol Total Spectrophotometry', '250.00', 'High', '< 200.00', 'mg/dL'],
    ['HDL Cholesterol Spectrophotometry', '50.00', '', '> 40.00', 'mg/dL'],
  ])] });
  assert.strictEqual(find(r, 'Cholesterol Total').status, 'high');
  assert.strictEqual(find(r, 'Cholesterol Total').basis, 'lab_flag');
  assert.strictEqual(find(r, 'HDL Cholesterol').status, 'normal');
});

test('graded and sex-specific ranges use the normal band / the printed sex', () => {
  const r = interpretReport({ content: 'Patient Name: Y Sex: Female', tables: [table([
    ['Test Name', 'Results', 'Reference Range'],
    ['Cholesterol', '222 mg/dL', '< 200 Preferred 200 - 240 Borderline High > 240 High'],
    ['HDL Cholesterol', '45 mg/dL', '> 40 (Males) > 50 (Females)'],
    ['Triglycerides', '102 mg/dL', 'Preferred: < 150 Borderline: 150 -199 High: > 199'],
    ['E.S.R.', '18', 'Male: 0 - 15 Female: 0 - 20'],
  ])] });
  assert.strictEqual(find(r, 'Cholesterol').status, 'high');
  assert.strictEqual(find(r, 'Cholesterol').normalHigh, 200);
  assert.strictEqual(find(r, 'HDL Cholesterol').status, 'low', '45 is low for a woman (> 50)');
  assert.strictEqual(find(r, 'Triglycerides').status, 'normal');
  assert.strictEqual(find(r, 'E.S.R.').status, 'normal', '18 is within the female 0 - 20');
});

test('scanned report: OCR arrows, thousands separators, section and ID rows', () => {
  const r = interpretReport({ content: 'Age/Sex: 45 Y / M', tables: [table([
    ['Visit Date: 07-Jul-2025', 'Final Report', 'Report Date'],
    ['Test Name', 'Results', 'Reference Ranges'],
    ['Complete Blood Picture', '07-Jul-25 2507-01-060054', ''],
    ['WBC Count', '+ 14,220', '4000 - 10,000'],
    ['RBC Count', '↑5.57', '4.50 - 5.50'],
    ['Haemoglobin', '¥12.9', '13 - 17'],
    ['Gamma GT', '15', 'Male: < 55 Female: < 38'],
  ], 2)] });
  assert.strictEqual(r.findings.length, 4, 'the section row is skipped');
  assert.deepStrictEqual([find(r, 'WBC Count').status, find(r, 'WBC Count').result], ['high', '14,220']);
  assert.strictEqual(find(r, 'RBC Count').status, 'high');
  assert.deepStrictEqual([find(r, 'Haemoglobin').status, find(r, 'Haemoglobin').result], ['low', '12.9']);
  assert.strictEqual(find(r, 'Gamma GT').status, 'normal');
});

test('urine: words, "Nil" against counts, counts against "Nil", "<8" against "< 17"', () => {
  const r = interpretReport({ content: '', tables: [
    table([
      ['Parameter Name', 'Result', 'Reference Value', 'Unit'],
      ['Sugar', 'Nil', 'Nil', ''],
      ['Protein', '** ++', 'Negative', ''],
      ['Appearance', 'Turbid', 'Clear, Transparent', ''],
      ['Pus Cells', '0-2', '0-5', '/HPF'],
      ['W.B.C./HPF', '8-10', '0 - 5', ''],
      ['Epithelial Cells', 'NIL', '0 - 10', ''],
      ['R.B.C/HPF', '40-50', 'Nil', ''],
      ['Anti CCP Ab', '<8', 'Negative: < 17.0 U/ml Positive: = />17.00', ''],
    ]),
  ] });
  const s = (n) => find(r, n).status;
  assert.deepStrictEqual(
    ['Sugar', 'Protein', 'Appearance', 'Pus Cells', 'W.B.C./HPF', 'Epithelial Cells', 'R.B.C/HPF', 'Anti CCP Ab'].map(s),
    ['normal', 'abnormal', 'abnormal', 'normal', 'high', 'normal', 'abnormal', 'normal'],
  );
  assert.strictEqual(find(r, 'Protein').result, '++');
});

test('a continuation table without headings is read; a guidance table is not', () => {
  const r = interpretReport({ content: '', tables: [
    table([['Parameter Name', 'Result', 'Reference Value'], ['pH', '6.5', '5.0-8.0']]),
    table([['Nitrite', 'Positive', 'Negative'], ['Ketones', 'Nil', 'Nil']]),
    table([['NLA - 2014 RECOMMENDATIONS', 'Total Cholesterol (mg/dL)', 'HDL'], ['Optimal', 'Dr', '< 40']]),
  ] });
  assert.deepStrictEqual(r.findings.map(f => f.name), ['pH', 'Nitrite', 'Ketones']);
  assert.strictEqual(find(r, 'Nitrite').status, 'abnormal');
});

test('a positive result printed outside any table is never missed', () => {
  const r = interpretReport({
    content: 'Department of Virology\nDengue NS1 Antigen\nNegative (<1.00) Positive (≥1.0)\n3.39 Positive\nInterpretation: ...',
    tables: [table([['Parameter Name', 'Result', 'Reference Value'], ['pH', '6.5', '5.0-8.0']])],
  });
  const dengue = find(r, 'Dengue NS1 Antigen');
  assert.ok(dengue, 'found');
  assert.deepStrictEqual([dengue.status, dengue.result, dengue.range], ['abnormal', '3.39 Positive', 'Negative (<1.00)']);
});

test('a written report (biopsy / scan) is recognised; an empty one is unreadable', () => {
  const narrative = interpretReport({ content: 'Histopathology Report\nGross: two skin covered soft tissue pieces collectively measuring 1.5 cm. '.repeat(4), tables: [] });
  assert.deepStrictEqual([narrative.kind, narrative.findings.length], ['narrative', 0]);
  assert.strictEqual(interpretReport({ content: 'x', tables: [] }).kind, 'unreadable');
});

test('value and range parsing helpers', () => {
  assert.deepStrictEqual([parseResult('222 mg/dL').value, parseResult('222 mg/dL').unit], [222, 'mg/dL']);
  assert.strictEqual(parseResult('Positive').value, null);
  assert.deepStrictEqual(pickBand('2.5 - 6.2'), { low: 2.5, high: 6.2 });
  assert.strictEqual(pickBand('Male: 0 - 15 Female: 0 - 20', null), null, 'split by sex, sex unknown → no band');
});

console.log('\nSummary');

test('flagged results are listed in English and Urdu with the doctor message', () => {
  const s = summarizeReport({ kind: 'table', findings: [
    { name: 'Haemoglobin', result: '8.8', unit: 'g/dl', range: '11.5 - 16', normalLow: 11.5, normalHigh: 16, status: 'low' },
    { name: 'LDL Cholesterol', result: '160', unit: 'mg/dL', range: '< 130', normalLow: null, normalHigh: 130, status: 'high' },
    { name: 'pH', result: '6.5', unit: '', range: '5.0-8.0', normalLow: 5, normalHigh: 8, status: 'normal' },
  ] });
  assert.ok(s.en.includes('2 of your 3 results are outside the normal range'));
  assert.ok(s.en.includes('Haemoglobin 8.8 g/dl (low; normal 11.5 to 16)'));
  assert.ok(s.en.includes('LDL Cholesterol 160 mg/dL (high; normal below 130)'));
  assert.ok(s.en.includes('visit them'));
  assert.ok(s.ur.includes('ہیموگلوبن 8.8 g/dl (کم؛ نارمل 11.5 سے 16)'));
  assert.ok(s.ur.includes('ایل ڈی ایل (خراب) کولیسٹرول 160 mg/dL (زیادہ؛ نارمل 130 سے کم)'));
  assert.ok(s.ur.includes('اپنے ڈاکٹر کو دکھائیں'));
});

// ── Reports whose header is a separate table / whose rows OCR merges (IDC-style) ──
test('header printed as its own table: columns are found from the cells', () => {
  const r = interpretReport({
    content: 'Mrs. X\nAge/Gender: 48 Y 0 M 0 D/F',
    tables: [
      table([['Visit Date: 1-Jan-2026 1:27PM', 'Final Report - Page 1 of 1', 'Report Date: 1-Jan-2026'], ['Test Name', 'Results', 'Reference Ranges']], 2),
      table([
        ['Complete Blood Picture', '01-Jan-26 2601-01-123456', '', ''],
        ['Haemoglobin', '13.5', '12 - 15', 'g/dl'],
        ['Absolute Lymphocyte Count :unselected:', '+3,030', '1000 - 3000', '/mm3'],
        ['T3 Total', '1.10', '0,70-2.04', 'ng/ml'],       // decimal comma read by the OCR
        ['TSH', '2.82', '0.4-4,5', 'uIU/ml'],
      ]),
    ],
  });
  assert.strictEqual(r.kind, 'table');
  assert.strictEqual(r.sex, 'female', 'the M in "0 M" is months, the sex follows the slash');
  assert.strictEqual(find(r, 'Haemoglobin').status, 'normal');
  assert.strictEqual(find(r, 'Haemoglobin').unit, 'g/dl');
  assert.strictEqual(find(r, 'Absolute Lymphocyte Count').status, 'high');
  assert.strictEqual(find(r, 'T3 Total').normalLow, 0.7);
  assert.strictEqual(find(r, 'TSH').normalHigh, 4.5);
  assert.ok(!r.findings.some(f => /visit date|complete blood/i.test(f.name)), 'header and title rows are not results');
});

test('rows merged into one cell are read as text, incl. "number: label" bands', () => {
  const r = interpretReport({ content: '', tables: [table([
    ['Renal Function Tests', '01-Jan-26 2601-01-123456', '', '', ''],
    ['Uric Acid 7.9 2.4 - 6.2 :unselected:', '', '', '', 'mg/dl'],
    ['Blood Urea Nitrogen', '12.6 6- 23', '', '', 'mg/dl'],
    ['eGFR', '86', '', '>60: Normal 15-60: Borderline', 'ml/min/1.73m^2'],
  ])] });
  assert.strictEqual(find(r, 'Uric Acid').status, 'high');
  assert.strictEqual(find(r, 'Uric Acid').normalHigh, 6.2);
  assert.strictEqual(find(r, 'Blood Urea Nitrogen').status, 'normal');
  assert.strictEqual(find(r, 'eGFR').status, 'normal', '">60: Normal" is the normal band, not 15-60');
});

test('chart-style reports: range under the name, lab flag under the value', () => {
  const r = interpretReport({ content: 'Age/Gender: 48 Y 0 M 0 D/F', tables: [table([
    ['Visit Date: 1-Jan-2026 Test Name', 'Result', 'Final Report', 'History'],
    ['Liver Function Tests', '', '', ''],
    ['Total Bilirubin 0.1-1.1', '0.2', '0.202', 'Latest (0.2)'],
    ['', 'mg/dL', '', ''],
    ['S.G.O.T. (AST)', '20', '20.2', ''],
    ['9.40', 'U/L Normal', '', 'Latest (20)'],             // OCR lost the dash in "9-40"
    ['Gamma GT Male: < 55', '48', '48.1', 'Latest (48)'],
    ['Female: < 38', 'U/L', '', ''],
    ['', '', '100', '1 Jan 26'],                            // chart axis, not a test
    ['Total Protein 6.0 - 8.7', '7.4 g/dl Normal', '7.5', 'Latest (7.4)'],
  ])] });
  assert.strictEqual(find(r, 'Total Bilirubin').status, 'normal');
  assert.strictEqual(find(r, 'Total Bilirubin').unit, 'mg/dL');
  assert.strictEqual(find(r, 'S.G.O.T. (AST)').status, 'normal', "garbled range: the lab's own Normal decides");
  assert.strictEqual(find(r, 'Gamma GT').status, 'high', 'female band (< 38) from the next line');
  assert.strictEqual(find(r, 'Total Protein').status, 'normal');
  assert.strictEqual(r.findings.length, 4, r.findings.map(f => f.name).join(', '));
});

test("a lab's guidance table is never read as the patient's results", () => {
  const r = interpretReport({ content: '', tables: [table([
    ['Optimal', '< 100', '', ''],
    ['Near / Above Optimal', '100 - 129', '', ''],
    ['Borderline High', '130 - 159', '', ''],
    ['Very High', '> 190', '', ''],
  ], 0)] });
  assert.strictEqual(r.findings.length, 0);
});

test('all-normal results never claim the whole report is normal', () => {
  const s = summarizeReport({ kind: 'table', findings: [{ name: 'pH', result: '6.5', unit: '', range: '5-8', normalLow: 5, normalHigh: 8, status: 'normal' }] });
  assert.ok(s.en.includes("found in the report's tables"));
  assert.ok(s.en.includes('not checked automatically'));
  assert.ok(s.en.includes('share this report with your doctor'));
});

test('written reports are not summarised — the patient is sent to their doctor', () => {
  const s = summarizeReport({ kind: 'narrative', findings: [] });
  assert.ok(s.en.includes('A doctor needs to explain it'));
  assert.ok(s.ur.includes('ڈاکٹر'));
});

test('more than six flagged results are shortened', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, result: '9', unit: '', range: '1 - 5', normalLow: 1, normalHigh: 5, status: 'high' }));
  assert.ok(summarizeReport({ kind: 'table', findings: many }).en.includes('and 3 more'));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
