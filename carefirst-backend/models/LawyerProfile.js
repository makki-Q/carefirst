const mongoose = require('mongoose');

const lawyerProfileSchema = new mongoose.Schema(
  {
    user:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    barNumber:      { type: String, trim: true },
    phone:          { type: String, trim: true },
    specialization: { type: String, default: 'General Practice', trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LawyerProfile', lawyerProfileSchema);
