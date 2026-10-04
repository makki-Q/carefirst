// Reads an uploaded lab report with Azure Document Intelligence ("prebuilt-layout")
// and returns its text + tables. PDFs are sent in small page groups because the
// free tier reads at most 2 pages per request and rejects files over ~4 MB;
// large photos are shrunk before sending.
const fs   = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { DOC_INTEL } = require('../config/azure');

const docIntelConfigured = () => Boolean(DOC_INTEL.key && DOC_INTEL.endpoint);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (code, message) => Object.assign(new Error(message), { code });

// One analyze call: submit, then poll the operation until it finishes
const analyzeBytes = async (bytes) => {
  if (bytes.length > DOC_INTEL.maxBytes) throw fail('too_large', 'This file is too large to read automatically');
  const url = `${DOC_INTEL.endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${DOC_INTEL.apiVersion}`;
  const headers = { 'Ocp-Apim-Subscription-Key': DOC_INTEL.key };

  let submit;
  for (let attempt = 0; attempt < 4; attempt++) {
    submit = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: Buffer.from(bytes).toString('base64') }),
      signal: AbortSignal.timeout(30000),
    });
    if (submit.status !== 429) break;
    await sleep((Number(submit.headers.get('retry-after')) || 5) * 1000); // free tier rate limit
  }
  if (submit.status !== 202) {
    const detail = await submit.text().catch(() => '');
    throw fail(submit.status === 400 ? 'unreadable' : 'service', `Document Intelligence responded ${submit.status}: ${detail.slice(0, 200)}`);
  }

  const operation = submit.headers.get('operation-location');
  const deadline = Date.now() + DOC_INTEL.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(DOC_INTEL.pollMs);
    const poll = await fetch(operation, { headers, signal: AbortSignal.timeout(30000) });
    if (poll.status === 429) { await sleep(3000); continue; }
    const body = await poll.json();
    if (body.status === 'succeeded') return body.analyzeResult;
    if (body.status === 'failed') throw fail('unreadable', `Analysis failed: ${JSON.stringify(body.error || {}).slice(0, 200)}`);
  }
  throw fail('service', 'Timed out waiting for the report to be read');
};

// Split a PDF into groups of `pagesPerRequest` pages (first maxPages pages only)
const pdfPieces = async (bytes) => {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = Math.min(src.getPageCount(), DOC_INTEL.maxPages);
  const pieces = [];
  for (let start = 0; start < total; start += DOC_INTEL.pagesPerRequest) {
    const doc = await PDFDocument.create();
    const indices = Array.from({ length: Math.min(DOC_INTEL.pagesPerRequest, total - start) }, (_, i) => start + i);
    (await doc.copyPages(src, indices)).forEach(p => doc.addPage(p));
    pieces.push(await doc.save());
  }
  return { pieces, totalPages: src.getPageCount(), readPages: total };
};

// Phone photos are often over the free tier's ~4 MB limit. Send a smaller JPEG copy
// for reading only; the uploaded original stays untouched for the patient and lab.
const prepareImage = async (bytes) => {
  if (bytes.length <= DOC_INTEL.maxBytes) return bytes;
  const sharp = require('sharp');
  for (const [size, quality] of [[3000, 85], [2400, 75], [1800, 70]]) {
    const out = await sharp(bytes)
      .rotate() // respect the phone's EXIF orientation
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= DOC_INTEL.maxBytes) return out;
  }
  throw fail('too_large', 'This photo is too large to read automatically');
};

// → { content, tables, pages, totalPages }
const readReport = async (filePath) => {
  if (!docIntelConfigured()) throw fail('not_configured', 'Report reading is not set up on this server');
  const bytes = fs.readFileSync(filePath);
  const isPdf = path.extname(filePath).toLowerCase() === '.pdf';

  let pieces = [bytes];
  let totalPages = 1;
  let readPages = 1;
  if (isPdf) ({ pieces, totalPages, readPages } = await pdfPieces(bytes));
  else pieces = [await prepareImage(bytes)];

  const results = [];
  for (const [i, piece] of pieces.entries()) {
    if (i > 0) await sleep(1000);
    results.push(await analyzeBytes(piece));
  }
  return {
    content: results.map(r => r.content || '').join('\n'),
    tables:  results.flatMap(r => r.tables || []),
    pages:   readPages,
    totalPages,
  };
};

module.exports = { docIntelConfigured, readReport };
