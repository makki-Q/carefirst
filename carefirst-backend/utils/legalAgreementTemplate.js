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

module.exports = { generateLegalAgreement };
