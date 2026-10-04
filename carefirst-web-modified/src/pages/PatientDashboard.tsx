import React, { useState, useEffect, useCallback } from 'react';
import './PatientDashboard.css';
import { confirmDialog, alertDialog } from '../components/Dialog';
import { api, getSession, saveSession, clearSession, formatCnic, downloadSlip } from '../lib/api';
import { getSocket } from '../lib/socket';
import MapPicker, { currentPosition } from '../components/MapPicker';
import { ListenButton, UrduText } from '../components/Urdu';
import { CnicPicturePicker, CnicPictureGallery, checkCnicPicture } from '../components/CnicPictures';

// ── Upload limits (mirror carefirst-backend/middleware/upload.js) ─────────────
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_MB        = 10;
const MAX_COMMUNITY_DOCS = 5;
// [upload field, label, what the error message calls it]
const CNIC_PICTURE_SLOTS: [string, string, string][] = [
  ['patientCnicFront',   'Your CNIC — front',      'the front of your CNIC'],
  ['patientCnicBack',    'Your CNIC — back',       'the back of your CNIC'],
  ['guarantorCnicFront', 'Guarantor CNIC — front', "the front of the guarantor's CNIC"],
  ['guarantorCnicBack',  'Guarantor CNIC — back',  "the back of the guarantor's CNIC"],
];

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

// Installment plans (mirror carefirst-backend/utils/installmentPlan.js)
const OPEN_PLAN_STATUSES = ['pending_approval', 'awaiting_fee', 'active', 'defaulter'];
const PLAN_STATUS: Record<string, { label: string; cls: string }> = {
  pending_approval: { label: 'Under review',    cls: 'pat-badge-amber' },
  rejected:         { label: 'Not approved',    cls: 'pat-badge-red'   },
  awaiting_fee:     { label: 'Service fee due', cls: 'pat-badge-amber' },
  active:           { label: 'Active',          cls: 'pat-badge-green' },
  completed:        { label: 'Completed',       cls: 'pat-badge-green' },
  defaulter:        { label: 'Escalated',       cls: 'pat-badge-red'   },
};

// ── Appointments & lab visits (mirror carefirst-backend/utils/schedule.js) ─────
const BOOKING_WINDOW_DAYS  = 14;
const PATIENT_CANCEL_HOURS = 2;
const pktToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()); // YYYY-MM-DD
const addDaysTo = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const time12 = (hhmm: string) => {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const APPT_STATUS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: 'pat-badge-green' },
  completed: { label: 'Completed', cls: 'pat-badge-green' },
  cancelled: { label: 'Cancelled', cls: 'pat-badge-red'   },
  no_show:   { label: 'Missed',    cls: 'pat-badge-red'   },
};
const LAB_STATUS: Record<string, { label: string; cls: string }> = {
  confirmed:        { label: 'Confirmed',        cls: 'pat-badge-green' },
  sample_collected: { label: 'Sample collected', cls: 'pat-badge-amber' },
  completed:        { label: 'Completed',        cls: 'pat-badge-green' },
  cancelled:        { label: 'Cancelled',        cls: 'pat-badge-red'   },
};

// Down payment and the (first) installment amount for a test, in whole rupees
const planEstimate = (price: number, count: number, downPct: number) => {
  const down = Math.round(price * downPct / 100);
  return { down, perInstallment: Math.floor((price - down) / count) };
};

// Where an installment (or the down payment) is in the patient → lab → admin verification chain
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
  if (type?.startsWith('receipt') || ['installment_overdue', 'installment_due_soon', 'plan_approved'].includes(type))
    return { color: 'amber', icon: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></> };
  if (['defaulter_escalated', 'cnic_rejected', 'community_rejected', 'plan_rejected', 'service_fee_rejected'].includes(type))
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

  // ── True Cost Analysis — the position is only sent for the calculation, never stored ──
  const [myPos, setMyPos]             = useState<{ lat: number; lng: number } | null>(null);
  const [showPosMap, setShowPosMap]   = useState(false);
  const [travelMode, setTravelMode]   = useState('motorbike');
  const [travel, setTravel]           = useState<any>(null); // GET /public/true-cost
  const [travelBusy, setTravelBusy]   = useState(false);
  const [travelMsg, setTravelMsg]     = useState<{ ok: boolean; text: string } | null>(null);
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
  const [appointments, setAppointments]   = useState<any[]>([]);
  const [labBookings, setLabBookings]     = useState<any[]>([]);

  // ── Booking flows ───────────────────────────────────────────────────────────
  const [apptDoctor, setApptDoctor]   = useState<any>(null);   // doctor being booked
  const [apptSlots, setApptSlots]     = useState<any>(null);   // GET /public/doctors/:id/slots
  const [apptDate, setApptDate]       = useState('');
  const [apptTime, setApptTime]       = useState('');
  const [labTarget, setLabTarget]     = useState<{ lab: any; test: any } | null>(null);
  const [visitDate, setVisitDate]     = useState('');
  const [payWallet, setPayWallet]     = useState('');           // '' = pay at the lab
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingMsg, setBookingMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [visitsMsg, setVisitsMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded]               = useState<Record<string, boolean>>({});

  // ── Wallet state ────────────────────────────────────────────────────────────
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [uploadingKey, setUploadingKey]         = useState('');
  const [walletMsg, setWalletMsg]               = useState<{ ok: boolean; text: string } | null>(null);
  const [showAgreement, setShowAgreement]       = useState(false);
  const [agreementLang, setAgreementLang]       = useState<'en' | 'ur'>('en');

  // ── Installment plan application ────────────────────────────────────────────
  const [planConfig, setPlanConfig]         = useState<any>(null); // fee, down-payment %, limit, CareFirst account
  const [planTarget, setPlanTarget]         = useState<{ lab: any; test: any } | null>(null);
  const [guarantorForm, setGuarantorForm]   = useState({ name: '', cnic: '', phone: '', relation: '', address: '' });
  const [planAddress, setPlanAddress]       = useState('');  // the patient's own address for the agreement
  const [cnicFiles, setCnicFiles]           = useState<Record<string, File | null>>({}); // the four CNIC pictures
  const [planPreview, setPlanPreview]       = useState<any>(null);  // terms + agreementText from the server
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [planBusy, setPlanBusy]             = useState(false);
  const [planMsg, setPlanMsg]               = useState<{ ok: boolean; text: string } | null>(null);

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
  const loadAppointments = useCallback(() =>
    api.get('/patient/appointments').then((d: any) => setAppointments(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('appointments')), []);
  const loadLabBookings = useCallback(() =>
    api.get('/patient/lab-bookings').then((d: any) => setLabBookings(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => markLoaded('labBookings')), []);
  const loadPlanConfig = useCallback(() =>
    api.get('/patient/installment-plans/config').then((d: any) => setPlanConfig(d)).catch(() => {}), []);

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
    loadPlanConfig();
    loadAppointments();
    loadLabBookings();
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
      if (n.type === 'test_report_uploaded' || n.type === 'report_summary_ready') { loadReports(); loadCommunity(); }
      if (n.type === 'prescription_issued')  { loadPrescriptions(); loadAppointments(); }
      if (n.type?.startsWith('appointment_')) loadAppointments();
      if (n.type?.startsWith('lab_booking_') || n.type === 'test_report_uploaded') loadLabBookings();
      if ([
        'receipt_lab_approved', 'receipt_admin_verified', 'installment_overdue', 'installment_due_soon', 'defaulter_escalated',
        'plan_approved', 'plan_rejected', 'plan_activated', 'service_fee_rejected',
      ].includes(n.type)) loadWallets();
      if (['community_approved', 'community_rejected'].includes(n.type)) loadCommunity();
      if (['cnic_verified', 'cnic_rejected'].includes(n.type)) loadProfile();
    });
    return () => { socket.off('notification:new'); };
  }, []);

  // True Cost: recalculate whenever the position or travel mode changes
  useEffect(() => {
    if (!showTrueCost || !myPos) return;
    let stale = false;
    setTravelBusy(true);
    api.get(`/public/true-cost?lat=${myPos.lat}&lng=${myPos.lng}&mode=${travelMode}`)
      .then((d: any) => { if (!stale) { setTravel(d); setTravelMsg(null); } })
      .catch((err: any) => { if (!stale) setTravelMsg({ ok: false, text: err.message || 'Could not calculate travel costs' }); })
      .finally(() => { if (!stale) setTravelBusy(false); });
    return () => { stale = true; };
  }, [showTrueCost, myPos?.lat, myPos?.lng, travelMode]);

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

  // target: installment index, or 'down-payment' / 'service-fee'
  const uploadReceipt = async (walletId: string, target: number | 'down-payment' | 'service-fee', file?: File | null) => {
    if (!file) return;
    setWalletMsg(null);
    const invalid = validateFile(file);
    if (invalid) { setWalletMsg({ ok: false, text: invalid }); return; }

    const fd = new FormData();
    fd.append('receipt', file);
    setUploadingKey(`${walletId}-${target}`);
    const path = typeof target === 'number' ? `installments/${target}` : target;
    try {
      const res: any = await api.upload(`/patient/wallets/${walletId}/${path}/receipt`, fd);
      setWallets(prev => prev.map(w => w._id === walletId ? res.wallet : w));
      setWalletMsg({ ok: true, text: res.message || 'Receipt uploaded.' });
    } catch (err: any) {
      setWalletMsg({ ok: false, text: err.message || 'Upload failed. Please try again.' });
    } finally {
      setUploadingKey('');
    }
  };

  // ── Doctor appointments ─────────────────────────────────────────────────────
  const loadSlots = async (doctorId: string, keepDate = '') => {
    const s: any = await api.get(`/public/doctors/${doctorId}/slots`);
    setApptSlots(s);
    const firstOpen = s.days?.find((d: any) => d.times.length)?.date || '';
    setApptDate(keepDate && s.days?.some((d: any) => d.date === keepDate && d.times.length) ? keepDate : firstOpen);
    setApptTime('');
  };

  const startAppointment = async (doc: any) => {
    setApptDoctor(doc); setApptSlots(null); setApptDate(''); setApptTime(''); setBookingMsg(null);
    navigate('bookAppointment');
    try { await loadSlots(doc.doctorId); }
    catch (err: any) { setBookingMsg({ ok: false, text: err.message || 'Could not load the schedule' }); }
  };

  const confirmAppointment = async () => {
    if (!apptDoctor || !apptDate || !apptTime) return;
    setBookingMsg(null); setBookingBusy(true);
    try {
      const appt: any = await api.post('/patient/appointments', { doctorId: apptDoctor.doctorId, date: apptDate, time: apptTime });
      setAppointments(prev => [appt, ...prev]);
      setVisitsMsg({ ok: true, text: `Appointment confirmed with ${drName(apptDoctor.name)} on ${dayLabel(apptDate)} at ${time12(apptTime)}. Pay the fee at the clinic.` });
      setApptDoctor(null);
      navigate('appointments');
    } catch (err: any) {
      setBookingMsg({ ok: false, text: err.message || 'Booking failed. Please try again.' });
      if (err.status === 409) loadSlots(apptDoctor.doctorId, apptDate).catch(() => {}); // slot just taken
    } finally {
      setBookingBusy(false);
    }
  };

  const cancelMyAppointment = async (a: any) => {
    if (!(await confirmDialog(`Cancel your appointment with ${drName(a.doctor?.name)} on ${dayLabel(a.date)} at ${time12(a.time)}?`, { danger: true, confirmLabel: 'Cancel appointment', cancelLabel: 'Keep it' }))) return;
    setVisitsMsg(null);
    try {
      const d: any = await api.put(`/patient/appointments/${a._id}/cancel`, {});
      setAppointments(prev => prev.map(x => x._id === a._id ? d.appointment : x));
      setVisitsMsg({ ok: true, text: 'Appointment cancelled.' });
    } catch (err: any) { setVisitsMsg({ ok: false, text: err.message || 'Could not cancel' }); }
  };

  // ── Lab visits ──────────────────────────────────────────────────────────────
  const startLabBooking = (lab: any, test: any) => {
    setLabTarget({ lab, test }); setVisitDate(pktToday()); setPayWallet(''); setBookingMsg(null);
    navigate('bookLabTest');
  };

  const confirmLabBooking = async () => {
    if (!labTarget || !visitDate) return;
    setBookingMsg(null); setBookingBusy(true);
    try {
      const b: any = await api.post('/patient/lab-bookings', {
        labId: labTarget.lab.labId, testId: labTarget.test._id, visitDate, ...(payWallet ? { walletId: payWallet } : {}),
      });
      setLabBookings(prev => [b, ...prev]);
      setVisitsMsg({ ok: true, text: `${labTarget.test.name} booked at ${labTarget.lab.labName} for ${dayLabel(visitDate)}.` });
      setLabTarget(null);
      navigate('appointments');
    } catch (err: any) {
      setBookingMsg({ ok: false, text: err.message || 'Booking failed. Please try again.' });
    } finally {
      setBookingBusy(false);
    }
  };

  const cancelLabVisit = async (b: any) => {
    if (!(await confirmDialog(`Cancel your ${b.testName} visit on ${dayLabel(b.visitDate)}?`, { danger: true, confirmLabel: 'Cancel visit', cancelLabel: 'Keep it' }))) return;
    setVisitsMsg(null);
    try {
      const d: any = await api.put(`/patient/lab-bookings/${b._id}/cancel`, {});
      setLabBookings(prev => prev.map(x => x._id === b._id ? d.booking : x));
      setVisitsMsg({ ok: true, text: 'Lab visit cancelled.' });
    } catch (err: any) { setVisitsMsg({ ok: false, text: err.message || 'Could not cancel' }); }
  };

  const findLabsFor = (testName: string) => { setTestSearch(testName); navigate('bookTests'); };

  const useMyLocation = async () => {
    setTravelMsg(null); setTravelBusy(true);
    try { setMyPos(await currentPosition()); setShowPosMap(false); }
    catch (err: any) { setTravelMsg({ ok: false, text: err.message }); setShowPosMap(true); }
    finally { setTravelBusy(false); } // the fetch effect sets it again while calculating
  };

  const toggleTrueCost = () => {
    const on = !showTrueCost;
    setShowTrueCost(on);
    if (on && !myPos) useMyLocation(); // SRS UC-18: ask for live location when True Cost is switched on
  };

  const startPlanApplication = (lab: any, test: any) => {
    setPlanTarget({ lab, test });
    setGuarantorForm({ name: '', cnic: '', phone: '', relation: '', address: '' });
    setPlanAddress(profile?.address || '');
    setCnicFiles({});
    setPlanPreview(null);
    setAgreementAccepted(false);
    setPlanMsg(null);
    navigate('applyPlan');
  };

  const updateGuarantor = (field: string, value: string) => {
    setGuarantorForm(prev => ({ ...prev, [field]: value }));
    // The agreement names the guarantor, so any change needs a fresh review
    if (planPreview) { setPlanPreview(null); setAgreementAccepted(false); }
  };

  const updatePlanAddress = (value: string) => {
    setPlanAddress(value);
    if (planPreview) { setPlanPreview(null); setAgreementAccepted(false); } // it is in the agreement too
  };

  const chooseCnicPicture = (field: string, file: File | null) => {
    const problem = checkCnicPicture(file);
    if (problem) { setPlanMsg({ ok: false, text: problem }); return; }
    setPlanMsg(null);
    setCnicFiles(prev => ({ ...prev, [field]: file }));
  };

  const planRequestBody = () => ({
    labId:          planTarget?.lab.labId,
    testId:         planTarget?.test._id,
    patientAddress: planAddress,
    guarantor:      { ...guarantorForm, cnic: formatCnic(guarantorForm.cnic) || guarantorForm.cnic },
  });

  const reviewAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlanMsg(null);
    const g = guarantorForm;
    if (!g.name.trim())                 { setPlanMsg({ ok: false, text: "Enter the guarantor's full name" }); return; }
    const gCnic = formatCnic(g.cnic);
    if (!gCnic)                         { setPlanMsg({ ok: false, text: "Enter the guarantor's 13-digit CNIC (e.g. 35202-1234567-8)" }); return; }
    if (gCnic === profile?.cnic)        { setPlanMsg({ ok: false, text: 'The guarantor must be someone other than you' }); return; }
    if (!/^\+?\d{10,13}$/.test(g.phone.replace(/[\s-]/g, ''))) { setPlanMsg({ ok: false, text: "Enter the guarantor's phone number (e.g. 03001234567)" }); return; }
    if (!g.relation.trim())             { setPlanMsg({ ok: false, text: 'Enter how the guarantor is related to you' }); return; }
    if (!g.address.trim())              { setPlanMsg({ ok: false, text: "Enter the guarantor's home address" }); return; }
    if (!planAddress.trim())            { setPlanMsg({ ok: false, text: 'Enter your home address' }); return; }
    const missingPicture = CNIC_PICTURE_SLOTS.find(([field]) => !cnicFiles[field]);
    if (missingPicture)                 { setPlanMsg({ ok: false, text: `Add a picture of ${missingPicture[2]}` }); return; }

    setPlanBusy(true);
    try {
      setPlanPreview(await api.post('/patient/installment-plans/preview', planRequestBody()));
      setAgreementAccepted(false);
    } catch (err: any) {
      setPlanMsg({ ok: false, text: err.message || 'Could not prepare the agreement. Please try again.' });
    } finally {
      setPlanBusy(false);
    }
  };

  const submitPlanApplication = async () => {
    if (!planPreview || !agreementAccepted) return;
    setPlanMsg(null);
    setPlanBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ ...planRequestBody(), acceptAgreement: true, agreementText: planPreview.agreementText }));
      CNIC_PICTURE_SLOTS.forEach(([field]) => { if (cnicFiles[field]) fd.append(field, cnicFiles[field] as File); });
      const created: any = await api.upload('/patient/installment-plans', fd);
      setWallets(prev => [created, ...prev]);
      setSelectedWalletId(created._id);
      setPlanTarget(null);
      setPlanPreview(null);
      loadPlanConfig();
      setWalletMsg({ ok: true, text: 'Application submitted. CareFirst will review it and notify you.' });
      navigate('myWallet');
    } catch (err: any) {
      // 409 from a changed price / plan: show the new terms for review
      if (err.status === 409 && /terms have changed/.test(err.message)) { setPlanPreview(null); setAgreementAccepted(false); }
      setPlanMsg({ ok: false, text: err.message || 'Could not submit the application. Please try again.' });
    } finally {
      setPlanBusy(false);
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
  // Plans with a running schedule; pending applications owe nothing yet
  const openWallets     = wallets.filter(w => ['active', 'defaulter'].includes(w.status));
  const openPlanCount   = wallets.filter(w => OPEN_PLAN_STATUSES.includes(w.status)).length;
  const maxOpenPlans    = planConfig?.maxOpenPlans ?? 2;
  const downPct         = planConfig?.downPaymentPercent ?? 20;
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

  // True Cost: travel per lab (null until calculated / when the lab has no location)
  const travelByLab: Record<string, any> = {};
  if (showTrueCost && travel) (travel.labs || []).forEach((l: any) => { travelByLab[String(l.labId)] = l; });
  const travelFor = (lab: any) => {
    const t = travelByLab[String(lab.labId)];
    return t && t.travelCost !== null ? t : null;
  };
  const travelModes = travel?.modes || [
    { key: 'motorbike', label: 'Motorbike', ratePerKm: 8 }, { key: 'car', label: 'Car', ratePerKm: 25 },
    { key: 'ride', label: 'Rickshaw / ride-hailing', ratePerKm: 50 },
  ];

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

  // With travel costs: cheapest true cost first (for the searched test), labs without a location last
  if (Object.keys(travelByLab).length) {
    const rank = (lab: any) => {
      const t = travelFor(lab);
      if (!t) return Infinity;
      return testSearch ? Math.min(...lab.tests.map((x: any) => x.price)) + t.travelCost : t.travelCost;
    };
    filteredLabs.sort((a, b) => rank(a) - rank(b));
  }
  const bestValueLabId = testSearch && filteredLabs[0] && travelFor(filteredLabs[0]) ? filteredLabs[0].labId : null;
  const anyApprox = Object.values(travelByLab).some((t: any) => t.source === 'approx');
  const allTestNames = [...new Set(allLabTests.flatMap(l => l.tests.map((t: any) => t.name)))] as string[];

  const filteredReports = reports.filter(r =>
    reportFilter === 'all' || (reportFilter === 'new' ? !r.isRead : r.isRead)
  );

  const wallet       = wallets.find(w => w._id === selectedWalletId) || wallets[0];
  const walletPaid   = wallet ? Math.max(0, (wallet.totalAmount || 0) - (wallet.remainingBalance ?? wallet.totalAmount ?? 0)) : 0;
  const walletPct    = wallet?.totalAmount ? Math.min(100, Math.round((walletPaid / wallet.totalAmount) * 100)) : 0;
  const receiptLog   = wallet
    ? [
        { ...wallet.serviceFee,  key: 'fee',  label: 'CareFirst service fee', labStep: false },
        { ...wallet.downPayment, key: 'down', label: 'Down payment',          labStep: true },
        ...(wallet.installments || []).map((inst: any, idx: number) => ({ ...inst, key: `inst-${idx}`, label: `Installment #${inst.number}`, labStep: true })),
      ]
        .filter((r: any) => r.receiptUrl)
        .sort((a: any, b: any) => new Date(b.receiptUploadedAt).getTime() - new Date(a.receiptUploadedAt).getTime())
    : [];

  // Appointments: upcoming soonest first, then past newest first
  const nowMs = Date.now();
  const upcomingAppts = appointments.filter(a => a.status === 'confirmed' && new Date(a.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const pastAppts = appointments.filter(a => !upcomingAppts.includes(a))
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const canCancelAppt = (a: any) => a.status === 'confirmed' && nowMs < new Date(a.startsAt).getTime() - PATIENT_CANCEL_HOURS * 3600000;
  const openLabVisits = labBookings.filter(b => ['confirmed', 'sample_collected'].includes(b.status)).length;

  // Installment plans that can pay for the lab test being booked (one booking per plan)
  const usedWallets = new Set(labBookings.filter(b => b.status !== 'cancelled' && b.wallet).map(b => String(b.wallet)));
  const payablePlans = labTarget ? wallets.filter(w =>
    String(w.lab?._id) === String(labTarget.lab.labId) &&
    (w.labTest ? String(w.labTest) === String(labTarget.test._id) : w.testName === labTarget.test.name) &&
    ['active', 'completed'].includes(w.status) && !usedWallets.has(String(w._id))
  ) : [];
  const visitDates = Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDaysTo(pktToday(), i));

  // Why a test can't be applied for right now (null = can apply)
  const planBlocker = (lab: any) =>
    cnicStatus === 'rejected'      ? 'Correct your CNIC on your Profile page first'
    : !lab.acceptsInstallments     ? 'This lab has not added payment details yet'
    : openPlanCount >= maxOpenPlans ? `You already have ${maxOpenPlans} open installment plans`
    : null;

  const pageBreadcrumbs: Record<string, string> = {
    dashboard:     'Dashboard',
    findDoctors:   'Find Doctors',
    bookTests:     'Book Tests',
    myReports:     'My Reports',
    myWallet:      'My Wallet',
    applyPlan:     'Apply for Installments',
    appointments:  'Appointments',
    bookAppointment: 'Book Appointment',
    bookLabTest:   'Book Lab Visit',
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

  // Where to send a payment — only the channels that are filled in
  const paymentDetails = (title: string, rows: [string, string | undefined][]) => (
    <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--border-md)', borderRadius: 'var(--radius-xs)', padding: '12px 14px', fontSize: '0.8rem' }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, padding: '2px 0', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 110 }}>{k}</span>
          <span style={{ fontWeight: 600, color: 'var(--text)', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{v}</span>
        </div>
      ))}
    </div>
  );
  const careFirstRows = (a: any): [string, string][] => [
    ['Bank', a?.bankName], ['Account title', a?.accountTitle], ['Account number', a?.accountNumber],
    ['JazzCash', a?.jazzCash], ['EasyPaisa', a?.easyPaisa],
  ];
  const labRows = (p: any): [string, string][] => [
    ['Bank', p?.bankName], ['Account number', p?.accountNumber], ['JazzCash', p?.jazzCash], ['EasyPaisa', p?.easyPaisa],
  ];

  const agreementBox = (text: string) => (
    <pre style={{
      whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.72rem', lineHeight: 1.55,
      maxHeight: 380, overflow: 'auto', margin: 0, padding: '14px 16px', color: 'var(--text)',
      background: 'var(--bg-alt)', border: '1px solid var(--border-md)', borderRadius: 'var(--radius-xs)',
    }}>{text}</pre>
  );

  // Report summary from the lab: English, Urdu (machine-translated or lab-corrected) and Listen
  const summaryBlock = (r: any) => {
    const auto = r.autoRead || {};
    const findings: any[] = auto.findings || [];
    const flagged = findings.filter(f => ['high', 'low', 'abnormal'].includes(f.status));
    const reading = ['pending', 'processing'].includes(auto.status);
    const seeDoctor = flagged.length > 0 || auto.kind === 'narrative' || auto.status === 'failed';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {reading && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Reading your report… the summary will appear here in a moment.</div>
        )}
        {(r.summary || r.summaryUrdu) && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {r.summary && (
              <div style={{ flex: '1 1 240px', fontSize: '0.8rem', color: 'var(--text-sub)' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 3 }}>
                  {r.summarySource === 'auto' ? 'Automatic summary' : 'Summary from the lab'}
                </div>
                {r.summary}
              </div>
            )}
            {r.summaryUrdu && (
              <div style={{ flex: '1 1 260px' }}>
                <UrduText text={r.summaryUrdu} style={{ color: 'var(--text)' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  {r.summaryUrduSource === 'machine' && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Machine translated</span>}
                  <ListenButton compact request={{ source: 'report', id: r._id }} />
                </div>
              </div>
            )}
          </div>
        )}

        {findings.length > 0 && (() => {
          const rowsFor = (list: any[]) => (
            <table style={{ marginTop: 6, width: '100%' }}>
              <thead><tr><th>Test</th><th>Your result</th><th>Normal range (from the report)</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((f: any, i: number) => {
                  const badge = f.status === 'high' ? ['High', 'pat-badge-red'] : f.status === 'low' ? ['Low', 'pat-badge-red']
                    : f.status === 'abnormal' ? ['Not normal', 'pat-badge-red'] : f.status === 'normal' ? ['Normal', 'pat-badge-green'] : ['Ask your doctor', 'pat-badge-amber'];
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{f.name}</td>
                      <td>{[f.result, f.unit && !String(f.result).includes(f.unit) ? f.unit : ''].filter(Boolean).join(' ')}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{f.range || '—'}</td>
                      <td><span className={`pat-badge ${badge[1]}`}><span className="pat-badge-dot"></span>{badge[0]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
          // Flagged results are always shown; the full list is one click away
          return (
            <div style={{ fontSize: '0.78rem' }}>
              {flagged.length > 0 && (
                <>
                  <div style={{ color: 'var(--text-sub)', fontWeight: 600 }}>{flagged.length} of {findings.length} results outside the normal range</div>
                  {rowsFor(flagged)}
                </>
              )}
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-sub)', fontWeight: 600 }}>
                  {flagged.length ? `Show all ${findings.length} results` : `${findings.length} results read from the report`}
                </summary>
                {rowsFor(findings)}
              </details>
            </div>
          );
        })()}

        {!reading && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 10, fontSize: '0.8rem',
            background: seeDoctor ? '#fef2f2' : '#f0fdf4', border: `1px solid ${seeDoctor ? '#fecaca' : '#bbf7d0'}`, color: seeDoctor ? '#991b1b' : '#166534',
          }}>
            <span style={{ flex: 1, minWidth: 220 }}>
              {auto.status === 'failed'
                ? "We couldn't read this report automatically. Please share it with your doctor and visit them."
                : seeDoctor
                  ? <><strong>Please share this report with your doctor and visit them</strong> to discuss these results.</>
                  : 'Share this report with your doctor at your next visit.'}
              {r.summarySource === 'auto' && <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.8, marginTop: 2 }}>Created automatically from your report — always check the original report.</span>}
            </span>
            {seeDoctor && <button type="button" className="pat-btn-primary pat-red" style={{ padding: '6px 14px', fontSize: '0.78rem' }} onClick={() => navigate('findDoctors')}>Book a doctor</button>}
          </div>
        )}
      </div>
    );
  };

  // Agreement with an English / Urdu switch; Listen reads the Urdu
  const agreementView = (textEn: string, textUr: string | undefined, request: any) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {pickChip('en', agreementLang === 'en', false, () => setAgreementLang('en'), 'English')}
        {textUr && pickChip('ur', agreementLang === 'ur', false, () => setAgreementLang('ur'), <span style={{ fontFamily: "'Noto Nastaliq Urdu', serif" }}>اردو</span>)}
        <span style={{ flex: 1 }} />
        {textUr && <ListenButton request={request} />}
      </div>
      {agreementLang === 'ur' && textUr
        ? <div style={{ maxHeight: 380, overflowY: 'auto', padding: '14px 18px', background: 'var(--bg-alt)', border: '1px solid var(--border-md)', borderRadius: 'var(--radius-xs)', color: 'var(--text)' }}>
            <UrduText text={textUr} />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>The English text is the binding version.</div>
          </div>
        : agreementBox(textEn)}
    </div>
  );

  const uploadButton = (key: string, label: string, onFile: (f?: File | null) => void) => (
    <label className="pat-upload-receipt-btn" style={{ cursor: uploadingKey ? 'wait' : 'pointer', opacity: uploadingKey && uploadingKey !== key ? 0.5 : 1 }}>
      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      {uploadingKey === key ? 'Uploading…' : label}
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden disabled={Boolean(uploadingKey)}
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );

  // Selectable chip for dates and times in the booking pages
  const pickChip = (key: string, active: boolean, disabled: boolean, onClick: () => void, children: React.ReactNode) => (
    <button key={key} type="button" className={`pat-spec-chip ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}
      style={{ ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}), display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25 }}>
      {children}
    </button>
  );

  // PDF slip to show at the clinic / lab
  const getSlip = (kind: string, id: string) =>
    downloadSlip(kind, id).catch((err: any) => alertDialog(err.message || 'Could not download the slip'));
  const slipLine = (n?: string) => n
    ? <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'ui-monospace, Consolas, monospace' }}>Slip {n}</div>
    : null;

  const smallBtn = (label: string, onClick: () => void, opts: { danger?: boolean; title?: string } = {}) => (
    <button type="button" className="pat-upload-receipt-btn" title={opts.title} onClick={onClick}
      style={opts.danger ? {} : { color: 'var(--text)' }}>
      {label}
    </button>
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
          <><strong>CNIC verification pending.</strong> An admin will verify your CNIC ({profile.cnic}). Community support unlocks once it's verified. You can already apply for an installment plan — the admin checks your CNIC pictures with the application.</>
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

            <button className={`pat-nav-item ${['appointments', 'bookAppointment', 'bookLabTest'].includes(currentPage) ? 'active' : ''}`} onClick={() => navigate('appointments')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                <line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>
              </svg>
              Appointments
              {upcomingAppts.length + openLabVisits > 0 && <span className="pat-nav-badge">{upcomingAppts.length + openLabVisits}</span>}
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
                      {upcomingAppts[0] && (
                        <div className="pat-hero-pill pat-green" style={{ cursor: 'pointer' }} onClick={() => navigate('appointments')}>
                          Next: {drName(upcomingAppts[0].doctor?.name)} · {dayLabel(upcomingAppts[0].date)} {time12(upcomingAppts[0].time)}
                        </div>
                      )}
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
                        {(doc.clinicName || doc.clinicAddress) && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {[doc.clinicName, doc.clinicAddress].filter(Boolean).join(' · ')}
                          </div>
                        )}
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
                      style={{ width: '100%', justifyContent: 'center', ...(doc.availableDays.length ? {} : { opacity: 0.55, cursor: 'not-allowed' }) }}
                      disabled={!doc.availableDays.length}
                      title={doc.availableDays.length ? 'See free times and book a clinic visit' : 'This doctor has not published a schedule yet'}
                      onClick={() => startAppointment(doc)}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                        <line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>
                      </svg>
                      Book Appointment
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
                  onClick={toggleTrueCost}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  True Cost Analysis
                </button>
              </div>

              {showTrueCost && (
                <div className="pat-card pat-fade-up" style={{ padding: '18px 22px', marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem', flex: 1, minWidth: 220 }}>
                      True cost = test price + travel to the lab and back
                    </div>
                    <button type="button" className="pat-btn-ghost" onClick={useMyLocation} disabled={travelBusy}>
                      {myPos ? 'Update my location' : 'Use my location'}
                    </button>
                    <button type="button" className="pat-btn-ghost" onClick={() => setShowPosMap(v => !v)}>
                      {showPosMap ? 'Hide map' : 'Pick on map'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>I'll travel by</span>
                    {travelModes.map((m: any) => (
                      <button key={m.key} type="button" className={`pat-spec-chip ${travelMode === m.key ? 'active' : ''}`} onClick={() => setTravelMode(m.key)}>
                        {m.label} · {pkr(m.ratePerKm)}/km
                      </button>
                    ))}
                  </div>

                  {showPosMap && (
                    <div style={{ marginBottom: 10 }}>
                      <MapPicker value={myPos} onChange={p => { setMyPos(p); setTravelMsg(null); }} height={240} />
                    </div>
                  )}

                  {banner(travelMsg)}
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    {travelBusy ? 'Calculating road distances…'
                      : !myPos ? 'Share your location or drop a pin to see travel costs. Your location is only used for this calculation and is not saved.'
                      : anyApprox ? 'Some distances are approximate — the route service is unavailable right now.' : null}
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
                          {lab.labId === bestValueLabId && (
                            <span style={{ fontSize: '0.65rem', background: 'var(--text)', color: '#fff', borderRadius: 10, padding: '1px 8px', fontWeight: 700 }}>Best value</span>
                          )}
                        </div>
                        <div className="pat-lab-location">
                          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" style={{ marginRight: 3, verticalAlign: 'middle' }}>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                          {lab.location}
                        </div>
                        {travel && showTrueCost && (() => {
                          const t = travelFor(lab);
                          return (
                            <div style={{ fontSize: '0.74rem', marginTop: 3, color: t ? 'var(--text-sub)' : 'var(--text-muted)' }}>
                              {t
                                ? <>{t.source === 'approx' ? '≈ ' : ''}{t.distanceKm} km · {t.durationMin} min · travel <strong style={{ color: 'var(--text)' }}>{pkr(t.travelCost)}</strong> there &amp; back</>
                                : 'Lab has not set its location — travel cost unknown'}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="pat-lab-prices">
                      {lab.tests.map((t: any, ti: number) => (
                        <div key={t._id} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 0', borderBottom: ti < lab.tests.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.84rem' }}>{t.name}</span>
                            <span className="pat-price-val">{pkr(t.price)}</span>
                          </div>
                          {travelFor(lab) && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-sub)' }}>
                              <span>True cost (with travel)</span>
                              <strong style={{ color: 'var(--text)' }}>{pkr(t.price + travelFor(lab).travelCost)}</strong>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t.category}</span>
                            {t.installmentEnabled && (() => {
                              const est = planEstimate(t.price, t.installmentCount, downPct);
                              return (
                                <span style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>
                                  {pkr(est.down)} down · {t.installmentCount} × ~{pkr(est.perInstallment)} every {t.installmentTenureDays} days
                                </span>
                              );
                            })()}
                          </div>
                          {(() => {
                            const blocker = t.installmentEnabled ? planBlocker(lab) : null;
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                                <button type="button" className="pat-upload-receipt-btn" style={{ color: 'var(--blue)' }}
                                  title="Pick a visit date — pay at the lab or with an installment plan" onClick={() => startLabBooking(lab, t)}>
                                  Book visit
                                </button>
                                {t.installmentEnabled && (
                                  <button
                                    type="button"
                                    className="pat-upload-receipt-btn"
                                    disabled={Boolean(blocker)}
                                    title={blocker || 'Pay for this test in installments'}
                                    style={blocker ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                    onClick={() => startPlanApplication(lab, t)}
                                  >
                                    Apply for installments
                                  </button>
                                )}
                                {blocker && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{blocker}</span>}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ══ BOOK APPOINTMENT (opened from Find Doctors) ═════ */}
            <section className={`pat-page-section ${currentPage === 'bookAppointment' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">Book Appointment</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Pick a day and a free time — your booking is confirmed straight away</div>
              </div>

              {!apptDoctor ? (
                <div className="pat-card" style={{ padding: '32px 28px', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                  Choose a doctor in <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('findDoctors')}>Find Doctors</a>.
                </div>
              ) : (() => {
                const day = apptSlots?.days?.find((d: any) => d.date === apptDate);
                return (
                  <>
                    <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '20px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                        <div className="pat-doc-avatar">{(apptDoctor.name || 'D').replace(/^dr\.?\s*/i, '')[0]?.toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{drName(apptDoctor.name)}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{apptDoctor.specialization} · {apptSlots?.consultationDuration || apptDoctor.consultationDuration || 20}-minute consultations</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{apptDoctor.consultationFee > 0 ? pkr(apptDoctor.consultationFee) : 'Fee not set'}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Paid at the clinic</div>
                        </div>
                      </div>
                    </div>

                    <div className="pat-card pat-fade-up pat-fade-up-2" style={{ padding: '20px 24px' }}>
                      {banner(bookingMsg)}
                      {!apptSlots ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{bookingMsg ? '' : 'Loading free times…'}</div>
                      ) : !apptSlots.days.some((d: any) => d.times.length) ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No free times in the next {apptSlots.windowDays} days. Please check back later or choose another doctor.</div>
                      ) : (
                        <>
                          <div className="pat-form-label" style={{ marginBottom: 8 }}>Day</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                            {apptSlots.days.map((d: any) => pickChip(d.date, d.date === apptDate, !d.times.length, () => { setApptDate(d.date); setApptTime(''); }, <>
                              <span style={{ fontWeight: 700 }}>{dayLabel(d.date, { weekday: 'short' })}</span>
                              <span>{dayLabel(d.date, { day: 'numeric', month: 'short' })}</span>
                              <span style={{ fontSize: '0.66rem', opacity: 0.75 }}>{d.times.length ? `${d.times.length} free` : 'Full / off'}</span>
                            </>))}
                          </div>
                          <div className="pat-form-label" style={{ marginBottom: 8 }}>Time {day && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                            {(day?.times || []).map((t: any) => pickChip(t.time, t.time === apptTime, false, () => setApptTime(t.time), t.label))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                            <div style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-sub)', minWidth: 220 }}>
                              {apptTime
                                ? <><strong style={{ color: 'var(--text)' }}>{dayLabel(apptDate, { weekday: 'long', day: 'numeric', month: 'long' })} at {time12(apptTime)}</strong> · pay {apptDoctor.consultationFee > 0 ? pkr(apptDoctor.consultationFee) : 'the fee'} at the clinic. You can cancel up to {PATIENT_CANCEL_HOURS} hours before.</>
                                : 'Choose a time to continue.'}
                            </div>
                            <button type="button" className="pat-btn-primary pat-red" disabled={!apptTime || bookingBusy} onClick={confirmAppointment}
                              style={!apptTime || bookingBusy ? { opacity: 0.5, cursor: bookingBusy ? 'wait' : 'not-allowed' } : {}}>
                              {bookingBusy ? 'Booking…' : 'Confirm Appointment'}
                            </button>
                            <button type="button" className="pat-btn-ghost" onClick={() => navigate('findDoctors')} disabled={bookingBusy}>Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </section>

            {/* ══ BOOK LAB VISIT (opened from Book Tests) ═════════ */}
            <section className={`pat-page-section ${currentPage === 'bookLabTest' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">Book Lab Visit</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Choose the day you'll visit the lab — no appointment time needed</div>
              </div>

              {!labTarget ? (
                <div className="pat-card" style={{ padding: '32px 28px', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                  Choose a test in <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('bookTests')}>Book Tests</a>.
                </div>
              ) : (
                <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '22px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1rem' }}>{labTarget.test.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{labTarget.lab.labName} · {labTarget.lab.location}</div>
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1rem' }}>{pkr(labTarget.test.price)}</div>
                  </div>

                  {banner(bookingMsg)}

                  <div className="pat-form-label" style={{ marginBottom: 8 }}>Visit date</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    {visitDates.map(d => pickChip(d, d === visitDate, false, () => setVisitDate(d), <>
                      <span style={{ fontWeight: 700 }}>{d === pktToday() ? 'Today' : dayLabel(d, { weekday: 'short' })}</span>
                      <span>{dayLabel(d, { day: 'numeric', month: 'short' })}</span>
                    </>))}
                  </div>

                  <div className="pat-form-label" style={{ marginBottom: 8 }}>Payment</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, fontSize: '0.84rem' }}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name="labPay" checked={!payWallet} onChange={() => setPayWallet('')} />
                      <span>Pay <strong>{pkr(labTarget.test.price)}</strong> at the lab</span>
                    </label>
                    {payablePlans.map(w => (
                      <label key={w._id} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" name="labPay" checked={payWallet === w._id} onChange={() => setPayWallet(w._id)} />
                        <span>Use my installment plan — {w.testName} ({PLAN_STATUS[w.status]?.label.toLowerCase()}, {pkr(w.totalAmount)})</span>
                      </label>
                    ))}
                    {payablePlans.length === 0 && labTarget.test.installmentEnabled && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Want to pay in installments? <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => startPlanApplication(labTarget.lab, labTarget.test)}>Apply for a plan</a> first — once it's active you can book with it.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-sub)', minWidth: 220 }}>
                      <strong style={{ color: 'var(--text)' }}>{visitDate && dayLabel(visitDate, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
                      {' · '}{payWallet ? 'covered by your installment plan' : 'pay at the lab'}. You can cancel until the day before.
                    </div>
                    <button type="button" className="pat-btn-primary pat-red" disabled={!visitDate || bookingBusy} onClick={confirmLabBooking}
                      style={bookingBusy ? { opacity: 0.6, cursor: 'wait' } : {}}>
                      {bookingBusy ? 'Booking…' : 'Confirm Visit'}
                    </button>
                    <button type="button" className="pat-btn-ghost" onClick={() => navigate('bookTests')} disabled={bookingBusy}>Cancel</button>
                  </div>
                </div>
              )}
            </section>

            {/* ══ APPOINTMENTS (doctor visits + lab visits) ════════ */}
            <section className={`pat-page-section ${currentPage === 'appointments' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="pat-page-title">Appointments</div>
                  <div className="pat-page-title-rule"></div>
                  <div className="pat-page-subtitle">Your clinic visits and lab visits — fees are paid at the clinic or lab</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="pat-btn-ghost" onClick={() => navigate('findDoctors')}>Book a doctor</button>
                  <button className="pat-btn-ghost" onClick={() => navigate('bookTests')}>Book a test</button>
                </div>
              </div>

              {banner(visitsMsg)}

              <div className="pat-card pat-fade-up pat-fade-up-1">
                <div className="pat-card-header">
                  <div className="pat-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                    Doctor Appointments
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Cancel up to {PATIENT_CANCEL_HOURS} hours before</div>
                </div>
                <div className="pat-table-wrap">
                  <table>
                    <thead>
                      <tr><th>When</th><th>Doctor</th><th>Fee</th><th>Status</th><th>Prescription</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {!loaded.appointments ? emptyRow(6, 'Loading appointments…')
                        : appointments.length === 0 ? emptyRow(6, 'No appointments yet — book one from Find Doctors.')
                        : [...upcomingAppts, ...pastAppts].map((a: any) => {
                          const st = APPT_STATUS[a.status] || { label: a.status, cls: 'pat-badge-amber' };
                          const upcoming = upcomingAppts.includes(a);
                          return (
                            <tr key={a._id} style={upcoming ? {} : { opacity: 0.8 }}>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{dayLabel(a.date)}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{time12(a.time)} · {a.durationMinutes} min</div>
                                {a.status !== 'cancelled' && slipLine(a.slipNumber)}
                              </td>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{drName(a.doctor?.name)}</div>
                                {a.doctorSpecialization && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.doctorSpecialization}</div>}
                                {a.doctorClinic && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: 220 }}>{a.doctorClinic}</div>}
                              </td>
                              <td>{pkr(a.fee)}<div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>at the clinic</div></td>
                              <td>
                                <span className={`pat-badge ${st.cls}`}><span className="pat-badge-dot"></span>{st.label}</span>
                                {a.status === 'cancelled' && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3, maxWidth: 220 }}>
                                    {a.cancelledBy === 'doctor' ? `By the doctor: ${a.cancellationReason}` : 'By you'}
                                  </div>
                                )}
                              </td>
                              <td style={{ fontSize: '0.78rem' }}>
                                {a.prescription
                                  ? (a.prescription.tests || []).map((t: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.testName}</span>
                                      {smallBtn('Find labs', () => findLabsFor(t.testName))}
                                    </div>
                                  ))
                                  : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                  {a.status !== 'cancelled' && smallBtn('Slip (PDF)', () => getSlip('appointment', a._id), { title: 'Download the appointment slip to show at the clinic' })}
                                  {canCancelAppt(a)
                                    ? smallBtn('Cancel', () => cancelMyAppointment(a), { danger: true })
                                    : upcoming
                                      ? <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Within {PATIENT_CANCEL_HOURS} h — call the clinic</span>
                                      : a.status === 'cancelled' && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pat-card pat-fade-up pat-fade-up-2">
                <div className="pat-card-header">
                  <div className="pat-card-title">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    Lab Visits
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Cancel until the day before the visit</div>
                </div>
                <div className="pat-table-wrap">
                  <table>
                    <thead>
                      <tr><th>Visit Date</th><th>Test</th><th>Payment</th><th>Status</th><th>Report</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {!loaded.labBookings ? emptyRow(6, 'Loading lab visits…')
                        : labBookings.length === 0 ? emptyRow(6, 'No lab visits yet — book one from Book Tests.')
                        : labBookings.map((b: any) => {
                          const st = LAB_STATUS[b.status] || { label: b.status, cls: 'pat-badge-amber' };
                          return (
                            <tr key={b._id}>
                              <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                                {b.visitDate === pktToday() ? 'Today' : dayLabel(b.visitDate)}
                                {b.status !== 'cancelled' && slipLine(b.slipNumber)}
                              </td>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{b.testName}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{b.labName}{b.labLocation ? ` · ${b.labLocation}` : ''}</div>
                              </td>
                              <td style={{ fontSize: '0.8rem' }}>{b.paymentMethod === 'installment' ? 'Installment plan' : <>{pkr(b.price)}<div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>at the lab</div></>}</td>
                              <td><span className={`pat-badge ${st.cls}`}><span className="pat-badge-dot"></span>{st.label}</span></td>
                              <td>
                                {b.report?.reportUrl
                                  ? <>
                                      <a href={b.report.reportUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600, fontSize: '0.78rem' }}>View report</a>
                                      {b.report.summaryUrdu && <div style={{ marginTop: 4 }}><ListenButton compact request={{ source: 'report', id: b.report._id }} /></div>}
                                    </>
                                  : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                  {b.status !== 'cancelled' && smallBtn('Slip (PDF)', () => getSlip('lab-booking', b._id), { title: 'Download the visit slip to show at the lab' })}
                                  {b.status === 'confirmed' && b.visitDate > pktToday()
                                    ? smallBtn('Cancel', () => cancelLabVisit(b), { danger: true })
                                    : b.status === 'cancelled' && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>}
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

            {/* ══ APPLY FOR INSTALLMENTS (opened from Book Tests) ═ */}
            <section className={`pat-page-section ${currentPage === 'applyPlan' ? 'active' : ''}`}>
              <div className="pat-page-header pat-fade-up">
                <div className="pat-page-title">Apply for Installments</div>
                <div className="pat-page-title-rule"></div>
                <div className="pat-page-subtitle">Add a guarantor and CNIC pictures, read the agreement and submit — CareFirst reviews every application</div>
              </div>

              {!planTarget ? (
                <div className="pat-card" style={{ padding: '32px 28px', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                  Choose a test with an installments tag in <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('bookTests')}>Book Tests</a>.
                </div>
              ) : (() => {
                const { lab, test } = planTarget;
                const est   = planEstimate(test.price, test.installmentCount, downPct);
                const terms = planPreview;
                const installments: number[] = terms?.installments || [];
                const lastDiffers = installments.length > 1 && installments[installments.length - 1] !== installments[0];
                return (
                  <>
                    {/* Plan summary */}
                    <div className="pat-card pat-fade-up pat-fade-up-1" style={{ padding: '22px 24px' }}>
                      <div className="pat-card-title" style={{ marginBottom: 14 }}>{test.name} · {lab.labName}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, fontSize: '0.82rem' }}>
                        {[
                          ['Test price', pkr(terms?.totalAmount ?? test.price), ''],
                          [`Down payment (${downPct}%)`, pkr(terms?.downPayment ?? est.down), 'Paid to the lab'],
                          ['Installments', terms
                            ? `${installments.length} × ${pkr(installments[0])}`
                            : `${test.installmentCount} × ~${pkr(est.perInstallment)}`,
                            lastDiffers ? `Last one ${pkr(installments[installments.length - 1])} · paid to the lab` : `Every ${test.installmentTenureDays} days · paid to the lab`],
                          ['Service fee', pkr(terms?.serviceFee ?? planConfig?.serviceFee ?? 0), 'Paid to CareFirst, once'],
                        ].map(([label, value, sub]) => (
                          <div key={label}>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
                            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.98rem' }}>{value}</div>
                            {sub && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2 }}>{sub}</div>}
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 16, fontSize: '0.76rem', color: 'var(--text-sub)', lineHeight: 1.6 }}>
                        <strong>How it works:</strong> CareFirst reviews your application → you pay the service fee to CareFirst and upload the screenshot →
                        once it's verified the plan starts: pay the down payment to the lab, then one installment every {test.installmentTenureDays} days (the first is due {test.installmentTenureDays} days after the plan starts).
                        Upload a receipt for every payment from My Wallet.
                      </div>
                    </div>

                    {/* Guarantor */}
                    <div className="pat-card pat-fade-up pat-fade-up-2" style={{ padding: '22px 24px' }}>
                      <div className="pat-card-title" style={{ marginBottom: 6 }}>Guarantor</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                        Someone other than you who agrees to be jointly responsible for the payments. Their details go into the agreement.
                      </div>
                      {!terms && banner(planMsg)}
                      <form onSubmit={reviewAgreement}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
                          {[
                            ['name',     'Full name',  'e.g. Kamran Khan',        'text'],
                            ['cnic',     'CNIC',       '35202-1234567-8',         'text'],
                            ['phone',    'Phone',      '03001234567',             'tel'],
                            ['relation', 'Relation to you', 'e.g. Brother, Father', 'text'],
                          ].map(([field, label, placeholder, type]) => (
                            <div className="pat-form-section" key={field}>
                              <label className="pat-form-label" htmlFor={`g-${field}`}>{label}</label>
                              <input id={`g-${field}`} className="pat-form-input" type={type} placeholder={placeholder}
                                value={(guarantorForm as any)[field]} onChange={e => updateGuarantor(field, e.target.value)} disabled={planBusy} />
                            </div>
                          ))}
                        </div>
                        <div className="pat-form-section">
                          <label className="pat-form-label" htmlFor="g-address">Guarantor's home address</label>
                          <input id="g-address" className="pat-form-input" type="text" placeholder="House, street, city"
                            value={guarantorForm.address} onChange={e => updateGuarantor('address', e.target.value)} disabled={planBusy} />
                        </div>
                        <div className="pat-form-section">
                          <label className="pat-form-label" htmlFor="p-address">Your home address</label>
                          <input id="p-address" className="pat-form-input" type="text" placeholder="House, street, city"
                            value={planAddress} onChange={e => updatePlanAddress(e.target.value)} disabled={planBusy} />
                        </div>

                        <div className="pat-card-title" style={{ margin: '8px 0 6px' }}>CNIC pictures</div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                          Clear photos of the front and back of your CNIC ({profile?.cnic}) and your guarantor's. CareFirst checks them before approving the plan;
                          only you, CareFirst's admin and — if the plan goes into default — CareFirst's lawyer can see them. JPG or PNG, up to 10 MB each.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
                          {CNIC_PICTURE_SLOTS.map(([field, label]) => (
                            <CnicPicturePicker key={field} label={label} file={cnicFiles[field]}
                              onChange={f => chooseCnicPicture(field, f)} disabled={planBusy} />
                          ))}
                        </div>
                        {!terms && (
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button type="submit" className="pat-btn-primary pat-red" disabled={planBusy} style={planBusy ? { opacity: 0.6, cursor: 'wait' } : {}}>
                              {planBusy ? 'Preparing…' : 'Review Agreement'}
                            </button>
                            <button type="button" className="pat-btn-ghost" onClick={() => navigate('bookTests')} disabled={planBusy}>Cancel</button>
                          </div>
                        )}
                      </form>
                    </div>

                    {/* Agreement */}
                    {terms && (
                      <div className="pat-card pat-fade-up" style={{ padding: '22px 24px' }}>
                        <div className="pat-card-title" style={{ marginBottom: 14 }}>Installment Plan Agreement</div>
                        {agreementView(terms.agreementText, terms.agreementTextUrdu,
                          { source: 'agreement-preview', labId: lab.labId, testId: test._id, patientAddress: planAddress, guarantor: planRequestBody().guarantor })}
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '16px 0', fontSize: '0.82rem', color: 'var(--text)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={agreementAccepted} onChange={e => setAgreementAccepted(e.target.checked)} disabled={planBusy} style={{ marginTop: 3 }} />
                          <span>I have read this agreement, my guarantor has agreed to it, and I accept its terms.</span>
                        </label>
                        {banner(planMsg)}
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button type="button" className="pat-btn-primary pat-red" onClick={submitPlanApplication}
                            disabled={!agreementAccepted || planBusy}
                            style={!agreementAccepted || planBusy ? { opacity: 0.5, cursor: planBusy ? 'wait' : 'not-allowed' } : {}}>
                            {planBusy ? 'Submitting…' : 'Accept & Submit Application'}
                          </button>
                          <button type="button" className="pat-btn-ghost" onClick={() => navigate('bookTests')} disabled={planBusy}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
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
                        <React.Fragment key={r._id}>
                        <tr>
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
                        {(r.summary || r.summaryUrdu || r.autoRead?.status && r.autoRead.status !== 'skipped') && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--bg-alt)', padding: '10px 18px 14px' }}>
                              {summaryBlock(r)}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
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
                              <div key={i} style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span>
                                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.testName}</span>
                                  {t.notes && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}> — {t.notes}</span>}
                                </span>
                                {smallBtn('Find labs', () => findLabsFor(t.testName), { title: `Labs offering ${t.testName}` })}
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
                    Tests you can pay for in installments have an "Apply for installments" button in <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('bookTests')}>Book Tests</a>.
                    {cnicStatus === 'rejected' && ' Correct your CNIC on your Profile page before applying.'}
                  </div>
                </div>
              ) : wallet && (
                <>
                  {wallets.length > 1 && (
                    <div className="pat-specialty-chips pat-fade-up" style={{ marginBottom: 16 }}>
                      {wallets.map(w => (
                        <button key={w._id} className={`pat-spec-chip ${w._id === wallet._id ? 'active' : ''}`} onClick={() => { setSelectedWalletId(w._id); setWalletMsg(null); setShowAgreement(false); }}>
                          {w.testName} · {w.labName} · {PLAN_STATUS[w.status]?.label || w.status}
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

                  {wallet.status === 'pending_approval' && (
                    <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20 }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <div className="pat-true-cost-text">
                        <strong>Application under review.</strong> Submitted {fmtDate(wallet.createdAt)}. You'll be notified when CareFirst approves it — then you pay the {pkr(wallet.serviceFee?.amount)} service fee to activate the plan.
                      </div>
                    </div>
                  )}

                  {wallet.status === 'rejected' && (
                    <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20, borderColor: '#fecaca', background: '#fef2f2' }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <div className="pat-true-cost-text">
                        <strong>This application was not approved.</strong> {wallet.rejectionReason} You can apply again from <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('bookTests')}>Book Tests</a>.
                      </div>
                    </div>
                  )}

                  {wallet.status === 'completed' && (
                    <div className="pat-true-cost-banner pat-fade-up" style={{ marginBottom: 20, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                      <svg width="16" height="16" fill="none" stroke="#166534" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      <div className="pat-true-cost-text"><strong>Fully paid.</strong> Every payment on this plan has been verified.</div>
                    </div>
                  )}

                  {/* Service fee — paid to CareFirst once the application is approved */}
                  {wallet.status === 'awaiting_fee' && (
                    <div className="pat-card pat-fade-up" style={{ padding: '20px 22px' }}>
                      <div className="pat-card-title" style={{ marginBottom: 6 }}>Approved — pay the CareFirst service fee</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginBottom: 14 }}>
                        Send <strong>{pkr(wallet.serviceFee?.amount)}</strong> to CareFirst and upload the screenshot. Your plan starts once CareFirst verifies it.
                        This fee is separate from the test price, which you pay to the lab.
                      </div>
                      {wallet.serviceFee?.rejectionReason && (
                        <div style={{ fontSize: '0.8rem', color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
                          Your last screenshot could not be verified: {wallet.serviceFee.rejectionReason}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 260px' }}>
                          {paymentDetails('CareFirst account', careFirstRows(planConfig?.careFirstAccount))}
                          {planConfig?.supportEmail && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>Questions? Email {planConfig.supportEmail}</div>
                          )}
                        </div>
                        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                          {wallet.serviceFee?.receiptUrl && (
                            <span style={{ fontSize: '0.8rem' }}>
                              <a href={wallet.serviceFee.receiptUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600 }}>Screenshot uploaded ✓</a>
                              <span style={{ color: 'var(--text-muted)' }}> · awaiting CareFirst verification</span>
                            </span>
                          )}
                          {uploadButton(`${wallet._id}-service-fee`, wallet.serviceFee?.receiptUrl ? 'Replace Screenshot' : 'Upload Screenshot',
                            f => uploadReceipt(wallet._id, 'service-fee', f))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Down payment — paid to the lab once the plan is active */}
                  {['active', 'defaulter', 'completed'].includes(wallet.status) && wallet.downPayment?.amount > 0 && (() => {
                    const dp = wallet.downPayment;
                    const stage = installmentStage(dp);
                    const canUpload = wallet.status === 'active' && !dp.labApproved && !dp.adminVerified;
                    return (
                      <div className="pat-card pat-fade-up" style={{ padding: '20px 22px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                          <div className="pat-card-title">Down payment · {pkr(dp.amount)}</div>
                          <span className={`pat-badge ${dp.adminVerified ? 'pat-badge-green' : 'pat-badge-amber'}`}><span className="pat-badge-dot"></span>
                            {dp.adminVerified ? 'Paid' : dp.receiptUrl ? stage.label : 'Due now'}
                          </span>
                        </div>
                        {!dp.adminVerified && (
                          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 12 }}>
                            <div style={{ flex: '1 1 260px' }}>{paymentDetails(`Pay ${wallet.labName} directly`, labRows(wallet.labPayment))}</div>
                            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                              {dp.receiptUrl && (
                                <span style={{ fontSize: '0.8rem' }}>
                                  <a href={dp.receiptUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600 }}>Receipt uploaded ✓</a>
                                  <span style={{ color: 'var(--text-muted)' }}> · {stage.verification.toLowerCase()}</span>
                                </span>
                              )}
                              {canUpload && uploadButton(`${wallet._id}-down-payment`, dp.receiptUrl ? 'Replace Receipt' : 'Upload Receipt',
                                f => uploadReceipt(wallet._id, 'down-payment', f))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                        <div className="pat-ws-sub">
                          {wallet.downPayment?.adminVerified ? 'Verified ✓'
                            : ['pending_approval', 'awaiting_fee'].includes(wallet.status) ? 'Due when plan starts'
                            : wallet.downPayment?.receiptUrl ? 'Awaiting verification'
                            : wallet.status === 'active' ? 'Due — pay the lab' : '—'}
                        </div>
                      </div>
                      <div className="pat-ws-divider"></div>
                      <div className="pat-ws-item">
                        <div className="pat-ws-label">Service Fee</div>
                        <div className={`pat-ws-val ${wallet.serviceFee?.adminVerified ? 'pat-ws-paid' : ''}`}>{pkr(wallet.serviceFee?.amount)}</div>
                        <div className="pat-ws-sub">
                          {wallet.serviceFee?.adminVerified ? 'Verified ✓'
                            : wallet.status === 'pending_approval' ? 'Due after approval'
                            : wallet.status === 'awaiting_fee' ? (wallet.serviceFee?.receiptUrl ? 'Awaiting verification' : 'Due now')
                            : 'Paid to CareFirst'}
                        </div>
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
                          {(wallet.installments || []).length === 0
                            ? emptyRow(7, wallet.status === 'rejected' ? 'No schedule — the application was not approved.'
                              : `${wallet.installmentCount || ''} installments every ${wallet.installmentTenureDays || '—'} days — due dates are set when the plan starts.`)
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
                                    uploadButton(key, inst.receiptUrl ? 'Replace Receipt' : 'Upload Receipt', f => uploadReceipt(wallet._id, idx, f))
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
                            <th>Payment</th>
                            <th>Uploaded On</th>
                            <th>Amount</th>
                            <th>Receipt</th>
                            <th style={{ textAlign: 'right' }}>Verification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptLog.length === 0 ? emptyRow(5, 'No receipts uploaded yet.')
                            : receiptLog.map((r: any) => (
                            <tr key={r.key}>
                              <td style={{ fontWeight: 500, color: 'var(--text)' }}>{r.label} — {wallet.testName}</td>
                              <td>{fmtDate(r.receiptUploadedAt)}</td>
                              <td style={{ fontWeight: 600 }}>{pkr(r.amount)}</td>
                              <td><a href={r.receiptUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', fontWeight: 600 }}>View</a></td>
                              <td style={{ textAlign: 'right' }}>
                                {r.adminVerified
                                  ? <span style={{ color: '#166534', fontWeight: 700, fontSize: '0.78rem' }}>Admin Verified ✓</span>
                                  : !r.labStep
                                    ? <span style={{ color: '#854d0e', fontSize: '0.78rem' }}>Awaiting CareFirst verification</span>
                                  : r.labApproved
                                    ? <span style={{ color: '#854d0e', fontSize: '0.78rem' }}>Lab confirmed · awaiting admin</span>
                                    : <span style={{ color: '#854d0e', fontSize: '0.78rem' }}>Awaiting lab confirmation</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Agreement & guarantor */}
                  {wallet.agreement?.text && (
                    <div className="pat-card pat-fade-up" style={{ padding: '18px 22px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <div>
                          <div className="pat-card-title">Agreement & Guarantor</div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                            Guarantor: {wallet.guarantor?.name} ({wallet.guarantor?.relation}) · accepted {fmtDate(wallet.agreement.acceptedAt)}
                          </div>
                        </div>
                        <button type="button" className="pat-btn-ghost" onClick={() => setShowAgreement(s => !s)}>
                          {showAgreement ? 'Hide agreement' : 'View agreement'}
                        </button>
                      </div>
                      {showAgreement && (
                        <div style={{ marginTop: 14 }}>
                          {agreementView(wallet.agreement.text, wallet.agreement.textUrdu, { source: 'agreement', id: wallet._id })}
                          <div className="pat-card-title" style={{ margin: '18px 0 10px' }}>CNIC pictures you sent</div>
                          <CnicPictureGallery walletId={wallet._id} pictures={wallet.cnicPictures} patientName="You" guarantorName={wallet.guarantor?.name || 'Guarantor'} />
                        </div>
                      )}
                    </div>
                  )}
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
                                <div><strong>Slip:</strong> <span style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{a.slip?.slipId || '—'}</span></div>
                                <div><strong>Lab:</strong> {[a.labName, a.labLocation].filter(Boolean).join(' · ')}</div>
                                <div>{a.testConducted ? `Test conducted on ${fmtDate(a.conductedAt)}` : 'Take the slip and your CNIC to the lab'}</div>
                                <div style={{ marginTop: 6 }}>{smallBtn('Download slip (PDF)', () => getSlip('community', a._id), { title: 'Your approval slip with the documents you sent' })}</div>
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
