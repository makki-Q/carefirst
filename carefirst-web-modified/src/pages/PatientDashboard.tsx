import React, { useState, useEffect, useCallback } from 'react';
import './PatientDashboard.css';
import { api, getSession, saveSession, clearSession, formatCnic } from '../lib/api';
import { getSocket } from '../lib/socket';

// ── Upload limits (mirror carefirst-backend/middleware/upload.js) ─────────────
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_MB        = 10;
const MAX_COMMUNITY_DOCS = 5;

const validateFile = (file: File): string | null => {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `${file.name}: only PDF, JPG or PNG files are allowed`;
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `${file.name}: file is larger than ${MAX_FILE_MB} MB`;
  return null;
};

// ── Formatting helpers ────────────────────────────────────────────────────────
const pkr = (n: number) => `PKR ${(Number(n) || 0).toLocaleString()}`;

const fmtDate = (d?: string | Date) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const timeAgo = (d?: string | Date) => {
  if (!d) return '';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  return fmtDate(d);
};

const drName = (name?: string) => (!name ? 'Doctor' : /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`);
const shortId = (id?: string) => (id ? id.toString().slice(-6).toUpperCase() : '—');

const CNIC_STATUS: Record<string, { label: string; pill: string; badge: string }> = {
  verified:   { label: 'CNIC Verified',        pill: 'pat-green', badge: 'pat-badge-green' },
  unverified: { label: 'CNIC Pending Review',  pill: 'pat-red',   badge: 'pat-badge-amber' },
  rejected:   { label: 'CNIC Not Verified',    pill: 'pat-red',   badge: 'pat-badge-red'   },
};

const APP_STATUS: Record<string, string> = {
  pending: 'pat-badge-amber', approved: 'pat-badge-green', rejected: 'pat-badge-red',
};

// Where an installment is in the patient → lab → admin verification chain
const installmentStage = (inst: any) => {
  if (inst.status === 'paid' || inst.adminVerified) return { label: 'Paid',              cls: 'pat-badge-green', verification: 'Verified ✓' };
  if (inst.status === 'overdue')                    return { label: 'Overdue',           cls: 'pat-badge-red',   verification: '—' };
  if (inst.labApproved)                             return { label: 'Lab confirmed',     cls: 'pat-badge-amber', verification: 'Awaiting admin' };
  if (inst.receiptUrl)                              return { label: 'Receipt submitted', cls: 'pat-badge-amber', verification: 'Awaiting lab' };
  if (new Date(inst.dueDate) < new Date())          return { label: 'Past due',          cls: 'pat-badge-red',   verification: '—' };
  return { label: 'Due', cls: 'pat-badge-amber', verification: '—' };
};

// Notification type → icon colour + glyph
const notifVisual = (type: string) => {
  if (type?.startsWith('test_report')) return { color: 'green', icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/> };
  if (type === 'prescription_issued')  return { color: 'red',   icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/> };
  if (type?.startsWith('receipt') || type === 'installment_overdue')
    return { color: 'amber', icon: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></> };
  if (['defaulter_escalated', 'cnic_rejected', 'community_rejected'].includes(type))
    return { color: 'red', icon: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></> };
  return { color: 'blue', icon: <polyline points="20 6 9 17 4 12"/> };
};

const PatientDashboard = () => {
  const session   = getSession();
  const isPatient = Boolean(session.token) && session.user?.role === 'patient';

  // ── UI state ────────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen]         = useState(true);
  const [currentPage, setCurrentPage]         = useState('dashboard');
  const [dateString, setDateString]           = useState('');
  const [activeSpecialty, setActiveSpecialty] = useState('All');
  const [doctorSearch, setDoctorSearch]       = useState('');
  const [showTrueCost, setShowTrueCost]       = useState(false);
  const [testSearch, setTestSearch]           = useState('');
  const [topSearch, setTopSearch]             = useState('');
  const [reportFilter, setReportFilter]       = useState('all');

  // ── Data state ──────────────────────────────────────────────────────────────
  const [me, setMe]                       = useState<any>(session.user || {});
  const [profile, setProfile]             = useState<any>(null);
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [reports, setReports]             = useState<any[]>([]);
  const [wallets, setWallets]             = useState<any[]>([]);
  const [communityApps, setCommunityApps] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [doctors, setDoctors]             = useState<any[]>([]);
  const [allLabTests, setAllLabTests]     = useState<any[]>([]);
  const [loaded, setLoaded]               = useState<Record<string, boolean>>({});

  // ── Wallet state ────────────────────────────────────────────────────────────
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [uploadingKey, setUploadingKey]         = useState('');
  const [walletMsg, setWalletMsg]               = useState<{ ok: boolean; text: string } | null>(null);

  // ── Community support form ──────────────────────────────────────────────────
  const [testRequired, setTestRequired]   = useState('');
  const [supportDocs, setSupportDocs]     = useState<File[]>([]);
  const [docsInputKey, setDocsInputKey]   = useState(0);
  const [applying, setApplying]           = useState(false);
  const [communityMsg, setCommunityMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  // ── Profile form ────────────────────────────────────────────────────────────
  const [profileForm, setProfileForm]     = useState({ name: '', phone: '', cnic: '', city: '', address: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const signOut = () => { clearSession(); window.location.href = '/login'; };

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const markLoaded = (key: string) => setLoaded(prev => ({ ...prev, [key]: true }));

  const loadProfile = useCallback(() =>
    api.get('/patient/profile').then((d: any) => {
      setMe(d.user || {});
      setProfile(d.profile || null);
      setProfileForm({
        name:    d.user?.name || '',
        phone:   d.user?.phone || '',
        cnic:    d.profile?.cnic || '',
        city:    d.profile?.city || '',
        address: d.profile?.address || '',
      });
    }).catch((err: any) => {
      // token expired, account suspended or wrong role → back to login
      if (err.status === 401 || err.status === 403) signOut();
    }),
  []);

  const loadPrescriptions = useCallback(() =>
    api.get('/patient/prescriptions').then((d: any) => setPrescriptions(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('prescriptions')), []);
  const loadReports = useCallback(() =>
    api.get('/patient/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('reports')), []);
  const loadWallets = useCallback(() =>
    api.get('/patient/wallets').then((d: any) => setWallets(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('wallets')), []);
  const loadCommunity = useCallback(() =>
    api.get('/patient/community-applications').then((d: any) => setCommunityApps(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('community')), []);
  const loadNotifications = useCallback(() =>
    api.get('/patient/notifications').then((d: any) => setNotifications(Array.isArray(d) ? d : [])).catch(() => {}), []);

  useEffect(() => {
    if (!isPatient) { window.location.href = '/login'; return; }

    const d = new Date();
    setDateString(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));

    loadProfile();
    loadPrescriptions();
    loadReports();
    loadWallets();
    loadCommunity();
    loadNotifications();
    api.get('/public/doctors').then((d: any) => setDoctors(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('doctors'));
    api.get('/public/tests').then((d: any) => setAllLabTests(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('tests'));
  }, []);

  // Real-time notifications — also refresh whatever data the event changed
  useEffect(() => {
    const uid = (session.user as any)?._id || (session.user as any)?.id;
    if (!isPatient || !uid) return;
    const socket = getSocket();
    socket.emit('join', uid);
    socket.on('notification:new', (n: any) => {
      setNotifications(prev => [n, ...prev]);
      if (n.type === 'test_report_uploaded') { loadReports(); loadCommunity(); }
      if (n.type === 'prescription_issued')  loadPrescriptions();
      if (['receipt_lab_approved', 'receipt_admin_verified', 'installment_overdue', 'defaulter_escalated'].includes(n.type)) loadWallets();
      if (['community_approved', 'community_rejected'].includes(n.type)) loadCommunity();
      if (['cnic_verified', 'cnic_rejected'].includes(n.type)) loadProfile();
    });
    return () => { socket.off('notification:new'); };
  }, []);

  // Keep a valid wallet selected
  useEffect(() => {
    if (wallets.length && !wallets.some(w => w._id === selectedWalletId)) setSelectedWalletId(wallets[0]._id);
  }, [wallets]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const navigate = (page: string) => setCurrentPage(page);

  const markNotifRead = async (n: any) => {
    if (n.read) return;
    try {
      await api.put(`/patient/notifications/${n._id}/read`, {});
      setNotifications(prev => prev.map(x => x._id === n._id ? { ...x, read: true } : x));
    } catch {}
  };

  const markAllNotifsRead = async () => {
    try {
      await api.put('/patient/notifications/read-all', {});
      setNotifications(prev => prev.map(x => ({ ...x, read: true })));
    } catch {}
  };

  const openReport = (r: any) => {
    if (r.isRead) return;
    setReports(prev => prev.map(x => x._id === r._id ? { ...x, isRead: true } : x));
    api.put(`/patient/reports/${r._id}/read`, {}).catch(() => {});
  };

  const uploadReceipt = async (walletId: string, instIndex: number, file?: File | null) => {
    if (!file) return;
    setWalletMsg(null);
    const invalid = validateFile(file);
    if (invalid) { setWalletMsg({ ok: false, text: invalid }); return; }

    const fd = new FormData();
    fd.append('receipt', file);
    setUploadingKey(`${walletId}-${instIndex}`);
    try {
      const res: any = await api.upload(`/patient/wallets/${walletId}/installments/${instIndex}/receipt`, fd);
      setWallets(prev => prev.map(w => w._id === walletId ? res.wallet : w));
      setWalletMsg({ ok: true, text: res.message || 'Receipt uploaded.' });
    } catch (err: any) {
      setWalletMsg({ ok: false, text: err.message || 'Upload failed. Please try again.' });
    } finally {
      setUploadingKey('');
    }
  };

  const selectSupportDocs = (files: FileList | null) => {
    setCommunityMsg(null);
    const list = Array.from(files || []);
    if (list.length > MAX_COMMUNITY_DOCS) {
      setCommunityMsg({ ok: false, text: `You can upload up to ${MAX_COMMUNITY_DOCS} documents` });
      setSupportDocs([]); setDocsInputKey(k => k + 1);
      return;
    }
    const invalid = list.map(validateFile).find(Boolean);
    if (invalid) {
      setCommunityMsg({ ok: false, text: invalid });
      setSupportDocs([]); setDocsInputKey(k => k + 1);
      return;
    }
    setSupportDocs(list);
  };

  const submitCommunityApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setCommunityMsg(null);
    if (!testRequired.trim())  { setCommunityMsg({ ok: false, text: 'Please enter the test you need support for' }); return; }
    if (!supportDocs.length)   { setCommunityMsg({ ok: false, text: 'Please attach at least one supporting document' }); return; }

    const fd = new FormData();
    fd.append('testRequired', testRequired.trim());
    supportDocs.forEach(f => fd.append('documents', f));
    setApplying(true);
    try {
      await api.upload('/patient/community-applications', fd);
      setTestRequired(''); setSupportDocs([]); setDocsInputKey(k => k + 1);
      setCommunityMsg({ ok: true, text: 'Application submitted. The admin will review your documents.' });
      loadCommunity();
    } catch (err: any) {
      setCommunityMsg({ ok: false, text: err.message || 'Submission failed. Please try again.' });
    } finally {
      setApplying(false);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    if (!profileForm.name.trim()) { setProfileMsg({ ok: false, text: 'Name is required' }); return; }
    if (profileForm.phone && !/^\d{11}$/.test(profileForm.phone.replace(/[\s\-().]/g, ''))) {
      setProfileMsg({ ok: false, text: 'Phone number must be exactly 11 digits (e.g. 03001234567)' }); return;
    }
    const cnicLocked = profile?.cnicStatus === 'verified';
    const cnic = formatCnic(profileForm.cnic);
    if (!cnicLocked && !cnic) { setProfileMsg({ ok: false, text: 'Enter a valid 13-digit CNIC (e.g. 35202-1234567-8)' }); return; }

    setSavingProfile(true);
    try {
      const payload: any = { name: profileForm.name, phone: profileForm.phone, city: profileForm.city, address: profileForm.address };
      if (!cnicLocked) payload.cnic = cnic;
      const d: any = await api.put('/patient/profile', payload);
      setMe(d.user); setProfile(d.profile);
      setProfileForm(prev => ({ ...prev, cnic: d.profile?.cnic || prev.cnic }));
      if (session.token) saveSession(session.token, { ...session.user, name: d.user?.name });
      setProfileMsg({ ok: true, text: 'Profile saved.' });
    } catch (err: any) {
      setProfileMsg({ ok: false, text: err.message || 'Could not save profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const firstName     = (me?.name || '').split(' ')[0] || 'there';
  const hour          = new Date().getHours();
  const greeting      = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const cnicStatus    = profile?.cnicStatus || 'unverified';
  const cnicVerified  = cnicStatus === 'verified';
  const unreadNotifs  = notifications.filter(n => !n.read).length;
  const unreadReports = reports.filter(r => !r.isRead).length;

  const prescribedTests = [...new Set(prescriptions.flatMap(p => (p.tests || []).map((t: any) => t.testName)))] as string[];
  const openWallets     = wallets.filter(w => w.status !== 'completed');
  const totalRemaining  = openWallets.reduce((s, w) => s + (w.remainingBalance ?? 0), 0);
  const nextDue = openWallets
    .flatMap(w => (w.installments || []).filter((i: any) => i.status !== 'paid' && !i.adminVerified).map((i: any) => i.dueDate))
    .sort((a: string, b: string) => new Date(a).getTime() - new Date(b).getTime())[0];
  const latestApp     = communityApps[0];
  const hasPendingApp = communityApps.some(a => a.status === 'pending');

  const specialties = ['All', ...[...new Set(doctors.map(d => d.specialization).filter(Boolean))].sort()] as string[];
  const filteredDoctors = doctors.filter(d =>
    (activeSpecialty === 'All' || d.specialization === activeSpecialty) &&
    (!doctorSearch ||
      d.name?.toLowerCase().includes(doctorSearch.toLowerCase()) ||
      d.specialization?.toLowerCase().includes(doctorSearch.toLowerCase()))
  );

  const filteredLabs = allLabTests
    .map(lab => ({
      ...lab,
      tests: lab.tests.filter((t: any) =>
        !testSearch ||
        t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
        t.category.toLowerCase().includes(testSearch.toLowerCase())
      ),
    }))
    .filter(lab => lab.tests.length > 0);
  const allTestNames = [...new Set(allLabTests.flatMap(l => l.tests.map((t: any) => t.name)))] as string[];

  const filteredReports = reports.filter(r =>
    reportFilter === 'all' || (reportFilter === 'new' ? !r.isRead : r.isRead)
  );

  const wallet       = wallets.find(w => w._id === selectedWalletId) || wallets[0];
  const walletPaid   = wallet ? Math.max(0, (wallet.totalAmount || 0) - (wallet.remainingBalance ?? wallet.totalAmount ?? 0)) : 0;
  const walletPct    = wallet?.totalAmount ? Math.min(100, Math.round((walletPaid / wallet.totalAmount) * 100)) : 0;
  const receiptLog   = wallet
    ? (wallet.installments || [])
        .map((inst: any, idx: number) => ({ ...inst, idx }))
        .filter((inst: any) => inst.receiptUrl)
        .sort((a: any, b: any) => new Date(b.receiptUploadedAt).getTime() - new Date(a.receiptUploadedAt).getTime())
    : [];

  const pageBreadcrumbs: Record<string, string> = {
    dashboard:     'Dashboard',
    findDoctors:   'Find Doctors',
    bookTests:     'Book Tests',
    myReports:     'My Reports',
    myWallet:      'My Wallet',
    community:     'Community Support',
    notifications: 'Notifications',
    profile:       'Profile',
  };

  const banner = (msg: { ok: boolean; text: string } | null) => msg && (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: '0.82rem', fontWeight: 500,
      background: msg.ok ? '#f0fdf4' : '#fef2f2', color: msg.ok ? '#166534' : '#991b1b',
      border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`,
    }}>
      {msg.text}
    </div>
  );

  const emptyRow = (cols: number, text: string) => (
    <tr><td colSpan={cols} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{text}</td></tr>
  );

  const cnicNotice = !cnicVerified && profile && (
    <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20 }}>
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <div className="pat-true-cost-text">
        {cnicStatus === 'rejected' ? (
          <><strong>Your CNIC could not be verified.</strong> {profile.cnicRejectionReason} <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('profile')}>Update it in your profile</a> to resubmit.</>
        ) : (
          <><strong>CNIC verification pending.</strong> An admin will verify your CNIC ({profile.cnic}). Community support and installment plans unlock once it's verified.</>
        )}
      </div>
    </div>
  );

  if (!isPatient) return null;

  return (
    <div className="patient-dashboard-wrapper">
      <div className="pat-shell">

        {/* ─── SIDEBAR ─────────────────────────────────────────── */}
        <aside className={`pat-sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
          <div className="pat-sidebar-logo">
            <div className="pat-logo-mark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </div>
            <span className="pat-logo-name">carefirst</span>
          </div>

          <div className="pat-sidebar-patient" style={{ cursor: 'pointer' }} onClick={() => navigate('profile')}>
            <div className="pat-avatar">{(me?.name || 'P')[0].toUpperCase()}</div>
            <div className="pat-patient-info">
              <div className="pat-name">{me?.name || 'Patient'}</div>
              <div className="pat-tag">Patient · {cnicVerified ? 'CNIC verified' : 'CNIC unverified'}</div>
            </div>
          </div>

          <nav className="pat-sidebar-nav">
            <div className="pat-nav-label">Main</div>

            <button className={`pat-nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('dashboard')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Dashboard
            </button>

            <button className={`pat-nav-item ${currentPage === 'findDoctors' ? 'active' : ''}`} onClick={() => navigate('findDoctors')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Find Doctors
            </button>

            <button className={`pat-nav-item ${currentPage === 'bookTests' ? 'active' : ''}`} onClick={() => navigate('bookTests')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              Book Tests
              {prescribedTests.length > 0 && <span className="pat-nav-badge">{prescribedTests.length}</span>}
            </button>

            <button className={`pat-nav-item ${currentPage === 'myReports' ? 'active' : ''}`} onClick={() => navigate('myReports')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              My Reports
              {unreadReports > 0 && <span className="pat-nav-badge">{unreadReports}</span>}
            </button>

            <div className="pat-nav-label">Finance</div>

            <button className={`pat-nav-item ${currentPage === 'myWallet' ? 'active' : ''}`} onClick={() => navigate('myWallet')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <path d="M2 10h20"/>
              </svg>
              My Wallet
            </button>

            <button className={`pat-nav-item ${currentPage === 'community' ? 'active' : ''}`} onClick={() => navigate('community')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              Community Support
            </button>

            <div className="pat-nav-label">Account</div>

            <button className={`pat-nav-item ${currentPage === 'notifications' ? 'active' : ''}`} onClick={() => navigate('notifications')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              Notifications
              {unreadNotifs > 0 && <span className="pat-nav-badge">{unreadNotifs}</span>}
            </button>

            <button className={`pat-nav-item ${currentPage === 'profile' ? 'active' : ''}`} onClick={() => navigate('profile')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
              Profile
            </button>
          </nav>

          <div className="pat-sidebar-footer">
            <button className="pat-nav-item" style={{ color: 'var(--red)' }} onClick={signOut}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* ─── MAIN ────────────────────────────────────────────── */}
        <main className={`pat-main ${!sidebarOpen ? 'expanded' : ''}`}>

          {/* TOPBAR */}
          <header className="pat-topbar">
            <div className="pat-topbar-left">
              <button className="pat-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle Sidebar">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <div className="pat-page-breadcrumb">
                <span>carefirst</span>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                <span className="pat-current">{pageBreadcrumbs[currentPage]}</span>
              </div>
            </div>
            <div className="pat-topbar-right">
              <div className="pat-search-wrap">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className="pat-search-input"
                  type="text"
                  placeholder="Search tests…"
                  value={topSearch}
                  onChange={e => setTopSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setTestSearch(topSearch); navigate('bookTests'); } }}
                />
              </div>
              <button className="pat-icon-btn" onClick={() => navigate('notifications')} style={{ position: 'relative' }}>
                <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadNotifs > 0 && <span className="pat-notif-dot" style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: '#e11d48', color: '#fff', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unreadNotifs}</span>}
              </button>
              <div className="pat-date-chip">{dateString}</div>
            </div>
          </header>

          {/* CONTENT */}
          <div className="pat-content">

            {/* ══ DASHBOARD ══════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'dashboard' ? 'active' : ''}`}>

              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">{greeting}, {firstName}</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Here's a summary of your healthcare today, {dateString}</div>
              </div>

              {cnicNotice}

              {/* Hero */}
              <div className="pat-hero-card pat-fade-up pat-fade-up-1">
                <div className="pat-hero-inner">
                  <div className="pat-hero-left">
                    <div className="pat-greeting">Member since {me?.createdAt ? new Date(me.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</div>
                    <div className="pat-patient-name">{me?.name || 'Patient'}</div>
                    <div className="pat-patient-meta">
                      {[profile?.cnic && `CNIC ${profile.cnic}`, profile?.city].filter(Boolean).join(' · ') || me?.email}
                    </div>
                    <div className="pat-hero-pills">
                      <div className={`pat-hero-pill ${CNIC_STATUS[cnicStatus].pill}`}>{CNIC_STATUS[cnicStatus].label}</div>
                      {unreadReports > 0 && <div className="pat-hero-pill pat-green">{unreadReports} New Report{unreadReports > 1 ? 's' : ''}</div>}
                    </div>
                  </div>
                  <div className="pat-hero-stats">
                    <div className="pat-hero-stat">
                      <div className="pat-val">{prescriptions.length}</div>
                      <div className="pat-lbl">Prescriptions</div>
                    </div>
                    <div className="pat-hero-divider"></div>
                    <div className="pat-hero-stat">
                      <div className="pat-val">{openWallets.length}</div>
                      <div className="pat-lbl">Active Plans</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="pat-stats-grid pat-fade-up pat-fade-up-2">
                <div className="pat-stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('bookTests')}>
                  <div className="pat-stat-top">
                    <div>
                      <div className="pat-stat-label">Tests Prescribed</div>
                      <div className="pat-stat-value">{prescribedTests.length}</div>
                    </div>
                    <div className="pat-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                      </svg>
                    </div>
                  </div>
                  <div className="pat-stat-trend">
                    {prescriptions[0] ? <>Latest: <span>{drName(prescriptions[0].doctor?.name)}</span></> : 'No prescriptions yet'}
                  </div>
                </div>

                <div className="pat-stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('myReports')}>
                  <div className="pat-stat-top">
                    <div>
                      <div className="pat-stat-label">Test Reports</div>
                      <div className="pat-stat-value">{reports.length}</div>
                    </div>
                    <div className="pat-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                  </div>
                  <div className="pat-stat-trend">
                    {unreadReports > 0 ? <>New: <span>{unreadReports} unread</span></> : reports[0] ? <>Latest: <span>{reports[0].testName}</span></> : 'No reports yet'}
                  </div>
                </div>

                <div className="pat-stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('myWallet')}>
                  <div className="pat-stat-top">
                    <div>
                      <div className="pat-stat-label">Remaining Balance</div>
                      <div className="pat-stat-value">{pkr(totalRemaining)}</div>
                    </div>
                    <div className="pat-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
                      </svg>
                    </div>
                  </div>
                  <div className="pat-stat-trend">
                    {nextDue ? <>Next due: <span>{fmtDate(nextDue)}</span></> : 'No pending installments'}
                  </div>
                </div>

                <div className="pat-stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('community')}>
                  <div className="pat-stat-top">
                    <div>
                      <div className="pat-stat-label">Community Support</div>
                      <div className="pat-stat-value" style={{ textTransform: 'capitalize' }}>{latestApp ? latestApp.status : '—'}</div>
                    </div>
                    <div className="pat-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                      </svg>
                    </div>
                  </div>
                  <div className="pat-stat-trend">
                    {latestApp ? <>Test: <span>{latestApp.testRequired}</span></> : cnicVerified ? 'Apply if you need help' : 'Requires verified CNIC'}
                  </div>
                </div>
              </div>

              {/* Two Column */}
              <div className="pat-two-col pat-fade-up pat-fade-up-3">
                {/* Recent Activity */}
                <div className="pat-card">
                  <div className="pat-card-header">
                    <div className="pat-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      Recent Activity
                    </div>
                    <div className="pat-card-action" style={{ cursor: 'pointer' }} onClick={() => navigate('notifications')}>
                      View all
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No activity yet.</div>
                  ) : notifications.slice(0, 4).map((n: any) => (
                    <div className="pat-activity-item" key={n._id}>
                      <div className="pat-activity-row1">
                        <div className="pat-activity-name">{n.title}</div>
                        {!n.read && <span className="pat-status-badge pat-pending"><span className="pat-status-dot"></span>New</span>}
                      </div>
                      <div className="pat-activity-type">{n.message}</div>
                      <div className="pat-activity-time">{timeAgo(n.createdAt)}</div>
                    </div>
                  ))}
                </div>

                {/* Recent Prescriptions */}
                <div className="pat-card">
                  <div className="pat-card-header">
                    <div className="pat-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                      </svg>
                      Recent Prescriptions
                    </div>
                    <div className="pat-card-action" onClick={() => navigate('bookTests')} style={{ cursor: 'pointer' }}>
                      Compare labs
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  <div className="pat-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Doctor</th>
                          <th>Date</th>
                          <th>Tests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prescriptions.length === 0
                          ? emptyRow(3, 'No prescriptions yet.')
                          : prescriptions.slice(0, 4).map((p: any) => (
                            <tr key={p._id}>
                              <td style={{ fontWeight: 600, color: 'var(--text)' }}>{drName(p.doctor?.name)}</td>
                              <td>{fmtDate(p.createdAt)}</td>
                              <td><span className="pat-type-tag pat-type-test">{(p.tests || []).map((t: any) => t.testName).join(', ')}</span></td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* ══ FIND DOCTORS ════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'findDoctors' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="pat-page-title">Find Doctors</div>
                  <div className="pat-page-title-rule"></div>
                  <div className="pat-page-subtitle">Browse verified specialists on CareFirst</div>
                </div>
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '20px 22px' }}>
                <div className="pat-search-input-wrap">
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input className="pat-form-input" type="text" placeholder="Search by doctor name or specialty…" value={doctorSearch} onChange={e => setDoctorSearch(e.target.value)} />
                </div>
              </div>

              {specialties.length > 1 && (
                <div className="pat-specialty-chips pat-fade-up pat-fade-up-2">
                  {specialties.map((s) => (
                    <button
                      key={s}
                      className={`pat-spec-chip ${activeSpecialty === s ? 'active' : ''}`}
                      onClick={() => setActiveSpecialty(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="pat-doctors-grid pat-fade-up pat-fade-up-3">
                {!loaded.doctors && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading doctors…</div>
                )}
                {loaded.doctors && filteredDoctors.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {doctors.length === 0 ? 'No doctors are registered yet.' : 'No doctors match your search.'}
                  </div>
                )}
                {filteredDoctors.map((doc) => (
                  <div className="pat-doctor-card" key={doc.doctorId}>
                    <div className="pat-doctor-card-header">
                      <div className="pat-doc-avatar">{(doc.name || 'D').replace(/^dr\.?\s*/i, '')[0]?.toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div className="pat-doc-name">{drName(doc.name)}</div>
                        <div className="pat-doc-spec">{doc.specialization}</div>
                      </div>
                      <div className="pat-doc-rating">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#d97706" stroke="none">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        {doc.rating > 0 ? doc.rating.toFixed(1) : 'New'}
                      </div>
                    </div>
                    <div className="pat-doc-divider"></div>
                    <div className="pat-doc-info-row">
                      <span className="pat-doc-exp">
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        {doc.experience} yrs experience
                      </span>
                      <span className="pat-doc-fee">{doc.consultationFee > 0 ? pkr(doc.consultationFee) : 'Fee not set'}</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '-4px 0 12px' }}>
                      {doc.availableDays.length ? `Available: ${doc.availableDays.map((d: string) => d.slice(0, 3)).join(', ')}` : 'Schedule not published yet'}
                    </div>
                    <button
                      className="pat-btn-primary pat-red"
                      style={{ width: '100%', justifyContent: 'center', opacity: 0.55, cursor: 'not-allowed' }}
                      disabled
                      title="Appointment booking is coming soon"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                        <line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>
                      </svg>
                      Booking coming soon
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* ══ BOOK TESTS ══════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'bookTests' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="pat-page-title">Book Tests</div>
                  <div className="pat-page-title-rule"></div>
                  <div className="pat-page-subtitle">Compare labs and book your prescribed tests at the best price</div>
                </div>
                <button
                  className={`pat-btn-ghost pat-fade-up pat-fade-up-1 ${showTrueCost ? 'pat-btn-primary' : ''}`}
                  style={showTrueCost ? { background: 'var(--text)', color: '#fff' } : {}}
                  onClick={() => setShowTrueCost(!showTrueCost)}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  True Cost Analysis
                </button>
              </div>

              {showTrueCost && (
                <div className="pat-true-cost-banner pat-fade-up">
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div className="pat-true-cost-text">
                    <strong>True Cost Analysis enabled.</strong> Prices shown include lab fees, collection charges, and any applicable taxes — no hidden costs.
                  </div>
                </div>
              )}

              <div className="pat-card pat-fade-up pat-fade-up-2" style={{ padding: '20px 22px', marginBottom: 24 }}>
                <div className="pat-search-input-wrap">
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input className="pat-form-input" type="text" placeholder="Search for a test (CBC, MRI, X-Ray…)" value={testSearch} onChange={e => setTestSearch(e.target.value)} />
                </div>
              </div>

              {prescribedTests.length > 0 && (
                <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.845rem', fontWeight: 600, color: 'var(--text)' }}>Prescribed Tests:</span>
                  {prescribedTests.map((t) => (
                    <span
                      key={t}
                      onClick={() => setTestSearch(t)}
                      title="Show labs offering this test"
                      style={{ cursor: 'pointer', padding: '4px 12px', background: testSearch === t ? 'var(--red)' : 'var(--red-light)', color: testSearch === t ? '#fff' : 'var(--red)', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, border: '1px solid var(--red-mid)' }}
                    >
                      {t}
                    </span>
                  ))}
                  {testSearch && (
                    <span onClick={() => setTestSearch('')} style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', textDecoration: 'underline' }}>Clear</span>
                  )}
                </div>
              )}

              <div className="pat-labs-grid pat-fade-up pat-fade-up-3">
                {!loaded.tests && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Loading labs…
                  </div>
                )}
                {loaded.tests && filteredLabs.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {allLabTests.length === 0 ? 'No labs have published tests yet.' : 'No tests match your search.'}
                  </div>
                )}
                {filteredLabs.map((lab: any) => (
                  <div className="pat-lab-card" key={lab.labId}>
                    <div className="pat-lab-card-header">
                      <div className="pat-lab-icon">
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="pat-lab-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {lab.labName}
                          {lab.isCharityPartner && (
                            <span style={{ fontSize: '0.65rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>Charity Partner</span>
                          )}
                        </div>
                        <div className="pat-lab-location">
                          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" style={{ marginRight: 3, verticalAlign: 'middle' }}>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                          {lab.location}
                        </div>
                      </div>
                    </div>

                    <div className="pat-lab-prices">
                      {lab.tests.map((t: any, ti: number) => (
                        <div key={t._id} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 0', borderBottom: ti < lab.tests.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.84rem' }}>{t.name}</span>
                            <span className="pat-price-val">{pkr(t.price)}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t.category}</span>
                            {t.installmentEnabled && (
                              <span style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>
                                {t.installmentCount} installments · every {t.installmentTenureDays} days · {pkr(Math.ceil(t.price / t.installmentCount))}/inst
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        className="pat-btn-primary pat-blue"
                        style={{ flex: 1, justifyContent: 'center', opacity: 0.55, cursor: 'not-allowed' }}
                        disabled
                        title="Lab test booking is coming soon"
                      >
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        Booking coming soon
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ══ MY REPORTS ══════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'myReports' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="pat-page-title">My Reports</div>
                  <div className="pat-page-title-rule"></div>
                  <div className="pat-page-subtitle">Lab test reports and your doctors' prescriptions</div>
                </div>
                <div className="pat-filter-row pat-fade-up pat-fade-up-1">
                  <select className="pat-filter-select" value={reportFilter} onChange={e => setReportFilter(e.target.value)}>
                    <option value="all">All Reports</option>
                    <option value="new">New</option>
                    <option value="viewed">Viewed</option>
                  </select>
                </div>
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-2">
                <div className="pat-card-header">
                  <div className="pat-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Test Reports
                  </div>
                </div>
                <div className="pat-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Report ID</th>
                        <th>Test</th>
                        <th>Lab</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!loaded.reports ? emptyRow(6, 'Loading reports…')
                        : filteredReports.length === 0 ? emptyRow(6, reports.length === 0 ? 'No reports yet. Labs upload your results here after your test.' : 'No reports match this filter.')
                        : filteredReports.map((r: any) => (
                        <tr key={r._id}>
                          <td className="pat-report-id">REP-{shortId(r._id)}</td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.testName}</div>
                            {r.notes && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.notes}</div>}
                          </td>
                          <td>{r.labName}</td>
                          <td>{fmtDate(r.createdAt)}</td>
                          <td>
                            <span className={`pat-report-status ${r.isRead ? 'pat-status-ready' : 'pat-status-processing'}`}>
                              {r.isRead ? 'Viewed' : 'New'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                              <a className="pat-action-btn" title="View report" href={r.reportUrl} target="_blank" rel="noreferrer" onClick={() => openReport(r)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                </svg>
                              </a>
                              <a className="pat-action-btn" title="Download report" href={r.reportUrl} target="_blank" rel="noreferrer" download onClick={() => openReport(r)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)' }}>
                                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-3">
                <div className="pat-card-header">
                  <div className="pat-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    My Prescriptions
                  </div>
                  {prescribedTests.length > 0 && (
                    <div className="pat-card-action" style={{ cursor: 'pointer' }} onClick={() => navigate('bookTests')}>
                      Compare labs
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  )}
                </div>
                <div className="pat-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Doctor</th>
                        <th>Date</th>
                        <th>Tests Prescribed</th>
                        <th>Doctor's Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!loaded.prescriptions ? emptyRow(4, 'Loading prescriptions…')
                        : prescriptions.length === 0 ? emptyRow(4, 'No prescriptions yet.')
                        : prescriptions.map((p: any) => (
                        <tr key={p._id}>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{drName(p.doctor?.name)}</div>
                            {p.doctorSpecialization && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.doctorSpecialization}</div>}
                          </td>
                          <td>{fmtDate(p.createdAt)}</td>
                          <td>
                            {(p.tests || []).map((t: any, i: number) => (
                              <div key={i} style={{ marginBottom: 2 }}>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.testName}</span>
                                {t.notes && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}> — {t.notes}</span>}
                              </div>
                            ))}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-sub)', maxWidth: 260 }}>{p.generalNotes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ MY WALLET ═══════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'myWallet' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">My Wallet</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Track your installment ledger — pay directly to the lab, upload receipt here for verification</div>
              </div>

              {banner(walletMsg)}

              {!loaded.wallets ? (
                <div className="pat-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading wallet…</div>
              ) : wallets.length === 0 ? (
                <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '36px 28px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No installment plans yet</div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto' }}>
                    Labs that allow installments show an "installments" tag on their tests in <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('bookTests')}>Book Tests</a>.
                    {!cnicVerified && ' Your CNIC must be verified before you can use an installment plan.'}
                  </div>
                </div>
              ) : wallet && (
                <>
                  {wallets.length > 1 && (
                    <div className="pat-specialty-chips pat-fade-up" style={{ marginBottom: 16 }}>
                      {wallets.map(w => (
                        <button key={w._id} className={`pat-spec-chip ${w._id === wallet._id ? 'active' : ''}`} onClick={() => { setSelectedWalletId(w._id); setWalletMsg(null); }}>
                          {w.testName} · {w.labName}
                        </button>
                      ))}
                    </div>
                  )}

                  {wallet.status === 'defaulter' && (
                    <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20, borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <div className="pat-true-cost-text">
                        <strong>This plan has been escalated to the legal team</strong> because of missed installments. Please contact CareFirst support.
                      </div>
                    </div>
                  )}

                  {/* Wallet Summary Strip */}
                  <div className="pat-wallet-summary pat-fade-up pat-fade-up-1">
                    <div className="pat-wallet-summary-inner">
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Test</div>
                        <div className="pat-ws-val" style={{ fontSize: '0.88rem', fontWeight: 700 }}>{wallet.testName}</div>
                        <div className="pat-ws-sub">{[wallet.labName, wallet.labLocation].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="pat-ws-divider"></div>
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Total Amount</div>
                        <div className="pat-ws-val">{pkr(wallet.totalAmount)}</div>
                      </div>
                      <div className="pat-ws-divider"></div>
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Down Payment</div>
                        <div className={`pat-ws-val ${wallet.downPayment?.adminVerified ? 'pat-ws-paid' : ''}`}>{pkr(wallet.downPayment?.amount)}</div>
                        <div className="pat-ws-sub">{wallet.downPayment?.adminVerified ? 'Verified ✓' : wallet.downPayment?.amount ? 'Awaiting verification' : '—'}</div>
                      </div>
                      <div className="pat-ws-divider"></div>
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Service Fee</div>
                        <div className={`pat-ws-val ${wallet.serviceFee?.adminVerified ? 'pat-ws-paid' : ''}`}>{pkr(wallet.serviceFee?.amount)}</div>
                        <div className="pat-ws-sub">{wallet.serviceFee?.adminVerified ? 'Verified ✓' : wallet.serviceFee?.amount ? 'Awaiting verification' : '—'}</div>
                      </div>
                      <div className="pat-ws-divider"></div>
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Remaining Balance</div>
                        <div className="pat-ws-val pat-ws-due">{pkr(wallet.remainingBalance ?? wallet.totalAmount)}</div>
                      </div>
                    </div>
                    <div className="pat-ws-progress-wrap">
                      <div className="pat-ws-progress-fill" style={{ width: `${walletPct}%` }}></div>
                    </div>
                    <div className="pat-ws-progress-labels">
                      <span>{walletPct}% paid</span>
                      <span>{pkr(wallet.remainingBalance ?? wallet.totalAmount)} remaining</span>
                    </div>
                  </div>

                  {/* Installment Schedule */}
                  <div className="pat-card pat-fade-up pat-fade-up-2">
                    <div className="pat-card-header">
                      <div className="pat-card-title">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        Installment Schedule
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pay lab directly · upload receipt · lab confirms · admin verifies</div>
                    </div>
                    <div className="pat-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Due Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Receipt</th>
                            <th>Verification</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(wallet.installments || []).length === 0 ? emptyRow(7, 'No installments scheduled yet.')
                            : wallet.installments.map((inst: any, idx: number) => {
                            const stage     = installmentStage(inst);
                            const key       = `${wallet._id}-${idx}`;
                            const canUpload = wallet.status === 'active' && !inst.labApproved && !inst.adminVerified && inst.status !== 'paid';
                            return (
                              <tr key={inst._id || idx}>
                                <td className="pat-report-id">#{inst.number}</td>
                                <td>{fmtDate(inst.dueDate)}</td>
                                <td style={{ fontWeight: 600 }}>{pkr(inst.amount)}</td>
                                <td>
                                  <span className={`pat-badge ${stage.cls}`}><span className="pat-badge-dot"></span>{stage.label}</span>
                                </td>
                                <td>
                                  {inst.receiptUrl
                                    ? <a href={inst.receiptUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600, fontSize: '0.78rem' }}>View ✓</a>
                                    : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>}
                                </td>
                                <td style={{ fontSize: '0.78rem', color: inst.adminVerified ? '#166534' : 'var(--text-muted)', fontWeight: inst.adminVerified ? 600 : 400 }}>
                                  {stage.verification}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {canUpload ? (
                                    <label className="pat-upload-receipt-btn" style={{ cursor: uploadingKey ? 'wait' : 'pointer', opacity: uploadingKey && uploadingKey !== key ? 0.5 : 1 }}>
                                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                      {uploadingKey === key ? 'Uploading…' : inst.receiptUrl ? 'Replace Receipt' : 'Upload Receipt'}
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        hidden
                                        disabled={Boolean(uploadingKey)}
                                        onChange={e => { uploadReceipt(wallet._id, idx, e.target.files?.[0]); e.target.value = ''; }}
                                      />
                                    </label>
                                  ) : (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{stage.label === 'Paid' ? 'Done' : '—'}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Receipt Log */}
                  <div className="pat-card pat-fade-up pat-fade-up-3">
                    <div className="pat-card-header">
                      <div className="pat-card-title">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        Receipt Log
                      </div>
                    </div>
                    <div className="pat-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Installment</th>
                            <th>Uploaded On</th>
                            <th>Amount</th>
                            <th>Receipt</th>
                            <th style={{ textAlign: 'right' }}>Verification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptLog.length === 0 ? emptyRow(5, 'No receipts uploaded yet.')
                            : receiptLog.map((inst: any) => (
                            <tr key={inst._id || inst.idx}>
                              <td style={{ fontWeight: 500, color: 'var(--text)' }}>Installment #{inst.number} — {wallet.testName}</td>
                              <td>{fmtDate(inst.receiptUploadedAt)}</td>
                              <td style={{ fontWeight: 600 }}>{pkr(inst.amount)}</td>
                              <td><a href={inst.receiptUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', fontWeight: 600 }}>View</a></td>
                              <td style={{ textAlign: 'right' }}>
                                {inst.adminVerified
                                  ? <span style={{ color: '#166534', fontWeight: 700, fontSize: '0.78rem' }}>Admin Verified ✓</span>
                                  : inst.labApproved
                                    ? <span style={{ color: '#854d0e', fontSize: '0.78rem' }}>Lab confirmed · awaiting admin</span>
                                    : <span style={{ color: '#854d0e', fontSize: '0.78rem' }}>Awaiting lab confirmation</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* ══ COMMUNITY SUPPORT ═══════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'community' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">Community Support</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Can't afford a test? Apply with supporting documents — if approved, a charity partner lab conducts it for you</div>
              </div>

              {cnicNotice}

              {cnicVerified && !hasPendingApp && (
                <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '22px 24px' }}>
                  <div className="pat-card-title" style={{ marginBottom: 16 }}>Apply for Support</div>
                  {banner(communityMsg)}
                  <form onSubmit={submitCommunityApplication}>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="testRequired">Test Required</label>
                      <input
                        id="testRequired"
                        className="pat-form-input"
                        type="text"
                        list="cf-test-names"
                        placeholder="e.g. MRI Brain"
                        value={testRequired}
                        onChange={e => setTestRequired(e.target.value)}
                        disabled={applying}
                      />
                      <datalist id="cf-test-names">
                        {[...new Set([...prescribedTests, ...allTestNames])].map(t => <option key={t} value={t} />)}
                      </datalist>
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="supportDocs">Supporting Documents</label>
                      <input
                        key={docsInputKey}
                        id="supportDocs"
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={e => selectSupportDocs(e.target.files)}
                        disabled={applying}
                        style={{ fontSize: '0.82rem' }}
                      />
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        Utility bills, bank statements or similar · up to {MAX_COMMUNITY_DOCS} files · PDF, JPG or PNG · max {MAX_FILE_MB} MB each
                        {supportDocs.length > 0 && <> · <strong>{supportDocs.length} selected</strong></>}
                      </div>
                    </div>
                    <button type="submit" className="pat-btn-primary pat-red" disabled={applying} style={applying ? { opacity: 0.6, cursor: 'wait' } : {}}>
                      {applying ? 'Submitting…' : 'Submit Application'}
                    </button>
                  </form>
                </div>
              )}

              {cnicVerified && hasPendingApp && (
                <>
                  {banner(communityMsg)}
                  <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20 }}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <div className="pat-true-cost-text"><strong>Your application is under review.</strong> You'll be notified once the admin decides. You can apply again after that.</div>
                  </div>
                </>
              )}

              <div className="pat-card pat-fade-up pat-fade-up-2">
                <div className="pat-card-header">
                  <div className="pat-card-title">My Applications</div>
                </div>
                <div className="pat-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>App ID</th>
                        <th>Applied</th>
                        <th>Test</th>
                        <th>Documents</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!loaded.community ? emptyRow(6, 'Loading applications…')
                        : communityApps.length === 0 ? emptyRow(6, 'You have not applied for community support.')
                        : communityApps.map((a: any) => (
                        <tr key={a._id}>
                          <td className="pat-report-id">APP-{shortId(a._id)}</td>
                          <td>{fmtDate(a.createdAt)}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{a.testRequired}</td>
                          <td>
                            {(a.documents || []).map((url: string, i: number) => (
                              <a key={i} href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', marginRight: 8 }}>Doc {i + 1}</a>
                            ))}
                          </td>
                          <td>
                            <span className={`pat-badge ${APP_STATUS[a.status] || 'pat-badge-amber'}`} style={{ textTransform: 'capitalize' }}>
                              <span className="pat-badge-dot"></span>{a.status}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-sub)', maxWidth: 280 }}>
                            {a.status === 'approved' && (
                              <>
                                <div><strong>Slip:</strong> {a.slip?.slipId || '—'}</div>
                                <div><strong>Lab:</strong> {[a.labName, a.labLocation].filter(Boolean).join(' · ')}</div>
                                <div>{a.testConducted ? `Test conducted on ${fmtDate(a.conductedAt)}` : 'Visit the lab with your Slip ID'}</div>
                              </>
                            )}
                            {a.status === 'rejected' && (a.rejectionReason || 'Not approved')}
                            {a.status === 'pending' && 'Awaiting admin review'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ NOTIFICATIONS ═══════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'notifications' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="pat-page-title">Notifications</div>
                  <div className="pat-page-title-rule"></div>
                  <div className="pat-page-subtitle">Stay updated on reports, prescriptions, and payments</div>
                </div>
                {unreadNotifs > 0 && (
                  <button className="pat-btn-ghost pat-fade-up pat-fade-up-1" onClick={markAllNotifsRead}>Mark all as read</button>
                )}
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-2">
                <div className="pat-notif-list">
                  {notifications.length === 0 ? (
                    <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No notifications yet.</div>
                  ) : notifications.map((n: any) => {
                    const v = notifVisual(n.type);
                    return (
                      <div
                        className={`pat-notif-item ${!n.read ? 'unread' : ''}`}
                        key={n._id}
                        onClick={() => markNotifRead(n)}
                        style={{ cursor: n.read ? 'default' : 'pointer' }}
                      >
                        <div className={`pat-notif-icon-wrap ${v.color}`}>
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                            {v.icon}
                          </svg>
                        </div>
                        <div className="pat-notif-body">
                          <div className="pat-notif-title">{n.title}</div>
                          <div className="pat-notif-desc">{n.message}</div>
                        </div>
                        <div className="pat-notif-meta">
                          <span className="pat-notif-time">{timeAgo(n.createdAt)}</span>
                          {!n.read && <span className="pat-unread-dot"></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ══ PROFILE ═════════════════════════════════════════ */}
            <section className={`pat-page-section ${currentPage === 'profile' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">Profile</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Your personal details and CNIC verification status</div>
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <span className={`pat-badge ${CNIC_STATUS[cnicStatus].badge}`}><span className="pat-badge-dot"></span>{CNIC_STATUS[cnicStatus].label}</span>
                  {cnicStatus === 'rejected' && profile?.cnicRejectionReason && (
                    <span style={{ fontSize: '0.78rem', color: '#991b1b' }}>{profile.cnicRejectionReason}</span>
                  )}
                  {cnicVerified && profile?.cnicReviewedAt && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Verified on {fmtDate(profile.cnicReviewedAt)}</span>
                  )}
                </div>

                {banner(profileMsg)}

                <form onSubmit={saveProfile}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 20px' }}>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-name">Full Name</label>
                      <input id="pf-name" className="pat-form-input" type="text" value={profileForm.name}
                        onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} disabled={savingProfile} />
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-email">Email</label>
                      <input id="pf-email" className="pat-form-input" type="email" value={me?.email || ''} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-phone">Phone</label>
                      <input id="pf-phone" className="pat-form-input" type="tel" placeholder="0300-1234567" value={profileForm.phone}
                        onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} disabled={savingProfile} />
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-cnic">CNIC</label>
                      <input id="pf-cnic" className="pat-form-input" type="text" inputMode="numeric" maxLength={15} placeholder="35202-1234567-8"
                        value={profileForm.cnic}
                        onChange={e => setProfileForm(p => ({ ...p, cnic: e.target.value }))}
                        disabled={savingProfile || cnicVerified}
                        style={cnicVerified ? { opacity: 0.6 } : {}} />
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        {cnicVerified ? 'Verified CNICs cannot be changed. Contact support if this is wrong.' : 'Changing your CNIC sends it back for admin verification.'}
                      </div>
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-city">City</label>
                      <input id="pf-city" className="pat-form-input" type="text" placeholder="e.g. Lahore" value={profileForm.city}
                        onChange={e => setProfileForm(p => ({ ...p, city: e.target.value }))} disabled={savingProfile} />
                    </div>
                    <div className="pat-form-section">
                      <label className="pat-form-label" htmlFor="pf-address">Address</label>
                      <input id="pf-address" className="pat-form-input" type="text" placeholder="House, street, area" value={profileForm.address}
                        onChange={e => setProfileForm(p => ({ ...p, address: e.target.value }))} disabled={savingProfile} />
                    </div>
                  </div>
                  <button type="submit" className="pat-btn-primary" disabled={savingProfile} style={savingProfile ? { opacity: 0.6, cursor: 'wait' } : {}}>
                    {savingProfile ? 'Saving…' : 'Save Changes'}
                  </button>
                </form>
              </div>
            </section>

          </div>{/* /pat-content */}
        </main>
      </div>
    </div>
  );
};

export default PatientDashboard;
