import React, { useState } from 'react';
import { api } from '../lib/api';
import MapPicker, { currentPosition } from './MapPicker';
import { confirmDialog, alertDialog } from './Dialog';

// ── A lab chain's branches: list, add, edit (with map pin), remove ────────────
// The parent owns the list (it also needs it for tests and bookings) and reloads it.

type Branch = {
  branchId: string; name: string; address: string; area: string; phone: string; hours: string;
  coordinates: { lat: number; lng: number } | null; hasLocation: boolean;
};

const EMPTY = { name: '', address: '', area: '', phone: '', hours: '' };

const LabBranches = ({ branches, labName, onChanged }: { branches: Branch[]; labName: string; onChanged: () => void }) => {
  const [editing, setEditing] = useState<string | null>(null); // branchId, 'new' or null
  const [form, setForm] = useState({ ...EMPTY });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const open = (b: Branch | null) => {
    setMsg(null);
    setEditing(b ? b.branchId : 'new');
    setForm(b ? { name: b.name, address: b.address, area: b.area, phone: b.phone, hours: b.hours } : { ...EMPTY, name: `${labName} – ` });
    setPin(b?.coordinates || null);
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = { ...form, coordinates: pin };
      if (editing === 'new') await api.post('/lab/branches', body);
      else await api.put(`/lab/branches/${editing}`, body);
      setEditing(null);
      setMsg({ ok: true, text: editing === 'new' ? 'Branch added.' : 'Branch saved.' });
      onChanged();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || 'Could not save the branch' });
    } finally { setBusy(false); }
  };

  const remove = async (b: Branch) => {
    if (!(await confirmDialog(`Remove ${b.name}? Tests offered only here are switched off.`, { danger: true, confirmLabel: 'Remove branch' }))) return;
    try {
      await (api as any).delete(`/lab/branches/${b.branchId}`);
      onChanged();
    } catch (err: any) { alertDialog(err.message || 'Could not remove the branch'); }
  };

  const useMyPosition = async () => {
    try { setPin(await currentPosition()); } catch (err: any) { setMsg({ ok: false, text: err.message }); }
  };

  const field = (key: keyof typeof EMPTY, label: string, placeholder: string, max: number) => (
    <div className="dash-form-group">
      <label className="dash-form-label">{label}</label>
      <input className="dash-form-input" type="text" maxLength={max} placeholder={placeholder}
        value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div>
      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 14, fontSize: '0.8rem', background: msg.ok ? '#f0fdf4' : '#fef2f2', color: msg.ok ? '#166534' : '#991b1b', border: '1px solid ' + (msg.ok ? '#bbf7d0' : '#fecaca') }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 18 }}>
        {branches.map(b => (
          <div key={b.branchId} className="dash-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>{b.name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: 4 }}>{b.address}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
              {b.phone && <div>Phone: {b.phone}</div>}
              {b.hours && <div>Hours: {b.hours}</div>}
              <div style={{ color: b.hasLocation ? '#166534' : '#92400e', fontWeight: 600 }}>
                {b.hasLocation ? '● On the map' : '● No map location — patients see it last in True Cost'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 12 }}>{/* buttons line up across a row */}
              <button className="dash-btn-ghost" style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={() => open(b)}>Edit</button>
              {branches.length > 1 && (
                <button className="dash-btn-ghost" style={{ padding: '5px 12px', fontSize: '0.76rem', color: '#b91c1c' }} onClick={() => remove(b)}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!editing && (
        <button className="dash-btn-primary accent" onClick={() => open(null)}>+ Add a branch</button>
      )}

      {editing && (
        <div className="dash-card" style={{ padding: '20px 24px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)', marginBottom: 14 }}>
            {editing === 'new' ? 'New branch' : 'Edit branch'}
          </div>
          <div className="dash-form-row">
            {field('name', 'Branch name', `${labName} – Susan Road`, 80)}
            {field('area', 'Area', 'e.g. Susan Road', 60)}
          </div>
          <div className="dash-form-row">{field('address', 'Address', 'House / building, street, area, city', 200)}</div>
          <div className="dash-form-row">
            {field('phone', 'Branch phone', '041-1234567', 30)}
            {field('hours', 'Opening hours', 'Mon–Sat 8 AM – 10 PM', 80)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '6px 0 10px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Click the map or drag the pin to the branch entrance — patients see the travel distance and cost.</div>
            <button type="button" className="dash-btn-ghost" style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={useMyPosition}>Use my current location</button>
          </div>
          <MapPicker value={pin} onChange={setPin} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="dash-btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button className="dash-btn-primary accent" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save branch'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabBranches;
