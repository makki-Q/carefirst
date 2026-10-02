const mongoose = require('mongoose');

// A physical clinic visit. Auto-confirmed when booked; the fee is paid at the clinic.
const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctor:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    date:     { type: String, required: true }, // PKT calendar day, "YYYY-MM-DD"
    time:     { type: String, required: true }, // PKT start, "HH:MM" (24h)
    startsAt: { type: Date,   required: true }, // same moment as a real instant
    durationMinutes: { type: Number, required: true },
    fee:      { type: Number, default: 0 },     // consultation fee when booked (paid at the clinic)

    status: { type: String, enum: ['confirmed', 'cancelled', 'completed', 'no_show'], default: 'confirmed' },
    cancelledBy:        { type: String, enum: ['patient', 'doctor'] },
    cancellationReason: { type: String, trim: true },
    cancelledAt:        { type: Date },
    closedAt:           { type: Date }, // marked completed / no_show
  },
  { timestamps: true }
);

// One confirmed booking per doctor per slot — enforced by MongoDB, not just the UI.
// Cancelled bookings drop out of the index, so the slot opens up again.
appointmentSchema.index(
  { doctor: 1, date: 1, time: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' }, name: 'one_confirmed_booking_per_slot' }
);
appointmentSchema.index({ patient: 1, startsAt: -1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
