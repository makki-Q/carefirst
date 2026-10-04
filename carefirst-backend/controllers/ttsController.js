const mongoose      = require('mongoose');
const Wallet        = require('../models/Wallet');
const TestReport    = require('../models/TestReport');
const DefaulterCase = require('../models/DefaulterCase');
const Prescription  = require('../models/Prescription');
const { urduAudioFile, speechConfigured, translatorConfigured } = require('../utils/azure');
const { VOICES, DEFAULT_VOICE } = require('../config/azure');
const { buildPlanApplication } = require('./patientController');

const notFound = (res) => res.status(404).json({ message: 'Not found' });
const same = (a, b) => Boolean(a && b && a.toString() === b.toString());

// Urdu text of an agreement the user may see, or null
const agreementText = async (user, id) => {
  const wallet = await Wallet.findById(id).select('patient agreement');
  if (!wallet) return null;
  const allowed =
    user.role === 'admin' ||
    (user.role === 'patient' && same(wallet.patient, user._id)) ||
    (user.role === 'lawyer' && await DefaulterCase.exists({ wallet: wallet._id, assignedLawyer: user._id }));
  return allowed ? { text: wallet.agreement?.textUrdu || '' } : null;
};

// Urdu summary of a report the user may see, or null
const reportText = async (user, id) => {
  const report = await TestReport.findById(id).select('patient lab summaryUrdu');
  if (!report) return null;
  const allowed =
    user.role === 'admin' ||
    (user.role === 'patient' && same(report.patient, user._id)) ||
    (user.role === 'lab' && same(report.lab, user._id)) ||
    (user.role === 'doctor' && await Prescription.exists({ doctor: user._id, patient: report.patient }));
  return allowed ? { text: report.summaryUrdu || '' } : null;
};

// Urdu agreement for a plan the patient is about to apply for — rebuilt on the
// server from the same validated inputs as the preview (body: labId, testId, patientAddress, guarantor)
const previewAgreementText = async (user, body) => {
  if (user.role !== 'patient') return null;
  const { error, agreementTextUrdu } = await buildPlanApplication(user, body);
  if (error) return { error };
  return { text: agreementTextUrdu };
};

// ─── GET /api/tts/status ──────────────────────────────────────────────────────
const getStatus = (req, res) => {
  res.json({ speech: speechConfigured(), translator: translatorConfigured(), voices: Object.keys(VOICES), defaultVoice: DEFAULT_VOICE });
};

// ─── POST /api/tts ────────────────────────────────────────────────────────────
// Body: { source: 'agreement' | 'report', id, voice?: 'uzma' | 'asad' } → audio/mpeg
//   or  { source: 'agreement-preview', labId, testId, patientAddress, guarantor, voice? } (patient, before applying)
// Only Urdu text the server stores or generates itself is spoken — never text from the request.
const speak = async (req, res) => {
  try {
    const { source, id } = req.body;
    const voice = req.body.voice || DEFAULT_VOICE;
    if (!['agreement', 'agreement-preview', 'report'].includes(source)) {
      return res.status(400).json({ message: "source must be 'agreement', 'agreement-preview' or 'report'" });
    }

    let found;
    if (source === 'agreement-preview') {
      found = await previewAgreementText(req.user, req.body);
      if (found?.error) return res.status(found.error.status).json({ message: found.error.message });
    } else {
      if (!mongoose.isValidObjectId(id)) return notFound(res);
      found = source === 'agreement' ? await agreementText(req.user, id) : await reportText(req.user, id);
    }
    if (!found) return notFound(res);
    if (!found.text) {
      return res.status(409).json({ message: source === 'agreement' ? 'This agreement has no Urdu version' : 'This report has no Urdu summary yet' });
    }

    const file = await urduAudioFile(found.text, voice);
    res.set('Cache-Control', 'private, max-age=3600');
    res.type('audio/mpeg').sendFile(file);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

module.exports = { getStatus, speak };
