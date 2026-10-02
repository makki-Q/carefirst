const PatientProfile = require('../models/PatientProfile');

// Returns { [userId]: PatientProfile } for the given patient user ids
const getPatientProfileMap = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean).map(id => id.toString()))];
  if (ids.length === 0) return {};
  const profiles = await PatientProfile.find({ user: { $in: ids } })
    .select('user cnic city address cnicStatus');
  const map = {};
  profiles.forEach(p => { map[p.user.toString()] = p; });
  return map;
};

// Adds cnic / city / address / cnicStatus onto each doc's populated `patient`
// field; returns plain objects
const withPatientDetails = async (docs) => {
  const map = await getPatientProfileMap(docs.map(d => d.patient?._id));
  return docs.map(d => {
    const obj = d.toObject ? d.toObject() : d;
    const p   = obj.patient?._id ? map[obj.patient._id.toString()] : null;
    if (p) {
      obj.patient = { ...obj.patient, cnic: p.cnic, city: p.city, address: p.address, cnicStatus: p.cnicStatus };
    }
    return obj;
  });
};

module.exports = { getPatientProfileMap, withPatientDetails };
