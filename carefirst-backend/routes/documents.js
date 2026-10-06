const express = require('express');
const router  = express.Router();
const { getCnicPicture, getAgreementPdf, getAppointmentSlip, getLabBookingSlip, getCommunitySlip } = require('../controllers/documentController');
const { protect, requireActive } = require('../middleware/auth');

// Private documents (any signed-in role; access is checked per item)
router.get('/wallets/:walletId/cnic/:picture', protect, requireActive, getCnicPicture);
router.get('/agreements/:walletId', protect, requireActive, getAgreementPdf); // the filled stamp paper (decision 15)

// PDF slips (appointment, lab visit, approved community support)
router.get('/slips/appointment/:id', protect, requireActive, getAppointmentSlip);
router.get('/slips/lab-booking/:id', protect, requireActive, getLabBookingSlip);
router.get('/slips/community/:id',   protect, requireActive, getCommunitySlip);

module.exports = router;
