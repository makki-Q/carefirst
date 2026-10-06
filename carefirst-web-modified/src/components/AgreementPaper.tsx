import React from 'react';
import paperImage from '../assets/agreement-stamp-paper.jpeg';
import { downloadFile } from '../lib/api';

// The installment agreement is the lab stamp paper (decision 15): the picture, with the plan's details
// written into its blanks. The server sends every field with its position (utils/agreementPaper.js),
// in pixels on the 1024 × 1536 picture; here they become percentages so the page scales with its box.
const W = 1024;
const H = 1536;

export type PaperField = {
  key: string; text: string; x: number; x2: number; y: number;
  signature?: boolean; small?: boolean; center?: boolean; check?: boolean; color?: string;
};

// Font size in "cqw" (1% of the paper's width) — shrunk to fit long values on their line
const fontSize = (f: PaperField) => {
  const base = f.small ? 0.95 : f.signature ? 1.45 : 1.2;
  const width = ((f.x2 - f.x) / W) * 100;              // line width in cqw
  const fits = width / (0.55 * Math.max(f.text.length, 1)); // ≈ 0.55em per character
  return Math.max(0.62, Math.min(base, fits));
};

export const AgreementPaper = ({ fields, walletId }: { fields: PaperField[]; walletId?: string }) => (
  <div>
    {walletId && (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" onClick={() => downloadFile(`/documents/agreements/${walletId}`, 'CareFirst-agreement.pdf')}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}>
          Download PDF
        </button>
      </div>
    )}
    <div
      role="img"
      aria-label="Installment agreement on stamp paper"
      style={{
        position: 'relative', width: '100%', maxWidth: 860, margin: '0 auto', aspectRatio: `${W} / ${H}`,
        backgroundImage: `url(${paperImage})`, backgroundSize: '100% 100%', containerType: 'inline-size',
        boxShadow: '0 4px 18px rgba(0,0,0,0.12)', borderRadius: 4,
      }}
    >
      {fields.map(f => (
        <span
          key={f.key}
          title={f.text}
          style={{
            position: 'absolute',
            left: `${((f.x + 2) / W) * 100}%`,
            width: `${((f.x2 - f.x - 2) / W) * 100}%`,
            bottom: `${((H - f.y + 2.5) / H) * 100}%`,
            fontSize: f.check ? '1.6cqw' : `${fontSize(f)}cqw`,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: f.center || f.check ? 'center' : 'left',
            fontFamily: f.signature ? "'Segoe Script', 'Brush Script MT', cursive" : "'DM Sans', Arial, sans-serif",
            fontStyle: f.signature ? 'italic' : 'normal',
            fontWeight: f.check ? 700 : 500,
            color: f.color === 'green' ? '#166534' : '#0f2a6b',
          }}
        >
          {f.check ? '✓' : f.text}
        </span>
      ))}
    </div>
  </div>
);
