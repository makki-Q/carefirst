const express = require('express');
const router  = express.Router();
const {
  getProfile, updateProfile,
  getAvailability, updateAvailability, updateFee,
  createPrescription, getPrescriptions,
  getReports,
  getNotifications, markRead,
} = require('../controllers/doctorController');
const { protect, requireRole, requireActive } = require('../middleware/auth');

const guard = [protect, requireRole('doctor'), requireActive];

// Profile
router.get('/profile',  ...guard, getProfile);
router.put('/profile',  ...guard, updateProfile);

// Availability & fee
router.get('/availability',  ...guard, getAvailability);
router.put('/availability',  ...guard, updateAvailability);
router.put('/fee',           ...guard, updateFee);

// Prescriptions
router.post('/prescriptions',  ...guard, createPrescription);
router.get('/prescriptions',   ...guard, getPrescriptions);

// Lab reports for this doctor's patients
router.get('/reports',  ...guard, getReports);

// Notifications
router.get('/notifications',           ...guard, getNotifications);
router.put('/notifications/:id/read',  ...guard, markRead);

module.exports = router;
