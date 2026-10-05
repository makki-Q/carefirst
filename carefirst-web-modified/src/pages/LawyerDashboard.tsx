import React, { useState, useEffect } from 'react';
import './LawyerDashboard.css';
import { api, getSession, clearSession } from '../lib/api';
import { getSocket } from '../lib/socket';
import { ListenButton, UrduText } from '../components/Urdu';
import { CnicPictureGallery } from '../components/CnicPictures';

interface Installment {
  month: string;
  due: string;
  amount: number;
  paid: boolean;
  paidOn: string | null;
  verifiedBy: string | null;
}

interface Defaulter {
  id: string;
  escalatedAt?: string; // when the case reached the lawyer
  patient: { name: string; cnic: string; phone: string; address: string };
  guarantor: { name: string; cnic: string; relation: string; phone: string; address?: string };
  test: string;
  lab: string;
  totalAmount: number;
  downPayment: number;
  serviceFee: number;
  paidAmount: number;
  remainingAmount: number;
  overdueBy: string;
  defaultedOn: string;
  agreementDate: string;
  agreementText?: string; // exact text the patient accepted (plans created through the app)
  agreementTextUrdu?: string;
  walletId?: string;
  cnicPictures?: Record<string, string>; // patient + guarantor CNIC pictures sent with the application
  installments: Installment[];
}


const LawyerDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(() => !(window.innerWidth <= 900)); // closed on phones
  const [currentPage, setCurrentPage] = useState('defaulters');
  const [selectedCase, setSelectedCase] = useState<Defaulter | null>(null);
  const [agreementUrdu, setAgreementUrdu] = useState(false); // show the Urdu version of the agreement
  const [dateString, setDateString] = useState('');

  const { user: sessionUser } = getSession();
  const [cases, setCases]               = useState<Defaulter[]>([]);
  // Case with the most days since it reached the lawyer, and paid vs total owed across cases
  const longest = cases
    .filter(c => c.escalatedAt)
    .map(c => ({ c, days: Math.floor((Date.now() - new Date(c.escalatedAt as string).getTime()) / 86400000) }))
    .sort((a, b) => b.days - a.days)[0] || null;
  const owedTotal = cases.reduce((t, c) => t + c.totalAmount, 0);
  const recoveryRate = owedTotal > 0 ? Math.round((cases.reduce((t, c) => t + c.paidAmount, 0) / owedTotal) * 100) : null;
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifBadge, setNotifBadge]     = useState(0);

  useEffect(() => {
    const d = new Date();
    setDateString(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);

  useEffect(() => {
    api.get('/lawyer/defaulter-cases').then((d: any) => {
      setCases(Array.isArray(d) ? d.map((c: any) => mapApiCase(c)) : []);
    }).catch(() => {});
    api.get('/lawyer/notifications').then((d: any) => {
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
    });
    return () => { socket.off('notification:new'); };
  }, []);

  const signOut = () => { clearSession(); window.location.href = '/login'; };

  const markAllRead = async () => {
    try {
      await api.put('/lawyer/notifications/read-all', {});
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setNotifBadge(0);
    } catch {}
  };

  const mapApiCase = (c: any): Defaulter => {
    const wallet = c.wallet || {};
    const total  = wallet.totalAmount || 0;
    const rem    = wallet.remainingBalance ?? total;
    return {
      id:             `DEF-${c._id?.toString().slice(-3).toUpperCase()}`,
      patient:        {
        name:    c.patient?.name || '—',
        cnic:    c.patient?.cnic || '—',
        phone:   c.patient?.phone || '—',
        address: wallet.patientAddress || [c.patient?.address, c.patient?.city].filter(Boolean).join(', ') || '—',
      },
      guarantor:      { name: wallet.guarantor?.name || '—', cnic: wallet.guarantor?.cnic || '—', relation: wallet.guarantor?.relation || '—', phone: wallet.guarantor?.phone || '—', address: wallet.guarantor?.address || '—' },
      test:           wallet.testName || '—',
      lab:            wallet.labName || (typeof wallet.lab === 'object' ? wallet.lab?.name : '') || '—',
      totalAmount:    total,
      downPayment:    wallet.downPayment?.amount || 0,
      serviceFee:     wallet.serviceFee?.amount || 0,
      paidAmount:     total - rem,
      remainingAmount: rem,
      overdueBy:      c.missedInstallments > 0 ? `${c.missedInstallments} installment${c.missedInstallments === 1 ? '' : 's'}` : '—',
      escalatedAt:    c.escalatedAt,
      defaultedOn:    c.escalatedAt ? new Date(c.escalatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
      agreementDate:  wallet.agreement?.acceptedAt ? new Date(wallet.agreement.acceptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
      agreementText:  wallet.agreement?.text,
      agreementTextUrdu: wallet.agreement?.textUrdu,
      walletId:       wallet._id,
      cnicPictures:   wallet.cnicPictures,
      installments:   (wallet.installments || []).map((inst: any, i: number) => ({
        month:      `Month ${i + 1}`,
        due:        inst.dueDate ? new Date(inst.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—',
        amount:     inst.amount || 0,
        paid:       inst.status === 'paid',
        paidOn:     inst.adminVerifiedAt ? new Date(inst.adminVerifiedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null,
        verifiedBy: inst.adminVerified ? 'Admin' : null,
      })),
    };
  };

  const navigate = (page: string) => {
    setCurrentPage(page);
    if (page !== 'caseDetail') setSelectedCase(null);
    if (window.innerWidth <= 900) setSidebarOpen(false);
  };

  const openCase = (c: Defaulter) => {
    setSelectedCase(c);
    setCurrentPage('caseDetail');
  };

  const breadcrumbs: Record<string, string> = {
    defaulters:     'Defaulter Cases',
    caseDetail:     selectedCase ? `Case — ${selectedCase.patient.name}` : 'Case Detail',
    notifications:  'Notifications',
  };

  const paidPct = (c: Defaulter) => Math.round((c.paidAmount / c.totalAmount) * 100);

  return (
    <div className="lawyer-dashboard-wrapper">
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
            <div className="dash-avatar">{((sessionUser as any)?.name || 'L')[0].toUpperCase()}</div>
            <div>
              <div className="dash-user-name">{(sessionUser as any)?.name || 'Lawyer'}</div>
              <div className="dash-user-role">Legal Partner · Healthcare Law</div>
            </div>
          </div>

          <nav className="dash-sidebar-nav">
            <div className="dash-nav-label">Assigned Cases</div>

            <button
              className={`dash-nav-item ${currentPage === 'defaulters' || currentPage === 'caseDetail' ? 'active' : ''}`}
              onClick={() => navigate('defaulters')}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              </svg>
              Defaulter Cases
              <span className="dash-nav-badge">{cases.length}</span>
            </button>

            <div className="dash-nav-label">Account</div>

            <button className={`dash-nav-item ${currentPage === 'notifications' ? 'active' : ''}`} onClick={() => navigate('notifications')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              Notifications
              {notifBadge > 0 && <span className="dash-nav-badge">{notifBadge}</span>}
            </button>

          </nav>

          <div className="dash-sidebar-footer">
            <button className="dash-nav-item danger" onClick={signOut}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* ─── MAIN ─────────────────────────────────────────── */}
        <main className={`dash-main ${!sidebarOpen ? 'expanded' : ''}`}>
          <header className="dash-topbar">
            <div className="dash-topbar-left">
              <button className="dash-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <div className="dash-breadcrumb">
                {currentPage === 'caseDetail' && (
                  <>
                    <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate('defaulters')}>Defaulter Cases</span>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                  </>
                )}
                {currentPage !== 'caseDetail' && <span>carefirst</span>}
                {currentPage !== 'caseDetail' && <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>}
                <span className="dash-current">{breadcrumbs[currentPage]}</span>
              </div>
            </div>
            <div className="dash-topbar-right">
              <div className="dash-date-chip">{dateString}</div>
            </div>
          </header>

          <div className="dash-content">

            {/* ══ DEFAULTER CASES LIST ══════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'defaulters' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu">
                <div className="dash-page-title">Defaulter Cases</div>
                <div className="dash-page-rule"></div>
                <div className="dash-page-subtitle">
                  Cases auto-assigned by the system. All legal action is taken offline — this portal is view-only.
                </div>
              </div>

              {/* Summary stats */}
              <div className="dash-stats-grid dash-fu dash-fu-1">
                <div className="dash-stat-card">
                  <div className="dash-stat-top">
                    <div>
                      <div className="dash-stat-label">Active Defaulters</div>
                      <div className="dash-stat-value">{cases.length}</div>
                    </div>
                    <div className="dash-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                    </div>
                  </div>
                  <div className="dash-stat-trend down">
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
                    <span>Requires offline action</span>
                  </div>
                </div>
                <div className="dash-stat-card">
                  <div className="dash-stat-top">
                    <div>
                      <div className="dash-stat-label">Total Outstanding</div>
                      <div className="dash-stat-value">PKR {cases.reduce((s, c) => s + c.remainingAmount, 0).toLocaleString()}</div>
                    </div>
                    <div className="dash-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                  </div>
                  <div className="dash-stat-trend down"><span>Across all defaulters</span></div>
                </div>
                <div className="dash-stat-card">
                  <div className="dash-stat-top">
                    <div>
                      <div className="dash-stat-label">Longest Overdue</div>
                      <div className="dash-stat-value">{longest ? `${longest.days} day${longest.days === 1 ? '' : 's'}` : '—'}</div>
                    </div>
                    <div className="dash-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </div>
                  </div>
                  <div className="dash-stat-trend down"><span>{longest ? `${longest.c.patient.name} · ${longest.c.id}` : 'No cases yet'}</span></div>
                </div>
                <div className="dash-stat-card">
                  <div className="dash-stat-top">
                    <div>
                      <div className="dash-stat-label">Avg Recovery Rate</div>
                      <div className="dash-stat-value">{recoveryRate === null ? '—' : `${recoveryRate}%`}</div>
                    </div>
                    <div className="dash-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    </div>
                  </div>
                  <div className="dash-stat-trend"><span>Paid vs total owed</span></div>
                </div>
              </div>

              {/* Defaulter cards */}
              <div className="dash-fu dash-fu-2">
                {cases.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 16 }}>No defaulter cases assigned to you yet.</div>}
                {cases.map((c) => (
                  <div className="law-defaulter-card" key={c.id}>
                    <div className="law-defaulter-header">
                      <div className="law-def-left">
                        <div className="law-def-id">{c.id}</div>
                        <div className="law-def-name">{c.patient.name}</div>
                        <div className="law-def-meta">
                          CNIC: {c.patient.cnic} &nbsp;·&nbsp; Test: {c.test} &nbsp;·&nbsp; Lab: {c.lab}
                        </div>
                      </div>
                      <div className="law-def-right">
                        <span className="dash-badge dash-red">
                          <span className="dash-badge-dot"></span>Defaulter
                        </span>
                        <div className="law-def-overdue">Overdue by {c.overdueBy}</div>
                      </div>
                    </div>

                    <div className="law-def-wallet-strip">
                      <div className="law-def-wallet-item">
                        <div className="law-def-wallet-label">Total Amount</div>
                        <div className="law-def-wallet-val">PKR {c.totalAmount.toLocaleString()}</div>
                      </div>
                      <div className="law-def-wallet-item">
                        <div className="law-def-wallet-label">Paid</div>
                        <div className="law-def-wallet-val" style={{ color: '#166534' }}>PKR {c.paidAmount.toLocaleString()}</div>
                      </div>
                      <div className="law-def-wallet-item">
                        <div className="law-def-wallet-label">Remaining</div>
                        <div className="law-def-wallet-val" style={{ color: '#c9372c' }}>PKR {c.remainingAmount.toLocaleString()}</div>
                      </div>
                      <div className="law-def-wallet-item" style={{ flex: 2 }}>
                        <div className="law-def-wallet-label">Recovery Progress ({paidPct(c)}%)</div>
                        <div className="dash-progress-wrap" style={{ margin: '6px 0 0' }}>
                          <div className="dash-progress-fill" style={{ width: `${paidPct(c)}%`, background: 'linear-gradient(90deg,#0f766e,#14b8a6)' }}></div>
                        </div>
                      </div>
                    </div>

                    <div className="law-def-footer">
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Defaulted on {c.defaultedOn} &nbsp;·&nbsp; Agreement signed {c.agreementDate}
                      </div>
                      <button className="dash-btn-primary accent" onClick={() => openCase(c)}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        View Full Case
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ══ CASE DETAIL ═══════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'caseDetail' && selectedCase ? 'active' : ''}`}>
              {selectedCase && (
                <>
                  <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div className="dash-page-title">{selectedCase.patient.name}</div>
                      <div className="dash-page-rule"></div>
                      <div className="dash-page-subtitle">Case {selectedCase.id} · Defaulted on {selectedCase.defaultedOn} · Overdue by {selectedCase.overdueBy}</div>
                    </div>
                    <button className="dash-btn-ghost dash-fu-1" onClick={() => navigate('defaulters')}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
                      Back to Cases
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    {/* Patient Info */}
                    <div className="dash-card dash-fu dash-fu-1">
                      <div className="dash-card-header">
                        <div className="dash-card-title">
                          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                          Patient Information
                        </div>
                        <span className="dash-badge dash-red"><span className="dash-badge-dot"></span>Defaulter</span>
                      </div>
                      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {[
                          { l: 'Full Name', v: selectedCase.patient.name },
                          { l: 'CNIC', v: selectedCase.patient.cnic },
                          { l: 'Phone', v: selectedCase.patient.phone },
                          { l: 'Address', v: selectedCase.patient.address },
                          { l: 'Test', v: selectedCase.test },
                          { l: 'Lab', v: selectedCase.lab },
                        ].map((r, i) => (
                          <div key={i} style={{ display: 'flex', gap: 12, fontSize: '0.825rem' }}>
                            <span style={{ width: 90, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{r.l}</span>
                            <span style={{ color: 'var(--text)' }}>{r.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Guarantor Info */}
                    <div className="dash-card dash-fu dash-fu-1">
                      <div className="dash-card-header">
                        <div className="dash-card-title">
                          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          Guarantor Information
                        </div>
                      </div>
                      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {[
                          { l: 'Full Name', v: selectedCase.guarantor.name },
                          { l: 'CNIC', v: selectedCase.guarantor.cnic },
                          { l: 'Relation', v: selectedCase.guarantor.relation },
                          { l: 'Phone', v: selectedCase.guarantor.phone },
                          ...(selectedCase.guarantor.address ? [{ l: 'Address', v: selectedCase.guarantor.address }] : []),
                        ].map((r, i) => (
                          <div key={i} style={{ display: 'flex', gap: 12, fontSize: '0.825rem' }}>
                            <span style={{ width: 90, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{r.l}</span>
                            <span style={{ color: 'var(--text)' }}>{r.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Signed Legal Agreement */}
                  <div className="dash-card dash-fu dash-fu-2" style={{ marginBottom: 20 }}>
                    <div className="dash-card-header">
                      <div className="dash-card-title">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        Signed Legal Agreement
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {selectedCase.agreementTextUrdu && selectedCase.walletId && <>
                          <button className="dash-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.74rem' }} onClick={() => setAgreementUrdu(v => !v)}>
                            {agreementUrdu ? 'English' : 'اردو'}
                          </button>
                          <ListenButton compact request={{ source: 'agreement', id: selectedCase.walletId }} />
                        </>}
                        <span className="dash-badge dash-green"><span className="dash-badge-dot"></span>Signed {selectedCase.agreementDate}</span>
                      </div>
                    </div>
                    {selectedCase.agreementText ? (
                      <div className="law-agreement-body">
                        {agreementUrdu && selectedCase.agreementTextUrdu
                          ? <UrduText text={selectedCase.agreementTextUrdu} />
                          : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.74rem', lineHeight: 1.55, margin: 0 }}>
                              {selectedCase.agreementText}
                            </pre>}
                      </div>
                    ) : (
                    <div className="law-agreement-body">
                      <div className="law-agreement-title">INSTALLMENT PAYMENT AGREEMENT</div>
                      <div className="law-agreement-subtitle">CareFirst Healthcare Platform — Legal Agreement</div>
                      <div className="law-agreement-text">
                        <p>This Installment Payment Agreement ("Agreement") is entered into on <strong>{selectedCase.agreementDate}</strong>, between:</p>
                        <p><strong>Patient:</strong> {selectedCase.patient.name} (CNIC: {selectedCase.patient.cnic}), residing at {selectedCase.patient.address}.</p>
                        <p><strong>Guarantor:</strong> {selectedCase.guarantor.name} (CNIC: {selectedCase.guarantor.cnic}), {selectedCase.guarantor.relation} of the patient, reachable at {selectedCase.guarantor.phone}.</p>
                        <p><strong>Lab:</strong> {selectedCase.lab}, an authorized diagnostic partner on the CareFirst platform.</p>
                        <p>The patient agrees to pay the total amount of <strong>PKR {selectedCase.totalAmount.toLocaleString()}</strong> for the medical test <strong>"{selectedCase.test}"</strong> in {selectedCase.installments.length} monthly installments as per the schedule detailed below. A down payment of PKR {selectedCase.downPayment.toLocaleString()} and a service fee of PKR {selectedCase.serviceFee.toLocaleString()} were paid at the time of agreement signing.</p>
                        <p>The patient understands that failure to submit payment proof within the grace period of any due date will result in immediate defaulter status and forwarding of this agreement, along with all patient and guarantor details, to the CareFirst platform legal counsel for appropriate legal action.</p>
                        <p>The guarantor co-signs this agreement and acknowledges full liability for the outstanding amount in the event of patient default.</p>
                        <p className="law-agreement-signatures">
                          <span><strong>Patient Signature:</strong> ___________________</span>
                          <span><strong>Guarantor Signature:</strong> ___________________</span>
                          <span><strong>Witnessed by:</strong> CareFirst Admin</span>
                        </p>
                      </div>
                    </div>
                    )}
                  </div>

                  {/* CNIC pictures sent with the application */}
                  {selectedCase.walletId && (
                    <div className="dash-card dash-fu dash-fu-2" style={{ marginBottom: 20 }}>
                      <div className="dash-card-header">
                        <div className="dash-card-title">
                          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="11" r="2.5"/><path d="M14 9h5M14 13h5M5 17h6"/></svg>
                          CNIC Pictures — Patient &amp; Guarantor
                        </div>
                      </div>
                      <div style={{ padding: '16px 22px' }}>
                        <CnicPictureGallery walletId={selectedCase.walletId} pictures={selectedCase.cnicPictures}
                          patientName={selectedCase.patient.name} guarantorName={selectedCase.guarantor.name} />
                      </div>
                    </div>
                  )}

                  {/* Wallet Breakdown */}
                  <div className="dash-card dash-fu dash-fu-3">
                    <div className="dash-card-header">
                      <div className="dash-card-title">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                        Digital Wallet — Installment Breakdown
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: '0.78rem', color: 'var(--text-sub)' }}>
                        <span>Total: <strong style={{ color: 'var(--text)' }}>PKR {selectedCase.totalAmount.toLocaleString()}</strong></span>
                        <span>Paid: <strong style={{ color: '#166534' }}>PKR {selectedCase.paidAmount.toLocaleString()}</strong></span>
                        <span>Remaining: <strong style={{ color: '#c9372c' }}>PKR {selectedCase.remainingAmount.toLocaleString()}</strong></span>
                      </div>
                    </div>

                    {/* Wallet summary strip */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '1px solid var(--border)' }}>
                      {[
                        { l: 'Test Cost', v: `PKR ${selectedCase.totalAmount.toLocaleString()}` },
                        { l: 'Down Payment', v: `PKR ${selectedCase.downPayment.toLocaleString()}`, color: '#166534' },
                        { l: 'Service Fee', v: `PKR ${selectedCase.serviceFee.toLocaleString()}` },
                        { l: 'Still Owed', v: `PKR ${selectedCase.remainingAmount.toLocaleString()}`, color: '#c9372c' },
                      ].map((item, i) => (
                        <div key={i} style={{ padding: '16px 22px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>{item.l}</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: "'DM Serif Display', serif", color: item.color || 'var(--text)' }}>{item.v}</div>
                        </div>
                      ))}
                    </div>

                    <div className="dash-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Due Date</th>
                            <th>Amount</th>
                            <th>Paid On</th>
                            <th>Verified By</th>
                            <th style={{ textAlign: 'right' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCase.installments.map((inst, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600, color: 'var(--text)' }}>{inst.month}</td>
                              <td>{inst.due}</td>
                              <td>PKR {inst.amount.toLocaleString()}</td>
                              <td>{inst.paidOn ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                              <td>{inst.verifiedBy ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                              <td style={{ textAlign: 'right' }}>
                                {inst.paid
                                  ? <span className="dash-badge dash-green"><span className="dash-badge-dot"></span>Paid & Verified</span>
                                  : <span className="dash-badge dash-red"><span className="dash-badge-dot"></span>Unpaid</span>
                                }
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

            {/* ══ NOTIFICATIONS ════════════════════════════════ */}
            <section className={`dash-page-section ${currentPage === 'notifications' ? 'active' : ''}`}>
              <div className="dash-page-header dash-fu" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="dash-page-title">Notifications</div>
                  <div className="dash-page-rule"></div>
                  <div className="dash-page-subtitle">New defaulter cases and system alerts</div>
                </div>
                <button className="dash-btn-ghost dash-fu-1" onClick={markAllRead}>Mark all as read</button>
              </div>

              <div className="dash-card dash-fu dash-fu-2">
                {notifications.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 20 }}>No notifications yet.</div>}
                {notifications.map((n: any, i: number) => (
                  <div className={`dash-notif-item ${!n.read ? 'unread' : ''}`} key={i}>
                    <div className="dash-notif-icon" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      </svg>
                    </div>
                    <div className="dash-notif-body">
                      <div className="dash-notif-title">{n.title}</div>
                      <div className="dash-notif-desc">{n.message}</div>
                    </div>
                    <div className="dash-notif-meta">
                      <span className="dash-notif-time">{n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>
                      {!n.read && <span className="dash-unread-dot"></span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
};

export default LawyerDashboard;
