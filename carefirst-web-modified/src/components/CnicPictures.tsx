import React, { useEffect, useState } from 'react';
import { getSession } from '../lib/api';

// ── CNIC pictures sent with an installment plan application ───────────────────
// The pictures are private: the server only sends them to the patient, an admin
// or the lawyer on the plan's defaulter case, so they are fetched with the token.

const MAX_PICTURE_MB = 10;

// Returns an error message for a picture that can't be sent, or ''
export const checkCnicPicture = (file: File | null | undefined) => {
  if (!file) return '';
  if (!/\.(jpe?g|png)$/i.test(file.name)) return 'CNIC pictures must be JPG or PNG images';
  if (file.size > MAX_PICTURE_MB * 1024 * 1024) return `Each CNIC picture must be under ${MAX_PICTURE_MB} MB`;
  return '';
};

const muted = 'var(--text-muted, #6b7280)';
const tile: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.74rem', color: muted,
};
const frame: React.CSSProperties = {
  height: 110, borderRadius: 10, border: '1px dashed rgba(0,0,0,0.2)', background: 'rgba(0,0,0,0.02)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
};

// File chooser with a thumbnail of the chosen picture
export const CnicPicturePicker = ({ label, file, onChange, disabled }: {
  label: string; file: File | null | undefined; onChange: (f: File | null) => void; disabled?: boolean;
}) => {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <label style={{ ...tile, cursor: disabled ? 'default' : 'pointer' }}>
      <div style={{ ...frame, borderStyle: file ? 'solid' : 'dashed' }}>
        {url
          ? <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>+ Add picture</span>}
      </div>
      <span style={{ fontWeight: 600, color: 'var(--text, #111)' }}>{label}</span>
      {file && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name} · change</span>}
      <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" style={{ display: 'none' }} disabled={disabled}
        onChange={e => { onChange(e.target.files?.[0] || null); e.target.value = ''; }} />
    </label>
  );
};

const PICTURES: [string, string, string][] = [
  ['patient-front',   'patientFront',   'front'],
  ['patient-back',    'patientBack',    'back'],
  ['guarantor-front', 'guarantorFront', 'front'],
  ['guarantor-back',  'guarantorBack',  'back'],
];

// The four CNIC pictures of a wallet (patient + guarantor, front + back)
export const CnicPictureGallery = ({ walletId, pictures, patientName = 'Patient', guarantorName = 'Guarantor' }: {
  walletId: string; pictures?: Record<string, string | undefined>; patientName?: string; guarantorName?: string;
}) => {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const hasPictures = PICTURES.some(([, key]) => pictures?.[key]);

  useEffect(() => {
    if (!hasPictures) return;
    let cancelled = false;
    const made: string[] = [];
    setUrls({});
    PICTURES.forEach(async ([name, key]) => {
      if (!pictures?.[key]) { setUrls(p => ({ ...p, [name]: null })); return; }
      try {
        const res = await fetch(`/api/documents/wallets/${walletId}/cnic/${name}`, {
          headers: { Authorization: `Bearer ${getSession().token}` },
        });
        if (!res.ok) throw new Error('not available');
        const u = URL.createObjectURL(await res.blob());
        made.push(u);
        if (!cancelled) setUrls(p => ({ ...p, [name]: u }));
      } catch {
        if (!cancelled) setUrls(p => ({ ...p, [name]: null }));
      }
    });
    return () => { cancelled = true; made.forEach(u => URL.revokeObjectURL(u)); };
  }, [walletId, hasPictures]);

  if (!hasPictures) {
    return <div style={{ fontSize: '0.78rem', color: muted }}>No CNIC pictures were sent with this application.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {PICTURES.map(([name, , side]) => {
        const who = name.startsWith('patient') ? patientName : guarantorName;
        const url = urls[name];
        return (
          <div key={name} style={tile}>
            <div style={{ ...frame, borderStyle: 'solid' }}>
              {url === undefined ? <span>Loading…</span>
                : url === null ? <span>Not available</span>
                : (
                  <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size" style={{ width: '100%', height: '100%' }}>
                    <img src={url} alt={`${who} CNIC ${side}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                )}
            </div>
            <span><strong style={{ color: 'var(--text, #111)' }}>{who}</strong> · CNIC {side}</span>
          </div>
        );
      })}
    </div>
  );
};
