const generateLegalAgreement = ({ patient, guarantor, testName, totalAmount, remainingBalance, escalatedAt }) => {
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
Email     : ${patient.email || 'N/A'}
Phone     : ${patient.phone || 'N/A'}

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CareFirst Health Platform — Legal Department
support@carefirst.pk
`.trim();
};

// Agreement the patient reads and accepts when applying for an installment plan.
// It has no date in it: the acceptance time is stored next to the text, so the
// text shown before acceptance can be compared word for word with the stored one.
const generateInstallmentAgreement = ({
  patient, patientCnic, guarantor, labName, testName,
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
   who receive this agreement and the patient and guarantor details above.
3. The guarantor is jointly liable with the patient for every outstanding amount.
4. Recovery is pursued offline through applicable legal channels.

SECTION 5 — DECLARATION
The patient confirms that the details above are correct, that the guarantor
has agreed to stand as guarantor, and that the patient has read and accepts
this agreement. CareFirst records the time of acceptance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CareFirst Health Platform — Legal Department
support@carefirst.pk
`.trim();
};

module.exports = { generateLegalAgreement, generateInstallmentAgreement };
