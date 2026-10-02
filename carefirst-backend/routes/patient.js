const express = require('express');
const router  = express.Router();
const {
  getProfile, updateProfile,
  getPrescriptions,
  getReports, markReportRead,
  getWallets, uploadPaymentReceipt, uploadServiceFeeReceipt,
  getInstallmentConfig, previewInstallmentPlan, applyForInstallmentPlan,
  getAppointments, bookAppointment, cancelAppointment,
  getCommunityApplications, createCommunityApplication,
  getNotifications, markRead, markAllRead,
} = require('../controllers/patientController');
const { protect, requireRole, requireActive } = require('../middleware/auth');
const { uploadReceipt, uploadCommunityDoc }   = require('../middleware/upload');

const guard = [protect, requireRole('patient'), requireActive];

// Profile
router.get('/profile',  ...guard, getProfile);
router.put('/profile',  ...guard, updateProfile);

// Prescriptions issued by doctors
router.get('/prescriptions', ...guard, getPrescriptions);

// Test reports uploaded by labs
router.get('/reports',           ...guard, getReports);
router.put('/reports/:id/read',  ...guard, markReportRead);

// Digital wallet (installment ledger)
router.get('/wallets', ...guard, getWallets);
router.post('/wallets/:walletId/installments/:instIndex/receipt',
  ...guard, uploadReceipt.single('receipt'), uploadPaymentReceipt);
router.post('/wallets/:walletId/down-payment/receipt',
  ...guard, uploadReceipt.single('receipt'), uploadPaymentReceipt);
router.post('/wallets/:walletId/service-fee/receipt',
  ...guard, uploadReceipt.single('receipt'), uploadServiceFeeReceipt);

// Installment plan applications
router.get('/installment-plans/config',   ...guard, getInstallmentConfig);
router.post('/installment-plans/preview', ...guard, previewInstallmentPlan);
router.post('/installment-plans',         ...guard, applyForInstallmentPlan);

// Doctor appointments (clinic visits)
router.get('/appointments',             ...guard, getAppointments);
router.post('/appointments',            ...guard, bookAppointment);
router.put('/appointments/:id/cancel',  ...guard, cancelAppointment);

// Community support
router.get('/community-applications',  ...guard, getCommunityApplications);
router.post('/community-applications', ...guard, uploadCommunityDoc.array('documents', 5), createCommunityApplication);

// Notifications
router.get('/notifications',            ...guard, getNotifications);
router.put('/notifications/read-all',   ...guard, markAllRead);   // must be before /:id
router.put('/notifications/:id/read',   ...guard, markRead);

module.exports = router;
