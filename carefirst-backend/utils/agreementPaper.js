// The installment agreement is the lab's stamp paper (decision 15): the picture in
// assets/agreement-stamp-paper.jpeg with the plan's details written into its blanks.
//   agreementData(...)        → the details, stored with the plan when the patient accepts
//   paperFields(data, live)   → text + position for every blank (the same list draws the page in the
//                               browser and in the PDF)
//   agreementTextEn / Ur      → the paper as text: English (what the patient accepts) and Urdu
//   agreementSpeech           → the Urdu text prepared for Azure Speech (CNIC / phone digits one by one)
// `live` adds what is only known later: acceptance time, approval date, real due dates, paid installments,
// and the booked visit date.
const fs   = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAPER = { file: path.join(__dirname, '..', 'assets', 'agreement-stamp-paper.jpeg'), width: 1024, height: 1536 };
const MAX_SCHEDULE_ROWS = 6; // rows printed on the paper — plans are limited to this (config/installments.js)

const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const pktParts = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: p.minute };
};
const dateEn = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
const dateShort = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
const dateUr = (d) => { const p = pktParts(d); return `${p.d} ${MONTHS_UR[p.m - 1]} ${p.y}`; };
const timeEn = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const timeUr = (d) => {
  const { h, min } = pktParts(d);
  const part = h < 12 ? 'صبح' : h < 16 ? 'دوپہر' : h < 19 ? 'شام' : 'رات';
  return `${part} ${h % 12 || 12} بج کر ${Number(min)} منٹ`;
};
const num = (n) => (Number(n) || 0).toLocaleString('en-US');
// "YYYY-MM-DD" (a booked visit date) → a Date at noon PKT
const visitDate = (s) => (s ? new Date(`${s}T12:00:00+05:00`) : null);

// ── The details ─────────────────────────────────────────────────────────────────────────────────
// reviewedOn: "YYYY-MM-DD" (PKT) — the day the patient reviews the agreement; it is the date on the paper
const agreementData = ({ patient, patientCnic, patientAddress, guarantor, labProfile, labUser, test, totalAmount, downPayment, installments, tenureDays, reviewedOn }) => ({
  reviewedOn,
  lab: {
    name:           labProfile.labName,
    address:        labProfile.location || '',
    contact:        labProfile.phone || labUser?.phone || '',
    registrationNo: labProfile.licenseNumber || '',
  },
  patient:   { name: patient.name, cnic: patientCnic, address: patientAddress || '', contact: patient.phone || '' },
  guarantor: { name: guarantor.name, cnic: guarantor.cnic, relation: guarantor.relation, address: guarantor.address || '', contact: guarantor.phone || '' },
  test:      { type: test.category || '', name: test.name, fee: totalAmount },
  plan:      { downPayment, remaining: totalAmount - downPayment, installments, tenureDays },
});

// What is known later, from a wallet (and the visit booked with the plan, if any)
const liveFor = (wallet, booking) => ({
  acceptedAt: wallet.agreement?.acceptedAt || null,
  approvedAt: wallet.planApprovedAt || null,
  schedule:   wallet.activatedAt && wallet.installments?.length
    ? wallet.installments.map(i => ({ dueDate: i.dueDate, paid: i.status === 'paid' }))
    : null,
  serviceDate: booking?.visitDate ? visitDate(booking.visitDate) : null,
});

// ── Values shared by the paper and the texts ──────────────────────────────────────────────────
const values = (data, live = {}, lang = 'en') => {
  const ur = lang === 'ur';
  const money = (n) => (ur ? `${num(n)} روپے` : num(n));
  const amounts = data.plan.installments;
  const t = data.plan.tenureDays;
  const due = (i) => (live.schedule?.[i]?.dueDate
    ? (ur ? dateUr(live.schedule[i].dueDate) : dateShort(live.schedule[i].dueDate))
    : (ur ? `منصوبہ شروع ہونے کے ${t * (i + 1)} دن بعد` : `Day ${t * (i + 1)} after activation`));
  const last = amounts[amounts.length - 1];
  const even = amounts.every(a => a === amounts[0]);
  const none = ur ? 'درج نہیں' : '—';
  return {
    date:        data.reviewedOn ? (ur ? dateUr(visitDate(data.reviewedOn)) : dateEn(visitDate(data.reviewedOn)))
      : live.acceptedAt ? (ur ? dateUr(live.acceptedAt) : dateEn(live.acceptedAt)) : (ur ? 'قبولیت کی تاریخ' : 'Date of acceptance'),
    lab:         data.lab,
    labContact:  data.lab.contact || none,
    labReg:      data.lab.registrationNo || (ur ? 'نہیں' : 'N/A'),
    patient:     data.patient,
    patientContact: data.patient.contact || none,
    guarantor:   data.guarantor,
    testType:    data.test.type || none,
    testName:    data.test.name,
    testFee:     money(data.test.fee),
    serviceDate: live.serviceDate ? (ur ? dateUr(live.serviceDate) : dateShort(live.serviceDate)) : (ur ? 'کیئر فرسٹ پر بُک کی جانے والی تاریخ' : 'Booked on CareFirst'),
    downPayment: money(data.plan.downPayment),
    remaining:   money(data.plan.remaining),
    count:       String(amounts.length),
    instAmount:  even ? money(amounts[0]) : (ur ? `${money(amounts[0])} (آخری قسط ${money(last)})` : `${num(amounts[0])} (last ${num(last)})`),
    firstDue:    due(0),
    finalDue:    due(amounts.length - 1),
    rows:        amounts.map((a, i) => ({ due: due(i), amount: money(a), paid: live.schedule ? Boolean(live.schedule[i]?.paid) : null })),
    approvedOn:  live.approvedAt ? (ur ? dateUr(live.approvedAt) : dateShort(live.approvedAt)) : '',
    signedOn:    live.acceptedAt ? (ur ? dateUr(live.acceptedAt) : dateShort(live.acceptedAt)) : '',
    accepted:    live.acceptedAt
      ? (ur ? `${data.patient.name} نے یہ معاہدہ ${dateUr(live.acceptedAt)} کو ${timeUr(live.acceptedAt)} (پاکستانی وقت) کیئر فرسٹ پر الیکٹرانک طور پر قبول کیا۔`
            : `Agreed electronically on CareFirst on ${dateShort(live.acceptedAt)}, ${timeEn(live.acceptedAt)} (PKT)`)
      : '',
  };
};

// ── The paper: every blank with its text and position (pixels on the 1024 × 1536 picture) ──────
// x / x2: start and end of the blank line, y: the line (text sits just above it)
const ROW_Y = [822, 843, 863, 884, 905, 926];
const paperFields = (data, live = {}) => {
  const v = values(data, live, 'en');
  const f = (key, text, x, x2, y, extra = {}) => ({ key, text: text || '', x, x2, y, ...extra });
  const fields = [
    f('date',            v.date,               360, 649, 359),
    f('introLab',        v.lab.name,             60, 460, 381),
    f('introPatient',    v.patient.name,         60, 465, 403),
    f('introCnic',       v.patient.cnic,        692, 924, 402),
    f('labName',         v.lab.name,            167, 488, 504),
    f('labAddress',      v.lab.address,         132, 487, 526),
    f('labContact',      v.labContact,          161, 488, 548),
    f('labReg',          v.labReg,              249, 488, 570),
    f('patientName',     v.patient.name,        619, 962, 504),
    f('patientCnic',     v.patient.cnic,        620, 961, 526),
    f('patientAddress',  v.patient.address,     620, 962, 548),
    f('patientContact',  v.patientContact,      636, 962, 570),
    f('testType',        v.testType,            244, 483, 630),
    f('testName',        v.testName,            694, 957, 630),
    f('testFee',         v.testFee,             231, 485, 651),
    f('serviceDate',     v.serviceDate,         654, 959, 651),
    f('downPayment',     v.downPayment,         241, 480, 705),
    f('remaining',       v.remaining,           725, 957, 705),
    f('count',           v.count,               251, 483, 725),
    f('instAmount',      v.instAmount,          726, 957, 725),
    f('firstDue',        v.firstDue,            267, 484, 746),
    f('finalDue',        v.finalDue,            728, 958, 746),
    // For the Laboratory (no signature: the lab offered the plan on CareFirst)
    f('labSignName',     v.lab.name,            138, 415, 1292),
    f('labDesignation',  'Installment plan offered on CareFirst', 183, 413, 1312),
    f('labSignDate',     v.approvedOn,          139, 412, 1333),
    // Patient — the name is the signature
    f('patientSign',     v.patient.name,        586, 882, 1253, { signature: true }),
    f('patientSignName', v.patient.name,        626, 882, 1292),
    f('patientSignCnic', v.patient.cnic,        657, 881, 1312),
    f('patientSignDate', v.signedOn,            626, 881, 1333),
    f('accepted',        v.accepted,            584, 990, 1352, { small: true, color: 'green' }),
    // Witness 1 = the guarantor
    f('witnessName',     `${v.guarantor.name} (Guarantor, ${v.guarantor.relation})`, 160, 390, 1399),
    f('witnessCnic',     v.guarantor.cnic,      184, 388, 1421),
    f('witnessSign',     v.guarantor.name,      182, 390, 1442, { signature: true }),
    f('witnessDate',     v.signedOn,            152, 388, 1463),
  ];
  v.rows.slice(0, MAX_SCHEDULE_ROWS).forEach((r, i) => {
    fields.push(f(`due${i + 1}`, r.due, 263, 508, ROW_Y[i]));
    fields.push(f(`amount${i + 1}`, r.amount, 566, 759, ROW_Y[i], { center: true }));
    if (r.paid) fields.push(f(`paid${i + 1}`, '✓', 871, 888, ROW_Y[i], { center: true, check: true }));
  });
  return fields.filter(x => x.text);
};

// ── The paper as English text (this is what the patient accepts, word for word) ────────────────
const TERMS_EN = [
  'The Patient agrees to pay the total test fee in the above-mentioned installments as per the schedule.',
  "The Patient shall make payments on or before the due date. Late payment may result in additional charges or refusal of further services, as per the Lab's policy.",
  'The Lab agrees to provide the selected test/service(s) to the Patient once the down payment (if any) is received.',
  'In case of default in payment, the Lab reserves the right to withhold test reports and further services until the dues are cleared.',
  'If the Patient fails to pay the remaining amount, the Lab may take legal action for recovery of the amount, as per applicable law.',
  'This agreement does not transfer any ownership rights of the test reports. The reports will be issued only after full payment is received.',
  'Any dispute arising from this agreement shall be subject to the jurisdiction of the courts of the district where the Lab is located.',
];
const GENERAL_EN = [
  'This agreement constitutes the entire understanding between the parties and supersedes any prior discussions.',
  'Any amendment to this agreement shall be made in writing and signed by both parties.',
  'The agreement is valid until the final installment is paid in full.',
];
const TERMS_UR = [
  'مریض کل ٹیسٹ فیس اوپر بیان کردہ اقساط میں شیڈول کے مطابق ادا کرنے پر متفق ہے۔',
  'مریض ادائیگیاں مقررہ تاریخ پر یا اس سے پہلے کرے گا۔ تاخیر سے ادائیگی کی صورت میں لیب کی پالیسی کے مطابق اضافی چارجز لگ سکتے ہیں یا مزید خدمات سے انکار کیا جا سکتا ہے۔',
  'ابتدائی ادائیگی (اگر کوئی ہو) موصول ہونے پر لیب مریض کو منتخب ٹیسٹ یا سروس فراہم کرے گی۔',
  'ادائیگی میں نادہندگی کی صورت میں لیب کو یہ حق حاصل ہے کہ واجبات کی ادائیگی تک ٹیسٹ رپورٹس اور مزید خدمات روک لے۔',
  'اگر مریض باقی رقم ادا نہ کرے تو لیب قابلِ اطلاق قانون کے مطابق رقم کی وصولی کے لیے قانونی کارروائی کر سکتی ہے۔',
  'اس معاہدے سے ٹیسٹ رپورٹس کی ملکیت کا کوئی حق منتقل نہیں ہوتا۔ رپورٹس صرف مکمل ادائیگی موصول ہونے کے بعد جاری کی جائیں گی۔',
  'اس معاہدے سے پیدا ہونے والا کوئی بھی تنازع اس ضلع کی عدالتوں کے دائرہ اختیار میں ہوگا جہاں لیب واقع ہے۔',
];
const GENERAL_UR = [
  'یہ معاہدہ فریقین کے درمیان مکمل مفاہمت ہے اور اس سے پہلے کی تمام بات چیت پر فوقیت رکھتا ہے۔',
  'اس معاہدے میں کوئی بھی ترمیم تحریری طور پر کی جائے گی اور دونوں فریق اس پر دستخط کریں گے۔',
  'یہ معاہدہ آخری قسط کی مکمل ادائیگی تک مؤثر رہے گا۔',
];

const agreementTextEn = (data, live = {}) => {
  const v = values(data, live, 'en');
  return [
    'MEDICAL LAB TEST PAYMENT INSTALLMENT AGREEMENT',
    '(Between Laboratory and Patient)',
    '',
    `This Installment Agreement is made on ${v.date} between ${v.lab.name} (Name of Laboratory), hereinafter referred to as "the Lab", ` +
      `and ${v.patient.name} (Name of Patient), CNIC No. ${v.patient.cnic}, hereinafter referred to as "the Patient", for the purpose of ` +
      'payment of the fee for medical tests and related services provided by the Lab, on an installment basis, under the terms and conditions set forth below.',
    '',
    '1. LABORATORY DETAILS',
    `Name of Lab: ${v.lab.name}`, `Address: ${v.lab.address}`, `Contact No.: ${v.labContact}`, `Registration No. (if any): ${v.labReg}`,
    '',
    '2. PATIENT DETAILS',
    `Name: ${v.patient.name}`, `CNIC No.: ${v.patient.cnic}`, `Address: ${v.patient.address}`, `Contact No.: ${v.patientContact}`,
    '',
    '3. TEST / SERVICE DETAILS',
    `Type of Test / Service: ${v.testType}`, `Package / Test Name: ${v.testName}`, `Total Test Fee (PKR): ${v.testFee}`, `Date of Service: ${v.serviceDate}`,
    '',
    '4. INSTALLMENT PAYMENT DETAILS',
    `Down Payment (PKR): ${v.downPayment}`, `Remaining Amount (PKR): ${v.remaining}`, `Number of Installments: ${v.count}`,
    `Installment Amount (PKR): ${v.instAmount}`, `First Installment Due Date: ${v.firstDue}`, `Final Installment Due Date: ${v.finalDue}`,
    '',
    '5. PAYMENT SCHEDULE',
    ...v.rows.map((r, i) => `Installment ${i + 1}: due ${r.due}, PKR ${r.amount}${r.paid ? ' (paid)' : ''}`),
    '',
    '6. TERMS AND CONDITIONS',
    ...TERMS_EN.map((t, i) => `${i + 1}. ${t}`),
    '',
    '7. GENERAL',
    ...GENERAL_EN.map((t, i) => `${i + 1}. ${t}`),
    '',
    'For the Laboratory',
    `Name: ${v.lab.name}`, 'Designation: Installment plan offered on CareFirst', `Date: ${v.approvedOn || 'On approval'}`,
    '',
    'Patient',
    `Signature: ${v.patient.name}`, `Name: ${v.patient.name}`, `CNIC No.: ${v.patient.cnic}`, `Date: ${v.signedOn || 'Date of acceptance'}`,
    ...(v.accepted ? [v.accepted] : []),
    '',
    'Witnesses',
    `1. Name: ${v.guarantor.name} (Guarantor, ${v.guarantor.relation})`, `   CNIC No.: ${v.guarantor.cnic}`,
    `   Signature: ${v.guarantor.name}`, `   Date: ${v.signedOn || 'Date of acceptance'}`,
  ].join('\n');
};

// Urdu: the same paper translated, with the same details — shown next to the paper and read aloud
const agreementTextUr = (data, live = {}) => {
  const v = values(data, live, 'ur');
  return [
    'میڈیکل لیب ٹیسٹ کی ادائیگی کے قسطوں کا معاہدہ',
    '(لیب اور مریض کے درمیان)',
    '',
    `یہ قسطوں کا معاہدہ ${v.date} کو ${v.lab.name} (لیب کا نام)، جسے آئندہ "لیب" کہا جائے گا، اور ${v.patient.name} (مریض کا نام)، ` +
      `شناختی کارڈ نمبر ${v.patient.cnic}، جسے آئندہ "مریض" کہا جائے گا، کے درمیان طے پایا، تاکہ لیب کی طرف سے فراہم کردہ طبی ٹیسٹ اور ` +
      'متعلقہ خدمات کی فیس درج ذیل شرائط و ضوابط کے تحت قسطوں میں ادا کی جائے۔',
    '',
    '1۔ لیب کی معلومات',
    `لیب کا نام: ${v.lab.name}`, `پتہ: ${v.lab.address}`, `رابطہ نمبر: ${v.labContact}`, `رجسٹریشن نمبر: ${v.labReg}`,
    '',
    '2۔ مریض کی معلومات',
    `مریض کا نام: ${v.patient.name}`, `شناختی کارڈ نمبر: ${v.patient.cnic}`, `پتہ: ${v.patient.address}`, `رابطہ نمبر: ${v.patientContact}`,
    '',
    '3۔ ٹیسٹ اور سروس کی تفصیلات',
    `ٹیسٹ کی قسم: ${v.testType}`, `پیکج یا ٹیسٹ کا نام: ${v.testName}`, `کل ٹیسٹ فیس: ${v.testFee}`, `سروس کی تاریخ: ${v.serviceDate}`,
    '',
    '4۔ قسطوں کی ادائیگی کی تفصیلات',
    `ابتدائی ادائیگی: ${v.downPayment}`, `باقی رقم: ${v.remaining}`, `قسطوں کی تعداد: ${v.count}`,
    `ہر قسط کی رقم: ${v.instAmount}`, `پہلی قسط کی تاریخ: ${v.firstDue}`, `آخری قسط کی تاریخ: ${v.finalDue}`,
    '',
    '5۔ ادائیگی کا شیڈول',
    ...v.rows.map((r, i) => `قسط نمبر ${i + 1}: ${r.due}، ${r.amount}${r.paid === true ? '، ادا ہو چکی' : r.paid === false ? '، ابھی باقی ہے' : ''}`),
    '',
    '6۔ شرائط و ضوابط',
    ...TERMS_UR.map((t, i) => `${i + 1}۔ ${t}`),
    '',
    '7۔ عمومی شرائط',
    ...GENERAL_UR.map((t, i) => `${i + 1}۔ ${t}`),
    '',
    'لیب کی جانب سے',
    `نام: ${v.lab.name}`, 'عہدہ: کیئر فرسٹ پر پیش کردہ اقساط کا منصوبہ', `تاریخ: ${v.approvedOn || 'منظوری پر'}`,
    '',
    'مریض',
    `دستخط اور نام: ${v.patient.name}`, `شناختی کارڈ نمبر: ${v.patient.cnic}`, `تاریخ: ${v.signedOn || 'قبولیت کی تاریخ'}`,
    ...(v.accepted ? [v.accepted] : []),
    '',
    'گواہ',
    `گواہ نمبر 1 (ضامن، ${v.guarantor.relation}): ${v.guarantor.name}`, `شناختی کارڈ نمبر: ${v.guarantor.cnic}`, `تاریخ: ${v.signedOn || 'قبولیت کی تاریخ'}`,
    '',
    'یہ اردو ترجمہ سہولت کے لیے ہے؛ قانونی طور پر انگریزی متن ہی معتبر ہوگا۔',
  ].join('\n');
};

// For Azure Speech: CNICs and phone numbers digit by digit (otherwise they are read as one huge number)
const spellDigits = (s) => s.split('-').map(part => part.split('').join(' ')).join('، ');
const agreementSpeech = (data, live = {}) => agreementTextUr(data, live)
  .replace(/\b\d[\d-]{7,}\d\b/g, spellDigits); // 35202-1234567-1, 0300-5550001, 03-111-456-789 (amounts use commas)

// ── PDF: the picture with the blanks filled (standard fonts: the paper is in English) ───────────
const buildAgreementPdf = async (data, live = {}) => {
  const pdf  = await PDFDocument.create();
  pdf.setTitle('CareFirst installment agreement');
  const page = pdf.addPage([PAPER.width * 0.75, PAPER.height * 0.75]); // 768 × 1152 pt
  const k = 0.75;
  page.drawImage(await pdf.embedJpg(fs.readFileSync(PAPER.file)), { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const script  = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.06, 0.16, 0.42);
  for (const fld of paperFields(data, live)) {
    if (fld.check) { // a tick inside the printed box (standard fonts have no ✓)
      const cx = (fld.x + fld.x2) / 2 * k, cy = page.getHeight() - (fld.y - 7) * k;
      page.drawLine({ start: { x: cx - 4, y: cy }, end: { x: cx - 1, y: cy - 3.5 }, thickness: 1.6, color: ink });
      page.drawLine({ start: { x: cx - 1, y: cy - 3.5 }, end: { x: cx + 5, y: cy + 4 }, thickness: 1.6, color: ink });
      continue;
    }
    const font = fld.signature ? script : regular;
    const text = fld.text.replace(/[^\x20-\x7E]/g, '?'); // standard fonts are Latin only
    const max = (fld.x2 - fld.x) * k;
    let size = (fld.small ? 7.5 : 9.5);
    while (size > 5.5 && font.widthOfTextAtSize(text, size) > max) size -= 0.25;
    const w = font.widthOfTextAtSize(text, size);
    const x = (fld.center ? fld.x + ((fld.x2 - fld.x) * k > w ? ((fld.x2 - fld.x) * k - w) / 2 / k : 0) : fld.x + 2) * k;
    page.drawText(text, { x, y: page.getHeight() - (fld.y - 3) * k, size, font, color: fld.color === 'green' ? rgb(0.09, 0.4, 0.2) : ink });
  }
  return Buffer.from(await pdf.save());
};

// The visit booked with each plan (its date fills "Date of Service")
const bookingsFor = async (walletIds) => {
  const LabBooking = require('../models/LabBooking');
  const rows = await LabBooking.find({ wallet: { $in: walletIds }, status: { $ne: 'cancelled' } }).select('wallet visitDate').lean();
  return Object.fromEntries(rows.map(b => [b.wallet.toString(), b]));
};

// Plain wallet objects → + agreementPaper (filled blanks) and agreementUrdu (the Urdu text, same details).
// Plans accepted before the stamp paper (no agreement.data) keep their stored text only.
const withAgreementPaper = async (wallets) => {
  const withData = wallets.filter(w => w?.agreement?.data);
  if (!withData.length) return wallets;
  const bookings = await bookingsFor(withData.map(w => w._id));
  return wallets.map(w => {
    if (!w?.agreement?.data) return w;
    const live = liveFor(w, bookings[w._id.toString()]);
    return { ...w, agreementPaper: paperFields(w.agreement.data, live), agreementUrdu: agreementTextUr(w.agreement.data, live) };
  });
};

module.exports = {
  PAPER, MAX_SCHEDULE_ROWS, agreementData, liveFor, paperFields, agreementTextEn, agreementTextUr, agreementSpeech, buildAgreementPdf,
  bookingsFor, withAgreementPaper,
};
