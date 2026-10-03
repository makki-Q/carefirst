const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { TRANSLATOR, SPEECH, VOICES, AUDIO_DIR, REQUEST_TIMEOUT_MS } = require('../config/azure');

const translatorConfigured = () => Boolean(TRANSLATOR.key && TRANSLATOR.region);
const speechConfigured     = () => Boolean(SPEECH.key && SPEECH.region);

// English → Urdu with Azure Translator. Returns null when not configured or on failure.
const translateToUrdu = async (text) => {
  if (!translatorConfigured() || !text?.trim()) return null;
  try {
    const res = await fetch(`${TRANSLATOR.endpoint}/translate?api-version=3.0&from=en&to=ur`, {
      method:  'POST',
      headers: {
        'Ocp-Apim-Subscription-Key':    TRANSLATOR.key,
        'Ocp-Apim-Subscription-Region': TRANSLATOR.region,
        'Content-Type':                 'application/json',
      },
      body:   JSON.stringify([{ Text: text }]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Translator responded ${res.status}`);
    const data = await res.json();
    return data?.[0]?.translations?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error(`[Azure] Translation failed: ${err.message}`);
    return null;
  }
};

const escapeXml = (s) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Urdu text → MP3, cached on disk by voice + text. Returns the file path.
// Throws { status, message } on errors the caller should report.
const urduAudioFile = async (text, voiceKey) => {
  if (!speechConfigured()) throw Object.assign(new Error("Urdu audio isn't set up on this server yet"), { status: 503 });
  const voice = VOICES[voiceKey];
  if (!voice) throw Object.assign(new Error(`voice must be one of: ${Object.keys(VOICES).join(', ')}`), { status: 400 });

  const hash = crypto.createHash('sha256').update(`${voice}\n${text}`).digest('hex');
  const file = path.join(AUDIO_DIR, `${hash}.mp3`);
  if (fs.existsSync(file)) return file;

  // Line breaks become short pauses so headings and list items are read separately
  const body = escapeXml(text).split(/\n+/).map(l => l.trim()).filter(Boolean).join(' <break time="400ms"/> ');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK"><voice name="${voice}">${body}</voice></speak>`;

  let res;
  try {
    res = await fetch(`${SPEECH.endpoint}/cognitiveservices/v1`, {
      method:  'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': SPEECH.key,
        'Content-Type':              'application/ssml+xml',
        'X-Microsoft-OutputFormat':  'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent':                'CareFirst',
      },
      body:   ssml,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw Object.assign(new Error('Could not reach the speech service. Please try again.'), { status: 502 });
  }
  if (!res.ok) {
    console.error(`[Azure] Speech responded ${res.status}`);
    throw Object.assign(new Error('The speech service could not create the audio. Please try again.'), { status: 502 });
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
  return file;
};

module.exports = { translatorConfigured, speechConfigured, translateToUrdu, urduAudioFile };
