const express       = require('express');
const router        = express.Router();
const LabProfile    = require('../models/LabProfile');
const DoctorProfile = require('../models/DoctorProfile');
const User          = require('../models/User');
const Appointment   = require('../models/Appointment');
const mongoose      = require('mongoose');
const { hasPaymentDetails } = require('../utils/installmentPlan');
const {
  freeSlots, formatTime12, bookingDates, DEFAULT_CONSULTATION_MINUTES, BOOKING_WINDOW_DAYS,
} = require('../utils/schedule');

// GET /api/public/tests — all active tests from all active labs (no auth required)
router.get('/tests', async (req, res) => {
  try {
    const activeLabIds = await User.find({ role: 'lab', status: 'active' }).distinct('_id');
    const labs = await LabProfile.find({ user: { $in: activeLabIds } })
      .populate('user', 'name')
      .select('labName location user tests isCharityPartner bankDetails jazzCash easyPaisa');

    const result = labs
      .filter(lab => lab.user && lab.tests.some(t => t.isActive))
      .map(lab => ({
        labId:            lab.user._id,
        labName:          lab.labName,
        location:         lab.location,
        isCharityPartner: lab.isCharityPartner,
        // Installment plans need the lab's payment details (down payment + installments go to the lab)
        acceptsInstallments: hasPaymentDetails(lab),
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
          consultationDuration: p.consultationDuration || DEFAULT_CONSULTATION_MINUTES,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/public/doctors/:doctorId/slots — free future start times for the next
// BOOKING_WINDOW_DAYS days, from the weekly availability minus confirmed bookings
router.get('/doctors/:doctorId/slots', async (req, res) => {
  try {
    const { doctorId } = req.params;
    if (!mongoose.isValidObjectId(doctorId)) return res.status(404).json({ message: 'Doctor not found' });

    const doctor  = await User.findOne({ _id: doctorId, role: 'doctor', status: 'active' }).select('name');
    const profile = doctor && await DoctorProfile.findOne({ user: doctor._id });
    if (!profile) return res.status(404).json({ message: 'Doctor not found' });

    const dates  = bookingDates();
    const booked = await Appointment.find({ doctor: doctor._id, status: 'confirmed', date: { $in: dates } }).select('date time');
    const taken  = new Set(booked.map(a => `${a.date} ${a.time}`));
    const duration = profile.consultationDuration || DEFAULT_CONSULTATION_MINUTES;

    res.json({
      doctorId:             doctor._id,
      name:                 doctor.name,
      specialization:       profile.specialization,
      consultationFee:      profile.consultationFee || 0,
      consultationDuration: duration,
      windowDays:           BOOKING_WINDOW_DAYS,
      days: freeSlots(profile.availability, duration, taken).map(d => ({
        ...d,
        times: d.times.map(time => ({ time, label: formatTime12(time) })),
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
