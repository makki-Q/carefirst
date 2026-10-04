// Turns Azure Document Intelligence "layout" output for a lab report into a list of
// results compared against the normal range printed on the report (decision 9 in PROJECT_GUIDE.md).
// No interpretation beyond that comparison: anything that can't be compared confidently
// is returned as status 'unknown' so the patient is told to ask their doctor.

// ─── Column detection ─────────────────────────────────────────────────────────
const HEADER = {
  test:   /^(test(s)?( name)?|investigation(s)?|parameter( name)?|examination|description|analyte|component)$/i,
  result: /^(result(s)?|value|observed value|your value|patient value)$/i,
  range:  /(normal|reference|ref\.?|biological).*(value|range|interval|limit)s?|^(normal|reference) ?(value|range)s?$|^ranges?$/i,
  unit:   /^units?$/i,
  flag:   /^(flag|status|remarks?)$/i,
};

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[:]+$/, '').trim();

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
  const parts = text.split(/(?=(?:\b[A-Za-z][A-Za-z .()-]{1,30}:\s*[<>≤≥]?\s*\d))|(?<=\d(?:\.\d+)?\s*(?:[a-zA-Z/%^\d.]+)?\s*(?:\([A-Za-z]+\))?)\s+(?=[<>≤≥]\s*\d|\d[\d.]*\s*-\s*\d)/);
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
  if (!range) return { status: 'unknown', basis: 'no_range' };
  const band = pickBand(range, sex);
  if (!band) return { status: 'unknown', basis: 'range_unclear' };

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
  const m = head.match(/\b(?:sex|gender)\b[^\n]{0,40}?\b(male|female|m|f)\b/i) || head.match(/\d+\s*(?:\(?y(?:ear)?s?\)?(?:\(s\))?)\s*\/\s*(male|female|m|f)\b/i);
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

const interpretReport = (analysis) => {
  const tables = analysis?.tables || [];
  const sex = reportSex(analysis?.content);
  const findings = [];
  const seen = new Set();
  let lastMap = null;

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
    if (!map) continue;
    lastMap = { map, width: table.columnCount };

    for (const row of rows.slice(start)) {
      const name = clean(row.cells[map.test]).replace(/\s+(spectrophotometry|calculated|elisa|clia)$/i, '');
      const rawResult = row.cells[map.result];
      if (!name || !rawResult || SKIP_ROW.test(name) || looksLikeId(rawResult) || name.length > 60) continue;
      const result = parseResult(rawResult);
      if (!result) continue;
      const rangeText = map.range !== undefined ? row.cells[map.range] : '';
      const key = `${name.toLowerCase()}|${result.text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const { status, basis } = statusFor({ result, rangeText, flagText: map.flag !== undefined ? row.cells[map.flag] : '', sex });
      const band = rangeText ? pickBand(clean(rangeText), sex) : null; // the normal limits used, for the summary
      findings.push({
        name,
        result:     displayResult(result),
        unit:       (map.unit !== undefined && row.cells[map.unit]) || result.unit || '',
        range:      clean(rangeText),
        normalLow:  band?.low ?? null,
        normalHigh: band?.high ?? null,
        status,     // high | low | abnormal | normal | unknown
        basis,      // range | lab_flag | qualitative | no_range | range_unclear
      });
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
