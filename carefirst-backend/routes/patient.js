const express = require('express');
const router  = express.Router();
const {
  getProfile, updateProfile,
  getPrescriptions,
  getReports, markReportRead, getReportDoctors, shareReport, unshareReport,
  getWallets, uploadPaymentReceipt, uploadServiceFeeReceipt,
  getInstallmentConfig, previewInstallmentPlan, applyForInstallmentPlan,
  getAppointments, bookAppointment, cancelAppointment,
  getLabBookings, bookLabTest, cancelLabBooking, changeLabBranch,
  getCommunityApplications, createCommunityApplication,
  getNotifications, markRead, markAllRead,
} = require('../controllers/patientController');
const { protect, requireRole, requireActive } = require('../middleware/auth');
const { notRestricted } = require('../utils/defaulters'); // a defaulter can't book or apply (decision 14)
const { uploadReceipt, uploadCommunityDoc, uploadCnicPictures } = require('../middleware/upload');

const guard = [protect, requireRole('patient'), requireActive];

// Profile
router.get('/profile',  ...guard, getProfile);
router.put('/profile',  ...guard, updateProfile);

// Prescriptions issued by doctors
router.get('/prescriptions', ...guard, getPrescriptions);

// Test reports uploaded by labs
router.get('/reports',           ...guard, getReports);
router.put('/reports/:id/read',  ...guard, markReportRead);
// Sharing a report with a doctor the patient visited or booked (decision 13)
router.get('/report-doctors',                     ...guard, getReportDoctors);
router.put('/reports/:id/share',                  ...guard, shareReport);
router.delete('/reports/:id/share/:doctorId',     ...guard, unshareReport);

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
router.post('/installment-plans/preview', ...guard, notRestricted, previewInstallmentPlan);
router.post('/installment-plans',         ...guard, notRestricted, uploadCnicPictures, applyForInstallmentPlan);

// Doctor appointments (clinic visits)
router.get('/appointments',             ...guard, getAppointments);
router.post('/appointments',            ...guard, notRestricted, bookAppointment);
router.put('/appointments/:id/cancel',  ...guard, cancelAppointment);

// Lab visits
router.get('/lab-bookings',             ...guard, getLabBookings);
router.post('/lab-bookings',            ...guard, notRestricted, bookLabTest);
router.put('/lab-bookings/:id/cancel',  ...guard, cancelLabBooking);
router.put('/lab-bookings/:id/branch',  ...guard, changeLabBranch);  // go to another branch

// Community support
router.get('/community-applications',  ...guard, getCommunityApplications);
router.post('/community-applications', ...guard, notRestricted, uploadCommunityDoc.array('documents', 5), createCommunityApplication);

// Notifications
router.get('/notifications',            ...guard, getNotifications);
router.put('/notifications/read-all',   ...guard, markAllRead);   // must be before /:id
router.put('/notifications/:id/read',   ...guard, markRead);

module.exports = router;
