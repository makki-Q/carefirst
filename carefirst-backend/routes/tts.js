const express = require('express');
const router  = express.Router();
const { getStatus, speak } = require('../controllers/ttsController');
const { protect, requireActive } = require('../middleware/auth');

// Urdu audio for agreements and report summaries (any signed-in role; access is checked per item)
router.get('/status', protect, requireActive, getStatus);
router.post('/',      protect, requireActive, speak);

module.exports = router;
