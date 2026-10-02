const { DOWN_PAYMENT_PERCENT } = require('../config/installments');

// Plans that count toward the per-patient limit
const OPEN_PLAN_STATUSES = ['pending_approval', 'awaiting_fee', 'active', 'defaulter'];

const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Pakistan is UTC+5 all year

// Calendar day number in Pakistan time — used to count "days until due"
const pktDay = (date) => Math.floor((new Date(date).getTime() + PKT_OFFSET_MS) / DAY_MS);

// The lab's own payment channels; patients pay the down payment and installments here
const labPaymentDetails = (labProfile) => ({
  bankName:      labProfile?.bankDetails?.bankName?.trim()      || '',
  accountNumber: labProfile?.bankDetails?.accountNumber?.trim() || '',
  jazzCash:      labProfile?.jazzCash?.trim()  || '',
  easyPaisa:     labProfile?.easyPaisa?.trim() || '',
});

const hasPaymentDetails = (labProfile) => {
  const d = labPaymentDetails(labProfile);
  return Boolean((d.bankName && d.accountNumber) || d.jazzCash || d.easyPaisa);
};

// Down payment = DOWN_PAYMENT_PERCENT of the price; the rest is split into
// `count` whole-rupee installments with the remainder on the last one
const planAmounts = (totalAmount, count) => {
  const downPayment = Math.round(totalAmount * DOWN_PAYMENT_PERCENT / 100);
  const rest        = totalAmount - downPayment;
  const base        = Math.floor(rest / count);
  const installments = Array(count).fill(base);
  installments[count - 1] += rest - base * count;
  return { downPayment, installments };
};

// Installment N is due N tenures after activation
const buildSchedule = (amounts, tenureDays, activatedAt) =>
  amounts.map((amount, i) => ({
    number:  i + 1,
    amount,
    dueDate: new Date(activatedAt.getTime() + tenureDays * (i + 1) * DAY_MS),
  }));

module.exports = {
  OPEN_PLAN_STATUSES, pktDay,
  labPaymentDetails, hasPaymentDetails,
  planAmounts, buildSchedule,
};
