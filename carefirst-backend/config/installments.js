// Installment-plan settings (decision 6 in PROJECT_GUIDE.md). All amounts are whole PKR.
// Read once at startup; server.js loads .env before this file is required.

const number = (value, fallback, max = Infinity) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

module.exports = {
  // Paid to CareFirst (not the lab), only when a patient opts into a plan
  SERVICE_FEE:          Math.round(number(process.env.SERVICE_FEE_PKR, 250)),
  // Share of the test price paid to the lab up front when the plan activates
  DOWN_PAYMENT_PERCENT: number(process.env.DOWN_PAYMENT_PERCENT, 20, 100),

  MAX_OPEN_PLANS: 2,      // pending applications count too
  MIN_INSTALLMENTS: 2,
  MAX_INSTALLMENTS: 6,    // the agreement's stamp paper has 6 schedule rows (decision 15)
  GRACE_DAYS:     3,      // days after a due date before escalation
  REMINDER_DAYS:  [3, 1], // "due soon" reminders, days before the due date

  // Where patients send the service fee
  CAREFIRST_ACCOUNT: {
    bankName:      text(process.env.CAREFIRST_BANK_NAME),
    accountTitle:  text(process.env.CAREFIRST_ACCOUNT_TITLE),
    accountNumber: text(process.env.CAREFIRST_ACCOUNT_NUMBER),
    jazzCash:      text(process.env.CAREFIRST_JAZZCASH),
    easyPaisa:     text(process.env.CAREFIRST_EASYPAISA),
  },
};
