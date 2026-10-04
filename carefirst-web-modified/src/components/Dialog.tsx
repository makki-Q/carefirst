import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// ── In-app confirm / alert dialogs (replace window.confirm / window.alert) ────
//   if (!(await confirmDialog('Delete this test?', { danger: true }))) return;
//   alertDialog(err.message);

type Options = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;   // red confirm button for destructive actions
};

const DialogBox = ({ message, title, confirmLabel, cancelLabel, danger, alertOnly, onClose }:
  Options & { message: string; alertOnly?: boolean; onClose: (ok: boolean) => void }) => {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const button: React.CSSProperties = {
    padding: '9px 18px', borderRadius: 10, fontSize: '0.86rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  };
  return (
    <div role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15, 18, 24, 0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cf-dialog-title" aria-describedby="cf-dialog-message"
        style={{ width: '100%', maxWidth: 440, background: '#fff', color: '#111', borderRadius: 16, padding: '22px 24px 18px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <div id="cf-dialog-title" style={{ fontWeight: 700, fontSize: '1.02rem', marginBottom: 8 }}>
          {title || (alertOnly ? 'CareFirst' : 'Please confirm')}
        </div>
        <div id="cf-dialog-message" style={{ fontSize: '0.88rem', lineHeight: 1.55, color: '#374151', whiteSpace: 'pre-wrap' }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          {!alertOnly && (
            <button type="button" onClick={() => onClose(false)}
              style={{ ...button, background: '#fff', color: '#111', border: '1px solid rgba(0,0,0,0.15)' }}>
              {cancelLabel || 'Cancel'}
            </button>
          )}
          <button ref={okRef} type="button" onClick={() => onClose(true)}
            style={{ ...button, border: 'none', color: '#fff', background: danger ? '#c9372c' : '#111' }}>
            {confirmLabel || (alertOnly ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

const open = (message: string, options: Options & { alertOnly?: boolean }) =>
  new Promise<boolean>(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<DialogBox message={message} {...options} onClose={close} />);
  });

// Resolves true when the user confirms, false on Cancel / Escape / clicking outside
export const confirmDialog = (message: string, options: Options = {}) => open(message, options);

export const alertDialog = (message: string, options: Omit<Options, 'cancelLabel' | 'danger'> = {}) =>
  open(message, { ...options, alertOnly: true }).then(() => undefined);
