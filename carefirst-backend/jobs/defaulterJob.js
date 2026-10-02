const cron = require('node-cron');
const Wallet        = require('../models/Wallet');
const DefaulterCase = require('../models/DefaulterCase');
const Notification  = require('../models/Notification');
const User          = require('../models/User');
const { sendNotification }       = require('../socket/notificationSocket');
const { generateLegalAgreement } = require('../utils/legalAgreementTemplate');

const GRACE_DAYS = 3; // days after due date before escalation

const runDefaulterCheck = async () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Running defaulter check...`);

  try {
    const now     = new Date();
    const wallets = await Wallet.find({ status: 'active' })
      .populate('patient', 'name email phone');

    for (const wallet of wallets) {
      let newlyOverdue = false;

      for (const inst of wallet.installments) {
        if (inst.status !== 'pending') continue;

        const graceCutoff = new Date(inst.dueDate);
        graceCutoff.setDate(graceCutoff.getDate() + GRACE_DAYS);

        // Past grace period AND no receipt uploaded yet → overdue
        if (now > graceCutoff && !inst.receiptUrl) {
          inst.status = 'overdue';
          newlyOverdue = true;
        }
      }

      if (!newlyOverdue) continue;

      const overdueList   = wallet.installments.filter(i => i.status === 'overdue');
      const totalOverdue  = overdueList.reduce((sum, i) => sum + i.amount, 0);

      // If already escalated, just update the counts
      const existingCase = await DefaulterCase.findOne({ wallet: wallet._id });
      if (existingCase) {
        existingCase.missedInstallments = overdueList.length;
        existingCase.totalOverdue       = totalOverdue;
        await existingCase.save();
        await wallet.save();
        continue;
      }

      // First time escalation
      wallet.status = 'defaulter';

      // Assign to the lawyer with the fewest active cases (round-robin by load)
      const lawyers   = await User.find({ role: 'lawyer', status: 'active' });
      let assignedLawyer = null;

      if (lawyers.length > 0) {
        const counts   = await Promise.all(
          lawyers.map(l => DefaulterCase.countDocuments({ assignedLawyer: l._id, status: 'active' }))
        );
        const minIndex = counts.indexOf(Math.min(...counts));
        assignedLawyer = lawyers[minIndex];
      }

      const legalText = generateLegalAgreement({
        patient:          wallet.patient,
        guarantor:        wallet.guarantor,
        testName:         wallet.testName,
        totalAmount:      wallet.totalAmount,
        remainingBalance: wallet.remainingBalance,
        escalatedAt:      now,
      });

      const newCase = await DefaulterCase.create({
        patient:            wallet.patient._id,
        wallet:             wallet._id,
        assignedLawyer:     assignedLawyer?._id,
        missedInstallments: overdueList.length,
        totalOverdue,
        legalAgreementText: legalText,
        escalatedAt:        now,
      });

      await wallet.save();

      // Notify the assigned lawyer
      if (assignedLawyer) {
        const lawyerNotif = await Notification.create({
          recipient: assignedLawyer._id,
          title:     'New Defaulter Case Assigned',
          message:   `${wallet.patient.name} has missed ${overdueList.length} installment(s) — PKR ${totalOverdue.toLocaleString()} overdue. Case #${newCase._id} assigned to you.`,
          type:      'defaulter_escalated',
          meta:      { caseId: newCase._id, walletId: wallet._id },
        });
        sendNotification(assignedLawyer._id.toString(), lawyerNotif);
      }

      // Notify all admins
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        const adminNotif = await Notification.create({
          recipient: admin._id,
          title:     'Patient Escalated to Defaulter',
          message:   `${wallet.patient.name} has been automatically moved to defaulter status. Legal case #${newCase._id} created.`,
          type:      'defaulter_escalated',
          meta:      { caseId: newCase._id, walletId: wallet._id },
        });
        sendNotification(admin._id.toString(), adminNotif);
      }

      // Notify the patient
      const patientNotif = await Notification.create({
        recipient: wallet.patient._id,
        title:     'Account Escalated to Legal',
        message:   `Your account has been escalated to our legal team due to ${overdueList.length} missed installment(s) totalling PKR ${totalOverdue.toLocaleString()}. Please contact support immediately.`,
        type:      'defaulter_escalated',
        meta:      { walletId: wallet._id },
      });
      sendNotification(wallet.patient._id.toString(), patientNotif);
    }

    console.log(`[${new Date().toISOString()}] Defaulter check complete.`);
  } catch (err) {
    console.error(`[DefaulterJob] Error: ${err.message}`);
  }
};

const startDefaulterJob = () => {
  // Runs every day at 00:05 PKT
  cron.schedule('5 0 * * *', runDefaulterCheck, { timezone: 'Asia/Karachi' });
  console.log('[DefaulterJob] Scheduled — runs daily at 00:05 PKT');
};

module.exports = { startDefaulterJob, runDefaulterCheck };
