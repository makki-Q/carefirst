const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  time:     { type: String, required: true }, // e.g. "09:00 AM"
  isBooked: { type: Boolean, default: false },
});

const availabilitySchema = new mongoose.Schema({
  day:   { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], required: true },
  slots: [slotSchema],
});

const doctorProfileSchema = new mongoose.Schema(
  {
    user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    specialization:  { type: String, required: true, trim: true },
    experience:      { type: Number, min: 0 },   // years
    consultationFee: { type: Number, default: 0, min: 0 },
    availability:    [availabilitySchema],
    bio:             { type: String, trim: true },
    rating:          { type: Number, default: 0, min: 0, max: 5 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DoctorProfile', doctorProfileSchema);
