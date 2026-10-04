const express = require('express');
const router  = express.Router();
const { getCnicPicture } = require('../controllers/documentController');
const { protect, requireActive } = require('../middleware/auth');

// Private documents (any signed-in role; access is checked per item)
router.get('/wallets/:walletId/cnic/:picture', protect, requireActive, getCnicPicture);

module.exports = router;
