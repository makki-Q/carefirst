const express = require('express');
const router  = express.Router();
const {
  adminLogin,
  getRegistrations, approveRegistration, rejectRegistration,
  getUsers, suspendUser, activateUser,
  verifyPatientCnic, rejectPatientCnic,
  getWallets, getWalletById, verifyInstallment,
  getDefaulterCases,
  getCommunityApplications, approveCommunityApplication, rejectCommunityApplication,
  getNotifications, markNotificationRead,
} = require('../controllers/adminController');
const { protect, requireRole } = require('../middleware/auth');

const guard = [protect, requireRole('admin')];

// Auth (no guard needed — hardcoded credential check inside controller)
router.post('/login', adminLogin);

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

// Defaulter cases (read-only — cases are auto-created by the cron job)
router.get('/defaulter-cases', ...guard, getDefaulterCases);

// Community support
router.get('/community-applications',                  ...guard, getCommunityApplications);
router.put('/community-applications/:id/approve',      ...guard, approveCommunityApplication);
router.put('/community-applications/:id/reject',       ...guard, rejectCommunityApplication);

// Notifications
router.get('/notifications',           ...guard, getNotifications);
router.put('/notifications/:id/read',  ...guard, markNotificationRead);

module.exports = router;
