import React, { useState, useEffect } from 'react';
import './LabDashboard.css';
import { api, getSession, clearSession, downloadSlip } from '../lib/api';
import { getSocket } from '../lib/socket';
import { confirmDialog, alertDialog } from '../components/Dialog';
import LabBranches from '../components/LabBranches';
import { ListenButton, UrduText } from '../components/Urdu';

const TENURE_OPTIONS = [15, 20, 25, 30];

// ── Bookings (patients' lab visits) ───────────────────────────────────────────
const pktToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()); // YYYY-MM-DD
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  confirmed:        { label: 'Confirmed',        cls: 'dash-blue'  },
  sample_collected: { label: 'Sample collected', cls: 'dash-amber' },
  completed:        { label: 'Completed',        cls: 'dash-green' },
  cancelled:        { label: 'Cancelled',        cls: 'dash-gray'  },
};

const LabDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [dateString, setDateString] = useState('');

  const { user: sessionUser } = getSession();
  const [labProfile, setLabProfile]   = useState<any>(null);
  const [tests, setTests]             = useState<any[]>([]);
  const [reports, setReports]         = useState<any[]>([]);
  const [needyPats, setNeedyPats]     = useState<any[]>([]);
  const [earnings, setEarnings]       = useState<any>(null); // payments recorded on CareFirst (GET /lab/earnings)
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifBadge, setNotifBadge]   = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [labPatients, setLabPatients] = useState<any[]>([]);
  const [receipts, setReceipts]       = useState<any[]>([]);
  const [bookings, setBookings]       = useState<any[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [bookingFilter, setBookingFilter]   = useState<'open' | 'today' | 'upcoming' | 'all'>('open');
  const [slipQuery, setSlipQuery]           = useState(''); // check a patient's slip number
  const [bookingMsg, setBookingMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadBookingId, setUploadBookingId] = useState('');

  const loadEarnings = () =>
    api.get('/lab/earnings').then((d: any) => setEarnings(d)).catch(() => {});

  const loadBookings = () =>
    api.get('/lab/bookings').then((d: any) => setBookings(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setBookingsLoaded(true));

  // Payment details — patients pay the down payment and installments here
  const [payForm, setPayForm]     = useState({ bankName: '', accountNumber: '', jazzCash: '', easyPaisa: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payMsg, setPayMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Branches (a lab account is a chain) and the branch the staff member is working at
  const [branches, setBranches]   = useState<any[]>([]);
  const [workingAt, setWorkingAt] = useState(() => { try { return localStorage.getItem('cf_lab_branch') || ''; } catch { return ''; } });
  const chooseWorkingAt = (id: string) => { setWorkingAt(id); try { localStorage.setItem('cf_lab_branch', id); } catch {} };

  // Add test form
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', category: '', price: '',
    installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30',
    branches: [] as string[], // [] = every branch
  });
  const [addLoading, setAddLoading] = useState(false);

  // Edit test form
  const [editingTest, setEditingTest] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', category: '', price: '',
    installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30',
    branches: [] as string[],
  });

  // Upload report form
  const [uploadPatientId, setUploadPatientId] = useState('');
  const [uploadTestName, setUploadTestName]   = useState('');
  const [uploadFile, setUploadFile]           = useState<File | null>(null);
  const [uploadNotes, setUploadNotes]         = useState('');
  const [uploadSummary, setUploadSummary]     = useState('');  // plain-language summary → translated to Urdu
  const [editSummaryId, setEditSummaryId]     = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft]       = useState({ summary: '', summaryUrdu: '' });
  const [summaryBusy, setSummaryBusy]         = useState(false);
  const [summaryMsg, setSummaryMsg]           = useState<{ ok: boolean; text: string } | null>(null);
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
    loadBranches();
    api.get('/lab/tests').then((d: any) => setTests(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/needy-patients').then((d: any) => setNeedyPats(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/lab/receipts').then((d: any) => setReceipts(Array.isArray(d) ? d : [])).catch(() => {});
    loadEarnings();
    loadBookings();
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
      if (n.type === 'plan_activated' || n.type === 'lab_booking_created') {
        api.get('/lab/patients').then((d: any) => setLabPatients(Array.isArray(d) ? d : [])).catch(() => {});
      }
      if (n.type?.startsWith('lab_booking_')) loadBookings();
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
    } catch (err: any) { alertDialog(err.message || 'Could not mark the test conducted'); }
  };

  // Join / leave Community Support (take care of needy patients the admin assigns)
  const [partnerBusy, setPartnerBusy] = useState(false);
  const setCommunitySupport = async (join: boolean) => {
    const ok = await confirmDialog(join
      ? 'Join Community Support? CareFirst\'s admin can then assign you needy patients whose financial need was checked, and you conduct their tests. CareFirst does not collect or pass on donations.'
      : 'Leave Community Support? You will not be assigned new needy patients.',
      join ? { confirmLabel: 'Join Community Support' } : { danger: true, confirmLabel: 'Leave' });
    if (!ok) return;
    setPartnerBusy(true);
    try {
      const d: any = await api.put('/lab/community-support', { join });
      setLabProfile((prev: any) => ({ ...prev, profile: d.profile }));
    } catch (err: any) {
      alertDialog(err.message || 'Could not update Community Support');
    } finally { setPartnerBusy(false); }
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
        branches:             addForm.branches,
      });
      setTests(prev => [...prev, created]);
      setAddForm({ name: '', category: '', price: '', installmentEnabled: false, installmentCount: '2', installmentTenureDays: '30', branches: [] });
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
      branches:             (t.branches || []).map(String),
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
        branches:             editForm.branches,
      });
      setTests(prev => prev.map((t: any) => t._id === id ? { ...t, ...updated } : t));
      setEditingTest(null);
    } catch {}
  };

  const deleteTest = async (id: string) => {
    if (!(await confirmDialog('Delete this test from your catalog?', { danger: true, confirmLabel: 'Delete test' }))) return;
    try {
      await (api as any).delete(`/lab/tests/${id}`);
      setTests(prev => prev.filter((t: any) => t._id !== id));
    } catch {}
  };

  const submitReport = async () => {
    if (!uploadFile || (!uploadBookingId && (!uploadPatientId || !uploadTestName))) return;
    setUploadLoading(true); setUploadMsg('');
    try {
      const fd = new FormData();
      if (uploadBookingId) {
        fd.append('bookingId', uploadBookingId); // patient + test come from the booking
      } else {
        fd.append('patientId', uploadPatientId);
        fd.append('testName',  uploadTestName);
      }
      fd.append('notes',  uploadNotes);
      if (uploadSummary.trim()) fd.append('summary', uploadSummary.trim());
      fd.append('report', uploadFile); // field name expected by POST /api/lab/reports/upload
      await api.upload('/lab/reports/upload', fd);
      setUploadPatientId(''); setUploadTestName(''); setUploadNotes(''); setUploadFile(null); setUploadBookingId(''); setUploadSummary('');
      setUploadMsg('Report uploaded successfully. It is being read now — the automatic summary appears under Recent Reports.');
      const refresh = () => api.get('/lab/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {});
      refresh();
      [4000, 10000, 20000, 40000].forEach(ms => setTimeout(refresh, ms)); // automatic reading runs in the background
      loadBookings();
    } catch (err: any) { setUploadMsg(err.message || 'Upload failed.'); }
    finally { setUploadLoading(false); }
  };

  const [readingId, setReadingId] = useState<string | null>(null);
  const readAgain = async (r: any) => {
    setSummaryMsg(null); setReadingId(r._id);
    try {
      const d: any = await api.post(`/lab/reports/${r._id}/read-again`, {});
      setReports(prev => prev.map((x: any) => x._id === r._id ? { ...x, ...d.report, patient: x.patient } : x));
      setSummaryMsg({ ok: d.report.autoRead?.status === 'ready', text: d.message });
    } catch (err: any) {
      setSummaryMsg({ ok: false, text: err.message || 'Could not read the report' });
    } finally {
      setReadingId(null);
    }
  };

  const startEditSummary = (r: any) => {
    setEditSummaryId(r._id); setSummaryMsg(null);
    setSummaryDraft({ summary: r.summary || '', summaryUrdu: r.summaryUrdu || '' });
  };

  // mode 'urdu': save the lab's Urdu correction · 'translate': save the English and translate it again
  const saveSummary = async (r: any, mode: 'urdu' | 'translate') => {
    setSummaryMsg(null); setSummaryBusy(true);
    try {
      const body = mode === 'urdu'
        ? { summary: summaryDraft.summary, summaryUrdu: summaryDraft.summaryUrdu }
        : { summary: summaryDraft.summary };
      const d: any = await api.put(`/lab/reports/${r._id}/summary`, body);
      setReports(prev => prev.map((x: any) => x._id === r._id ? { ...x, ...d.report, patient: x.patient } : x));
      setSummaryDraft({ summary: d.report.summary || '', summaryUrdu: d.report.summaryUrdu || '' });
      setSummaryMsg({ ok: true, text: mode === 'urdu' ? 'Urdu summary saved.' : 'Translated again — check the Urdu below.' });
      if (mode === 'urdu') setEditSummaryId(null);
    } catch (err: any) {
      setSummaryMsg({ ok: false, text: err.message || 'Could not save the summary' });
    } finally {
      setSummaryBusy(false);
    }
  };

  const getSlip = (kind: string, id: string) =>
    downloadSlip(kind, id).catch((err: any) => alertDialog(err.message || 'Could not download the slip'));

  // action: 'sample-collected' | 'complete'
  const advanceBooking = async (b: any, action: 'sample-collected' | 'complete') => {
    setBookingMsg(null);
    try {
      const d: any = await api.put(`/lab/bookings/${b._id}/${action}`, {});
      setBookings(prev => prev.map(x => x._id === b._id ? d.booking : x));
      if (action === 'complete') loadEarnings();
    } catch (err: any) { setBookingMsg({ ok: false, text: err.message || 'Update failed' }); }
  };

  const uploadForBooking = (b: any) => {
    setUploadBookingId(b._id); setUploadFile(null); setUploadNotes(''); setUploadMsg('');
    navigate('upload');
  };

  // path: `installments/<index>` or `down-payment`
  const approveReceipt = async (walletId: string, path: string) => {
    try {
      await api.put(`/lab/receipts/${walletId}/${path}/approve`, {});
      api.get('/lab/receipts').then((d: any) => setReceipts(Array.isArray(d) ? d : [])).catch(() => {});
      loadEarnings();
    } catch (err: any) { alertDialog(err.message || 'Could not confirm the receipt'); }
  };

  const loadBranches = () =>
    api.get('/lab/branches').then((d: any) => setBranches(Array.isArray(d) ? d : [])).catch(() => {});
  const branchesChanged = () => {
    loadBranches();
    api.get('/lab/tests').then((d: any) => setTests(Array.isArray(d) ? d : [])).catch(() => {}); // a removed branch can switch tests off
    loadBookings();
  };

  // Where a test is offered: ids of branches ([] / missing = every branch)
  const offeredAt = (test: any) => (test?.branches?.length ? test.branches.map(String) : branches.map((b: any) => String(b.branchId)));
  const branchName = (id: string) => branches.find((b: any) => String(b.branchId) === String(id))?.name || '—';

  // The patient came to another branch: take the visit at the given branch
  const transferBooking = async (b: any, branchId: string) => {
    if (!(await confirmDialog(`Take ${b.patient?.name || 'this patient'}'s ${b.testName} visit at ${branchName(branchId)}? It was booked at ${b.branchName}. The patient is told.`, { confirmLabel: 'Take visit here' }))) return;
    try {
      const d: any = await api.put(`/lab/bookings/${b._id}/transfer`, { branchId });
      setBookings(prev => prev.map(x => x._id === b._id ? d.booking : x));
    } catch (err: any) { alertDialog(err.message || 'Could not move the visit'); }
  };

  // Which branches the "Offered at" checkboxes show as ticked; ticking all = every branch ([])
  const toggleOffered = (current: string[], id: string) => {
    const all = branches.map((b: any) => String(b.branchId));
    const set = new Set(current.length ? current : all);
    if (set.has(id)) set.delete(id); else set.add(id);
    return set.size === all.length ? [] : [...set];
  };
  const offeredPicker = (value: string[], onChange: (v: string[]) => void) => branches.length > 1 && (
    <div style={{ margin: '4px 0 12px' }}>
      <div className="dash-form-label" style={{ marginBottom: 6 }}>Offered at</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {branches.map((br: any) => {
          const on = !value.length || value.includes(String(br.branchId));
          return (
            <label key={br.branchId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => onChange(toggleOffered(value, String(br.branchId)))} /> {br.name}
            </label>
          );
        })}
      </div>
    </div>
  );

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
  const unplaced = branches.filter((b: any) => !b.hasLocation);
  const locationNotice = branches.length > 0 && unplaced.length > 0 && (
    <div className="dash-card dash-fu" style={{ padding: '12px 18px', marginBottom: 18, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.82rem' }}>
      <strong>{unplaced.length === branches.length ? "Set your branches' locations on the map." : `${unplaced.length} branch${unplaced.length === 1 ? ' has' : 'es have'} no map location.`}</strong> Patients compare labs by true cost (test price + travel); a branch without a location is listed last.
      {currentPage !== 'branches' && <> <a style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }} onClick={() => setCurrentPage('branches')}>Set them under Branches</a>.</>}
    </div>
  );

  const today = pktToday();
  const openBookings   = bookings.filter((b: any) => ['confirmed', 'sample_collected'].includes(b.status));
  const visitsToday    = bookings.filter((b: any) => b.visitDate === today && b.status !== 'cancelled');
  const awaitingReport = bookings.filter((b: any) => b.status === 'sample_collected' && !b.report);
  // Slip numbers compare without dashes / spaces / case ("lb 7kq4m9xd" finds LB-7KQ4-M9XD)
  const slipKey = (v: string) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const filteredBookings = bookings.filter((b: any) =>
    slipKey(slipQuery)           ? slipKey(b.slipNumber).includes(slipKey(slipQuery)) // a slip is found at any branch
    : workingAt && String(b.branch) !== workingAt ? false
    : bookingFilter === 'all'      ? true
    : bookingFilter === 'today'  ? b.visitDate === today
    : bookingFilter === 'upcoming' ? b.visitDate > today && b.status === 'confirmed'
    : ['confirmed', 'sample_collected'].includes(b.status)
  );
  const uploadBooking = bookings.find((b: any) => b._id === uploadBookingId);

  const breadcrumbs: Record<string, string> = {
    dashboard:    'Dashboard',
    requests:     'Bookings',
    upload:       'Upload Reports',
    catalog:      'Test Catalog',
    branches:     'Branches',
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
              Bookings
              {openBookings.length > 0 && <span className="dash-nav-badge">{openBookings.length}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'upload' ? 'active' : ''}`} onClick={() => navigate('upload')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Reports
            </button>

            <button className={`dash-nav-item ${currentPage === 'catalog' ? 'active' : ''}`} onClick={() => navigate('catalog')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Test Catalog
            </button>

            <button className={`dash-nav-item ${currentPage === 'branches' ? 'active' : ''}`} onClick={() => navigate('branches')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Branches
              {branches.length > 1 && <span className="dash-nav-badge" style={{ background: 'var(--text-muted)' }}>{branches.length}</span>}
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
              {locationNotice}

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
                  { label: 'Visits Today', value: String(visitsToday.length), icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>, trend: `${openBookings.length} open booking${openBookings.length === 1 ? '' : 's'}` },
                  { label: 'Pending Upload', value: String(awaitingReport.length), icon: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>, trend: 'Samples collected, no report yet' },
                  { label: 'Received This Month', value: earnings ? `PKR ${earnings.total.toLocaleString()}` : '—', icon: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>, trend: earnings ? `${earnings.count} payment${earnings.count === 1 ? '' : 's'} recorded on CareFirst` : 'Loading…' },
                  { label: 'Reports This Month', value: String(reports.filter((r: any) => (r.createdAt || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length), icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>, trend: `${reports.length} report${reports.length === 1 ? '' : 's'} uploaded in total` },
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
                      Upcoming Visits
                    </div>
                    <div className="dash-card-action" onClick={() => navigate('requests')} style={{ cursor: 'pointer' }}>View all <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
                  </div>
                  {openBookings.filter((b: any) => b.status === 'confirmed').length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No upcoming visits.</div>
                  ) : openBookings.filter((b: any) => b.status === 'confirmed').slice(0, 4).map((b: any) => (
                    <div className="dash-list-item" key={b._id}>
                      <div className="dash-list-row1">
                        <div className="dash-list-name">{b.patient?.name || '—'}</div>
                        <span className={`dash-badge ${b.visitDate === today ? 'dash-amber' : 'dash-blue'}`}><span className="dash-badge-dot"></span>{b.visitDate === today ? 'Today' : dayLabel(b.visitDate)}</span>
                      </div>
                      <div className="dash-list-sub">{b.testName} · {b.paymentMethod === 'installment' ? 'installment plan' : `PKR ${Number(b.price).toLocaleString()} at the lab`}</div>
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
                        {awaitingReport.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No samples waiting for a report.</td></tr>
                        )}
                        {awaitingReport.slice(0, 4).map((b: any) => (
                          <tr key={b._id}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{b.patient?.name || '—'}</td>
                            <td>{b.testName}</td>
                            <td>{b.sampleCollectedAt ? new Date(b.sampleCollectedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="dash-action-btn" title="Upload report" onClick={() => uploadForBooking(b)}>
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

            {/* ══ BOOKINGS (patients' lab visits) ═══════════════ */}
            <section className={`dash-page-section ${currentPage === 'requests' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Bookings</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">Patients' lab visits — collect the sample, then upload the report to complete the booking</div>
                </div>
                <div className="dash-filter-row dash-fu-1">
                  <input className="dash-filter-select" style={{ width: 190, backgroundImage: 'none', paddingRight: 12, cursor: 'text' }} type="text" placeholder="Check a slip number…"
                    value={slipQuery} onChange={e => setSlipQuery(e.target.value)} title="Type the number on the patient's slip to find their booking" />
                  {branches.length > 1 && (
                    <select className="dash-filter-select" value={workingAt} onChange={e => chooseWorkingAt(e.target.value)} title="Show the visits of the branch you are working at">
                      <option value="">All branches</option>
                      {branches.map((br: any) => <option key={br.branchId} value={String(br.branchId)}>Working at: {br.name}</option>)}
                    </select>
                  )}
                  <select className="dash-filter-select" value={bookingFilter} onChange={e => setBookingFilter(e.target.value as any)}>
                    <option value="open">Open</option>
                    <option value="today">Visiting today</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="all">All bookings</option>
                  </select>
                </div>
              </div>

              {bookingMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: '0.82rem', background: bookingMsg.ok ? '#dcfce7' : '#fee2e2', color: bookingMsg.ok ? '#166534' : '#991b1b' }}>
                  {bookingMsg.text}
                </div>
              )}

              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-table-wrap">
                  <table>
                    <thead>
                      <tr><th>Visit</th><th>Patient</th><th>Test</th><th>Branch</th><th>Payment</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {!bookingsLoaded ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
                      ) : filteredBookings.length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                          {slipKey(slipQuery)
                            ? 'No booking at your lab has this slip number. Check the number, or the slip may be for another lab.'
                            : bookings.length === 0 ? 'No bookings yet. Patients book visits from Book Tests.' : 'No bookings in this view.'}
                        </td></tr>
                      ) : filteredBookings.map((b: any) => {
                        const st = BOOKING_STATUS[b.status] || { label: b.status, cls: 'dash-gray' };
                        return (
                          <tr key={b._id}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                              {b.visitDate === today ? 'Today' : dayLabel(b.visitDate)}
                              {b.slipNumber && <div className="dash-mono" style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>Slip {b.slipNumber}</div>}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{b.patient?.name || '—'}</div>
                              <div className="dash-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{[b.patient?.cnic, b.patient?.phone].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td>{b.testName}</td>
                            <td style={{ fontSize: '0.78rem' }}>
                              <div style={{ fontWeight: 600, color: workingAt && String(b.branch) !== workingAt ? '#b45309' : 'var(--text)' }}>{b.branchName || '—'}</div>
                              {workingAt && String(b.branch) !== workingAt && <div style={{ fontSize: '0.68rem', color: '#b45309' }}>booked at another branch</div>}
                              {b.transfers?.length > 0 && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>moved from {b.transfers[b.transfers.length - 1].fromName}</div>}
                            </td>
                            <td style={{ fontSize: '0.8rem' }}>
                              {b.paymentMethod === 'installment'
                                ? <span style={{ color: '#1d4ed8', fontWeight: 600 }}>Installment plan</span>
                                : <>PKR {Number(b.price).toLocaleString()}<div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>collect at the lab</div></>}
                            </td>
                            <td>
                              <span className={`dash-badge ${st.cls}`}><span className="dash-badge-dot"></span>{st.label}</span>
                              {b.report?.reportUrl && <div><a href={b.report.reportUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>Report ↗</a></div>}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {b.status === 'confirmed' && workingAt && String(b.branch) !== workingAt && offeredAt(tests.find((t: any) => t._id === b.labTest)).includes(workingAt) && (
                                  <button className="dash-btn-primary accent" style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={() => transferBooking(b, workingAt)}>Take visit here</button>
                                )}
                                {b.status === 'confirmed' && !workingAt && branches.length > 1 && (
                                  <select className="dash-filter-select" style={{ height: 28, fontSize: '0.72rem' }} value="" onChange={e => e.target.value && transferBooking(b, e.target.value)}>
                                    <option value="">Move to…</option>
                                    {branches.filter((br: any) => String(br.branchId) !== String(b.branch) && offeredAt(tests.find((t: any) => t._id === b.labTest)).includes(String(br.branchId)))
                                      .map((br: any) => <option key={br.branchId} value={br.branchId}>{br.name}</option>)}
                                  </select>
                                )}
                                {b.status === 'confirmed' && (
                                  <button className="adm-approve-btn" onClick={() => advanceBooking(b, 'sample-collected')}>Sample collected</button>
                                )}
                                {b.status === 'sample_collected' && !b.report && (
                                  <button className="dash-btn-primary accent" style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={() => uploadForBooking(b)}>Upload report</button>
                                )}
                                {b.status === 'sample_collected' && (
                                  <button className="dash-btn-ghost" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => advanceBooking(b, 'complete')}>Mark completed</button>
                                )}
                                {b.status !== 'cancelled' && (
                                  <button className="dash-btn-ghost" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => getSlip('lab-booking', b._id)}>Slip (PDF)</button>
                                )}
                                {b.status === 'cancelled' && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
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
                <div className="dash-form-group">
                  <label className="dash-form-label">Booking</label>
                  <select className="dash-form-input" style={{ height: 42 }} value={uploadBookingId} onChange={e => { setUploadBookingId(e.target.value); setUploadMsg(''); }}>
                    <option value="">No booking — choose the patient and test below</option>
                    {awaitingReport.map((b: any) => (
                      <option key={b._id} value={b._id}>{b.patient?.name} — {b.testName} (visit {dayLabel(b.visitDate)})</option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Bookings whose sample is collected are listed here; uploading the report completes the booking.
                  </div>
                </div>

                {uploadBooking ? (
                  <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-light, #eff6ff)', fontSize: '0.84rem', marginBottom: 8 }}>
                    <strong>{uploadBooking.patient?.name}</strong> · {uploadBooking.testName} · visit {dayLabel(uploadBooking.visitDate)}
                    {uploadBooking.patient?.cnic && <span style={{ color: 'var(--text-muted)' }}> · CNIC {uploadBooking.patient.cnic}</span>}
                  </div>
                ) : (
                <div className="dash-form-row">
                  <div className="dash-form-group">
                    <label className="dash-form-label">Patient <span style={{ color: '#ef4444' }}>*</span></label>
                    {labPatients.length === 0 ? (
                      <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef9c3', color: '#854d0e', fontSize: '0.82rem' }}>
                        No patients linked to your lab yet. Patients appear here once they book a visit, have an installment plan with your lab, or a community support case is assigned to you.
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
                )}

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
                  <label className="dash-form-label">Summary for the patient</label>
                  <textarea className="dash-form-input dash-form-textarea" style={{ minHeight: 70 }}
                    placeholder="One or two plain sentences, e.g. &quot;Your blood count is normal. Haemoglobin is slightly low — discuss with your doctor.&quot;"
                    value={uploadSummary} onChange={e => setUploadSummary(e.target.value)}></textarea>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Translated to Urdu automatically so the patient can read it and listen to it. You can correct the Urdu below after uploading.
                  </div>
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
                  <button className="dash-btn-ghost" onClick={() => { setUploadPatientId(''); setUploadTestName(''); setUploadFile(null); setUploadNotes(''); setUploadMsg(''); setUploadBookingId(''); setUploadSummary(''); }}>Clear</button>
                  <button className="dash-btn-primary accent" disabled={uploadLoading || !uploadFile || (!uploadBooking && (!uploadPatientId || !uploadTestName))} onClick={submitReport}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    {uploadLoading ? 'Uploading…' : 'Submit Report'}
                  </button>
                </div>
              </div>

              {/* Recent reports — review / correct the machine-translated Urdu summary */}
              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-card-header">
                  <div className="dash-card-title">Recent Reports</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Check the Urdu summary patients will read and hear</div>
                </div>
                {summaryMsg && (
                  <div style={{ margin: '0 20px 10px', padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: summaryMsg.ok ? '#f0fdf4' : '#fef2f2', color: summaryMsg.ok ? '#166534' : '#991b1b' }}>
                    {summaryMsg.text}
                  </div>
                )}
                {reports.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>No reports uploaded yet.</div>
                ) : reports.slice(0, 10).map((r: any) => (
                  <div key={r._id} style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      <strong style={{ color: 'var(--text)' }}>{r.patient?.name || '—'}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-sub)' }}>{r.testName} · {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      <a href={r.reportUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.74rem', fontWeight: 600 }}>File ↗</a>
                      {(() => {
                        const a = r.autoRead || {};
                        const flagged = (a.findings || []).filter((f: any) => ['high', 'low', 'abnormal'].includes(f.status)).length;
                        const [label, cls] =
                          ['pending', 'processing'].includes(a.status) ? ['Reading report…', 'dash-blue']
                          : a.status === 'failed' ? ["Couldn't read automatically", 'dash-red']
                          : a.status === 'ready' && a.kind === 'table' ? [flagged ? `${flagged} of ${a.findings.length} outside range` : `${a.findings.length} results, all in range`, flagged ? 'dash-amber' : 'dash-green']
                          : a.status === 'ready' && a.kind === 'narrative' ? ['Written report — sent to doctor', 'dash-gray']
                          : a.status === 'ready' ? ['No results found', 'dash-gray'] : [null, ''];
                        return label && <span className={`dash-badge ${cls}`}><span className="dash-badge-dot"></span>{label}</span>;
                      })()}
                      <span style={{ flex: 1 }} />
                      {['failed', 'ready'].includes(r.autoRead?.status) && editSummaryId !== r._id && (
                        <button className="dash-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.74rem' }} disabled={readingId === r._id} onClick={() => readAgain(r)}>
                          {readingId === r._id ? 'Reading…' : 'Read again'}
                        </button>
                      )}
                      {r.summaryUrdu && editSummaryId !== r._id && <ListenButton compact request={{ source: 'report', id: r._id }} />}
                      {editSummaryId !== r._id && (
                        <button className="dash-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.74rem' }} onClick={() => startEditSummary(r)}>
                          {r.summary ? 'Edit summary' : 'Add summary'}
                        </button>
                      )}
                    </div>
                    {editSummaryId === r._id ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        <div>
                          <div className="dash-form-label">English</div>
                          <textarea className="dash-form-input dash-form-textarea" style={{ minHeight: 80 }} value={summaryDraft.summary}
                            onChange={e => setSummaryDraft(d => ({ ...d, summary: e.target.value }))} />
                        </div>
                        <div>
                          <div className="dash-form-label">اردو</div>
                          <textarea className="dash-form-input dash-form-textarea" dir="rtl" lang="ur"
                            style={{ minHeight: 80, fontFamily: "'Noto Nastaliq Urdu', serif", lineHeight: 2 }} value={summaryDraft.summaryUrdu}
                            onChange={e => setSummaryDraft(d => ({ ...d, summaryUrdu: e.target.value }))} />
                        </div>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button className="dash-btn-ghost" disabled={summaryBusy} onClick={() => setEditSummaryId(null)}>Cancel</button>
                          <button className="dash-btn-ghost" disabled={summaryBusy || !summaryDraft.summary.trim()} onClick={() => saveSummary(r, 'translate')}>Translate English again</button>
                          <button className="dash-btn-primary accent" disabled={summaryBusy} onClick={() => saveSummary(r, 'urdu')}>
                            {summaryBusy ? 'Saving…' : 'Save Urdu'}
                          </button>
                        </div>
                      </div>
                    ) : (r.summary || r.summaryUrdu) ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, fontSize: '0.8rem', color: 'var(--text-sub)' }}>
                        <div>{r.summary || <em>No English summary</em>}</div>
                        <div>
                          {r.summaryUrdu ? <UrduText text={r.summaryUrdu} style={{ color: 'var(--text)' }} /> : <em>Not translated yet — use Edit summary → Translate English again</em>}
                          {r.summaryUrdu && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                              {r.summarySource === 'auto' ? 'Automatic summary — already shown to the patient'
                                : r.summaryUrduSource === 'lab' ? 'Corrected by your lab' : 'Machine translated — please check'}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{['pending', 'processing'].includes(r.autoRead?.status) ? 'The automatic summary will appear here when the report has been read.' : 'No summary — patients only get the file.'}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ══ TEST CATALOG ══════════════════════════════════ */}
            {/* ══ BRANCHES ══════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'branches' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Branches</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Every place patients can visit — each with its own address, phone, hours and map location</div>
              </div>
              {locationNotice}
              <div className="dash-fu dash-fu-1">
                <LabBranches branches={branches} labName={labName} onChanged={branchesChanged} />
              </div>
              <div className="dash-fu dash-fu-2" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 18, lineHeight: 1.6 }}>
                Patients choose a branch when they book. If one comes to the wrong branch, open Bookings, type their slip number and press
                <strong> Take visit here</strong> — the visit moves to your branch and the patient is told. Limit a test to some branches in Test Catalog.
              </div>
            </section>

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
              {locationNotice}

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

                  {offeredPicker(addForm.branches, v => setAddForm(f => ({ ...f, branches: v })))}

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

                        {offeredPicker(editForm.branches, v => setEditForm(f => ({ ...f, branches: v })))}

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
                        {branches.length > 1 && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {t.branches?.length ? `At: ${t.branches.map(branchName).join(', ')}` : 'At all branches'}
                          </div>
                        )}
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
                <div className="dash-page-subtitle">Payments recorded on CareFirst — visits paid at your lab and installment-plan payments you confirmed</div>
              </div>

              {(() => {
                const fmt = (n: number) => n.toLocaleString();
                const total = earnings?.total || 0;
                const prev = earnings?.previousTotal || 0;
                const change = prev === 0 ? (total > 0 ? 'New' : '—') : `${total >= prev ? '+' : ''}${Math.round(((total - prev) / prev) * 100)}%`;
                const thisMonth = earnings?.month || '';
                const monthName = thisMonth ? new Date(`${thisMonth}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
                return (
                  <>
                    <div className="lab-revenue-hero dash-fu dash-fu-1">
                      <div className="lab-revenue-inner">
                        <div>
                          <div className="lab-revenue-label">Received in {monthName || 'this month'}</div>
                          <div className="lab-revenue-amount"><span className="lab-revenue-currency">PKR</span>{fmt(total)}</div>
                        </div>
                        <div className="lab-revenue-stats">
                          <div className="lab-rev-stat"><div className="rv">{earnings?.visitsCompleted ?? 0}</div><div className="rl">Visits Paid at Lab</div></div>
                          <div style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.10)' }}></div>
                          <div className="lab-rev-stat"><div className="rv">{earnings?.planPayments ?? 0}</div><div className="rl">Plan Payments</div></div>
                          <div style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.10)' }}></div>
                          <div className="lab-rev-stat"><div className="rv">{change}</div><div className="rl">vs Last Month</div></div>
                        </div>
                      </div>
                    </div>

                    <div className="dash-card dash-fu dash-fu-2">
                      <div className="dash-card-header">
                        <div className="dash-card-title">
                          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                          Payments — this month and last month
                        </div>
                      </div>
                      <div className="dash-table-wrap">
                        <table>
                          <thead><tr><th>Date</th><th>Patient</th><th>Test</th><th>Payment</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                          <tbody>
                            {!earnings ? (
                              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
                            ) : earnings.entries.length === 0 ? (
                              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                No payments recorded yet. Completed visits paid at your lab and plan payments you confirm under Receipts appear here.
                              </td></tr>
                            ) : earnings.entries.map((r: any, i: number) => (
                              <tr key={i}>
                                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.patient}</td>
                                <td>{r.testName}</td>
                                <td style={{ fontSize: '0.78rem', color: 'var(--text-sub)' }}>{r.detail}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>+ PKR {fmt(r.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </section>

            {/* ══ NEEDY PATIENTS ════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'needyPatients' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Needy Patients</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Community Support approved patients assigned to your lab — conduct tests as per authorization slip</div>
              </div>

              {(() => {
                const partner = Boolean(labProfile?.profile?.isCharityPartner);
                const waiting = needyPats.filter((p: any) => !p.testConducted).length;
                return (
                  <div className="dash-card dash-fu" style={{ padding: '18px 22px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ maxWidth: 640 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <div className="dash-card-title" style={{ margin: 0 }}>Community Support</div>
                        {partner
                          ? <span className="dash-badge dash-green"><span className="dash-badge-dot"></span>Partner lab</span>
                          : <span className="dash-badge dash-gray"><span className="dash-badge-dot"></span>Not joined</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', lineHeight: 1.55 }}>
                        {partner
                          ? <>You take care of needy patients the CareFirst admin assigns to you{labProfile?.profile?.charityPartnerSince ? ` (partner since ${new Date(labProfile.profile.charityPartnerSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}. Their financial need has been checked by the admin; conduct the test on their slip and mark it conducted.
                              {waiting > 0 && <> You can leave once the {waiting} waiting test{waiting === 1 ? ' is' : 's are'} conducted.</>}</>
                          : <>Join to take care of needy patients who cannot afford a test. The admin checks each patient's documents and assigns approved patients to partner labs; you conduct the test for them. CareFirst does not collect or pass on donations.</>}
                      </div>
                    </div>
                    {partner ? (
                      <button className="dash-btn-ghost" disabled={partnerBusy || waiting > 0} onClick={() => setCommunitySupport(false)}
                        title={waiting > 0 ? 'Conduct the waiting tests first' : 'Stop receiving needy patients'}
                        style={waiting > 0 || partnerBusy ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
                        Leave Community Support
                      </button>
                    ) : (
                      <button className="dash-btn-primary accent" disabled={partnerBusy || !labProfile} onClick={() => setCommunitySupport(true)}>
                        Join Community Support
                      </button>
                    )}
                  </div>
                );
              })()}

              <div className="dash-fu dash-fu-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
                {needyPats.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 16 }}>
                    {labProfile?.profile?.isCharityPartner ? 'No community support patients assigned to your lab yet.' : 'Join Community Support above to be assigned needy patients.'}
                  </div>
                )}
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
                          <div className="lab-needy-slip-id">Slip: {p.slip?.slipId || '—'} · Case: {p._id?.toString().slice(-6).toUpperCase()}</div>
                          <div className="lab-needy-stamp">Background Check Assured</div>
                          <div className="lab-needy-approved">Admin approved: {p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                        </div>
                        {p.slip?.slipId && (
                          <button className="dash-btn-ghost" style={{ padding: '5px 10px', fontSize: '0.74rem', marginTop: 8 }} onClick={() => getSlip('community', p._id)}>
                            Slip + documents (PDF)
                          </button>
                        )}
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
                          <th>Payment</th>
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
