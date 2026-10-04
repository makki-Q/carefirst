const crypto = require('crypto');

// Slip numbers printed on PDF slips and shown in the lab / doctor dashboards,
// e.g. "AP-7KQ4-M9XD". No 0/O/1/I so they are easy to read out and type.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SLIP_PREFIX = { appointment: 'AP', labBooking: 'LB', community: 'CS' };

const newSlipNumber = (prefix) => {
  const chars = Array.from(crypto.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4)}`;
};

// Mongoose plugin: gives every new document a slip number in `field`
const withSlipNumber = (prefix, field = 'slipNumber') => (schema) => {
  schema.add({ [field]: { type: String, unique: true, sparse: true } });
  schema.pre('validate', function (next) {
    if (!this[field]) this[field] = newSlipNumber(prefix);
    next();
  });
};

// Bookings made before slips existed get a number once, at startup
const backfillSlipNumbers = async () => {
  const Appointment = require('../models/Appointment');
  const LabBooking  = require('../models/LabBooking');
  let count = 0;
  for (const [Model, prefix] of [[Appointment, SLIP_PREFIX.appointment], [LabBooking, SLIP_PREFIX.labBooking]]) {
    const missing = await Model.find({ slipNumber: { $exists: false } }).select('_id').lean();
    for (const { _id } of missing) {
      await Model.updateOne({ _id, slipNumber: { $exists: false } }, { $set: { slipNumber: newSlipNumber(prefix) } });
      count++;
    }
  }
  return count;
};

module.exports = { SLIP_PREFIX, newSlipNumber, withSlipNumber, backfillSlipNumbers };
