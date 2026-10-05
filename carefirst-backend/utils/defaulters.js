// Defaulters (decision 14): a patient with a plan escalated to 'defaulter' is restricted — they can
// only pay (My Wallet) and read their own records — until every overdue installment is verified.
const Wallet        = require('../models/Wallet');
const DefaulterCase = require('../models/DefaulterCase');
const Notification  = require('../models/Notification');
const User          = require('../models/User');
const { sendNotification } = require('../socket/notificationSocket');

const RESTRICTED_MESSAGE = 'Your account is restricted because of overdue installments. ' +
  'Upload the payment receipts in My Wallet — once they are verified your account returns to normal.';

const same = (a, b) => Boolean(a && b && a.toString() === b.toString());

const notify = async (recipient, { title, message, type, meta }) => {
  const notif = await Notification.create({ recipient, title, message, type, meta });
  sendNotification(recipient.toString(), notif);
};

// What the patient still owes on escalated plans, or null when the account is not restricted
const restrictionFor = async (patientId) => {
  const wallets = await Wallet.find({ patient: patientId, status: 'defaulter' }).select('testName installments');
  if (!wallets.length) return null;
  const overdue = wallets.flatMap(w => w.installments.filter(i => i.status === 'overdue'));
  return {
    plans:        wallets.map(w => ({ walletId: w._id, testName: w.testName })),
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((sum, i) => sum + i.amount, 0),
  };
};

// Route guard for everything a restricted patient may not do (book, apply)
const notRestricted = async (req, res, next) => {
  try {
    if (await Wallet.exists({ patient: req.user._id, status: 'defaulter' })) {
      return res.status(403).json({ message: RESTRICTED_MESSAGE, restricted: true });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Call after a payment on a plan is verified (or settled by the lawyer). While overdue installments
// remain, the open case's figures are refreshed; once none remain, the plan goes back to active
// (or completed), the case closes and the patient, lawyer and admins are told. → the closed case or null
const clearDefaultIfPaid = async (wallet, { resolution = 'paid', note, by } = {}) => {
  if (wallet.status !== 'defaulter') return null;
  const openCase = await DefaulterCase.findOne({ wallet: wallet._id, status: 'active' });
  const overdue = wallet.installments.filter(i => i.status === 'overdue');
  if (overdue.length) {
    if (openCase) {
      openCase.missedInstallments = overdue.length;
      openCase.totalOverdue       = overdue.reduce((sum, i) => sum + i.amount, 0);
      await openCase.save();
    }
    return null;
  }

  wallet.status = wallet.isFullyPaid() ? 'completed' : 'active';
  await wallet.save();
  if (openCase) {
    Object.assign(openCase, { status: 'resolved', resolvedAt: new Date(), resolution, resolutionNote: note, resolvedBy: by });
    await openCase.save();
  }

  const patientId   = wallet.patient?._id || wallet.patient;
  const patientName = wallet.patient?.name || (await User.findById(patientId).select('name'))?.name || 'The patient';
  const how = resolution === 'settled' ? 'settled the overdue installments with the lawyer' : 'paid all overdue installments';
  const stillRestricted = await Wallet.exists({ patient: patientId, status: 'defaulter' });
  const meta = { walletId: wallet._id, caseId: openCase?._id };

  await notify(patientId, {
    type:  'defaulter_cleared',
    title: stillRestricted ? 'Plan Back to Normal' : 'Account Restored',
    message: stillRestricted
      ? `Your overdue installments for ${wallet.testName} are cleared. Your account stays restricted until your other overdue plan is paid.`
      : `Your overdue installments for ${wallet.testName} are cleared. Your account is back to normal — you can book doctors and tests again.`,
    meta,
  });
  if (openCase?.assignedLawyer && !same(openCase.assignedLawyer, by)) {
    await notify(openCase.assignedLawyer, {
      type: 'defaulter_cleared', title: 'Defaulter Case Closed',
      message: `${patientName} ${how} for ${wallet.testName}. The case is closed.`, meta,
    });
  }
  for (const admin of await User.find({ role: 'admin' }).select('_id')) {
    if (same(admin._id, by)) continue;
    await notify(admin._id, {
      type: 'defaulter_cleared', title: 'Defaulter Cleared',
      message: `${patientName} ${how} for ${wallet.testName}. The case is closed${stillRestricted ? '' : ' and the account is back to normal'}.`, meta,
    });
  }
  return openCase;
};

module.exports = { RESTRICTED_MESSAGE, restrictionFor, notRestricted, clearDefaultIfPaid };
