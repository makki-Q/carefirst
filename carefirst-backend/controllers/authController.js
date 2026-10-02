const User          = require('../models/User');
const LabProfile    = require('../models/LabProfile');
const DoctorProfile = require('../models/DoctorProfile');
const LawyerProfile  = require('../models/LawyerProfile');
const PatientProfile = require('../models/PatientProfile');
const generateToken  = require('../utils/generateToken');
const { normalizeCnic } = require('../utils/cnic');

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, password, phone, role, ...extra } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!['patient', 'lawyer', 'lab', 'doctor'].includes(role)) {
      return res.status(400).json({ message: 'Role must be one of: patient, lawyer, lab, doctor' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, and password are required' });
    }

    // Patients must supply a valid, unused CNIC
    let cnic = null;
    if (role === 'patient') {
      cnic = normalizeCnic(extra.cnic);
      if (!cnic) return res.status(400).json({ message: 'A valid 13-digit CNIC is required (e.g. 35202-1234567-8)' });
      if (await PatientProfile.exists({ cnic })) {
        return res.status(409).json({ message: 'This CNIC is already registered' });
      }
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email is already registered' });

    // Patients are active immediately (CNIC is verified later by admin);
    // providers stay 'pending' until admin approves
    const status = role === 'patient' ? 'active' : 'pending';
    const user   = await User.create({ name, email, password, phone, role, status });

    // Create role-specific profile
    try {
      if (role === 'patient') {
        const { city, address } = extra;
        await PatientProfile.create({ user: user._id, cnic, city, address });

      } else if (role === 'lab') {
        const { labName, location, licenseNumber } = extra;
        if (!labName || !location) throw new Error('labName and location are required for labs');
        await LabProfile.create({ user: user._id, labName, location, licenseNumber, phone });

      } else if (role === 'doctor') {
        const { specialization, experience } = extra;
        if (!specialization) throw new Error('specialization is required for doctors');
        await DoctorProfile.create({ user: user._id, specialization, experience: Number(experience) || 0 });

      } else if (role === 'lawyer') {
        const { barNumber } = extra;
        await LawyerProfile.create({ user: user._id, barNumber, phone });
      }
    } catch (profileErr) {
      await User.findByIdAndDelete(user._id); // rollback
      if (profileErr.code === 11000) return res.status(409).json({ message: 'This CNIC is already registered' });
      return res.status(400).json({ message: profileErr.message });
    }

    res.status(201).json({
      message: role === 'patient'
        ? 'Account created. You can now log in.'
        : 'Registration submitted. Awaiting admin approval.',
      user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/auth/login  (lawyer, lab, doctor, patient — NOT admin)
const login = async (req, res) => {
  try {
    const { password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    // Admin must use /api/admin/login
    if (user.role === 'admin') {
      return res.status(400).json({ message: 'Admin must log in via /api/admin/login' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

    const statusMessages = {
      pending:   'Your account is awaiting admin approval.',
      rejected:  'Your registration was rejected.',
      suspended: 'Your account has been suspended.',
    };
    if (user.status !== 'active') {
      return res.status(403).json({ message: statusMessages[user.status] });
    }

    const token = generateToken(user._id, user.role);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    let profile = null;
    if (req.user.role === 'lab')    profile = await LabProfile.findOne({ user: req.user._id });
    if (req.user.role === 'doctor') profile = await DoctorProfile.findOne({ user: req.user._id });
    if (req.user.role === 'lawyer') profile = await LawyerProfile.findOne({ user: req.user._id });
    if (req.user.role === 'patient') profile = await PatientProfile.findOne({ user: req.user._id });

    res.json({ user: req.user, profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { register, login, getMe };
