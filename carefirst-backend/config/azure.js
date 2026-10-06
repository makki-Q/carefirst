// Azure AI settings (decision 8 in PROJECT_GUIDE.md): Translator for Urdu report
// summaries, Speech for Urdu audio. Keys stay on the server.
const path = require('path');

const trim = (v) => (typeof v === 'string' ? v.trim() : '');
const speechRegion     = trim(process.env.AZURE_SPEECH_REGION);
const translatorRegion = trim(process.env.AZURE_TRANSLATOR_REGION);

module.exports = {
  TRANSLATOR: {
    key:      trim(process.env.AZURE_TRANSLATOR_KEY),
    region:   translatorRegion,
    endpoint: (trim(process.env.AZURE_TRANSLATOR_ENDPOINT) || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, ''),
  },
  SPEECH: {
    key:      trim(process.env.AZURE_SPEECH_KEY),
    region:   speechRegion,
    endpoint: (trim(process.env.AZURE_SPEECH_ENDPOINT) || `https://${speechRegion}.tts.speech.microsoft.com`).replace(/\/+$/, ''),
  },

  // Document Intelligence ("layout" model) reads uploaded lab reports, scans included.
  // Free tier: 2 pages per request and ~4 MB per file, so PDFs are sent in 2-page pieces.
  DOC_INTEL: {
    key:      trim(process.env.AZURE_DOCINTEL_KEY),
    endpoint: trim(process.env.AZURE_DOCINTEL_ENDPOINT).replace(/\/+$/, ''),
    apiVersion: '2024-11-30',
    pagesPerRequest: 2,
    maxPages: 12,            // per report — protects the monthly free quota
    maxBytes: 4 * 1024 * 1024,
    pollMs: Number(process.env.AZURE_DOCINTEL_POLL_MS) || 1500,
    timeoutMs: 120000,
  },

  // Urdu (Pakistan) neural voices; Uzma is the default
  VOICES: { uzma: 'ur-PK-UzmaNeural', asad: 'ur-PK-AsadNeural' },
  DEFAULT_VOICE: 'uzma',

  // Generated audio is cached here — private (not under the public /uploads)
  AUDIO_DIR: trim(process.env.AUDIO_CACHE_DIR) || path.join(__dirname, '..', 'storage', 'audio'),
  REQUEST_TIMEOUT_MS: 20000,
  SPEECH_TIMEOUT_MS:  60000, // per piece of text
  SPEECH_PIECE_CHARS: 1200,  // a long text is spoken in pieces of about this size, side by side
  SPEECH_PARALLEL:    4,
};
