// Turns Azure Document Intelligence "layout" output for a lab report into a list of
// results compared against the normal range printed on the report (decision 9 in PROJECT_GUIDE.md).
// No interpretation beyond that comparison: anything that can't be compared confidently
// is returned as status 'unknown' so the patient is told to ask their doctor.

// ─── Column detection ─────────────────────────────────────────────────────────
const HEADER = {
  test:   /^(test(s|\(s\))?( name)?|investigation(s)?|parameter( name)?|examination|description|analyte|component)$/i,
  result: /^(result(s)?|value|observed value|your value|patient value)$/i,
  // also a bare "NORMAL" over the ranges (Shaukat Khanum: TEST(s) | NORMAL | UNIT(s) | <date>)
  range:  /(normal|reference|ref\.?|biological).*(value|range|interval|limit)s?|^(normal|reference) ?(value|range)s?$|^ranges?$|^normal$/i,
  unit:   /^unit(s|\(s\))?$/i,
  flag:   /^(flag|status|remarks?)$/i,
};

const clean = (s) => String(s || '')
  .replace(/:(un)?selected:/g, ' ')        // checkbox marks the OCR adds
  .replace(/«/g, '<').replace(/»/g, '>')
  .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2') // decimal comma: "0,70" → "0.70" (thousands keep 3 digits)
  .replace(/(\d\s*[-–]\s*)\.\s*(\d)/g, '$10.$2') // OCR'd leading decimal: "0.02 - . 5" → "0.02 - 0.5"
  .replace(/\s+/g, ' ').replace(/[:]+$/, '').trim();

// Rows of a table as arrays of cell text, plus which rows are column headers
const tableRows = (table) => {
  const rows = [];
  for (const c of table.cells) {
    (rows[c.rowIndex] = rows[c.rowIndex] || { cells: [], header: false }).cells[c.columnIndex] = clean(c.content);
    if (c.kind === 'columnHeader') rows[c.rowIndex].header = true;
  }
  return rows.filter(Boolean).map(r => ({ ...r, cells: Array.from({ length: table.columnCount }, (_, i) => r.cells[i] || '') }));
};

// Find test / result / range / unit / flag columns from a header row
const mapColumns = (cells) => {
  const map = {};
  cells.forEach((text, i) => {
    for (const [key, re] of Object.entries(HEADER)) {
      if (map[key] === undefined && re.test(text)) { map[key] = i; return; }
    }
  });
  if (map.test === undefined || map.range === undefined) return null;
  // Some labs head the result column with the sample number / date instead of "Result"
  if (map.result === undefined) {
    const free = cells.findIndex((t, i) => !Object.values(map).includes(i) && (t === '' || /\d/.test(t)));
    if (free < 0) return null;
    map.result = free;
  }
  // An unnamed column right after the result usually holds the lab's High/Low flag
  if (map.flag === undefined && cells[map.result + 1] === '' && !Object.values(map).includes(map.result + 1)) map.flag = map.result + 1;
  return map;
};

// ─── Values and ranges ────────────────────────────────────────────────────────
const NUM = /[<>≤≥]?\s*=?\s*\d[\d,]*(?:\.\d+)?/;

// "↑5.57", "+ 14,220", "¥12.9", "222 mg/dL", "<8" → { value, qualifier, unit, arrow }
const parseResult = (raw) => {
  const text = clean(raw);
  if (!text) return null;
  const arrow = /^\s*[↑▲]/.test(text) ? 'high' : /^\s*[↓▼]/.test(text) ? 'low' : null;
  const m = text.replace(/^[\s+*¥↑↓▲▼#!]+/, '').match(/^([<>≤≥])?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*([a-zA-Zµ%/^\d.*]+(?:\/[a-zA-Z\d^.]+)?)?\s*$/);
  if (!m) return { text, value: null, arrow };
  return {
    text,
    value: Number(m[2].replace(/,/g, '')),
    upperOfRange: m[3] !== undefined ? Number(m[3]) : null, // "0-2" counts (e.g. urine cells)
    qualifier: m[1] || null,
    unit: m[4] || null,
    arrow,
  };
};

const BAND_LABEL = /(preferred|normal|optimal|desirable|negative|non[- ]?reactive|adults?|desired)/i;
const SEX_LABEL = /\b(males?|females?|men|women)\b/i;

// Split a printed range into labelled bands: "Male: 0 - 15 Female: 0 - 20",
// "< 200 Preferred 200 - 240 Borderline High > 240 High", "Negative: < 17.0 U/ml Positive: >17"
const splitBands = (text) => {
  // also "number: label" bands — ">60: Normal 15-60: Borderline <15: Kidney Failure"
  const parts = text.split(/\s+(?=[<>≤≥]?\s*\d[\d.,]*(?:\s*-\s*\d[\d.,]*)?\s*:\s*[A-Za-z])|(?=(?:\b[A-Za-z][A-Za-z .()-]{1,30}:\s*[<>≤≥]?\s*\d))|(?<=\d(?:\.\d+)?\s*(?:[a-zA-Z/%^\d.]+)?\s*(?:\([A-Za-z]+\))?)\s+(?=[<>≤≥]\s*\d|\d[\d.]*\s*-\s*\d)/);
  return parts.map(p => p.trim()).filter(Boolean);
};

const parseBand = (band) => {
  const m1 = band.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|–|to)\s*(\d[\d,]*(?:\.\d+)?)/);
  if (m1) return { low: Number(m1[1].replace(/,/g, '')), high: Number(m1[2].replace(/,/g, '')) };
  const m2 = band.match(/(<=|≤|<|=\s*\/?\s*<)\s*(\d[\d,]*(?:\.\d+)?)/);
  if (m2) return { low: null, high: Number(m2[2].replace(/,/g, '')), highExclusive: m2[1] === '<' };
  const m3 = band.match(/(>=|≥|>|=\s*\/?\s*>)\s*(\d[\d,]*(?:\.\d+)?)/);
  if (m3) return { low: Number(m3[2].replace(/,/g, '')), high: null, lowExclusive: m3[1] === '>' };
  return null;
};

// The band that applies to this patient: their sex if the range is split by sex,
// otherwise the "normal / preferred / adult / negative" band, otherwise the first one.
const pickBand = (text, sex) => {
  const bands = splitBands(text);
  if (bands.length === 0) return null;
  if (bands.length > 1 && sex) {
    const mine = bands.find(b => SEX_LABEL.test(b) && (sex === 'female' ? /\b(females?|women)\b/i : /\b(males?|men)\b/i).test(b) && !(sex === 'male' && /female/i.test(b)));
    if (mine) return parseBand(mine);
  }
  if (bands.length > 1 && bands.every(b => SEX_LABEL.test(b))) return null; // split by sex but sex unknown
  const preferred = bands.find(b => BAND_LABEL.test(b) && parseBand(b));
  return parseBand(preferred || bands[0]);
};

const QUALITATIVE_NORMAL = /^(nil|negative|neg|normal|absent|non[- ]?reactive|not detected|clear|none( seen)?)$/i;

// ─── Interpretation ───────────────────────────────────────────────────────────
const statusFor = ({ result, rangeText, flagText, sex }) => {
  const flag = clean(flagText).toLowerCase();
  if (/^(h|high|hi|↑)$/.test(flag)) return { status: 'high', basis: 'lab_flag' };
  if (/^(l|low|lo|↓)$/.test(flag)) return { status: 'low', basis: 'lab_flag' };

  const range = clean(rangeText);
  const expectsNone = Boolean(range) && range.split(/[,/]/).every(e => QUALITATIVE_NORMAL.test(e.trim()));
  // A number where "Nil / Negative" is expected: 0 is fine, anything else is not
  if (result.value !== null && expectsNone) {
    return (result.upperOfRange ?? result.value) === 0 ? { status: 'normal', basis: 'qualitative' } : { status: 'abnormal', basis: 'qualitative' };
  }
  // "Nil" where a count range starting at 0 is expected
  if (result.value === null && QUALITATIVE_NORMAL.test(result.text.replace(/^[\s*]+/, '')) && /^0\s*(-|–|to)\s*\d/.test(range)) {
    return { status: 'normal', basis: 'qualitative' };
  }
  if (result.value === null) {
    // Words: compare with the expected word ("Nil", "Negative", "Clear, Transparent")
    if (!range) return { status: 'unknown', basis: 'no_range' };
    const expected = range.split(/[,/]| or /i).map(s => s.trim().toLowerCase()).filter(Boolean);
    const got = result.text.replace(/^[\s*]+/, '').toLowerCase();
    if (expected.includes(got) || (QUALITATIVE_NORMAL.test(got) && expected.some(e => QUALITATIVE_NORMAL.test(e)))) return { status: 'normal', basis: 'qualitative' };
    if (expected.some(e => QUALITATIVE_NORMAL.test(e)) || /positive|reactive|\+/.test(got)) return { status: 'abnormal', basis: 'qualitative' };
    return { status: 'unknown', basis: 'qualitative' };
  }

  if (result.arrow) return { status: result.arrow, basis: 'lab_flag' };
  if (!range) return flag === 'normal' ? { status: 'normal', basis: 'lab_flag' } : { status: 'unknown', basis: 'no_range' };
  const band = pickBand(range, sex);
  if (!band) return flag === 'normal' ? { status: 'normal', basis: 'lab_flag' } : { status: 'unknown', basis: 'range_unclear' };

  const value = result.upperOfRange ?? result.value; // "0-2" cells → compare the upper end
  // "<8" against "< 17": a result below a small number is below any upper limit above it
  if (result.qualifier === '<' && band.high !== null && value <= band.high) return { status: 'normal', basis: 'range', band };
  if (band.high !== null && (band.highExclusive ? value >= band.high : value > band.high)) return { status: 'high', basis: 'range', band };
  if (band.low !== null && (band.lowExclusive ? value <= band.low : value < band.low)) return { status: 'low', basis: 'range', band };
  return { status: 'normal', basis: 'range', band };
};

// Patient sex as printed on the report ("Age/Sex: 27 (Y) / M", "Sex: Female", "70 Year(s)/Female")
const reportSex = (content) => {
  const head = String(content || '').slice(0, 1500);
  const m = head.match(/\b(?:sex|gender)\b[^\n]{0,40}?\/\s*(male|female|m|f)\b/i) ||
    head.match(/\b(?:sex|gender)\b[^\n]{0,40}?\b(male|female|m|f)\b/i) || head.match(/\d+\s*(?:\(?y(?:ear)?s?\)?(?:\(s\))?)\s*\/\s*(male|female|m|f)\b/i);
  if (!m) return /\bfemale\b/i.test(head) ? 'female' : /\bmale\b/i.test(head) ? 'male' : null;
  return /^f/i.test(m[1]) ? 'female' : 'male';
};

// Lines that look like section headings or sample IDs rather than results
const SKIP_ROW = /^(physical|chemical|microscopic|clinical|special)? ?(examination|chemistry|pathology|haematology|hematology|serology|immunology|virology)$|^note\b|^rbc morphology$/i;
// Result words a lab report actually uses (so OCR junk like "Dr" isn't mistaken for data)
const RESULT_WORD = /^(nil|negative|neg|positive|pos|normal|absent|present|trace|reactive|non[- ]?reactive|not detected|detected|clear|turbid|none( seen)?|[+]{1,4}|\(\+{1,4}\))$/i;
const looksLikeDataRow = (cells, map) => {
  const r = clean(cells[map.result]).replace(/^\*+\s*/, '');
  const parsed = parseResult(r);
  return Boolean(parsed && (parsed.value !== null || RESULT_WORD.test(r)));
};
const looksLikeId = (s) => /\d{2}-[A-Za-z]{3}-\d{2,4}|\d{4}-\d{2}-\d{4,}/.test(s);

// What to show: OCR arrows / noise removed in front of numbers, "** ++" kept as "++"
const displayResult = (result) =>
  result.value !== null
    ? result.text.replace(/^[\s+*¥#!↑↓▲▼]+(?=[\d<>≤≥])/, '').trim()
    : result.text.replace(/^\*+\s*/, '').trim();

// ─── Tables without a usable header ───────────────────────────────────────────
// Some reports print the "Test Name | Results | Reference Ranges" header as a separate
// table, or OCR merges a whole row into one cell. Two fallbacks, both strict enough to
// skip ordinary text: guess the columns from the cells, or read a row as a line of text.

const RANGE_START = /^(?:[A-Za-z][A-Za-z .()-]{0,24}:\s*)?(?:[<>≤≥]\s*=?\s*\d|\d[\d,]*(?:\.\d+)?\s*(?:-|–|to)\s*\d)/;
const isRangeCell = (t) => RANGE_START.test(clean(t));
const isNumberCell = (t) => {
  const text = clean(t);
  if (!text || isRangeCell(text) || looksLikeId(text)) return false;
  const r = parseResult(text);
  return Boolean(r && r.value !== null);
};
const isUnitCell = (t) => /^[a-zµ%/][a-zµ%/\d^.\s]{0,14}$/i.test(clean(t)) && /[a-zµ%]/i.test(t);
const isNameCell = (t) => { const c = clean(t); return /^[A-Za-z(]/.test(c) && (c.match(/[A-Za-z]/g) || []).length >= 2 && !isRangeCell(c) && !isNumberCell(c) && c.length <= 60; };

// Columns from the cells themselves: the column of plain numbers is the result, the column
// of "a - b" / "< n" is the range, the text column on the left is the test name.
const inferColumns = (rows) => {
  const width = rows[0]?.cells.length || 0;
  const count = (test) => Array.from({ length: width }, (_, col) => rows.filter(r => test(r.cells[col])).length);
  const nums = count(isNumberCell), ranges = count(isRangeCell), names = count(isNameCell), units = count(isUnitCell);
  const best = (arr, skip) => arr.reduce((b, v, i) => (skip.includes(i) || v <= (arr[b] ?? -1) ? b : i), -1);
  const result = best(nums, []);
  const range = best(ranges, [result]);
  const test = best(names, [result, range]);
  // Result tables read left to right: name, result, range
  if (result < 0 || range < 0 || test < 0 || !(test < result && result < range)) return null;
  const complete = rows.filter(r => isNameCell(r.cells[test]) && isNumberCell(r.cells[result]) && isRangeCell(r.cells[range])).length;
  if (complete < 2) return null;
  const map = { test, result, range };
  const unit = best(units, [result, range, test]);
  if (unit >= 0 && units[unit] >= 2) map.unit = unit;
  return map;
};

// "Uric Acid 4.3 2.4 - 6.2 mg/dl"  (name, result, range)
// "Total Protein 6.0 - 8.7 7.4 g/dl Normal"  (name, range, result — the range printed under the name)
const NUM_RE = '\\d[\\d,]*(?:\\.\\d+)?';
const RANGE_RE = `(?:[A-Za-z][A-Za-z .()-]{0,24}:\\s*)?(?:[<>≤≥]\\s*=?\\s*${NUM_RE}|${NUM_RE}\\s*(?:-|–|to)\\s*${NUM_RE})`;
const RESULT_RE = `[+↑↓▲▼*]?\\s*[<>]?\\s*${NUM_RE}`;
const UNIT_RE = '[a-zA-Zµ%/][\\w/^.µ%]*';
const NAME_SPLIT = new RegExp(`^(.*?[A-Za-z)\\]])\\s+(?=[+↑↓▲▼*]?\\s*[<>≤≥]?\\s*\\d|(?:males?|females?|adults?|upto|children)\\b\\s*:?)`, 'i');
const LINE_A = new RegExp(`^(${RESULT_RE})(?:\\s*(${UNIT_RE}))?\\s+(${RANGE_RE}(?:\\s+${RANGE_RE})*)(?:\\s*(.*))?$`);
const LINE_B = new RegExp(`^((?:${RANGE_RE}\\s*)+?)\\s+(${RESULT_RE})(?:\\s+(${UNIT_RE}))?(?:\\s+(normal|high|low))?(?:\\s|$)`, 'i');
const LINE_RESULT = new RegExp(`^(${RESULT_RE})(?:\\s*(${UNIT_RE}))?(?:\\s+(normal|high|low))?(?:\\s|$)`, 'i');
const FLAG_AT_END = /\b(normal|high|low)\s*$/i;
// Rows of a lab's guidance table ("Optimal < 100", "Borderline High 150 - 189") are not results
const CATEGORY_NAME = /^(?:near |above |below )?(?:optimal|desirable|ideal|borderline|high|very high|low|normal|abnormal|deficien|insufficien|sufficien|toxic|risk)\b/i;
const CONTINUES_RANGE = /^(?:[<>≤≥]|\d|(?:males?|females?|men|women|adults?|upto|up to|children|years?)\b)/i;

// Reads the rows of a table as text lines; a test's range may continue on the next rows
// ("Gamma GT Male: < 55" / "Female: < 38") and the lab's "Normal" may sit below the value.
const readRowsAsText = (rows) => {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const text = clean(rows[i].cells.filter(Boolean).join(' '));
    const split = text.match(NAME_SPLIT);
    if (!split) continue;
    const name = split[1].trim();
    if (name.includes(':') || name.split(' ').length > 7 || !isNameCell(name)) continue;
    const rest = text.slice(split[0].length);
    let result, unit = '', range = '', flag = '';
    let m = rest.match(LINE_A);
    if (m) {
      result = m[1]; unit = m[2] || '';
      range = m[3];
      if (/^:/.test((m[4] || '').trim())) range = clean(`${range}${m[4]}`); // ">60: Normal 15-60: Borderline"
      const tail = (m[4] || '').trim();
      if (!unit && tail && isUnitCell(tail.split(' ')[0])) unit = tail.split(' ')[0];
    } else if ((m = rest.match(LINE_B))) {
      range = m[1].trim(); result = m[2]; unit = m[3] || ''; flag = m[4] || '';
    } else if ((m = rest.match(LINE_RESULT))) {
      result = m[1]; unit = m[2] || ''; flag = m[3] || '';
    } else continue;
    // Following rows: more of the range (under the name), the unit or the lab's flag under the value
    for (let j = i + 1; j < Math.min(rows.length, i + 5); j++) {
      const first = clean(rows[j].cells[0]);
      if (first && !CONTINUES_RANGE.test(first)) break; // the next test starts
      if (first) range = clean(`${range} ${first}`);
      for (const cell of rows[j].cells.slice(1)) {
        const c = clean(cell);
        if (!unit && isUnitCell(c.replace(FLAG_AT_END, '').trim())) unit = c.replace(FLAG_AT_END, '').trim();
        if (!flag && FLAG_AT_END.test(c)) flag = c.match(FLAG_AT_END)[1];
      }
    }
    if (!range && !flag) continue; // nothing to compare with
    out.push({ name, result, unit, range, flag });
  }
  return out;
};

const interpretReport = (analysis) => {
  const tables = analysis?.tables || [];
  const sex = reportSex(analysis?.content);
  const findings = [];
  const seen = new Set();
  let lastMap = null;

  const addFinding = (rawName, rawResult, rawRange, flagText, unitText) => {
    const name = clean(rawName).replace(/\s+(spectrophotometry|calculated|elisa|clia)$/i, '');
    if (!name || !rawResult || SKIP_ROW.test(name) || looksLikeId(rawResult) || name.length > 60) return;
    const result = parseResult(rawResult);
    if (!result) return;
    const rangeText = clean(rawRange);
    const value = result.value !== null ? String(result.value) : result.text.toLowerCase();
    const key = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${value}`;
    const twin = findings.some(f => f.name.slice(0, 3).toLowerCase() === name.slice(0, 3).toLowerCase() &&
      f.range === rangeText && rangeText && String(parseResult(f.result)?.value ?? '') === value);
    if (seen.has(key) || twin) return;
    seen.add(key);
    const { status, basis } = statusFor({ result, rangeText, flagText, sex });
    const band = rangeText ? pickBand(rangeText, sex) : null; // the normal limits used, for the summary
    findings.push({
      name,
      result:     displayResult(result),
      unit:       clean(unitText) || result.unit || '',
      range:      rangeText,
      normalLow:  band?.low ?? null,
      normalHigh: band?.high ?? null,
      status,     // high | low | abnormal | normal | unknown
      basis,      // range | lab_flag | qualitative | no_range | range_unclear
    });
  };

  for (const table of tables) {
    const rows = tableRows(table);
    let map = null;
    let start = 0;
    // Header can be the first or second row (some reports put a title row above it)
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const m = mapColumns(rows[i].cells);
      if (m) { map = m; start = i + 1; break; }
    }
    // A table with the same shape as the previous results table continues it — if it starts
    // with result rows (a title row with a sample ID / date may come first), not other headings
    if (!map && lastMap && table.columnCount === lastMap.width) {
      const first = rows.findIndex((r, i) => i < 3 && looksLikeDataRow(r.cells, lastMap.map));
      const titlesOnly = rows.slice(0, Math.max(first, 0)).every(r => !clean(r.cells[lastMap.map.result]) || looksLikeId(r.cells[lastMap.map.result]));
      if (first >= 0 && titlesOnly) { map = lastMap.map; start = first; }
    }
    let inferred = false;
    if (!map) {
      map = inferColumns(rows);
      if (map) { start = 0; inferred = true; }
    }
    if (!map) {
      for (const r of readRowsAsText(rows)) if (!CATEGORY_NAME.test(r.name)) addFinding(r.name, r.result, r.range, r.flag, r.unit);
      continue;
    }
    lastMap = { map, width: table.columnCount };

    for (const row of rows.slice(start)) {
      if (inferred && (!looksLikeDataRow(row.cells, map) || clean(row.cells[map.test]).includes(':') || CATEGORY_NAME.test(clean(row.cells[map.test])))) continue;
      addFinding(row.cells[map.test], row.cells[map.result], map.range !== undefined ? row.cells[map.range] : '',
        map.flag !== undefined ? row.cells[map.flag] : '', map.unit !== undefined ? row.cells[map.unit] : '');
    }
  }

  // Results printed outside tables that are positive on their own line — e.g. a Dengue test:
  //   "Dengue NS1 Antigen" / "Negative (<1.00) Positive (≥1.0)" / "3.39 Positive"
  // These must never be missed, so they are added as "not normal" with the name found above.
  const lines = String(analysis?.content || '').split('\n').map(l => l.trim());
  lines.forEach((line, i) => {
    const m = line.match(/^(?:[<>]?\s*\d[\d.,]*\s*)?(positive|reactive|detected)$/i);
    if (!m) return;
    let name = null;
    let range = '';
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const prev = lines[j];
      if (/\b(negative|positive)\b|[:<>≥≤]/i.test(prev)) { range = range || prev; continue; }
      if (/[a-z]{3}/i.test(prev) && prev.length <= 60 && !/\d{2}-[a-z]{3}-\d{2}/i.test(prev)) { name = prev; break; }
    }
    if (!name || findings.some(f => f.name.toLowerCase() === name.toLowerCase())) return;
    // "Negative (<1.00) Positive (≥1.0)" → the expected part is "Negative (<1.00)"
    const expected = range.split(/\bpositive\b/i)[0].trim() || range;
    findings.push({ name, result: line, unit: '', range: expected, normalLow: null, normalHigh: null, status: 'abnormal', basis: 'text' });
  });

  const kind = findings.length > 0 ? 'table' : (String(analysis?.content || '').trim().length > 200 ? 'narrative' : 'unreadable');
  return { kind, sex, findings };
};

module.exports = { interpretReport, parseResult, pickBand, statusFor, reportSex };
