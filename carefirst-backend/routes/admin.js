const express = require('express');
const router  = express.Router();
const {
  adminLogin,
  getRegistrations, approveRegistration, rejectRegistration,
  getUsers, suspendUser, activateUser,
  verifyPatientCnic, rejectPatientCnic,
  getWallets, getWalletById, verifyInstallment, rejectLabPayment,
  approvePlan, rejectPlan, verifyServiceFee, rejectServiceFee,
  getDefaulterCases,
  getCommunityApplications, approveCommunityApplication, rejectCommunityApplication, getPartnerLabs,
  getNotifications, markNotificationRead,
} = require('../controllers/adminController');
const { getReports, getOverview, getSettings, updateSettings } = require('../controllers/adminInsightsController');
const { protect, requireRole } = require('../middleware/auth');

const guard = [protect, requireRole('admin')];

// Auth (no guard needed — hardcoded credential check inside controller)
router.post('/login', adminLogin);

// Dashboard, Platform Reports and Settings (real data)
router.get('/overview', ...guard, getOverview);
router.get('/reports',  ...guard, getReports);   // ?month=YYYY-MM
router.get('/settings', ...guard, getSettings);
router.put('/settings', ...guard, updateSettings); // CareFirst account for service fees, support email

// Registrations
router.get('/registrations',                  ...guard, getRegistrations);
router.put('/registrations/:userId/approve',  ...guard, approveRegistration);
router.put('/registrations/:userId/reject',   ...guard, rejectRegistration);

// User management
router.get('/users',                   ...guard, getUsers);
router.put('/users/:userId/suspend',   ...guard, suspendUser);
router.put('/users/:userId/activate',  ...guard, activateUser);

// Patient CNIC verification
router.put('/patients/:userId/cnic/verify', ...guard, verifyPatientCnic);
router.put('/patients/:userId/cnic/reject', ...guard, rejectPatientCnic);

// Digital wallet monitoring
router.get('/wallets',                                              ...guard, getWallets);
router.get('/wallets/:walletId',                                    ...guard, getWalletById);
router.put('/wallets/:walletId/installments/:instIndex/verify',    ...guard, verifyInstallment);
router.put('/wallets/:walletId/down-payment/verify',               ...guard, verifyInstallment);
router.put('/wallets/:walletId/installments/:instIndex/reject',    ...guard, rejectLabPayment);
router.put('/wallets/:walletId/down-payment/reject',               ...guard, rejectLabPayment);

// Installment plan applications
router.put('/wallets/:walletId/approve',             ...guard, approvePlan);
router.put('/wallets/:walletId/reject',              ...guard, rejectPlan);
router.put('/wallets/:walletId/service-fee/verify',  ...guard, verifyServiceFee);
router.put('/wallets/:walletId/service-fee/reject',  ...guard, rejectServiceFee);

// Defaulter cases (read-only — cases are auto-created by the cron job)
router.get('/defaulter-cases', ...guard, getDefaulterCases);

// Community support
router.get('/community-applications',                  ...guard, getCommunityApplications);
router.put('/community-applications/:id/approve',      ...guard, approveCommunityApplication);
router.get('/partner-labs',                            ...guard, getPartnerLabs); // labs in Community Support
router.put('/community-applications/:id/reject',       ...guard, rejectCommunityApplication);

// Notifications
router.get('/notifications',           ...guard, getNotifications);
router.put('/notifications/:id/read',  ...guard, markNotificationRead);

module.exports = router;
