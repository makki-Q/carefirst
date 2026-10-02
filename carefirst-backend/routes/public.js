const express       = require('express');
const router        = express.Router();
const LabProfile    = require('../models/LabProfile');
const DoctorProfile = require('../models/DoctorProfile');
const User          = require('../models/User');

// GET /api/public/tests — all active tests from all active labs (no auth required)
router.get('/tests', async (req, res) => {
  try {
    const activeLabIds = await User.find({ role: 'lab', status: 'active' }).distinct('_id');
    const labs = await LabProfile.find({ user: { $in: activeLabIds } })
      .populate('user', 'name')
      .select('labName location user tests isCharityPartner');

    const result = labs
      .filter(lab => lab.user && lab.tests.some(t => t.isActive))
      .map(lab => ({
        labId:            lab.user._id,
        labName:          lab.labName,
        location:         lab.location,
        isCharityPartner: lab.isCharityPartner,
        tests: lab.tests
          .filter(t => t.isActive)
          .map(t => ({
            _id:                  t._id,
            name:                 t.name,
            category:             t.category,
            price:                t.price,
            installmentEnabled:   t.installmentEnabled,
            installmentCount:     t.installmentCount,
            installmentTenureDays:t.installmentTenureDays,
          })),
      }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/public/doctors — active doctors with their public profile (no auth required)
router.get('/doctors', async (req, res) => {
  try {
    const doctors  = await User.find({ role: 'doctor', status: 'active' }).select('name');
    const profiles = await DoctorProfile.find({ user: { $in: doctors.map(d => d._id) } });
    const byUser   = {};
    profiles.forEach(p => { byUser[p.user.toString()] = p; });

    const result = doctors
      .filter(d => byUser[d._id.toString()])
      .map(d => {
        const p = byUser[d._id.toString()];
        return {
          doctorId:        d._id,
          name:            d.name,
          specialization:  p.specialization,
          experience:      p.experience || 0,
          consultationFee: p.consultationFee || 0,
          rating:          p.rating || 0,
          bio:             p.bio || '',
          availableDays:   p.availability.filter(a => a.slots.length > 0).map(a => a.day),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
