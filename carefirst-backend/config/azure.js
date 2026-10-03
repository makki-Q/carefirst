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

  // Urdu (Pakistan) neural voices; Uzma is the default
  VOICES: { uzma: 'ur-PK-UzmaNeural', asad: 'ur-PK-AsadNeural' },
  DEFAULT_VOICE: 'uzma',

  // Generated audio is cached here — private (not under the public /uploads)
  AUDIO_DIR: trim(process.env.AUDIO_CACHE_DIR) || path.join(__dirname, '..', 'storage', 'audio'),
  REQUEST_TIMEOUT_MS: 20000,
};
