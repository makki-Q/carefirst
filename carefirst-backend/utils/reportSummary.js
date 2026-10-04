// English + Urdu summary of an interpreted lab report (decision 9 in PROJECT_GUIDE.md).
// Fixed templates only: it states which results fall outside the range printed on the
// report and always tells the patient to share the report with their doctor and visit them.

const MAX_LISTED = 6;

// Common test names in Urdu; anything not listed keeps its English name
const URDU_NAMES = [
  [/^(hb|h(a)?emoglobin|haemoglobin)\b/i, 'ہیموگلوبن'],
  [/^(total )?rbc|red blood cell/i, 'خون کے سرخ خلیے (RBC)'],
  [/^(total )?wbc|tlc|white blood cell|leucocyte|leukocyte count/i, 'خون کے سفید خلیے (WBC)'],
  [/platelet/i, 'پلیٹ لیٹس'],
  [/^(hct|h(a)?ematocrit|pcv)\b/i, 'ہیماٹوکرٹ'],
  [/absolute neutrophil/i, 'نیوٹروفلز کی تعداد'],
  [/absolute lymphocyte/i, 'لمفوسائٹس کی تعداد'],
  [/neutrophil/i, 'نیوٹروفلز'],
  [/lymphocyte/i, 'لمفوسائٹس'],
  [/monocyte/i, 'مونوسائٹس'],
  [/eosinophil/i, 'ایوسینوفلز'],
  [/^e\.?s\.?r\.?\b/i, 'ای ایس آر'],
  [/^ldl/i, 'ایل ڈی ایل (خراب) کولیسٹرول'],
  [/^hdl/i, 'ایچ ڈی ایل (اچھا) کولیسٹرول'],
  [/^vldl/i, 'وی ایل ڈی ایل کولیسٹرول'],
  [/non-?hdl/i, 'نان ایچ ڈی ایل کولیسٹرول'],
  [/cholesterol/i, 'کولیسٹرول'],
  [/triglyceride/i, 'ٹرائی گلیسرائیڈز'],
  [/hba1c|glycated/i, 'ایچ بی اے ون سی (تین ماہ کی شوگر)'],
  [/glucose|sugar/i, 'شوگر'],
  [/creatinine/i, 'کریٹینین (گردے)'],
  [/urea|bun\b/i, 'یوریا (گردے)'],
  [/uric acid/i, 'یورک ایسڈ'],
  [/bilirubin/i, 'بلیروبن'],
  [/alt|sgpt/i, 'جگر کا ٹیسٹ ALT'],
  [/ast|sgot/i, 'جگر کا ٹیسٹ AST'],
  [/alkaline phosphatase/i, 'الکلائن فاسفیٹیز'],
  [/gamma ?gt|ggt/i, 'گاما جی ٹی'],
  [/albumin/i, 'البیومن'],
  [/globulin/i, 'گلوبیولن'],
  [/protein/i, 'پروٹین'],
  [/^tsh/i, 'ٹی ایس ایچ (تھائرائیڈ)'],
  [/vitamin d/i, 'وٹامن ڈی'],
  [/calcium/i, 'کیلشیم'],
  [/ferritin/i, 'فیریٹن'],
  [/\biron\b/i, 'آئرن'],
  [/sodium/i, 'سوڈیم'],
  [/potassium/i, 'پوٹاشیم'],
  [/pus cell|w\.?b\.?c\.?\s*\/\s*hpf/i, 'پیشاب میں پیپ کے خلیے'],
  [/r\.?b\.?c\.?\s*\/\s*hpf|red blood cell/i, 'پیشاب میں خون کے سرخ خلیے'],
  [/crystals?/i, 'کرسٹلز'],
  [/appearance|turbidity/i, 'پیشاب کی رنگت اور صفائی'],
  [/specific gravity|sp\.? gravity/i, 'پیشاب کی کثافت'],
  [/rheumatoid/i, 'جوڑوں کا ٹیسٹ (RF)'],
  [/ccp/i, 'جوڑوں کا ٹیسٹ (Anti CCP)'],
  [/crp|c-reactive/i, 'سی آر پی (سوزش)'],
];
const urduName = (name) => (URDU_NAMES.find(([re]) => re.test(name)) || [null, name])[1];

const fmtNum = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));
const withUnit = (f) => [f.result, f.unit && !f.result.includes(f.unit) ? f.unit : ''].filter(Boolean).join(' ');

// "normal 11.5 to 16" / "normal below 200" / "expected: Negative"
const normalEn = (f) =>
  f.normalLow !== null && f.normalHigh !== null ? `normal ${fmtNum(f.normalLow)} to ${fmtNum(f.normalHigh)}`
  : f.normalHigh !== null ? `normal below ${fmtNum(f.normalHigh)}`
  : f.normalLow !== null ? `normal above ${fmtNum(f.normalLow)}`
  : f.range ? `expected: ${f.range}` : '';
const normalUr = (f) =>
  f.normalLow !== null && f.normalHigh !== null ? `نارمل ${fmtNum(f.normalLow)} سے ${fmtNum(f.normalHigh)}`
  : f.normalHigh !== null ? `نارمل ${fmtNum(f.normalHigh)} سے کم`
  : f.normalLow !== null ? `نارمل ${fmtNum(f.normalLow)} سے زیادہ`
  : f.range ? `متوقع: ${f.range}` : '';

const STATUS_EN = { high: 'high', low: 'low', abnormal: 'not normal' };
const STATUS_UR = { high: 'زیادہ', low: 'کم', abnormal: 'نارمل نہیں' };

const OPENING_EN = 'This summary was created automatically from your report.';
const OPENING_UR = 'یہ خلاصہ آپ کی رپورٹ سے خود بخود تیار کیا گیا ہے۔';
const DOCTOR_EN = 'Please share this report with your doctor and visit them to discuss these results.';
const DOCTOR_UR = 'براہِ کرم یہ رپورٹ اپنے ڈاکٹر کو دکھائیں اور ان سے مل کر ان نتائج پر بات کریں۔';

const summarizeReport = ({ kind, findings = [] }) => {
  if (kind === 'narrative') {
    return {
      en: `${OPENING_EN} This is a written specialist report (for example a biopsy or scan report). A doctor needs to explain it, so it is not summarised automatically. Please take this report to your doctor and visit them.`,
      ur: `${OPENING_UR} یہ ایک تحریری ماہرانہ رپورٹ ہے (مثلاً بایوپسی یا اسکین کی رپورٹ)۔ اسے ڈاکٹر ہی سمجھا سکتے ہیں، اس لیے اس کا خودکار خلاصہ نہیں بنایا گیا۔ براہِ کرم یہ رپورٹ اپنے ڈاکٹر کے پاس لے جائیں اور ان سے ملیں۔`,
    };
  }
  if (kind !== 'table' || findings.length === 0) {
    return {
      en: `We could not read this report automatically. ${DOCTOR_EN}`,
      ur: `یہ رپورٹ خود بخود پڑھی نہیں جا سکی۔ ${DOCTOR_UR}`,
    };
  }

  const flagged = findings.filter(f => ['high', 'low', 'abnormal'].includes(f.status));
  const unknown = findings.filter(f => f.status === 'unknown');
  const normal  = findings.filter(f => f.status === 'normal');
  const en = [OPENING_EN];
  const ur = [OPENING_UR];

  if (flagged.length === 0) {
    // Never claim the whole report is normal — only what was found and compared
    en.push(`All ${normal.length} results found in the report's tables are within the normal range printed on the report. Parts of a report that are not in a table, such as written comments, are not checked automatically.`);
    ur.push(`رپورٹ کے جدولوں میں ملنے والے تمام ${normal.length} نتائج رپورٹ پر لکھی نارمل حد کے اندر ہیں۔ رپورٹ کے وہ حصے جو جدول میں نہیں، جیسے تحریری تبصرے، خود بخود نہیں جانچے جاتے۔`);
  } else {
    const listed = flagged.slice(0, MAX_LISTED);
    const more = flagged.length - listed.length;
    en.push(`${flagged.length} of your ${findings.length} results ${flagged.length === 1 ? 'is' : 'are'} outside the normal range printed on the report: ` +
      listed.map(f => `${f.name} ${withUnit(f)} (${STATUS_EN[f.status]}; ${normalEn(f)})`).join(', ') +
      (more > 0 ? `, and ${more} more` : '') + '.');
    ur.push(`آپ کی رپورٹ کے ${findings.length} نتائج میں سے ${flagged.length} نارمل حد سے باہر ہیں: ` +
      listed.map(f => `${urduName(f.name)} ${withUnit(f)} (${STATUS_UR[f.status]}؛ ${normalUr(f)})`).join('، ') +
      (more > 0 ? `، اور ${more} مزید` : '') + '۔');
    if (normal.length) {
      en.push(`Your other ${normal.length} results are within the normal range.`);
      ur.push(`آپ کے باقی ${normal.length} نتائج نارمل حد کے اندر ہیں۔`);
    }
  }
  if (unknown.length) {
    en.push(`${unknown.length} result${unknown.length === 1 ? '' : 's'} could not be compared automatically — ask your doctor about ${unknown.length === 1 ? 'it' : 'them'}.`);
    ur.push(unknown.length === 1
      ? 'ایک نتیجے کا خود بخود موازنہ نہیں ہو سکا — اس کے بارے میں اپنے ڈاکٹر سے پوچھیں۔'
      : `${unknown.length} نتائج کا خود بخود موازنہ نہیں ہو سکا — ان کے بارے میں اپنے ڈاکٹر سے پوچھیں۔`);
  }
  en.push(flagged.length ? DOCTOR_EN : 'Please still share this report with your doctor at your next visit.');
  ur.push(flagged.length ? DOCTOR_UR : 'پھر بھی اگلی ملاقات پر یہ رپورٹ اپنے ڈاکٹر کو ضرور دکھائیں۔');
  return { en: en.join(' '), ur: ur.join(' ') };
};

module.exports = { summarizeReport, urduName };
