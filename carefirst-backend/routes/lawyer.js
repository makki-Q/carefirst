const express = require('express');
const router  = express.Router();
const {
  getDefaulterCases, getDefaulterCaseById, closeCase,
  getNotifications, markRead, markAllRead,
} = require('../controllers/lawyerController');
const { protect, requireRole, requireActive } = require('../middleware/auth');

const guard = [protect, requireRole('lawyer'), requireActive];

// Defaulter cases
router.get('/',     ...guard, getDefaulterCases);          // alias root
router.get('/defaulter-cases',      ...guard, getDefaulterCases);
router.get('/defaulter-cases/:id',  ...guard, getDefaulterCaseById);
router.put('/defaulter-cases/:id/close', ...guard, closeCase); // settled outside CareFirst (decision 14)

// Notifications
router.get('/notifications',             ...guard, getNotifications);
router.put('/notifications/read-all',    ...guard, markAllRead);   // must be before /:id
router.put('/notifications/:id/read',    ...guard, markRead);

module.exports = router;
