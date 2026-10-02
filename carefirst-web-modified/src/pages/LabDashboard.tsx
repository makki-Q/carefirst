import React, { useState, useEffect } from 'react';
import './LabDashboard.css';
import { api, getSession, clearSession } from '../lib/api';
import { getSocket } from '../lib/socket';

const TENURE_OPTIONS = [15, 20, 25, 30];

const LabDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [dateString, setDateString] = useState('');

  const { user: sessionUser } = getSession();
  const [labProfile, setLabProfile]   = useState<any>(null);
  const [tests, setTests]             = useState<any[]>([]);
  const [reports, setReports]         = useState<any[]>([]);
  const [needyPats, setNeedyPats]     = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifBadge, setNotifBadge]   = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [labPatients, setLabPatients] = useState<any[]>([]);
  const [receipts, setReceipts]       = useState<any[]>([]);

  // Payment details — patients pay the down payment and installments here
  const [payForm, setPayForm]     = useState({ bankName: '', accountNumber: '', jazzCash: '', easyPaisa: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payMsg, setPayMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Add test form
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', category: '', price: '',
    installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30',
  });
  const [addLoading, setAddLoading] = useState(false);

  // Edit test form
  const [editingTest, setEditingTest] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', category: '', price: '',
    installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30',
  });

  // Upload report form
  const [uploadPatientId, setUploadPatientId] = useState('');
  const [uploadTestName, setUploadTestName]   = useState('');
  const [uploadFile, setUploadFile]           = useState<File | null>(null);
  const [uploadNotes, setUploadNotes]         = useState('');
  const [uploadLoading, setUploadLoading]     = useState(false);
  const [uploadMsg, setUploadMsg]             = useState('');

  useEffect(() => {
    const d = new Date();
    setDateString(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);

  useEffect(() => {
    api.get('/lab/profile').then((d: any) => {
      setLabProfile(d);
      setPayForm({
        bankName:      d.profile?.bankDetails?.bankName      || '',
        accountNumber: d.profile?.bankDetails?.accountNumber || '',
        jazzCash:      d.profile?.jazzCash  || '',
        easyPaisa:     d.profile?.easyPaisa || '',
      });
    }).catch(() => {});
    api.get('/lab/tests').then((d: any) => setTests(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/needy-patients').then((d: any) => setNeedyPats(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/receipts').then((d: any) => setReceipts(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/patients').then((d: any) => setLabPatients(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/notifications').then((d: any) => {
      const arr = Array.isArray(d) ? d : [];
      setNotifications(arr);
      setNotifBadge(arr.filter((n: any) => !n.read).length);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const uid = (sessionUser as any)?._id || (sessionUser as any)?.id;
    if (!uid) return;
    const socket = getSocket();
    socket.emit('join', uid);
    socket.on('notification:new', (n: any) => {
      setNotifications(prev => [n, ...prev]);
      setNotifBadge(prev => prev + 1);
      if (n.type === 'receipt_uploaded') {
        api.get('/lab/receipts').then((d: any) => setReceipts(Array.isArray(d) ? d : [])).catch(() => {});
      }
      if (n.type === 'plan_activated') {
        api.get('/lab/patients').then((d: any) => setLabPatients(Array.isArray(d) ? d : [])).catch(() => {});
      }
    });
    return () => { socket.off('notification:new'); };
  }, []);

  const signOut = () => { clearSession(); window.location.href = '/login'; };

  const markNotifRead = async (notif: any) => {
    if (notif.read) return;
    try {
      await api.put(`/lab/notifications/${notif._id}/read`, {});
      setNotifications(prev => prev.map((n: any) => n._id === notif._id ? { ...n, read: true } : n));
      setNotifBadge(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const toggleActive = async (test: any) => {
    try {
      const updated = await api.put(`/lab/tests/${test._id}`, { isActive: !test.isActive });
      setTests(prev => prev.map(t => t._id === test._id ? { ...t, isActive: (updated as any).isActive } : t));
    } catch {}
  };

  const markConducted = async (id: string) => {
    try {
      await api.put(`/lab/needy-patients/${id}/mark-conducted`, {});
      setNeedyPats(prev => prev.map(p => p._id === id ? { ...p, testConducted: true } : p));
    } catch {}
  };

  const addTest = async () => {
    if (!addForm.name.trim() || !addForm.category.trim() || !addForm.price) return;
    setAddLoading(true);
    try {
      const created: any = await api.post('/lab/tests', {
        name: addForm.name.trim(), category: addForm.category.trim(), price: Number(addForm.price),
        installmentEnabled:   addForm.installmentEnabled,
        installmentCount:     addForm.installmentEnabled ? Number(addForm.installmentCount) : 2,
        installmentTenureDays:addForm.installmentEnabled ? Number(addForm.installmentTenureDays) : 30,
      });
      setTests(prev => [...prev, created]);
      setAddForm({ name: '', category: '', price: '', installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30' });
      setShowAddPanel(false);
    } catch {} finally { setAddLoading(false); }
  };

  const startEdit = (t: any) => {
    setEditingTest(t._id);
    setEditForm({
      name: t.name, category: t.category, price: String(t.price),
      installmentEnabled:   t.installmentEnabled   || false,
      installmentCount:     String(t.installmentCount     || 2),
      installmentTenureDays:String(t.installmentTenureDays || 30),
    });
  };
  const cancelEdit = () => setEditingTest(null);

  const saveEditTest = async (id: string) => {
    try {
      const updated: any = await api.put(`/lab/tests/${id}`, {
        name: editForm.name, category: editForm.category, price: Number(editForm.price),
        installmentEnabled:   editForm.installmentEnabled,
        installmentCount:     editForm.installmentEnabled ? Number(editForm.installmentCount) : 2,
        installmentTenureDays:editForm.installmentEnabled ? Number(editForm.installmentTenureDays) : 30,
      });
      setTests(prev => prev.map((t: any) => t._id === id ? { ...t, ...updated } : t));
      setEditingTest(null);
    } catch {}
  };

  const deleteTest = async (id: string) => {
    if (!window.confirm('Delete this test from your catalog?')) return;
    try {
      await (api as any).delete(`/lab/tests/${id}`);
      setTests(prev => prev.filter((t: any) => t._id !== id));
    } catch {}
  };

  const submitReport = async () => {
    if (!uploadPatientId || !uploadTestName || !uploadFile) return;
    setUploadLoading(true); setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('patientId', uploadPatientId);
      fd.append('testName',  uploadTestName);
      fd.append('notes',     uploadNotes);
      fd.append('file',      uploadFile);
      await api.upload('/lab/reports/upload', fd);
      setUploadPatientId(''); setUploadTestName(''); setUploadNotes(''); setUploadFile(null);
      setUploadMsg('Report uploaded successfully.');
      api.get('/lab/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {});
    } catch (err: any) { setUploadMsg(err.message || 'Upload failed.'); }
    finally { setUploadLoading(false); }
  };

  // path: `installments/<index>` or `down-payment`
  const approveReceipt = async (walletId: string, path: string) => {
    try {
      await api.put(`/lab/receipts/${walletId}/${path}/approve`, {});
      api.get('/lab/receipts').then((d: any) => setReceipts(Array.isArray(d) ? d : [])).catch(() => {});
    } catch (err: any) { alert(err.message || 'Could not confirm the receipt'); }
  };

  const savePaymentDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayMsg(null);
    const f = { bankName: payForm.bankName.trim(), accountNumber: payForm.accountNumber.trim(), jazzCash: payForm.jazzCash.trim(), easyPaisa: payForm.easyPaisa.trim() };
    if (Boolean(f.bankName) !== Boolean(f.accountNumber)) {
      setPayMsg({ ok: false, text: 'Enter both the bank name and the account number, or leave both empty' }); return;
    }
    if (!f.accountNumber && !f.jazzCash && !f.easyPaisa) {
      setPayMsg({ ok: false, text: 'Add at least one way for patients to pay you' }); return;
    }
    setPaySaving(true);
    try {
      const updated: any = await api.put('/lab/profile', {
        bankDetails: { bankName: f.bankName, accountNumber: f.accountNumber },
        jazzCash: f.jazzCash, easyPaisa: f.easyPaisa,
      });
      setLabProfile((prev: any) => ({ ...prev, profile: updated }));
      setPayMsg({ ok: true, text: 'Payment details saved. Patients can now apply for installments at your lab.' });
    } catch (err: any) {
      setPayMsg({ ok: false, text: err.message || 'Could not save payment details' });
    } finally {
      setPaySaving(false);
    }
  };

  const navigate = (page: string) => setCurrentPage(page);

  const labName     = labProfile?.profile?.labName || (sessionUser as any)?.name || 'Lab Dashboard';
  const labLocation = labProfile?.profile?.location || '';
  const pendingNeedyCount   = needyPats.filter((p: any) => !p.testConducted && p.status !== 'conducted').length;
  const pendingReceiptCount = receipts.reduce((s: number, r: any) => s + (r.pendingInstallments?.length || 0) + (r.pendingDownPayment ? 1 : 0), 0);

  // Mirrors hasPaymentDetails() in carefirst-backend/utils/installmentPlan.js
  const lp = labProfile?.profile;
  const hasPaymentDetails = Boolean((lp?.bankDetails?.bankName && lp?.bankDetails?.accountNumber) || lp?.jazzCash || lp?.easyPaisa);
  const offersInstallments = tests.some((t: any) => t.installmentEnabled);
  const paymentDetailsNotice = labProfile && !hasPaymentDetails && (
    <div className="dash-card dash-fu" style={{ padding: '12px 18px', marginBottom: 18, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.82rem' }}>
      <strong>Add your payment details.</strong> Patients pay the down payment and installments directly to your lab, so they
      {offersInstallments ? " can't apply for installments on your tests" : " can't use installment plans at your lab"} until you add a bank account, JazzCash or EasyPaisa number.
      {currentPage !== 'catalog' && <> <a style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }} onClick={() => setCurrentPage('catalog')}>Add them in Test Catalog</a>.</>}
    </div>
  );

  const breadcrumbs: Record<string, string> = {
    dashboard:    'Dashboard',
    requests:     'Test Requests',
    upload:       'Upload Reports',
    catalog:      'Test Catalog',
    revenue:      'Revenue',
    needyPatients:'Needy Patients',
    receipts:     'Receipts',
  };

  return (
    <div className="lab-dashboard-wrapper">
      <div className="dash-shell">

        {/* ─── SIDEBAR ─────────────────────────────────────── */}
        <aside className={`dash-sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
          <div className="dash-sidebar-logo">
            <div className="dash-logo-mark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
              </svg>
            </div>
            <span className="dash-logo-name">carefirst</span>
          </div>

          <div className="dash-sidebar-user">
            <div className="dash-avatar">{labName[0]?.toUpperCase() || 'L'}</div>
            <div>
              <div className="dash-user-name">{labName}</div>
              <div className="dash-user-role">Lab Partner{labLocation ? ` · ${labLocation}` : ''}</div>
            </div>
          </div>

          <nav className="dash-sidebar-nav">
            <div className="dash-nav-label">Lab Operations</div>

            <button className={`dash-nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('dashboard')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </button>

            <button className={`dash-nav-item ${currentPage === 'requests' ? 'active' : ''}`} onClick={() => navigate('requests')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Test Requests
              <span className="dash-nav-badge">7</span>
            </button>

            <button className={`dash-nav-item ${currentPage === 'upload' ? 'active' : ''}`} onClick={() => navigate('upload')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Reports
            </button>

            <button className={`dash-nav-item ${currentPage === 'catalog' ? 'active' : ''}`} onClick={() => navigate('catalog')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Test Catalog
            </button>

            <button className={`dash-nav-item ${currentPage === 'needyPatients' ? 'active' : ''}`} onClick={() => navigate('needyPatients')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              Needy Patients
              {pendingNeedyCount > 0 && <span className="dash-nav-badge">{pendingNeedyCount}</span>}
            </button>

            <div className="dash-nav-label">Finance</div>

            <button className={`dash-nav-item ${currentPage === 'receipts' ? 'active' : ''}`} onClick={() => navigate('receipts')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Receipts
              {pendingReceiptCount > 0 && <span className="dash-nav-badge">{pendingReceiptCount}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'revenue' ? 'active' : ''}`} onClick={() => navigate('revenue')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              Revenue
            </button>

            <div className="dash-nav-label">Account</div>
          </nav>

          <div className="dash-sidebar-footer">
            <button className="dash-nav-item danger" onClick={signOut}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* ─── MAIN ─────────────────────────────────────────── */}
        <main className={`dash-main ${!sidebarOpen ? 'expanded' : ''}`}>
          <header className="dash-topbar">
            <div className="dash-topbar-left">
              <button className="dash-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <div className="dash-breadcrumb">
                <span>carefirst</span>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                <span className="dash-current">{breadcrumbs[currentPage]}</span>
              </div>
            </div>
            <div className="dash-topbar-right">
              <div className="dash-search-wrap">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input className="dash-search-input" type="text" placeholder="Search…" />
              </div>

              {/* Notification Bell */}
              <div style={{ position: 'relative' }}>
                <button className="dash-icon-btn" onClick={() => setShowNotifDropdown(v => !v)} style={{ position: 'relative' }}>
                  <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {notifBadge > 0 && <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--accent, #e11d48)', color: '#fff', fontSize: '0.58rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', fontWeight: 700 }}>{notifBadge}</span>}
                </button>
                {showNotifDropdown && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320, maxHeight: 400, overflowY: 'auto', background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 200 }}>
                    <div style={{ padding: '14px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Notifications</div>
                      <button onClick={() => setShowNotifDropdown(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No notifications yet.</div>
                    ) : (
                      notifications.slice(0, 12).map((n: any, i: number) => (
                        <div key={i} onClick={() => markNotifRead(n)} style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10, background: n.read ? 'transparent' : 'rgba(220,38,38,0.04)', cursor: n.read ? 'default' : 'pointer' }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.read ? 'var(--border)' : 'var(--accent, #e11d48)', marginTop: 5, flexShrink: 0 }}></div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.45 }}>{n.message || n.title || 'New notification'}</div>
                            {n.createdAt && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{new Date(n.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="dash-date-chip">{dateString}</div>
            </div>
          </header>

          <div className="dash-content">

            {/* ══ DASHBOARD ════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'dashboard' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Good morning, {labName}</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Lab operations overview for {dateString}</div>
              </div>

              {paymentDetailsNotice}

              <div className="dash-hero-card dash-fu dash-fu-1">
                <div className="dash-hero-inner">
                  <div className="dash-hero-left">
                    <div className="dash-hero-eyebrow">CareFirst Lab Partner</div>
                    <div className="dash-hero-name">{labName}</div>
                    <div className="dash-hero-sub">{labLocation || 'Location not set'}</div>
                    <div className="dash-hero-pills">
                      <div className="dash-hero-pill">{tests.length} Tests in Catalog</div>
                      {pendingNeedyCount > 0 && <div className="dash-hero-pill green">{pendingNeedyCount} Needy Pending</div>}
                    </div>
                  </div>
                  <div className="dash-hero-stats">
                    <div className="dash-hero-stat"><div className="val">{tests.length}</div><div className="lbl">Tests Listed</div></div>
                    <div className="dash-hero-divider"></div>
                    <div className="dash-hero-stat"><div className="val">{reports.length}</div><div className="lbl">Reports Uploaded</div></div>
                    <div className="dash-hero-divider"></div>
                    <div className="dash-hero-stat"><div className="val">{tests.filter((t: any) => t.isActive).length}</div><div className="lbl">Active Tests</div></div>
                  </div>
                </div>
              </div>

              <div className="dash-stats-grid dash-fu dash-fu-2">
                {[
                  { label: 'Tests Today', value: '34', icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>, trend: '+6 from yesterday' },
                  { label: 'Pending Upload', value: '7', icon: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>, trend: '3 urgent' },
                  { label: 'Revenue Today', value: 'PKR 48k', icon: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>, trend: '+12% from avg' },
                  { label: 'Avg Time up', value: '3.2 hrs', icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, trend: '-0.4 hrs improved' },
                ].map((s, i) => (
                  <div className="dash-stat-card" key={i}>
                    <div className="dash-stat-top">
                      <div>
                        <div className="dash-stat-label">{s.label}</div>
                        <div className="dash-stat-value">{s.value}</div>
                      </div>
                      <div className="dash-stat-icon">
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">{s.icon}</svg>
                      </div>
                    </div>
                    <div className="dash-stat-trend" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}><span>{s.trend}</span></div>
                  </div>
                ))}
              </div>

              <div className="dash-two-col dash-fu dash-fu-3">
                <div className="dash-card">
                  <div className="dash-card-header">
                    <div className="dash-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
                      Recent Requests
                    </div>
                    <div className="dash-card-action" onClick={() => navigate('requests')} style={{ cursor: 'pointer' }}>View all <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
                  </div>
                  {[
                    { patient: 'Ayesha Raza', test: 'CBC + Lipid Panel', doctor: 'Dr. Sarah Malik', status: 'dash-green', label: 'New' },
                    { patient: 'Bilal Ahmed', test: 'Thyroid Profile', doctor: 'Dr. Julian Haider', status: 'dash-amber', label: 'Processing' },
                    { patient: 'Zara Khan', test: 'HbA1c', doctor: 'Dr. Raza Khan', status: 'dash-green', label: 'New' },
                    { patient: 'Omar Farooq', test: 'Urinalysis', doctor: 'Dr. Nadia Farooq', status: 'dash-amber', label: 'Processing' },
                  ].map((r, i) => (
                    <div className="dash-list-item" key={i}>
                      <div className="dash-list-row1">
                        <div className="dash-list-name">{r.patient}</div>
                        <span className={`dash-badge ${r.status}`}><span className="dash-badge-dot"></span>{r.label}</span>
                      </div>
                      <div className="dash-list-sub">{r.test} · {r.doctor}</div>
                    </div>
                  ))}
                </div>

                <div className="dash-card">
                  <div className="dash-card-header">
                    <div className="dash-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Upload Queue
                    </div>
                    <div className="dash-card-action" onClick={() => navigate('upload')} style={{ cursor: 'pointer' }}>Upload now <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
                  </div>
                  <div className="dash-table-wrap">
                    <table>
                      <thead><tr><th>Patient</th><th>Test</th><th>Collected</th><th></th></tr></thead>
                      <tbody>
                        {[
                          { p: 'Ayesha Raza', t: 'CBC', d: '8:30 AM' },
                          { p: 'Bilal Ahmed', t: 'Thyroid', d: '9:00 AM' },
                          { p: 'Sara Imran', t: 'Lipid', d: '9:45 AM' },
                          { p: 'Zara Khan', t: 'HbA1c', d: '10:15 AM' },
                        ].map((row, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{row.p}</td>
                            <td>{row.t}</td>
                            <td>{row.d}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="dash-action-btn" onClick={() => navigate('upload')}>
                                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* ══ TEST REQUESTS ═════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'requests' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Test Requests</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">Incoming prescriptions awaiting sample collection and processing</div>
                </div>
                <div className="dash-filter-row dash-fu-1">
                  <select className="dash-filter-select">
                    <option>All Requests</option>
                    <option>New</option>
                    <option>Processing</option>
                    <option>Ready to Upload</option>
                  </select>
                </div>
              </div>

              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-table-wrap">
                  <table>
                    <thead>
                      <tr><th>Request ID</th><th>Patient</th><th>Prescribed By</th><th>Tests Ordered</th><th>Received</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 'REQ-081', patient: 'Ayesha Raza', doctor: 'Dr. Sarah Malik', tests: 'CBC, Lipid Panel', date: 'Today 8:00 AM', st: 'dash-red', sl: 'Urgent' },
                        { id: 'REQ-082', patient: 'Bilal Ahmed', doctor: 'Dr. Julian Haider', tests: 'Thyroid Profile', date: 'Today 8:30 AM', st: 'dash-amber', sl: 'Processing' },
                        { id: 'REQ-083', patient: 'Zara Khan', doctor: 'Dr. Raza Khan', tests: 'HbA1c', date: 'Today 9:00 AM', st: 'dash-green', sl: 'New' },
                        { id: 'REQ-084', patient: 'Omar Farooq', doctor: 'Dr. Nadia Farooq', tests: 'Urinalysis', date: 'Today 9:30 AM', st: 'dash-green', sl: 'New' },
                        { id: 'REQ-085', patient: 'Sara Imran', doctor: 'Dr. Ahmed Siddiqui', tests: 'Lipid Panel, Glucose', date: 'Today 10:00 AM', st: 'dash-amber', sl: 'Processing' },
                        { id: 'REQ-086', patient: 'Hamza Tariq', doctor: 'Dr. Julian Haider', tests: 'ECG', date: 'Today 10:15 AM', st: 'dash-green', sl: 'New' },
                        { id: 'REQ-087', patient: 'Noor Fatima', doctor: 'Dr. Maha Qureshi', tests: 'Vitamin D, B12', date: 'Today 10:45 AM', st: 'dash-green', sl: 'New' },
                      ].map((r, i) => (
                        <tr key={i}>
                          <td className="dash-mono">{r.id}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.patient}</td>
                          <td>{r.doctor}</td>
                          <td>{r.tests}</td>
                          <td>{r.date}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="dash-btn-primary accent" style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={() => navigate('upload')}>
                              Upload
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ UPLOAD REPORTS ════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'upload' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Upload Reports</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Attach completed test results to patient records</div>
              </div>

              <div className="dash-card dash-fu dash-fu-1" style={{ padding: '32px' }}>
                <div className="dash-form-row">
                  <div className="dash-form-group">
                    <label className="dash-form-label">Patient <span style={{ color: '#ef4444' }}>*</span></label>
                    {labPatients.length === 0 ? (
                      <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef9c3', color: '#854d0e', fontSize: '0.82rem' }}>
                        No patients linked to your lab yet. Patients appear here once they have wallets or community support cases assigned to your lab.
                      </div>
                    ) : (
                      <select className="dash-form-input" style={{ height: 42 }} value={uploadPatientId} onChange={e => setUploadPatientId(e.target.value)}>
                        <option value="">Select patient…</option>
                        {labPatients.map((p: any) => (
                          <option key={p._id} value={p._id}>{p.name}{p.email ? ` (${p.email})` : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="dash-form-group">
                    <label className="dash-form-label">Test Type <span style={{ color: '#ef4444' }}>*</span></label>
                    <select className="dash-form-input" style={{ height: 42 }} value={uploadTestName} onChange={e => setUploadTestName(e.target.value)}>
                      <option value="">Select test…</option>
                      {tests.map((t: any) => <option key={t._id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                </div>

                <hr className="dash-form-divider" />

                <div className="dash-form-group">
                  <label className="dash-form-label">Upload Report File <span style={{ color: '#ef4444' }}>*</span></label>
                  <label style={{ cursor: 'pointer', display: 'block' }}>
                    <div className="dash-dropzone" style={uploadFile ? { borderColor: 'var(--accent)', background: 'var(--accent-light)' } : {}}>
                      <div className="dash-dropzone-icon">
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      </div>
                      <div className="dash-dropzone-title">{uploadFile ? uploadFile.name : 'Click or drag & drop report file here'}</div>
                      <div className="dash-dropzone-sub">{uploadFile ? `${(uploadFile.size / 1024).toFixed(0)} KB` : 'PDF, PNG, JPG — max 20 MB'}</div>
                    </div>
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) setUploadFile(e.target.files[0]); }} />
                  </label>
                </div>

                <div className="dash-form-group">
                  <label className="dash-form-label">Lab Technician Notes</label>
                  <textarea className="dash-form-input dash-form-textarea" placeholder="Add processing notes, flagged values, or remarks…" value={uploadNotes} onChange={e => setUploadNotes(e.target.value)}></textarea>
                </div>

                {uploadMsg && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: uploadMsg.includes('success') ? '#dcfce7' : '#fee2e2', color: uploadMsg.includes('success') ? '#166534' : '#991b1b', fontSize: '0.82rem' }}>
                    {uploadMsg}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="dash-btn-ghost" onClick={() => { setUploadPatientId(''); setUploadTestName(''); setUploadFile(null); setUploadNotes(''); setUploadMsg(''); }}>Clear</button>
                  <button className="dash-btn-primary accent" disabled={uploadLoading || !uploadPatientId || !uploadTestName || !uploadFile} onClick={submitReport}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    {uploadLoading ? 'Uploading…' : 'Submit Report'}
                  </button>
                </div>
              </div>
            </section>

            {/* ══ TEST CATALOG ══════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'catalog' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Test Catalog</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">Manage available tests, pricing, installment plans, and active status</div>
                </div>
                <button className="dash-btn-primary accent dash-fu-1" onClick={() => setShowAddPanel(v => !v)}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {showAddPanel ? 'Cancel' : 'Add Test'}
                </button>
              </div>

              {paymentDetailsNotice}

              {/* Payment details — where patients pay the down payment and installments */}
              <div className="dash-card dash-fu" style={{ padding: '20px 28px', marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)', marginBottom: 4 }}>Payment Details</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                  Shown to patients on installment plans — they pay the down payment and every installment to you directly, then you confirm each receipt.
                </div>
                {payMsg && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: '0.8rem', background: payMsg.ok ? '#f0fdf4' : '#fef2f2', color: payMsg.ok ? '#166534' : '#991b1b', border: `1px solid ${payMsg.ok ? '#bbf7d0' : '#fecaca'}` }}>
                    {payMsg.text}
                  </div>
                )}
                <form onSubmit={savePaymentDetails}>
                  <div className="dash-form-row">
                    {[
                      ['bankName',      'Bank Name',      'e.g. HBL'],
                      ['accountNumber', 'Account Number / IBAN', 'PK00 XXXX 0000 0000 0000 0000'],
                      ['jazzCash',      'JazzCash',       '03XX-XXXXXXX'],
                      ['easyPaisa',     'EasyPaisa',      '03XX-XXXXXXX'],
                    ].map(([field, label, placeholder]) => (
                      <div className="dash-form-group" key={field}>
                        <label className="dash-form-label">{label}</label>
                        <input className="dash-form-input" type="text" placeholder={placeholder} disabled={paySaving}
                          value={(payForm as any)[field]} onChange={e => setPayForm(f => ({ ...f, [field]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <button type="submit" className="dash-btn-primary accent" disabled={paySaving} style={paySaving ? { opacity: 0.6 } : {}}>
                    {paySaving ? 'Saving…' : 'Save Payment Details'}
                  </button>
                </form>
              </div>

              {showAddPanel && (
                <div className="dash-card dash-fu" style={{ padding: '24px 28px', marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)', marginBottom: 16 }}>New Test</div>
                  <div className="dash-form-row">
                    <div className="dash-form-group">
                      <label className="dash-form-label">Test Name</label>
                      <input className="dash-form-input" type="text" placeholder="e.g. Complete Blood Count" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="dash-form-group">
                      <label className="dash-form-label">Category</label>
                      <input className="dash-form-input" type="text" placeholder="e.g. Hematology" value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} />
                    </div>
                    <div className="dash-form-group" style={{ maxWidth: 160 }}>
                      <label className="dash-form-label">Price (PKR)</label>
                      <input className="dash-form-input" type="number" placeholder="0" value={addForm.price} onChange={e => setAddForm(f => ({ ...f, price: e.target.value }))} />
                    </div>
                  </div>

                  {/* Installment Plan */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
                    <button
                      type="button"
                      onClick={() => setAddForm(f => ({ ...f, installmentEnabled: !f.installmentEnabled }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: addForm.installmentEnabled ? 'var(--accent, #e11d48)' : '#d1d5db', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: addForm.installmentEnabled ? 19 : 3, transition: 'left 0.2s' }}></div>
                      </div>
                      <span style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text)' }}>Enable Installment Plan</span>
                    </button>
                  </div>

                  {addForm.installmentEnabled && (
                    <div className="dash-form-row" style={{ marginBottom: 16 }}>
                      <div className="dash-form-group" style={{ maxWidth: 180 }}>
                        <label className="dash-form-label">Number of Installments</label>
                        <input className="dash-form-input" type="number" min="2" max="12" placeholder="e.g. 3" value={addForm.installmentCount} onChange={e => setAddForm(f => ({ ...f, installmentCount: e.target.value }))} />
                      </div>
                      <div className="dash-form-group" style={{ maxWidth: 200 }}>
                        <label className="dash-form-label">Tenure per Installment</label>
                        <select className="dash-form-input" style={{ height: 42 }} value={addForm.installmentTenureDays} onChange={e => setAddForm(f => ({ ...f, installmentTenureDays: e.target.value }))}>
                          {TENURE_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="dash-btn-ghost" onClick={() => setShowAddPanel(false)}>Cancel</button>
                    <button className="dash-btn-primary accent" disabled={addLoading} onClick={addTest}>
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      {addLoading ? 'Adding…' : 'Add to Catalog'}
                    </button>
                  </div>
                </div>
              )}

              <div className="lab-test-grid dash-fu dash-fu-2">
                {tests.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 16 }}>No tests in catalog yet. Add your first test above.</div>}
                {tests.map((t: any) => (
                  <div key={t._id}>
                    {editingTest === t._id ? (
                      <div className="lab-test-card" style={{ padding: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 10, color: 'var(--text)' }}>Edit Test</div>
                        <input className="dash-form-input" style={{ marginBottom: 8 }} type="text" placeholder="Test name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                        <input className="dash-form-input" style={{ marginBottom: 8 }} type="text" placeholder="Category" value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} />
                        <input className="dash-form-input" style={{ marginBottom: 10 }} type="number" placeholder="Price" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} />

                        {/* Installment toggle in edit */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <button type="button" onClick={() => setEditForm(f => ({ ...f, installmentEnabled: !f.installmentEnabled }))} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            <div style={{ width: 32, height: 18, borderRadius: 9, background: editForm.installmentEnabled ? 'var(--accent, #e11d48)' : '#d1d5db', position: 'relative', flexShrink: 0 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: editForm.installmentEnabled ? 17 : 3, transition: 'left 0.2s' }}></div>
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)' }}>Installment Plan</span>
                          </button>
                        </div>
                        {editForm.installmentEnabled && (
                          <>
                            <input className="dash-form-input" style={{ marginBottom: 8 }} type="number" min="2" max="12" placeholder="# of installments" value={editForm.installmentCount} onChange={e => setEditForm(f => ({ ...f, installmentCount: e.target.value }))} />
                            <select className="dash-form-input" style={{ marginBottom: 10, height: 38 }} value={editForm.installmentTenureDays} onChange={e => setEditForm(f => ({ ...f, installmentTenureDays: e.target.value }))}>
                              {TENURE_OPTIONS.map(d => <option key={d} value={d}>{d} days per installment</option>)}
                            </select>
                          </>
                        )}

                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="dash-btn-primary accent" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem', padding: '6px 0' }} onClick={() => saveEditTest(t._id)}>Save</button>
                          <button className="dash-btn-ghost" style={{ flex: 1, fontSize: '0.75rem', padding: '6px 0' }} onClick={cancelEdit}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="lab-test-card">
                        <div className="lab-test-icon">
                          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                        </div>
                        <div className="lab-test-name">{t.name}</div>
                        <div className="lab-test-cat">{t.category}</div>
                        {t.installmentEnabled && (
                          <div style={{ margin: '6px 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(220,38,38,0.1)', color: 'var(--accent, #e11d48)', fontSize: '0.7rem', fontWeight: 700 }}>
                              {t.installmentCount} installments · every {t.installmentTenureDays} days
                            </span>
                          </div>
                        )}
                        <div className="lab-test-footer">
                          <div className="lab-test-price">PKR {Number(t.price).toLocaleString()}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button className={`lab-toggle ${t.isActive ? 'on' : ''}`} onClick={() => toggleActive(t)} title={t.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}></button>
                            <button className="dash-action-btn" title="Edit" onClick={() => startEdit(t)}>
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button className="dash-action-btn" title="Delete" style={{ color: '#ef4444' }} onClick={() => deleteTest(t._id)}>
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ══ REVENUE ═══════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'revenue' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Revenue</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Earnings summary and transaction history</div>
              </div>

              <div className="lab-revenue-hero dash-fu dash-fu-1">
                <div className="lab-revenue-inner">
                  <div>
                    <div className="lab-revenue-label">Total Revenue (This Month)</div>
                    <div className="lab-revenue-amount"><span className="lab-revenue-currency">PKR</span>1,24,800</div>
                  </div>
                  <div className="lab-revenue-stats">
                    <div className="lab-rev-stat"><div className="rv">4,812</div><div className="rl">Tests Completed</div></div>
                    <div style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.10)' }}></div>
                    <div className="lab-rev-stat"><div className="rv">PKR 25.9</div><div className="rl">Avg Per Test</div></div>
                    <div style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.10)' }}></div>
                    <div className="lab-rev-stat"><div className="rv">+18%</div><div className="rl">vs Last Month</div></div>
                  </div>
                </div>
              </div>

              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-card-header">
                  <div className="dash-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    Transaction Ledger
                  </div>
                </div>
                <div className="dash-table-wrap">
                  <table>
                    <thead><tr><th>TXN ID</th><th>Patient</th><th>Test</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                    <tbody>
                      {[
                        { id: 'TXN-301', p: 'Ayesha Raza', t: 'CBC + Lipid', d: 'May 1, 2024', a: 2100 },
                        { id: 'TXN-300', p: 'Bilal Ahmed', t: 'Thyroid Profile', d: 'Apr 30, 2024', a: 1800 },
                        { id: 'TXN-299', p: 'Zara Khan', t: 'HbA1c', d: 'Apr 29, 2024', a: 1600 },
                        { id: 'TXN-298', p: 'Omar Farooq', t: 'Urinalysis', d: 'Apr 28, 2024', a: 500 },
                        { id: 'TXN-297', p: 'Sara Imran', t: 'Lipid + Glucose', d: 'Apr 27, 2024', a: 1750 },
                      ].map((r, i) => (
                        <tr key={i}>
                          <td className="dash-mono">{r.id}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.p}</td>
                          <td>{r.t}</td>
                          <td>{r.d}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#166534' }}>+ PKR {r.a.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ NEEDY PATIENTS ════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'needyPatients' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Needy Patients</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Community Support approved patients assigned to your lab — conduct tests as per authorization slip</div>
              </div>

              <div className="dash-fu dash-fu-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
                {needyPats.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 16 }}>No community support patients assigned to your lab yet.</div>}
                {needyPats.map((p: any) => {
                  const conducted = p.testConducted || p.status === 'conducted';
                  return (
                    <div className="lab-needy-card" key={p._id}>
                      <div className="lab-needy-header">
                        <div>
                          <div className="lab-needy-name">{p.patient?.name || '—'}</div>
                          <div className="lab-needy-meta">CNIC: {p.patient?.cnic || '—'}</div>
                        </div>
                        <span className={`dash-badge ${conducted ? 'dash-green' : 'dash-amber'}`}>
                          <span className="dash-badge-dot"></span>{conducted ? 'Test Conducted' : 'Pending Conduction'}
                        </span>
                      </div>
                      <div className="lab-needy-test">
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
                        {p.testRequired || '—'}
                      </div>
                      <div className="lab-needy-slip-row">
                        <div className="lab-needy-slip-block">
                          <div className="lab-needy-slip-id">Slip ID: {p.slip?.slipId || '—'} · Case: {p._id?.toString().slice(-6).toUpperCase()}</div>
                          <div className="lab-needy-stamp">Background Check Assured</div>
                          <div className="lab-needy-approved">Admin approved: {p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                        </div>
                      </div>
                      {!conducted && (
                        <button className="dash-btn-primary accent" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={() => markConducted(p._id)}>
                          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          Mark Test Conducted
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ══ RECEIPTS ══════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'receipts' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Receipts</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Confirm you received each down payment and installment — CareFirst verifies it next</div>
              </div>

              <div className="dash-card dash-fu dash-fu-1">
                {receipts.length === 0 ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>No receipts pending approval.</div>
                ) : (
                  <div className="dash-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Patient</th>
                          <th>Test</th>
                          <th>Installment</th>
                          <th>Amount</th>
                          <th>Due Date</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((r: any) =>
                          [
                            ...(r.pendingDownPayment ? [{ ...r.pendingDownPayment, label: 'Down payment', path: 'down-payment' }] : []),
                            ...(r.pendingInstallments || []).map((inst: any) => ({ ...inst, label: `#${inst.number || inst.index + 1}`, path: `installments/${inst.index}` })),
                          ].map((inst: any) => (
                            <tr key={`${r.walletId}-${inst.path}`}>
                              <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.patient?.name || '—'}</td>
                              <td>{r.testName || '—'}</td>
                              <td>{inst.label}</td>
                              <td>PKR {Number(inst.amount || 0).toLocaleString()}</td>
                              <td>{inst.dueDate ? new Date(inst.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                              <td>
                                <span className={`dash-badge ${inst.labApproved ? 'dash-green' : inst.receiptUrl ? 'dash-amber' : 'dash-gray'}`}>
                                  <span className="dash-badge-dot"></span>
                                  {inst.labApproved ? 'Approved' : inst.receiptUrl ? 'Receipt Uploaded' : 'Awaiting'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {inst.receiptUrl && !inst.labApproved ? (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                                    <a href={inst.receiptUrl} target="_blank" rel="noreferrer" className="dash-action-btn" title="View Receipt" style={{ textDecoration: 'none', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    </a>
                                    <button className="adm-approve-btn" onClick={() => approveReceipt(r.walletId, inst.path)}>
                                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                                      Approve
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: inst.labApproved ? '#166534' : 'var(--text-muted)', fontWeight: inst.labApproved ? 700 : 400 }}>
                                    {inst.labApproved ? 'Approved ✓' : '—'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
};

export default LabDashboard;
