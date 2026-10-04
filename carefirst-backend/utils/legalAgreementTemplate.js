const generateLegalAgreement = ({ patient, patientCnic, patientAddress, guarantor, testName, totalAmount, remainingBalance, escalatedAt, hasCnicPictures }) => {
  const date = new Date(escalatedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return `
LEGAL NOTICE OF INSTALLMENT DEFAULT
CareFirst Health Platform
Date: ${date}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PREAMBLE
This document serves as formal legal notice that the patient named below has
defaulted on their installment plan obligations under the CareFirst Healthcare
Installment Programme and has been referred to CareFirst's legal counsel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — PATIENT DETAILS
Full Name : ${patient.name || 'N/A'}
CNIC      : ${patientCnic || 'N/A'}
Email     : ${patient.email || 'N/A'}
Phone     : ${patient.phone || 'N/A'}
Address   : ${patientAddress || 'N/A'}

SECTION 2 — SERVICE DETAILS
Test / Service  : ${testName || 'N/A'}
Total Amount    : PKR ${(totalAmount || 0).toLocaleString()}
Outstanding     : PKR ${(remainingBalance || 0).toLocaleString()}

SECTION 3 — GUARANTOR DETAILS
The following individual agreed to stand as guarantor for the above patient
and is jointly liable for all outstanding amounts.

Full Name : ${guarantor?.name     || 'Not provided'}
CNIC      : ${guarantor?.cnic     || 'Not provided'}
Phone     : ${guarantor?.phone    || 'Not provided'}
Relation  : ${guarantor?.relation || 'Not provided'}
Address   : ${guarantor?.address  || 'Not provided'}

SECTION 4 — TERMS & CONDITIONS
1. The patient and guarantor agreed to the installment schedule at the time
   of plan approval and are contractually bound by it.
2. Failure to upload payment proof within 3 days of the due date constitutes
   a default under the CareFirst Installment Agreement.
3. CareFirst Legal reserves the right to pursue recovery of all outstanding
   amounts through applicable legal channels.
4. All legal action is conducted entirely offline. This document is for
   reference and record-keeping purposes only.
${hasCnicPictures ? `
The signed installment agreement and pictures of the patient's and the
guarantor's CNIC (front and back) are attached to this case on CareFirst.
` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CareFirst Health Platform — Legal Department
support@carefirst.pk
`.trim();
};

// Agreement the patient reads and accepts when applying for an installment plan.
// It has no date in it: the acceptance time is stored next to the text, so the
// text shown before acceptance can be compared word for word with the stored one.
const generateInstallmentAgreement = ({
  patient, patientCnic, patientAddress, guarantor, labName, testName,
  totalAmount, downPayment, installments, tenureDays, serviceFee, graceDays,
}) => {
  const pkr = (n) => `PKR ${(n || 0).toLocaleString('en-US')}`;
  const schedule = installments
    .map((amount, i) => `  Installment ${i + 1}: ${pkr(amount).padEnd(12)} due ${tenureDays * (i + 1)} days after plan activation`)
    .join('\n');

  return `
INSTALLMENT PLAN AGREEMENT
CareFirst Health Platform

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — PARTIES
Patient   : ${patient.name}
CNIC      : ${patientCnic}
Phone     : ${patient.phone || 'Not provided'}
Address   : ${patientAddress || 'Not provided'}

Guarantor : ${guarantor.name}
CNIC      : ${guarantor.cnic}
Phone     : ${guarantor.phone}
Relation  : ${guarantor.relation}
Address   : ${guarantor.address || 'Not provided'}

Laboratory: ${labName}

SECTION 2 — SERVICE AND AMOUNTS
Test / Service : ${testName}
Test Price     : ${pkr(totalAmount)}
Down Payment   : ${pkr(downPayment)} (paid to the laboratory)
Installments   : ${installments.length} × every ${tenureDays} days (paid to the laboratory)
${schedule}

CareFirst Service Fee: ${pkr(serviceFee)} (paid to CareFirst, separate from the test price)

SECTION 3 — HOW THE PLAN WORKS
1. This application is reviewed by CareFirst. If approved, the patient pays the
   service fee to CareFirst and uploads proof of payment.
2. The plan becomes active once CareFirst verifies the service fee. The
   installment due dates are counted from that day.
3. The down payment and every installment are paid directly to the laboratory.
   CareFirst does not receive, hold or transfer any payment for the test.
4. For every payment the patient uploads proof on CareFirst; the laboratory
   confirms receipt and CareFirst verifies it.

SECTION 4 — DEFAULT
1. If no proof of payment is uploaded within ${graceDays} days after an installment's
   due date, the patient is in default.
2. On default the plan is escalated automatically to CareFirst's legal counsel,
   who receive this agreement, the patient and guarantor details above and
   the pictures of both CNICs.
3. The guarantor is jointly liable with the patient for every outstanding amount.
4. Recovery is pursued offline through applicable legal channels.

SECTION 5 — DECLARATION
The patient confirms that the details above are correct, that the CNIC
pictures uploaded with this application are of the patient and the guarantor,
that the guarantor has agreed to stand as guarantor, and that the patient has
read and accepts this agreement. CareFirst records the time of acceptance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CareFirst Health Platform — Legal Department
support@carefirst.pk
`.trim();
};

// Urdu version of the installment agreement — shown and read aloud (Azure Speech)
// next to the English one. The English text remains the binding version.
// Same inputs as generateInstallmentAgreement; names and CNICs stay as entered.
const generateInstallmentAgreementUrdu = ({
  patient, patientCnic, patientAddress, guarantor, labName, testName,
  totalAmount, downPayment, installments, tenureDays, serviceFee, graceDays,
}) => {
  const rs = (n) => `${(n || 0).toLocaleString('en-US')} روپے`;
  const schedule = installments
    .map((amount, i) => `قسط نمبر ${i + 1}: ${rs(amount)} — منصوبہ فعال ہونے کے ${tenureDays * (i + 1)} دن بعد واجب الادا`)
    .join('\n');

  return `
اقساط کے منصوبے کا معاہدہ
کیئر فرسٹ ہیلتھ پلیٹ فارم

حصہ اوّل — فریقین
مریض: ${patient.name}
شناختی کارڈ نمبر: ${patientCnic}
فون: ${patient.phone || 'درج نہیں'}
پتہ: ${patientAddress || 'درج نہیں'}

ضامن: ${guarantor.name}
شناختی کارڈ نمبر: ${guarantor.cnic}
فون: ${guarantor.phone}
رشتہ: ${guarantor.relation}
پتہ: ${guarantor.address || 'درج نہیں'}

لیبارٹری: ${labName}

حصہ دوم — ٹیسٹ اور رقم
ٹیسٹ: ${testName}
ٹیسٹ کی قیمت: ${rs(totalAmount)}
پیشگی ادائیگی: ${rs(downPayment)}، جو لیبارٹری کو ادا کی جائے گی
اقساط: ${installments.length} اقساط، ہر ${tenureDays} دن بعد، جو لیبارٹری کو ادا کی جائیں گی
${schedule}

کیئر فرسٹ سروس فیس: ${rs(serviceFee)}، جو کیئر فرسٹ کو ادا کی جائے گی اور ٹیسٹ کی قیمت سے الگ ہے

حصہ سوم — منصوبہ کیسے کام کرتا ہے
1. کیئر فرسٹ اس درخواست کا جائزہ لے گا۔ منظوری کی صورت میں مریض کیئر فرسٹ کو سروس فیس ادا کرے گا اور ادائیگی کا ثبوت اپ لوڈ کرے گا۔
2. سروس فیس کی تصدیق کے بعد منصوبہ فعال ہو جائے گا، اور اقساط کی تاریخیں اسی دن سے شمار ہوں گی۔
3. پیشگی ادائیگی اور ہر قسط براہِ راست لیبارٹری کو ادا کی جائے گی۔ کیئر فرسٹ ٹیسٹ کی کوئی رقم نہ وصول کرتا ہے، نہ اپنے پاس رکھتا ہے اور نہ منتقل کرتا ہے۔
4. ہر ادائیگی کا ثبوت مریض کیئر فرسٹ پر اپ لوڈ کرے گا؛ لیبارٹری رقم کی وصولی کی تصدیق کرے گی اور کیئر فرسٹ اس کی توثیق کرے گا۔

حصہ چہارم — نادہندگی
1. اگر کسی قسط کی مقررہ تاریخ کے بعد ${graceDays} دن کے اندر ادائیگی کا ثبوت اپ لوڈ نہ کیا گیا تو مریض نادہندہ تصور ہوگا۔
2. نادہندگی کی صورت میں معاملہ خود بخود کیئر فرسٹ کے قانونی مشیر کو بھیج دیا جائے گا، جنہیں یہ معاہدہ، مریض و ضامن کی مندرجہ بالا تفصیلات اور دونوں کے شناختی کارڈ کی تصاویر فراہم کی جائیں گی۔
3. تمام واجب الادا رقم کی ادائیگی کا ضامن، مریض کے ساتھ مشترکہ طور پر ذمہ دار ہوگا۔
4. رقم کی وصولی کی کارروائی قابلِ اطلاق قانونی طریقوں کے مطابق آف لائن کی جائے گی۔

حصہ پنجم — اقرار
مریض اقرار کرتا ہے کہ اوپر درج تفصیلات درست ہیں، اس درخواست کے ساتھ اپ لوڈ کی گئی شناختی کارڈ کی تصاویر مریض اور ضامن ہی کی ہیں، ضامن نے ضمانت دینے پر رضامندی ظاہر کی ہے، اور مریض نے یہ معاہدہ پڑھ لیا ہے اور اسے قبول کرتا ہے۔ کیئر فرسٹ قبولیت کا وقت محفوظ کرتا ہے۔

نوٹ: یہ معاہدے کا اردو متن سہولت کے لیے ہے؛ قانونی طور پر انگریزی متن ہی معتبر ہوگا۔
`.trim();
};

module.exports = { generateLegalAgreement, generateInstallmentAgreement, generateInstallmentAgreementUrdu };
