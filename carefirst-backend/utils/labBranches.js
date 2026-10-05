// Lab chains and their branches (decision 12 in PROJECT_GUIDE.md).
// A lab account is a chain; each branch has its own address, phone, hours and map pin,
// and each test can be limited to some branches (empty list = every branch).
const { isLatLng } = require('./travel');

const same = (a, b) => Boolean(a && b && a.toString() === b.toString());

// Does `branch` offer `test`?
const offersTest = (test, branch) => !test.branches?.length || test.branches.some(id => same(id, branch._id));

// Branches of a lab that offer a test
const branchesOffering = (profile, test) => (profile.branches || []).filter(b => offersTest(test, b));

// Public shape of a branch
const branchView = (b) => ({
  branchId:    b._id,
  name:        b.name,
  address:     b.address,
  area:        b.area || '',
  phone:       b.phone || '',
  hours:       b.hours || '',
  coordinates: isLatLng(b.coordinates) ? { lat: b.coordinates.lat, lng: b.coordinates.lng } : null,
  hasLocation: isLatLng(b.coordinates),
});

// Checks a branch from the lab's form → { error } or { branch }
const cleanBranchInput = (body, { partial = false } = {}) => {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {};
  for (const [key, max, label] of [['name', 80, 'Branch name'], ['address', 200, 'Address'], ['area', 60, 'Area'], ['phone', 30, 'Phone'], ['hours', 80, 'Opening hours']]) {
    if (body[key] === undefined) continue;
    const value = str(body[key]);
    if (value.length > max) return { error: `${label} can be up to ${max} characters` };
    out[key] = value;
  }
  if (!partial || body.name !== undefined) { if (!out.name) return { error: 'Please enter the branch name' }; }
  if (!partial || body.address !== undefined) { if (!out.address) return { error: 'Please enter the branch address' }; }
  if (body.coordinates === null) out.coordinates = null;
  else if (body.coordinates !== undefined) {
    const point = { lat: Number(body.coordinates?.lat), lng: Number(body.coordinates?.lng) };
    if (!isLatLng(point)) return { error: 'Invalid map location' };
    out.coordinates = point;
  }
  return { branch: out };
};

// A lab without branches (registered before branches existed) gets one from its own details
const ensureBranch = (profile) => {
  if (profile.branches?.length) return false;
  profile.branches.push({
    name:    profile.labName,
    address: profile.location || profile.labName,
    phone:   profile.phone || '',
    ...(isLatLng(profile.coordinates) ? { coordinates: { lat: profile.coordinates.lat, lng: profile.coordinates.lng } } : {}),
  });
  return true;
};

// Startup: labs without branches get one; bookings without a branch get their lab's first branch
const backfillLabBranches = async () => {
  const LabProfile = require('../models/LabProfile');
  const LabBooking = require('../models/LabBooking');
  let labs = 0, bookings = 0;
  for (const profile of await LabProfile.find({ $or: [{ branches: { $exists: false } }, { branches: { $size: 0 } }] })) {
    if (ensureBranch(profile)) { await profile.save(); labs++; }
  }
  const missing = await LabBooking.find({ branch: { $exists: false } }).select('lab').lean();
  const firstBranch = {};
  for (const b of missing) {
    const key = b.lab.toString();
    if (!(key in firstBranch)) firstBranch[key] = (await LabProfile.findOne({ user: b.lab }).select('branches').lean())?.branches?.[0] || null;
    const branch = firstBranch[key];
    if (!branch) continue;
    await LabBooking.updateOne({ _id: b._id, branch: { $exists: false } },
      { $set: { branch: branch._id, branchName: branch.name, branchAddress: branch.address } });
    bookings++;
  }
  return { labs, bookings };
};

module.exports = { offersTest, branchesOffering, branchView, cleanBranchInput, ensureBranch, backfillLabBranches, same };
