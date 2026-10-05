const express = require('express');
const router  = express.Router();
const {
  getProfile, updateProfile,
  getTests, addTest, updateTest, deleteTest,
  uploadReport, getReports, updateReportSummary, readReportAgain,
  getReceiptsPendingApproval, approveReceipt, rejectReceipt,
  getNeedyPatients, markTestConducted, setCommunitySupport, getEarnings,
  getLabPatients,
  getBookings, markSampleCollected, completeBooking, transferBooking,
  getBranches, addBranch, updateBranch, deleteBranch,
  getNotifications, markRead,
} = require('../controllers/labController');
const { protect, requireRole, requireActive } = require('../middleware/auth');
const { uploadReport: reportUpload }          = require('../middleware/upload');

const guard = [protect, requireRole('lab'), requireActive];

// Profile
router.get('/profile',  ...guard, getProfile);
router.put('/profile',  ...guard, updateProfile);

// Branches (a lab account is a chain of branches)
router.get('/branches',              ...guard, getBranches);
router.post('/branches',             ...guard, addBranch);
router.put('/branches/:branchId',    ...guard, updateBranch);
router.delete('/branches/:branchId', ...guard, deleteBranch);

// Test catalog
router.get('/tests',           ...guard, getTests);
router.post('/tests',          ...guard, addTest);
router.put('/tests/:testId',   ...guard, updateTest);
router.delete('/tests/:testId',...guard, deleteTest);

// Test reports (lab → patient)
router.post('/reports/upload',  ...guard, reportUpload.single('report'), uploadReport);
router.get('/reports',          ...guard, getReports);
router.put('/reports/:id/summary', ...guard, updateReportSummary); // correct the Urdu / re-translate
router.post('/reports/:id/read-again', ...guard, readReportAgain);  // re-run the automatic reading

// Receipt approval (lab confirms patient's payment)
router.get('/receipts',                                                   ...guard, getReceiptsPendingApproval);
router.put('/receipts/:walletId/installments/:instIndex/approve',         ...guard, approveReceipt);
router.put('/receipts/:walletId/down-payment/approve',                    ...guard, approveReceipt);
router.put('/receipts/:walletId/installments/:instIndex/reject',          ...guard, rejectReceipt);
router.put('/receipts/:walletId/down-payment/reject',                     ...guard, rejectReceipt);

// Needy patients (community support)
router.get('/needy-patients',                      ...guard, getNeedyPatients);
router.put('/needy-patients/:id/mark-conducted',   ...guard, markTestConducted);
router.put('/community-support',                   ...guard, setCommunitySupport); // join / leave

// Payments recorded on CareFirst (visits paid at the lab + confirmed plan payments)
router.get('/earnings', ...guard, getEarnings);

// Bookings (patients' lab visits): confirmed → sample_collected → completed
router.get('/bookings',                        ...guard, getBookings);
router.put('/bookings/:id/sample-collected',   ...guard, markSampleCollected);
router.put('/bookings/:id/complete',           ...guard, completeBooking);
router.put('/bookings/:id/transfer',           ...guard, transferBooking); // take the visit at another branch

// Patients linked to this lab (for report upload dropdown)
router.get('/patients', ...guard, getLabPatients);

// Notifications
router.get('/notifications',           ...guard, getNotifications);
router.put('/notifications/:id/read',  ...guard, markRead);

module.exports = router;
