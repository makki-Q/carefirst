import React, { useState, useEffect } from 'react';
import './AdminDashboard.css';
import { api, getSession, clearSession } from '../lib/api';
import { getSocket } from '../lib/socket';

const ROLE_FILTERS = ['All', 'Patients', 'CNIC Review', 'Doctors', 'Labs', 'Lawyers'];

const CNIC_BADGE: Record<string, { cls: string; label: string }> = {
  verified:   { cls: 'dash-green', label: 'Verified' },
  unverified: { cls: 'dash-amber', label: 'Unverified' },
  rejected:   { cls: 'dash-red',   label: 'Rejected' },
};

const DONATION_LABS = [
  { name: 'LifeCare Diagnostics', location: 'Gulberg III, Lahore', bank: 'HBL — 0001-2345-678', jazz: '0300-1234567', easypaisa: '0333-1234567', charity: true },
  { name: 'MedLab Plus',          location: 'DHA Phase 5, Lahore', bank: 'MCB — 0002-3456-789', jazz: '0311-9876543', easypaisa: '—',           charity: true },
  { name: 'CityScan & Labs',       location: 'Johar Town, Lahore',  bank: 'UBL — 0003-4567-890', jazz: '0321-5556677', easypaisa: '0321-5556677', charity: false },
];

const DEFAULT_SETTINGS = {
  supportEmail: 'support@carefirst.pk',
};

const AdminDashboard = () => {
  // ── UI state ──────────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen]             = useState(true);
  const [currentPage, setCurrentPage]             = useState('dashboard');
  const [dateString, setDateString]               = useState('');
  const [roleFilter, setRoleFilter]               = useState('All');
  const [userSearch, setUserSearch]               = useState('');
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [settings, setSettings]                   = useState({ ...DEFAULT_SETTINGS });

  // ── Data state ────────────────────────────────────────────────────────────────
  const { user: sessionUser } = getSession();
  const [apiUsers, setApiUsers]               = useState<any[]>([]);
  const [communityApps, setCommunityApps]     = useState<any[]>([]);
  const [appStatusFilter, setAppStatusFilter] = useState('all');
  const [registrations, setRegistrations]     = useState<any[]>([]);
  const [allRegs, setAllRegs]                 = useState<any[]>([]);
  const [regStatusFilter, setRegStatusFilter] = useState<'pending' | 'active' | 'rejected'>('pending');
  const [rejectingId, setRejectingId]         = useState<string | null>(null);
  const [rejectReason, setRejectReason]       = useState('');
  const [notifications, setNotifications]     = useState<any[]>([]);
  const [notifBadge, setNotifBadge]           = useState(0);
  const [activeLabs, setActiveLabs]           = useState<any[]>([]);
  const [approvingApp, setApprovingApp]       = useState<string | null>(null);
  const [selectedLabId, setSelectedLabId]     = useState('');
  const [rejectingApp, setRejectingApp]       = useState<string | null>(null);
  const [appRejectReason, setAppRejectReason] = useState('');
  const [wallets, setWallets]                 = useState<any[]>([]);
  const [walletFilter, setWalletFilter]       = useState('all');
  const [defaulterCases, setDefaulterCases]   = useState<any[]>([]);
  const [cnicRejectingId, setCnicRejectingId] = useState<string | null>(null);
  const [cnicRejectReason, setCnicRejectReason] = useState('');

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const d = new Date();
    setDateString(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);

  useEffect(() => {
    api.get('/admin/users?limit=1000').then((d: any) => setApiUsers(d.users || [])).catch(() => {});

    Promise.all([
      api.get('/admin/registrations?status=pending'),
      api.get('/admin/registrations?status=active'),
      api.get('/admin/registrations?status=rejected'),
    ]).then(([p, a, r]) => {
      setRegistrations(Array.isArray(p) ? p : []);
      setAllRegs([
        ...(Array.isArray(p) ? p : []),
        ...(Array.isArray(a) ? a : []),
        ...(Array.isArray(r) ? r : []),
      ]);
    }).catch(() => {});

    api.get('/admin/community-applications').then((d: any) => setCommunityApps(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/admin/users?role=lab&status=active').then((d: any) => setActiveLabs(d.users || [])).catch(() => {});
    api.get('/admin/wallets').then((d: any) => setWallets(d.wallets || [])).catch(() => {});
    api.get('/admin/defaulter-cases').then((d: any) => setDefaulterCases(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/admin/notifications').then((d: any) => {
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
      if (n.type === 'community_submitted') {
        api.get('/admin/community-applications').then((d: any) => setCommunityApps(Array.isArray(d) ? d : [])).catch(() => {});
      }
    });
    return () => { socket.off('notification:new'); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const signOut = () => { clearSession(); window.location.href = '/login'; };

  const markNotifRead = async (id: string) => {
    try {
      await api.put(`/admin/notifications/${id}/read`, {});
      setNotifications(prev => prev.map((n: any) => n._id === id ? { ...n, read: true } : n));
      setNotifBadge(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const approveReg = async (userId: string) => {
    try {
      await api.put(`/admin/registrations/${userId}/approve`, {});
      setRegistrations(prev => prev.filter((u: any) => u._id !== userId));
      setAllRegs(prev => prev.map((u: any) => u._id === userId ? { ...u, status: 'active' } : u));
      setApiUsers(prev => prev.map((u: any) => u._id === userId ? { ...u, status: 'active' } : u));
    } catch (err: any) { alert(err.message || 'Approval failed'); }
  };

  const rejectReg = async () => {
    if (!rejectingId) return;
    try {
      await api.put(`/admin/registrations/${rejectingId}/reject`, { reason: rejectReason.trim() || 'Your registration could not be approved.' });
      setRegistrations(prev => prev.filter((u: any) => u._id !== rejectingId));
      setAllRegs(prev => prev.map((u: any) => u._id === rejectingId ? { ...u, status: 'rejected' } : u));
      setApiUsers(prev => prev.map((u: any) => u._id === rejectingId ? { ...u, status: 'rejected' } : u));
      setRejectingId(null); setRejectReason('');
    } catch (err: any) { alert(err.message || 'Rejection failed'); }
  };

  const suspendUser = async (id: string) => {
    if (!window.confirm('Suspend this user? They will be unable to log in.')) return;
    try {
      await api.put(`/admin/users/${id}/suspend`, {});
      setApiUsers(prev => prev.map((u: any) => u._id === id ? { ...u, status: 'suspended' } : u));
    } catch (err: any) { alert(err.message || 'Failed'); }
  };

  const activateUser = async (id: string) => {
    try {
      await api.put(`/admin/users/${id}/activate`, {});
      setApiUsers(prev => prev.map((u: any) => u._id === id ? { ...u, status: 'active' } : u));
    } catch (err: any) { alert(err.message || 'Failed'); }
  };

  const verifyCnic = async (userId: string) => {
    if (!window.confirm('Mark this patient\'s CNIC as verified?')) return;
    try {
      const d: any = await api.put(`/admin/patients/${userId}/cnic/verify`, {});
      setApiUsers(prev => prev.map((u: any) => u._id === userId ? { ...u, profile: d.profile } : u));
    } catch (err: any) { alert(err.message || 'Verification failed'); }
  };

  const rejectCnic = async () => {
    if (!cnicRejectingId) return;
    try {
      const d: any = await api.put(`/admin/patients/${cnicRejectingId}/cnic/reject`, { reason: cnicRejectReason.trim() });
      setApiUsers(prev => prev.map((u: any) => u._id === cnicRejectingId ? { ...u, profile: d.profile } : u));
      setCnicRejectingId(null); setCnicRejectReason('');
    } catch (err: any) { alert(err.message || 'Rejection failed'); }
  };

  const approveCommunity = async (appId: string) => {
    if (!selectedLabId) { alert('Please select a lab first.'); return; }
    try {
      await api.put(`/admin/community-applications/${appId}/approve`, { assignedLabId: selectedLabId });
      setCommunityApps(prev => prev.map((a: any) => a._id === appId
        ? { ...a, status: 'approved', assignedLab: activeLabs.find((l: any) => l._id === selectedLabId) }
        : a
      ));
      setApprovingApp(null); setSelectedLabId('');
    } catch (err: any) { alert(err.message || 'Approval failed'); }
  };

  const rejectCommunity = async (appId: string) => {
    try {
      await api.put(`/admin/community-applications/${appId}/reject`, { reason: appRejectReason.trim() || 'Application rejected.' });
      setCommunityApps(prev => prev.map((a: any) => a._id === appId ? { ...a, status: 'rejected' } : a));
      setRejectingApp(null); setAppRejectReason('');
    } catch (err: any) { alert(err.message || 'Rejection failed'); }
  };

  const adminVerifyInstallment = async (walletId: string, instIndex: number) => {
    if (!window.confirm('Verify this installment payment? This marks it as fully paid.')) return;
    try {
      await api.put(`/admin/wallets/${walletId}/installments/${instIndex}/verify`, {});
      setWallets(prev => prev.map((w: any) => {
        if (w._id !== walletId) return w;
        return {
          ...w,
          installments: w.installments.map((inst: any, i: number) =>
            i === instIndex ? { ...inst, adminVerified: true, adminVerifiedAt: new Date(), status: 'paid' } : inst
          ),
        };
      }));
    } catch (err: any) { alert(err.message || 'Verification failed'); }
  };

  // ── Navigation ────────────────────────────────────────────────────────────────
  const navigate = (page: string) => { setCurrentPage(page); setShowNotifDropdown(false); };

  const breadcrumbs: Record<string, string> = {
    dashboard:     'Dashboard',
    registrations: 'Registrations',
    users:         'Manage Users',
    donations:     'Community Support',
    reports:       'Platform Reports',
    settings:      'Settings',
    wallets:       'Wallet Management',
    defaulters:    'Defaulter Cases',
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const statusClass = (s: string) => ({ active: 'dash-green', pending: 'dash-amber', rejected: 'dash-red', suspended: 'dash-gray' }[s] || 'dash-gray');
  const statusLabel = (s: string) => ({ active: 'Active', pending: 'Pending', rejected: 'Rejected', suspended: 'Suspended' }[s] || s);
  const appStatusClass = (s: string) => ({ pending: 'dash-amber', approved: 'dash-green', rejected: 'dash-red' }[s] || 'dash-amber');

  const profileDetail = (u: any) => {
    if (u.role === 'lab')    return `${u.profile?.labName || '—'}${u.profile?.location ? ' · ' + u.profile.location : ''}`;
    if (u.role === 'doctor') return `${u.profile?.specialization || '—'}${u.profile?.experience ? ' · ' + u.profile.experience + ' yrs exp' : ''}`;
    if (u.role === 'lawyer') return `Bar No: ${u.profile?.barNumber || '—'}`;
    return '—';
  };

  const roleTag = (role: string) => {
    const map: Record<string, string> = { patient: 'adm-role-patient', doctor: 'adm-role-doctor', lab: 'adm-role-lab', lawyer: 'adm-role-lawyer' };
    return map[role] || '';
  };

  // ── Derived values ────────────────────────────────────────────────────────────
  const byRole = roleFilter === 'All' ? apiUsers : apiUsers.filter((u: any) => {
    if (roleFilter === 'Patients') return u.role === 'patient';
    if (roleFilter === 'CNIC Review') return u.role === 'patient' && u.profile?.cnicStatus === 'unverified';
    if (roleFilter === 'Doctors')  return u.role === 'doctor';
    if (roleFilter === 'Labs')     return u.role === 'lab';
    if (roleFilter === 'Lawyers')  return u.role === 'lawyer';
    return true;
  });
  const filteredUsers = !userSearch ? byRole : byRole.filter((u: any) =>
    u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  const pendingCnicCount = apiUsers.filter((u: any) => u.role === 'patient' && u.profile?.cnicStatus === 'unverified').length;

  const filteredCommunityApps = appStatusFilter === 'all'
    ? communityApps
    : communityApps.filter((a: any) => a.status === appStatusFilter);

  // Installments where patient uploaded, lab approved, admin hasn't verified yet
  const pendingVerifications: Array<{ wallet: any; inst: any; instIndex: number }> = [];
  wallets.forEach((w: any) => {
    (w.installments || []).forEach((inst: any, i: number) => {
      if (inst.receiptUrl && inst.labApproved && !inst.adminVerified) {
        pendingVerifications.push({ wallet: w, inst, instIndex: i });
      }
    });
  });

  const filteredWallets = walletFilter === 'all'
    ? wallets
    : walletFilter === 'needs_verify'
      ? wallets.filter((w: any) => w.installments?.some((inst: any) => inst.receiptUrl && inst.labApproved && !inst.adminVerified))
      : wallets.filter((w: any) => w.status === walletFilter);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="admin-dashboard-wrapper">
      <div className="dash-shell">

        {/* ─── SIDEBAR ─────────────────────────────────────── */}
        <aside className={`dash-sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
          <div className="dash-sidebar-logo">
            <div className="dash-logo-mark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <span className="dash-logo-name">carefirst</span>
          </div>

          <div className="dash-sidebar-user">
            <div className="dash-avatar">{((sessionUser as any)?.name || 'A')[0].toUpperCase()}</div>
            <div>
              <div className="dash-user-name">{(sessionUser as any)?.name || 'Administrator'}</div>
              <div className="dash-user-role">Super Administrator</div>
            </div>
          </div>

          <nav className="dash-sidebar-nav">
            <div className="dash-nav-label">Platform</div>

            <button className={`dash-nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('dashboard')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </button>

            <button className={`dash-nav-item ${currentPage === 'registrations' ? 'active' : ''}`} onClick={() => navigate('registrations')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              Registrations
              {registrations.length > 0 && <span className="dash-nav-badge">{registrations.length}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'users' ? 'active' : ''}`} onClick={() => navigate('users')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Manage Users
              {pendingCnicCount > 0 && <span className="dash-nav-badge" title="Patient CNICs awaiting verification">{pendingCnicCount}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'donations' ? 'active' : ''}`} onClick={() => navigate('donations')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              Community Support
            </button>

            <button className={`dash-nav-item ${currentPage === 'wallets' ? 'active' : ''}`} onClick={() => navigate('wallets')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
              Wallet Management
              {pendingVerifications.length > 0 && <span className="dash-nav-badge">{pendingVerifications.length}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'defaulters' ? 'active' : ''}`} onClick={() => navigate('defaulters')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Defaulter Cases
              {defaulterCases.length > 0 && <span className="dash-nav-badge">{defaulterCases.length}</span>}
            </button>

            <button className={`dash-nav-item ${currentPage === 'reports' ? 'active' : ''}`} onClick={() => navigate('reports')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Platform Reports
            </button>

            <div className="dash-nav-label">Configuration</div>

            <button className={`dash-nav-item ${currentPage === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
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
                <input
                  className="dash-search-input"
                  type="text"
                  placeholder="Search users…"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  onFocus={() => navigate('users')}
                />
              </div>

              {/* Notification bell with dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  className="dash-icon-btn"
                  onClick={() => setShowNotifDropdown(v => !v)}
                  style={{ position: 'relative' }}
                >
                  <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {notifBadge > 0 && (
                    <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: '#e11d48', color: '#fff', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                      {notifBadge}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowNotifDropdown(false)} />
                    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 360, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 100, overflow: 'hidden' }}>
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)' }}>Notifications</span>
                        {notifBadge > 0 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{notifBadge} unread</span>}
                      </div>
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        {notifications.length === 0 ? (
                          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No notifications yet.</div>
                        ) : notifications.slice(0, 20).map((n: any) => (
                          <div
                            key={n._id}
                            onClick={() => { if (!n.read) markNotifRead(n._id); }}
                            style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', cursor: n.read ? 'default' : 'pointer', background: n.read ? 'transparent' : 'var(--glass-bg)' }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 2 }}>{n.title}</div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', marginBottom: 3 }}>{n.message}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {new Date(n.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {!n.read && <span style={{ marginLeft: 8, color: '#e11d48', fontWeight: 700 }}>● unread</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="dash-date-chip">{dateString}</div>
            </div>
          </header>

          <div className="dash-content">

            {/* ══ DASHBOARD ════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'dashboard' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Platform Overview</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">CareFirst health platform real-time admin view for {dateString}</div>
              </div>

              <div className="dash-hero-card dash-fu dash-fu-1">
                <div className="dash-hero-inner">
                  <div className="dash-hero-left">
                    <div className="dash-hero-eyebrow">Admin Dashboard</div>
                    <div className="dash-hero-name">CareFirst Platform</div>
                    <div className="dash-hero-sub">Healthcare management system · All roles active</div>
                    <div className="dash-hero-pills">
                     
                      <div className="dash-hero-pill accent">{registrations.length} Pending Reviews</div>
                      <div className="dash-hero-pill green">All Systems Operational</div>
                    </div>
                  </div>
                  <div className="dash-hero-stats">
                    <div className="dash-hero-stat"><div className="val">8,240</div><div className="lbl">Total Users</div></div>
                    <div className="dash-hero-divider"></div>
                    <div className="dash-hero-stat"><div className="val">99.9%</div><div className="lbl">Uptime</div></div>
                    <div className="dash-hero-divider"></div>
                    <div className="dash-hero-stat"><div className="val">342</div><div className="lbl">Active Today</div></div>
                  </div>
                </div>
              </div>

              <div className="dash-stats-grid dash-fu dash-fu-2">
                {[
                  { label: 'Total Users',      value: apiUsers.length || '—', icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>, trend: 'All registered platform members' },
                  { label: 'Platform Revenue', value: 'PKR 2.1M',              icon: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,                                                                                    trend: '+22% vs last month' },
                  { label: 'Community Cases',  value: `${communityApps.filter(a => a.status === 'pending').length} Pending`, icon: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>, trend: `${communityApps.length} total applications` },
                  { label: 'Pending Receipts', value: pendingVerifications.length, icon: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></>,                                                                                                            trend: 'Awaiting admin verification' },
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
                    <div className="dash-stat-trend">
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      <span>{s.trend}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="dash-two-col dash-fu dash-fu-3">
                <div className="dash-card">
                  <div className="dash-card-header">
                    <div className="dash-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      Recent Registrations
                    </div>
                    <div className="dash-card-action" style={{ cursor: 'pointer' }} onClick={() => navigate('registrations')}>
                      View all <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  {registrations.length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No pending registrations.</div>
                  ) : registrations.slice(0, 4).map((u: any, i: number) => (
                    <div className="dash-list-item" key={i} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                      <div className="dash-list-row1">
                        <div className="dash-list-name">{u.name}</div>
                        <span className={`dash-badge ${statusClass(u.status)}`}><span className="dash-badge-dot"></span>{statusLabel(u.status)}</span>
                      </div>
                      <div className="dash-list-sub" style={{ marginBottom: 2 }}>
                        <span className={`adm-role-tag ${roleTag(u.role)}`}>{u.role}</span> · {profileDetail(u)}
                      </div>
                      {u.status === 'pending' && rejectingId !== u._id && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="adm-approve-btn" onClick={() => approveReg(u._id)}>
                            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                            Approve
                          </button>
                          <button className="adm-reject-btn" onClick={() => { setRejectingId(u._id); setRejectReason(''); }}>
                            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            Reject
                          </button>
                        </div>
                      )}
                      {rejectingId === u._id && (
                        <div className="adm-reject-reason-row" style={{ flexWrap: 'wrap' }}>
                          <input
                            className="adm-reject-reason-input"
                            type="text"
                            placeholder="Rejection reason…"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && rejectReg()}
                            autoFocus
                          />
                          <button className="adm-reject-btn" onClick={rejectReg}>Confirm</button>
                          <button className="dash-btn-ghost" style={{ padding: '4px 8px', fontSize: '0.72rem' }} onClick={() => setRejectingId(null)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="dash-card">
                  <div className="dash-card-header">
                    <div className="dash-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      System Activity Log
                    </div>
                  </div>
                  {[
                    { color: '#7c3aed', msg: <><strong>Noor Fatima</strong> registered as a patient</>,            time: '2 min ago' },
                    { color: '#166534', msg: <><strong>REP-089</strong> uploaded by LifeCare Diagnostics</>,      time: '14 min ago' },
                    { color: '#854d0e', msg: <><strong>APP-035</strong> donation application submitted</>,        time: '32 min ago' },
                    { color: '#1e40af', msg: <><strong>Dr. Sarah Malik</strong> updated availability</>,          time: '1 hr ago' },
                    { color: '#7c3aed', msg: <><strong>MedLab Plus</strong> profile sent for review</>,           time: '2 hrs ago' },
                    { color: '#991b1b', msg: <><strong>APP-034</strong> funding application rejected</>,          time: '3 hrs ago' },
                    { color: '#166534', msg: <><strong>Omar Farooq</strong> account verified</>,                  time: '4 hrs ago' },
                  ].map((l, i) => (
                    <div className="adm-log-item" key={i}>
                      <div className="adm-log-dot" style={{ background: l.color }}></div>
                      <div className="adm-log-body">{l.msg}</div>
                      <div className="adm-log-time">{l.time}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ══ REGISTRATIONS ════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'registrations' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Registrations</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">Review and approve or reject doctor, lab, and lawyer registration requests</div>
                </div>
              </div>

              <div className="dash-stats-grid dash-fu dash-fu-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {[
                  { label: 'Pending Review', value: allRegs.filter(u => u.status === 'pending').length,   cls: 'dash-amber', filter: 'pending',   icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
                  { label: 'Approved',        value: allRegs.filter(u => u.status === 'active').length,    cls: 'dash-green', filter: 'active',    icon: <><polyline points="20 6 9 17 4 12"/></> },
                  { label: 'Rejected',        value: allRegs.filter(u => u.status === 'rejected').length,  cls: 'dash-red',   filter: 'rejected',  icon: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> },
                ].map((s, i) => (
                  <div className="dash-stat-card" key={i} style={{ cursor: 'pointer' }} onClick={() => setRegStatusFilter(s.filter as any)}>
                    <div className="dash-stat-top">
                      <div>
                        <div className="dash-stat-label">{s.label}</div>
                        <div className="dash-stat-value">{s.value}</div>
                      </div>
                      <div className="dash-stat-icon">
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">{s.icon}</svg>
                      </div>
                    </div>
                    <div className="dash-stat-trend"><span>Click to filter</span></div>
                  </div>
                ))}
              </div>

              <div className="dash-chip-row dash-fu dash-fu-2">
                {(['pending', 'active', 'rejected'] as const).map((f) => (
                  <button key={f} className={`dash-chip ${regStatusFilter === f ? 'active' : ''}`} onClick={() => setRegStatusFilter(f)}>
                    {f === 'pending' ? 'Pending' : f === 'active' ? 'Approved' : 'Rejected'}
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>({allRegs.filter(u => u.status === f).length})</span>
                  </button>
                ))}
              </div>

              <div className="dash-card dash-fu dash-fu-3">
                {allRegs.filter(u => u.status === regStatusFilter).length === 0 ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No {regStatusFilter === 'active' ? 'approved' : regStatusFilter} registrations.
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Applicant</th><th>Role</th><th>Email</th><th>Profile Details</th><th>Applied</th><th>Status</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allRegs.filter((u: any) => u.status === regStatusFilter).map((u: any) => (
                          <React.Fragment key={u._id}>
                            <tr>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--glass-bg-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0, border: '1px solid var(--border)' }}>
                                    {u.name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.85rem' }}>{u.name}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.phone || '—'}</div>
                                  </div>
                                </div>
                              </td>
                              <td><span className={`adm-role-tag ${roleTag(u.role)}`}>{u.role}</span></td>
                              <td style={{ fontSize: '0.82rem' }}>{u.email}</td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text-sub)', maxWidth: 180 }}>{profileDetail(u)}</td>
                              <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                              <td><span className={`dash-badge ${statusClass(u.status)}`}><span className="dash-badge-dot"></span>{statusLabel(u.status)}</span></td>
                              <td style={{ textAlign: 'right' }}>
                                {u.status === 'pending' ? (
                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button className="adm-approve-btn" onClick={() => approveReg(u._id)}>
                                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                                      Approve
                                    </button>
                                    <button className="adm-reject-btn" onClick={() => { setRejectingId(u._id); setRejectReason(''); }}>
                                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                            </tr>
                            {rejectingId === u._id && (
                              <tr>
                                <td colSpan={7} style={{ background: 'var(--glass-bg)', padding: '12px 20px' }}>
                                  <div className="adm-reject-reason-row">
                                    <svg width="15" height="15" fill="none" stroke="#991b1b" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#991b1b', flexShrink: 0 }}>Rejection reason for {u.name}:</span>
                                    <input
                                      className="adm-reject-reason-input"
                                      type="text"
                                      placeholder="Enter reason (sent to user via notification)…"
                                      value={rejectReason}
                                      onChange={e => setRejectReason(e.target.value)}
                                      onKeyDown={e => e.key === 'Enter' && rejectReg()}
                                      autoFocus
                                    />
                                    <button className="adm-reject-btn" style={{ flexShrink: 0 }} onClick={rejectReg}>Confirm Reject</button>
                                    <button className="dash-btn-ghost" style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setRejectingId(null)}>Cancel</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* ══ MANAGE USERS ══════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'users' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Manage Users</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">View, verify, and manage all platform accounts</div>
                </div>
              </div>

              <div className="dash-chip-row dash-fu dash-fu-1">
                {ROLE_FILTERS.map((f) => (
                  <button key={f} className={`dash-chip ${roleFilter === f ? 'active' : ''}`} onClick={() => setRoleFilter(f)}>
                    {f}
                    {f === 'CNIC Review' && pendingCnicCount > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>({pendingCnicCount})</span>}
                  </button>
                ))}
              </div>

              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-table-wrap">
                  <table>
                    <thead>
                      <tr><th>User ID</th><th>Name</th><th>Role</th><th>Email</th><th>CNIC</th><th>Joined</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {userSearch ? `No users matching "${userSearch}"` : 'No users found.'}
                        </td></tr>
                      ) : filteredUsers.map((u: any) => {
                        const cnicStatus = u.role === 'patient' ? (u.profile?.cnicStatus || 'unverified') : null;
                        return (
                        <React.Fragment key={u._id}>
                        <tr>
                          <td className="dash-mono">{u._id?.toString().slice(-6).toUpperCase()}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</td>
                          <td><span className={`adm-role-tag ${roleTag(u.role)}`}>{u.role}</span></td>
                          <td>{u.email}</td>
                          <td>
                            {cnicStatus ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <span className="dash-mono" style={{ fontSize: '0.78rem' }}>{u.profile?.cnic || '—'}</span>
                                <span className={`dash-badge ${CNIC_BADGE[cnicStatus].cls}`} style={{ alignSelf: 'flex-start' }}>
                                  <span className="dash-badge-dot"></span>{CNIC_BADGE[cnicStatus].label}
                                </span>
                              </div>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td><span className={`dash-badge ${statusClass(u.status)}`}><span className="dash-badge-dot"></span>{statusLabel(u.status)}</span></td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                              {cnicStatus && cnicStatus !== 'verified' && u.profile && (
                                <>
                                  <button className="adm-approve-btn" style={{ fontSize: '0.68rem', padding: '4px 10px' }} onClick={() => verifyCnic(u._id)}>Verify CNIC</button>
                                  {cnicStatus === 'unverified' && (
                                    <button className="adm-reject-btn" style={{ fontSize: '0.68rem', padding: '4px 10px' }} onClick={() => { setCnicRejectingId(u._id); setCnicRejectReason(''); }}>Reject CNIC</button>
                                  )}
                                </>
                              )}
                              {u.status === 'active' ? (
                                <button className="adm-reject-btn" style={{ fontSize: '0.68rem', padding: '4px 10px' }} onClick={() => suspendUser(u._id)}>Suspend</button>
                              ) : u.status === 'suspended' ? (
                                <button className="adm-approve-btn" style={{ fontSize: '0.68rem', padding: '4px 10px' }} onClick={() => activateUser(u._id)}>Activate</button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {cnicRejectingId === u._id && (
                          <tr>
                            <td colSpan={8} style={{ background: 'var(--glass-bg)', padding: '12px 20px' }}>
                              <div className="adm-reject-reason-row">
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#991b1b', flexShrink: 0 }}>Why can't {u.name}'s CNIC be verified?</span>
                                <input
                                  className="adm-reject-reason-input"
                                  type="text"
                                  placeholder="e.g. CNIC number does not match the name provided"
                                  value={cnicRejectReason}
                                  onChange={e => setCnicRejectReason(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && rejectCnic()}
                                  autoFocus
                                />
                                <button className="adm-reject-btn" style={{ flexShrink: 0 }} onClick={rejectCnic}>Confirm Reject</button>
                                <button className="dash-btn-ghost" style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setCnicRejectingId(null)}>Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ COMMUNITY SUPPORT ════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'donations' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Community Support</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Review needy patient applications and view partner lab donation channels</div>
              </div>

              <div className="dash-card dash-fu dash-fu-1">
                <div className="dash-card-header">
                  <div className="dash-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    Community Support Applications
                  </div>
                  <div className="dash-filter-row">
                    <select
                      className="dash-filter-select"
                      style={{ height: 30 }}
                      value={appStatusFilter}
                      onChange={e => setAppStatusFilter(e.target.value)}
                    >
                      <option value="all">All Applications</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                <div className="dash-table-wrap">
                  <table>
                    <thead>
                      <tr><th>App ID</th><th>Patient</th><th>Test Required</th><th>Assigned Lab</th><th>Docs</th><th>Status</th><th style={{ textAlign: 'right' }}>Decision</th></tr>
                    </thead>
                    <tbody>
                      {filteredCommunityApps.length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No applications found.</td></tr>
                      ) : filteredCommunityApps.map((a: any, i: number) => (
                        <React.Fragment key={i}>
                          <tr>
                            <td className="dash-mono">{a._id?.toString().slice(-6).toUpperCase()}</td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{a.patient?.name || '—'}</div>
                              {a.patient?.cnic && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  CNIC {a.patient.cnic}{a.patient.cnicStatus === 'verified' ? ' ✓' : ` (${a.patient.cnicStatus})`}
                                </div>
                              )}
                            </td>
                            <td>{a.testRequired || '—'}</td>
                            <td style={{ color: 'var(--text-sub)' }}>{a.assignedLab?.name || a.assignedLab?.profile?.labName || '—'}</td>
                            <td>
                              {(a.documents || []).length === 0 ? '—' : a.documents.map((url: string, di: number) => (
                                <a key={di} href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, marginRight: 8, textDecoration: 'none' }}>
                                  Doc {di + 1}
                                </a>
                              ))}
                            </td>
                            <td><span className={`dash-badge ${appStatusClass(a.status)}`}><span className="dash-badge-dot"></span>{a.status}</span></td>
                            <td style={{ textAlign: 'right' }}>
                              {a.status === 'pending' ? (
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <button className="adm-approve-btn" onClick={() => { setApprovingApp(a._id); setRejectingApp(null); setSelectedLabId(''); }}>
                                    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                                    Approve
                                  </button>
                                  <button className="adm-reject-btn" onClick={() => { setRejectingApp(a._id); setApprovingApp(null); setAppRejectReason(''); }}>
                                    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Decision made</span>
                              )}
                            </td>
                          </tr>
                          {approvingApp === a._id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--glass-bg)', padding: '12px 20px' }}>
                                <div className="adm-reject-reason-row">
                                  <svg width="15" height="15" fill="none" stroke="#166534" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#166534', flexShrink: 0 }}>Assign Lab for {a.patient?.name}:</span>
                                  <select className="adm-reject-reason-input" style={{ border: '1px solid #86efac', background: '#f0fdf4' }} value={selectedLabId} onChange={e => setSelectedLabId(e.target.value)}>
                                    <option value="">Select active lab…</option>
                                    {activeLabs.map((lab: any) => (
                                      <option key={lab._id} value={lab._id}>{lab.profile?.labName || lab.name}</option>
                                    ))}
                                  </select>
                                  <button className="adm-approve-btn" style={{ flexShrink: 0 }} onClick={() => approveCommunity(a._id)}>Confirm Approve</button>
                                  <button className="dash-btn-ghost" style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setApprovingApp(null)}>Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {rejectingApp === a._id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--glass-bg)', padding: '12px 20px' }}>
                                <div className="adm-reject-reason-row">
                                  <svg width="15" height="15" fill="none" stroke="#991b1b" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#991b1b', flexShrink: 0 }}>Rejection reason:</span>
                                  <input className="adm-reject-reason-input" type="text" placeholder="Enter reason…" value={appRejectReason} onChange={e => setAppRejectReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && rejectCommunity(a._id)} autoFocus />
                                  <button className="adm-reject-btn" style={{ flexShrink: 0 }} onClick={() => rejectCommunity(a._id)}>Confirm Reject</button>
                                  <button className="dash-btn-ghost" style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setRejectingApp(null)}>Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="dash-fu dash-fu-2">
                <div className="dash-card-header" style={{ paddingLeft: 0, marginBottom: 14 }}>
                  <div className="dash-card-title" style={{ fontSize: '0.9rem' }}>
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    Partner Labs — Donation Channels
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Patients donate directly to labs. Platform does not process or track donations.</div>
                </div>
                <div className="adm-donation-labs-grid">
                  {DONATION_LABS.map((lab, i) => (
                    <div className="adm-donation-lab-card" key={i}>
                      <div className="adm-dl-header">
                        <div className="adm-dl-name">{lab.name}</div>
                        {lab.charity && <span className="dash-badge dash-green"><span className="dash-badge-dot"></span>Charity Partner</span>}
                      </div>
                      <div className="adm-dl-location">
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {lab.location}
                      </div>
                      <div className="adm-dl-channels">
                        <div className="adm-dl-channel"><span className="adm-dl-ch-label">Bank Transfer</span><span className="adm-dl-ch-val">{lab.bank}</span></div>
                        <div className="adm-dl-channel"><span className="adm-dl-ch-label">JazzCash</span><span className="adm-dl-ch-val">{lab.jazz}</span></div>
                        <div className="adm-dl-channel"><span className="adm-dl-ch-label">EasyPaisa</span><span className="adm-dl-ch-val">{lab.easypaisa}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ══ WALLET MANAGEMENT ════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'wallets' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Wallet Management</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Verify patient installment payments after lab confirmation — final step in the receipt flow</div>
              </div>

              {/* Pending verifications — action-first */}
              <div className="dash-card dash-fu dash-fu-1">
                <div className="dash-card-header">
                  <div className="dash-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Receipts Awaiting Admin Verification
                    {pendingVerifications.length > 0 && (
                      <span style={{ marginLeft: 8, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 10, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {pendingVerifications.length} pending
                      </span>
                    )}
                  </div>
                </div>
                {pendingVerifications.length === 0 ? (
                  <div style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No receipts awaiting verification. Lab must confirm receipt before admin can verify.
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table>
                      <thead>
                        <tr><th>Patient</th><th>Lab</th><th>Test</th><th>Inst #</th><th>Amount</th><th>Lab Confirmed</th><th>Receipt</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                      </thead>
                      <tbody>
                        {pendingVerifications.map(({ wallet, inst, instIndex }, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{wallet.patient?.name || '—'}</td>
                            <td style={{ color: 'var(--text-sub)' }}>{wallet.lab?.name || '—'}</td>
                            <td>{wallet.testName || '—'}</td>
                            <td className="dash-mono">#{inst.number}</td>
                            <td style={{ fontWeight: 600 }}>PKR {inst.amount?.toLocaleString()}</td>
                            <td>
                              <span style={{ color: '#166534', fontWeight: 600, fontSize: '0.78rem' }}>
                                {inst.labApprovedAt ? new Date(inst.labApprovedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Confirmed ✓'}
                              </span>
                            </td>
                            <td>
                              {inst.receiptUrl ? (
                                <a href={inst.receiptUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
                                  View Receipt ↗
                                </a>
                              ) : '—'}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="adm-approve-btn" onClick={() => adminVerifyInstallment(wallet._id, instIndex)}>
                                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                                Verify Payment
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* All wallets */}
              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-card-header">
                  <div className="dash-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                    All Installment Plans
                  </div>
                  <div className="dash-filter-row">
                    <select className="dash-filter-select" style={{ height: 30 }} value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                      <option value="all">All Plans</option>
                      <option value="needs_verify">Needs Verification</option>
                      <option value="active">Active</option>
                      <option value="defaulter">Defaulter</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
                {filteredWallets.length === 0 ? (
                  <div style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No wallets found.</div>
                ) : (
                  <div className="dash-table-wrap">
                    <table>
                      <thead>
                        <tr><th>Patient</th><th>Lab</th><th>Test</th><th>Total</th><th>Remaining</th><th>Installments</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {filteredWallets.map((w: any, i: number) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{w.patient?.name || '—'}</td>
                            <td style={{ color: 'var(--text-sub)' }}>{w.lab?.name || '—'}</td>
                            <td>{w.testName || '—'}</td>
                            <td style={{ fontWeight: 600 }}>PKR {(w.totalAmount || w.installments?.reduce((s: number, i: any) => s + i.amount, 0) || 0).toLocaleString()}</td>
                            <td style={{ fontWeight: 600, color: w.remainingBalance > 0 ? '#854d0e' : '#166534' }}>PKR {(w.remainingBalance || 0).toLocaleString()}</td>
                            <td style={{ fontSize: '0.8rem' }}>
                              {w.installments?.filter((i: any) => i.status === 'paid').length ?? 0} / {w.installments?.length ?? 0} paid
                            </td>
                            <td>
                              <span className={`dash-badge ${statusClass(w.status === 'completed' ? 'active' : w.status === 'defaulter' ? 'rejected' : 'pending')}`}>
                                <span className="dash-badge-dot"></span>
                                {w.status === 'completed' ? 'Completed' : w.status === 'defaulter' ? 'Defaulter' : 'Active'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* ══ DEFAULTER CASES ══════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'defaulters' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Defaulter Cases</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Auto-generated cases for patients who have missed installment payments — escalated for legal review</div>
              </div>

              <div className="dash-card dash-fu dash-fu-1">
                {defaulterCases.length === 0 ? (
                  <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No defaulter cases at this time. Cases are auto-generated when installments become overdue.
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table>
                      <thead>
                        <tr><th>Patient</th><th>Contact</th><th>Test / Wallet</th><th>Amount Owed</th><th>Escalated On</th><th>Assigned Lawyer</th></tr>
                      </thead>
                      <tbody>
                        {defaulterCases.map((c: any, i: number) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{c.patient?.name || '—'}</td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-sub)' }}>
                              <div>{c.patient?.email || '—'}</div>
                              <div>{c.patient?.phone || '—'}</div>
                            </td>
                            <td>{c.wallet?.testName || '—'}</td>
                            <td style={{ fontWeight: 700, color: '#991b1b' }}>PKR {(c.wallet?.remainingBalance || 0).toLocaleString()}</td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                              {c.escalatedAt ? new Date(c.escalatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                            </td>
                            <td style={{ fontSize: '0.82rem' }}>
                              {c.assignedLawyer ? (
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{c.assignedLawyer.name}</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>Not assigned</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* ══ PLATFORM REPORTS ═════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'reports' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Platform Reports</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">System health, usage analytics, and financial summaries</div>
              </div>

              <div className="dash-stats-grid dash-fu dash-fu-1">
                {[
                  { label: 'Appointments (Month)', value: '1,842', color: 'dash-blue' },
                  { label: 'Tests Processed',       value: '6,210', color: 'dash-green' },
                  { label: 'Reports Generated',     value: '6,008', color: 'dash-green' },
                  { label: 'Legal Consultations',   value: '214',   color: 'dash-teal' },
                ].map((s, i) => (
                  <div className="dash-stat-card" key={i}>
                    <div className="dash-stat-label">{s.label}</div>
                    <div className="dash-stat-value" style={{ marginTop: 8 }}>{s.value}</div>
                    <div className="dash-progress-wrap" style={{ marginTop: 12 }}>
                      <div className="dash-progress-fill" style={{ width: `${60 + i * 8}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="dash-card dash-fu dash-fu-2">
                <div className="dash-card-header">
                  <div className="dash-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Monthly Activity Breakdown
                  </div>
                  <div className="dash-filter-row">
                    <select className="dash-filter-select" style={{ height: 30 }}>
                      <option>April 2024</option>
                      <option>March 2024</option>
                    </select>
                  </div>
                </div>
                <div className="dash-table-wrap">
                  <table>
                    <thead><tr><th>Metric</th><th>Count</th><th>Revenue</th><th>vs Last Month</th></tr></thead>
                    <tbody>
                      {[
                        { m: 'Patient Registrations', c: '148',       r: '—',         ch: '+18%', up: true },
                        { m: 'Doctor Consultations',  c: '1,842',     r: 'PKR 3.2M',  ch: '+12%', up: true },
                        { m: 'Lab Tests Booked',      c: '6,210',     r: 'PKR 7.8M',  ch: '+22%', up: true },
                        { m: 'Installment Plans',     c: '312',       r: 'PKR 1.4M',  ch: '+8%',  up: true },
                        { m: 'Legal Consultations',   c: '214',       r: 'PKR 640k',  ch: '-4%',  up: false },
                        { m: 'Donations Received',    c: '28 donors', r: 'PKR 920k',  ch: '+35%', up: true },
                      ].map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.m}</td>
                          <td>{r.c}</td>
                          <td>{r.r}</td>
                          <td style={{ fontWeight: 700, color: r.up ? '#166534' : '#991b1b' }}>{r.ch}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ SETTINGS ══════════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'settings' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Platform Settings</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">Configure global platform parameters and policies</div>
              </div>

              <div className="adm-settings-section dash-fu dash-fu-1">
                <div className="adm-settings-title">General Configuration</div>
                <div className="dash-form-row">
                  <div className="dash-form-group">
                    <label className="dash-form-label">Platform Name</label>
                    <input className="dash-form-input" value="CareFirst Health Platform" readOnly
                      style={{ background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'not-allowed', userSelect: 'none' }} />
                  </div>
                  <div className="dash-form-group">
                    <label className="dash-form-label">Support Email</label>
                    <input className="dash-form-input" type="email" value={settings.supportEmail}
                      onChange={e => setSettings(s => ({ ...s, supportEmail: e.target.value }))} />
                  </div>
                </div>
                <div className="dash-form-row">
                  <div className="dash-form-group">
                    <label className="dash-form-label">Default Currency</label>
                    <input className="dash-form-input" value="PKR — Pakistani Rupee" readOnly
                      style={{ background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'not-allowed', userSelect: 'none' }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }} className="dash-fu dash-fu-3">
                <button className="dash-btn-ghost" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>
                  Discard Changes
                </button>
                <button className="dash-btn-primary accent" onClick={() => alert('Settings saved.')}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  Save Settings
                </button>
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
