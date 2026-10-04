// One-page PDF slips (appointment, lab visit, community support) made with pdf-lib.
// The community slip is followed by the documents the patient uploaded.
const fs   = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4     = [595.28, 841.89];
const MARGIN = 48;
const INK    = rgb(0.07, 0.09, 0.12);
const MUTED  = rgb(0.42, 0.45, 0.5);
const LINE   = rgb(0.86, 0.87, 0.9);
const BRAND  = rgb(0.79, 0.22, 0.17); // CareFirst red
const PALE   = rgb(0.98, 0.95, 0.94);

const UPLOADS = path.join(__dirname, '..', 'uploads');

const fmtDateTime = (d) => new Date(d).toLocaleString('en-GB', {
  timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

// Standard PDF fonts only cover Latin text: anything else (e.g. Urdu) becomes "?"
const safeText = (font, text) => {
  let out = '';
  for (const ch of String(text ?? '')) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
};

const wrap = (font, size, text, width) => {
  const lines = [];
  for (const para of safeText(font, text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
};

// slip: { kind, title, slipNumber, status, statusNote, sections: [{ heading, rows: [[label, value]] }],
//         notes: [string], verifyNote, generatedAt }
const drawSlipPage = (pdf, fonts, slip) => {
  const page = pdf.addPage(A4);
  const { width, height } = page.getSize();
  const { regular, bold } = fonts;
  const text = (t, x, y, { size = 10, font = regular, color = INK } = {}) =>
    page.drawText(safeText(font, t), { x, y, size, font, color });
  let y = height - MARGIN;

  // Header
  page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: BRAND });
  text('CareFirst', MARGIN, height - 50, { size: 24, font: bold, color: rgb(1, 1, 1) });
  text('Healthcare appointments, lab tests & support', MARGIN, height - 70, { size: 9, color: rgb(1, 0.9, 0.88) });
  const title = safeText(bold, slip.title);
  text(title, width - MARGIN - bold.widthOfTextAtSize(title, 15), height - 52, { size: 15, font: bold, color: rgb(1, 1, 1) });
  y = height - 92 - 30;

  // Slip number + status
  page.drawRectangle({ x: MARGIN, y: y - 58, width: width - 2 * MARGIN, height: 66, color: PALE, borderColor: LINE, borderWidth: 1 });
  text('SLIP NUMBER', MARGIN + 16, y - 10, { size: 8, font: bold, color: MUTED });
  text(slip.slipNumber, MARGIN + 16, y - 38, { size: 24, font: bold });
  const status = safeText(bold, slip.status.toUpperCase());
  const statusX = width - MARGIN - 16 - bold.widthOfTextAtSize(status, 13);
  text('STATUS', statusX, y - 10, { size: 8, font: bold, color: MUTED });
  text(status, statusX, y - 30, { size: 13, font: bold, color: BRAND });
  if (slip.statusNote) {
    const note = safeText(regular, slip.statusNote);
    text(note, width - MARGIN - 16 - regular.widthOfTextAtSize(note, 8), y - 46, { size: 8, color: MUTED });
  }
  y -= 58 + 28;

  // Sections of label / value rows
  const labelW = 130;
  const valueW = width - 2 * MARGIN - labelW;
  for (const section of slip.sections) {
    text(section.heading.toUpperCase(), MARGIN, y, { size: 9, font: bold, color: BRAND });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 1, color: LINE });
    y -= 16;
    for (const [label, value] of section.rows) {
      const lines = wrap(regular, 10.5, value || '—', valueW);
      text(label, MARGIN, y, { size: 9.5, color: MUTED });
      lines.forEach((l, i) => text(l, MARGIN + labelW, y - i * 14, { size: 10.5, font: i === 0 && section.boldFirst ? bold : regular }));
      y -= 14 * lines.length + 6;
    }
    y -= 12;
  }

  // Instructions
  if (slip.notes?.length) {
    const lines = slip.notes.flatMap(n => wrap(regular, 9.5, `•  ${n}`, width - 2 * MARGIN - 28));
    const boxH = lines.length * 13 + 32;
    page.drawRectangle({ x: MARGIN, y: y - boxH + 10, width: width - 2 * MARGIN, height: boxH, borderColor: LINE, borderWidth: 1 });
    text('PLEASE NOTE', MARGIN + 14, y - 8, { size: 8, font: bold, color: MUTED });
    lines.forEach((l, i) => text(l, MARGIN + 14, y - 26 - i * 13, { size: 9.5 }));
    y -= boxH + 10;
  }

  // Footer
  const footer = [
    slip.verifyNote,
    `Generated ${fmtDateTime(slip.generatedAt || new Date())} (Pakistan time). CareFirst records bookings and payment proofs; it does not collect or hold payments.`,
  ].filter(Boolean).flatMap(f => wrap(regular, 8, f, width - 2 * MARGIN));
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 14 + footer.length * 11 }, end: { x: width - MARGIN, y: MARGIN + 14 + footer.length * 11 }, thickness: 1, color: LINE });
  footer.forEach((l, i) => text(l, MARGIN, MARGIN + (footer.length - 1 - i) * 11, { size: 8, color: MUTED }));
  return page;
};

// Local file behind an /uploads/... URL, or null
const uploadedFile = (url) => {
  const rel = String(url || '').split('/uploads/')[1];
  if (!rel) return null;
  const file = path.resolve(UPLOADS, decodeURIComponent(rel));
  return file.startsWith(path.resolve(UPLOADS) + path.sep) && fs.existsSync(file) ? file : null;
};

// Adds each uploaded document after the slip: pictures as one page each (shrunk),
// PDFs page by page (at most 10 pages per document)
const appendDocuments = async (pdf, fonts, urls) => {
  const sharp = require('sharp');
  for (const [i, url] of urls.entries()) {
    const caption = `Attachment ${i + 1} of ${urls.length} — document uploaded by the patient with the application`;
    const file = uploadedFile(url);
    try {
      if (!file) throw new Error('missing');
      if (path.extname(file).toLowerCase() === '.pdf') {
        const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
        const indices = src.getPageIndices().slice(0, 10);
        (await pdf.copyPages(src, indices)).forEach(p => pdf.addPage(p));
        continue;
      }
      const jpg = await sharp(file).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const image = await pdf.embedJpg(jpg);
      const page = pdf.addPage(A4);
      const { width, height } = page.getSize();
      page.drawText(safeText(fonts.regular, caption), { x: MARGIN, y: height - MARGIN + 10, size: 9, font: fonts.regular, color: MUTED });
      const scale = Math.min((width - 2 * MARGIN) / image.width, (height - 2 * MARGIN - 20) / image.height, 1.5);
      const w = image.width * scale, h = image.height * scale;
      page.drawImage(image, { x: (width - w) / 2, y: height - MARGIN - 14 - h, width: w, height: h });
      page.drawRectangle({ x: (width - w) / 2, y: height - MARGIN - 14 - h, width: w, height: h, borderColor: LINE, borderWidth: 1 });
    } catch {
      const page = pdf.addPage(A4);
      page.drawText(safeText(fonts.regular, `${caption}: this file could not be attached.`), { x: MARGIN, y: A4[1] - MARGIN, size: 10, font: fonts.regular, color: MUTED });
    }
  }
};

// → PDF bytes
const buildSlipPdf = async (slip, { attachments = [] } = {}) => {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`CareFirst ${slip.title} ${slip.slipNumber}`);
  pdf.setAuthor('CareFirst');
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  drawSlipPage(pdf, fonts, slip);
  if (attachments.length) await appendDocuments(pdf, fonts, attachments);
  return Buffer.from(await pdf.save());
};

module.exports = { buildSlipPdf, fmtDateTime };
