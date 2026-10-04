import React, { useState, useEffect } from 'react';
import './DoctorDashboard.css';
import { api, getSession, clearSession } from '../lib/api';
import { getSocket } from '../lib/socket';
import { ListenButton, UrduText } from '../components/Urdu';

// ── Common tests, suggested on Prescribe Test along with what labs offer ──────
const TESTS = [
  'Complete Blood Count (CBC)',
  'Lipid Panel',
  'Thyroid Profile',
  'X-Ray Chest',
  'MRI Brain',
  'ECG / Electrocardiogram',
  'Urinalysis',
  'Liver Function Test',
  'Blood Glucose (Fasting)',
];

// ── Demo / fallback dummy data (used only when backend returns nothing) ────────
const DUMMY_PROFILE_DATA = {
  specialization: 'Cardiologist',
  experience:     12,
  bio:            'Consultant Cardiologist with 12+ years of clinical experience in interventional cardiology and cardiac imaging.',
  rating:         4.8,
};

const DUMMY_FEE = 2500;

const mkDate = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();

const DUMMY_PRESCRIPTIONS = [
  { _id: 'dp1', patient: { _id: 'pat1', name: 'Ayesha Raza' },   tests: [{ testName: 'CBC + Lipid Panel' }],        createdAt: mkDate(2)  },
  { _id: 'dp2', patient: { _id: 'pat2', name: 'Omar Farooq' },   tests: [{ testName: 'Thyroid Profile' }],          createdAt: mkDate(5)  },
  { _id: 'dp3', patient: { _id: 'pat3', name: 'Noor Fatima' },   tests: [{ testName: 'X-Ray Chest' }],              createdAt: mkDate(8)  },
  { _id: 'dp4', patient: { _id: 'pat4', name: 'Hamza Tariq' },   tests: [{ testName: 'Blood Glucose (Fasting)' }],  createdAt: mkDate(12) },
  { _id: 'dp5', patient: { _id: 'pat5', name: 'Sara Zainab' },   tests: [{ testName: 'MRI Brain' }],                createdAt: mkDate(18) },
  { _id: 'dp6', patient: { _id: 'pat6', name: 'Bilal Ahmed' },   tests: [{ testName: 'Liver Function Test' }],      createdAt: mkDate(22) },
  { _id: 'dp7', patient: { _id: 'pat7', name: 'Zara Hussain' },  tests: [{ testName: 'ECG / Electrocardiogram' }],  createdAt: mkDate(30) },
];

const DUMMY_REPORTS = [
  { _id: 'dr1', patient: { name: 'Ayesha Raza' },  testName: 'Complete Blood Count',    labName: 'LifeCare Diagnostics', createdAt: mkDate(1),  reportUrl: '#' },
  { _id: 'dr2', patient: { name: 'Omar Farooq' },  testName: 'Thyroid Profile',         labName: 'MedLab Plus',          createdAt: mkDate(4),  reportUrl: '#' },
  { _id: 'dr3', patient: { name: 'Noor Fatima' },  testName: 'X-Ray Chest',             labName: 'CityScan & Labs',      createdAt: mkDate(7),  reportUrl: '#' },
  { _id: 'dr4', patient: { name: 'Hamza Tariq' },  testName: 'Lipid Panel',             labName: 'LifeCare Diagnostics', createdAt: mkDate(11), reportUrl: null },
  { _id: 'dr5', patient: { name: 'Sara Zainab' },  testName: 'MRI Brain',               labName: 'MedLab Plus',          createdAt: mkDate(15), reportUrl: '#' },
];

const DUMMY_NOTIFICATIONS = [
  { _id: 'dn1', title: 'New Report Available',  message: "Ayesha Raza's CBC + Lipid Panel report has been uploaded by LifeCare Diagnostics. Review it in Patient Reports.", read: false, createdAt: mkDate(0) },
  { _id: 'dn2', title: 'Report Ready',          message: "Omar Farooq's Thyroid Profile result is ready for review.",                                                         read: false, createdAt: mkDate(0) },
  { _id: 'dn3', title: 'Schedule Reminder',     message: "You have consultations tomorrow from 09:00 AM – 01:00 PM. Please confirm availability.",                             read: true,  createdAt: mkDate(1) },
];

// ── Appointments (mirror carefirst-backend/utils/schedule.js) ─────────────────
const DURATION_OPTIONS = [10, 15, 20, 30, 45, 60];
const pktToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()); // YYYY-MM-DD
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const time12 = (hhmm: string) => {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const toMinutes = (t: string) => {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return h * 60 + Number(m[2]);
};
// How many appointments fit in a range like "09:00 AM – 01:00 PM"
const slotsInRange = (range: string, duration: number) => {
  const [a, b] = range.split(/\s*(?:–|—|-)\s*/);
  const start = toMinutes(a), end = b ? toMinutes(b) : null;
  if (start === null) return 0;
  if (end === null) return 1;
  return end > start ? Math.floor((end - start) / duration) : 0;
};
const APPT_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  confirmed: { label: 'Confirmed', bg: '#dbeafe', fg: '#1d4ed8' },
  completed: { label: 'Completed', bg: '#dcfce7', fg: '#166534' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', fg: '#6b7280' },
  no_show:   { label: 'No-show',   bg: '#fee2e2', fg: '#991b1b' },
};
const statusPill = (s: string) => {
  const st = APPT_STATUS[s] || { label: s, bg: '#f3f4f6', fg: '#6b7280' };
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, background: st.bg, color: st.fg }}>{st.label}</span>;
};

const DoctorDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [dateString, setDateString]   = useState('');

  const { user: sessionUser } = getSession();
  const [docProfile, setDocProfile]           = useState<any>(null);
  const [consultationFee, setConsultationFee] = useState<number>(0);
  const [feeInput, setFeeInput]               = useState('');
  const [feeMsg, setFeeMsg]                   = useState('');
  const [prescriptions, setPrescriptions]     = useState<any[]>([]);
  const [notifications, setNotifications]     = useState<any[]>([]);
  const [notifBadge, setNotifBadge]           = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [reports, setReports]         = useState<any[]>([]);
  const [reportFilter, setReportFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const [addingSlotDay, setAddingSlotDay] = useState<number | null>(null);
  const [newSlotStart, setNewSlotStart]   = useState('09:00');
  const [newSlotEnd, setNewSlotEnd]       = useState('13:00');

  const [profileForm, setProfileForm] = useState({
    specialization: DUMMY_PROFILE_DATA.specialization,
    experience:     String(DUMMY_PROFILE_DATA.experience),
    bio:            DUMMY_PROFILE_DATA.bio,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg]       = useState('');

  const [availability, setAvailability] = useState([
    { id: 0, day: 'Monday',    active: true,  slots: ['09:00 AM – 01:00 PM', '02:00 PM – 05:00 PM'] },
    { id: 1, day: 'Tuesday',   active: true,  slots: ['09:00 AM – 01:00 PM'] },
    { id: 2, day: 'Wednesday', active: true,  slots: ['10:00 AM – 02:00 PM'] },
    { id: 3, day: 'Thursday',  active: true,  slots: ['10:00 AM – 04:00 PM'] },
    { id: 4, day: 'Friday',    active: true,  slots: ['09:00 AM – 12:00 PM'] },
    { id: 5, day: 'Saturday',  active: true,  slots: ['10:00 AM – 01:00 PM'] },
    { id: 6, day: 'Sunday',    active: false, slots: [] },
  ]);

  const [availSaving, setAvailSaving] = useState(false);
  const [availMsg, setAvailMsg]       = useState('');
  const [consultationDuration, setConsultationDuration] = useState(20);

  // ── Appointments, patients, prescriptions ───────────────────────────────────
  const [appointments, setAppointments] = useState<any[]>([]);
  const [apptsLoaded, setApptsLoaded]   = useState(false);
  const [myPatients, setMyPatients]     = useState<any[]>([]);
  const [apptFilter, setApptFilter]     = useState<'upcoming' | 'today' | 'past' | 'all'>('upcoming');
  const [cancelId, setCancelId]         = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [apptMsg, setApptMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [labTestNames, setLabTestNames] = useState<string[]>([]);
  const [rxAppointmentId, setRxAppointmentId] = useState('');
  const [rxTests, setRxTests]   = useState([{ testName: '', notes: '' }]);
  const [rxNotes, setRxNotes]   = useState('');
  const [rxBusy, setRxBusy]     = useState(false);
  const [rxMsg, setRxMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const loadAppointments = () =>
    api.get('/doctor/appointments').then((d: any) => setAppointments(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setApptsLoaded(true));
  const loadPatients = () =>
    api.get('/doctor/patients').then((d: any) => setMyPatients(Array.isArray(d) ? d : [])).catch(() => {});

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const d = new Date();
    setDateString(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);

  useEffect(() => {
    api.get('/doctor/profile').then((d: any) => {
      setDocProfile(d);
      setProfileForm({
        specialization: d.profile?.specialization || DUMMY_PROFILE_DATA.specialization,
        experience:     String(d.profile?.experience || DUMMY_PROFILE_DATA.experience),
        bio:            d.profile?.bio             || DUMMY_PROFILE_DATA.bio,
      });
    }).catch(() => {});

    api.get('/doctor/availability').then((d: any) => {
      if (d.consultationFee !== undefined) {
        setConsultationFee(d.consultationFee);
        setFeeInput(String(d.consultationFee));
      }
      if (d.consultationDuration) setConsultationDuration(d.consultationDuration);
      if (Array.isArray(d.availability) && d.availability.length) {
        setAvailability(prev => prev.map(entry => {
          const backend = d.availability.find((av: any) => av.day === entry.day);
          if (!backend) return entry;
          return { ...entry, active: (backend.slots?.length ?? 0) > 0, slots: backend.slots?.map((s: any) => s.time || s) || [] };
        }));
      }
    }).catch(() => {});

    api.get('/doctor/prescriptions').then((d: any) => setPrescriptions(Array.isArray(d) ? d : [])).catch(() => {});
    loadAppointments();
    loadPatients();
    // Test names labs actually offer — suggestions when prescribing, so "Find labs" matches
    api.get('/public/tests').then((d: any) => {
      const names = (Array.isArray(d) ? d : []).flatMap((lab: any) => (lab.tests || []).map((t: any) => t.name));
      setLabTestNames([...new Set([...names, ...TESTS])].sort() as string[]);
    }).catch(() => setLabTestNames(TESTS));
    api.get('/doctor/reports').then((d: any) => setReports(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/doctor/notifications').then((d: any) => {
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
      if (n.type?.startsWith('appointment_')) { loadAppointments(); loadPatients(); }
    });
    return () => { socket.off('notification:new'); };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const signOut = () => { clearSession(); window.location.href = '/login'; };

  const handleUpdateFee = async () => {
    try {
      const res: any = await api.put('/doctor/fee', { consultationFee: Number(feeInput) });
      setConsultationFee(res.consultationFee ?? Number(feeInput));
      setFeeMsg('Fee updated.');
      setTimeout(() => setFeeMsg(''), 3000);
    } catch (err: any) { setFeeMsg(err.message || 'Update failed.'); }
  };

  const markNotifRead = async (notif: any) => {
    if (notif.read) return;
    // Dummy notifications are read client-side only
    if (notif._id?.startsWith('dn')) {
      setNotifications(prev =>
        prev.length > 0
          ? prev.map((n: any) => n._id === notif._id ? { ...n, read: true } : n)
          : DUMMY_NOTIFICATIONS.map((n: any) => n._id === notif._id ? { ...n, read: true } : n)
      );
      setNotifBadge(prev => Math.max(0, prev - 1));
      return;
    }
    try {
      await api.put(`/doctor/notifications/${notif._id}/read`, {});
      setNotifications(prev => prev.map((n: any) => n._id === notif._id ? { ...n, read: true } : n));
      setNotifBadge(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const handleSaveAvailability = async () => {
    setAvailSaving(true); setAvailMsg('');
    try {
      await api.put('/doctor/availability', {
        availability: availability.map(d => ({
          day: d.day, slots: d.active ? d.slots.map(time => ({ time })) : [],
        })),
        consultationDuration,
      });
      setAvailMsg('Availability saved.');
      setTimeout(() => setAvailMsg(''), 3000);
    } catch (err: any) { setAvailMsg(err.message || 'Save failed.'); }
    finally { setAvailSaving(false); }
  };

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const addSlot = (dayId: number) => {
    if (!newSlotStart || !newSlotEnd) return;
    const formatted = `${formatTime(newSlotStart)} – ${formatTime(newSlotEnd)}`;
    setAvailability(prev => prev.map(d => d.id === dayId ? { ...d, slots: [...d.slots, formatted] } : d));
    setNewSlotStart('09:00');
    setNewSlotEnd('13:00');
    setAddingSlotDay(null);
  };

  const removeSlot = (dayId: number, slotIdx: number) => {
    setAvailability(prev => prev.map(d => d.id === dayId ? { ...d, slots: d.slots.filter((_, i) => i !== slotIdx) } : d));
  };

  const saveProfile = async () => {
    setProfileSaving(true); setProfileMsg('');
    try {
      await api.put('/doctor/profile', {
        specialization: profileForm.specialization,
        experience:     Number(profileForm.experience),
        bio:            profileForm.bio,
      });
      setProfileMsg('Profile updated successfully.');
      api.get('/doctor/profile').then((d: any) => setDocProfile(d)).catch(() => {});
    } catch (err: any) { setProfileMsg(err.message || 'Update failed.'); }
    finally { setProfileSaving(false); }
  };

  const replaceAppt = (a: any) => setAppointments(prev => prev.map(x => x._id === a._id ? { ...a, prescription: x.prescription } : x));

  // action: 'complete' | 'no-show'
  const closeAppt = async (a: any, action: 'complete' | 'no-show') => {
    setApptMsg(null);
    try {
      const d: any = await api.put(`/doctor/appointments/${a._id}/${action}`, {});
      replaceAppt(d.appointment);
      loadPatients();
    } catch (err: any) { setApptMsg({ ok: false, text: err.message || 'Update failed' }); }
  };

  const cancelAppt = async () => {
    if (!cancelId) return;
    if (!cancelReason.trim()) { setApptMsg({ ok: false, text: 'Please give a reason — it is sent to the patient.' }); return; }
    setApptMsg(null);
    try {
      const d: any = await api.put(`/doctor/appointments/${cancelId}/cancel`, { reason: cancelReason.trim() });
      replaceAppt(d.appointment);
      setCancelId(null); setCancelReason('');
      setApptMsg({ ok: true, text: 'Appointment cancelled — the patient has been notified.' });
      loadPatients();
    } catch (err: any) { setApptMsg({ ok: false, text: err.message || 'Cancel failed' }); }
  };

  const openPrescribe = (a: any) => {
    setRxAppointmentId(a._id); setRxTests([{ testName: '', notes: '' }]); setRxNotes(''); setRxMsg(null);
    navigate('prescribe');
  };

  const submitPrescription = async () => {
    setRxMsg(null);
    const tests = rxTests.map(t => ({ testName: t.testName.trim(), notes: t.notes.trim() })).filter(t => t.testName);
    if (!rxAppointmentId) { setRxMsg({ ok: false, text: 'Choose the appointment this prescription is for.' }); return; }
    if (!tests.length)    { setRxMsg({ ok: false, text: 'Add at least one test.' }); return; }
    setRxBusy(true);
    try {
      const rx: any = await api.post('/doctor/prescriptions', { appointmentId: rxAppointmentId, tests, generalNotes: rxNotes.trim() });
      setAppointments(prev => prev.map(a => a._id === rxAppointmentId ? { ...a, prescription: rx } : a));
      setPrescriptions(prev => [{ ...rx, patient: appointments.find(a => a._id === rxAppointmentId)?.patient }, ...prev]);
      setRxAppointmentId(''); setRxTests([{ testName: '', notes: '' }]); setRxNotes('');
      setRxMsg({ ok: true, text: 'Prescription sent to the patient. They can find labs for each test from their dashboard.' });
    } catch (err: any) {
      setRxMsg({ ok: false, text: err.message || 'Could not save the prescription' });
    } finally {
      setRxBusy(false);
    }
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const toggleDay = (id: number) => setAvailability(prev => prev.map(d => d.id === id ? { ...d, active: !d.active } : d));
  const navigate  = (page: string) => { setCurrentPage(page); setShowNotifDropdown(false); };

  // ── Display variables (real data if available, dummy fallback otherwise) ─────
  const displaySpec   = docProfile?.profile?.specialization || DUMMY_PROFILE_DATA.specialization;
  const displayExp    = docProfile?.profile?.experience     || DUMMY_PROFILE_DATA.experience;
  const displayBio    = docProfile?.profile?.bio            || DUMMY_PROFILE_DATA.bio;
  const displayRating = docProfile?.profile?.rating > 0 ? docProfile.profile.rating : DUMMY_PROFILE_DATA.rating;
  const displayFee    = consultationFee > 0 ? consultationFee : DUMMY_FEE;

  const displayPrescriptions = prescriptions.length > 0 ? prescriptions : DUMMY_PRESCRIPTIONS;
  const displayReports       = reports.length       > 0 ? reports       : DUMMY_REPORTS;
  const displayNotifications = notifications.length > 0 ? notifications  : DUMMY_NOTIFICATIONS;
  const displayNotifBadge    = notifications.length > 0 ? notifBadge    : DUMMY_NOTIFICATIONS.filter(n => !n.read).length;

  // Patients come from appointments
  const uniquePatientCount = myPatients.length;

  const nowMs = Date.now();
  const today = pktToday();
  const started = (a: any) => new Date(a.startsAt).getTime() <= nowMs;
  const todaysAppts = appointments.filter(a => a.date === today && a.status !== 'cancelled');
  const upcomingCount = appointments.filter(a => a.status === 'confirmed' && !started(a)).length;
  const filteredAppts = appointments.filter(a =>
    apptFilter === 'all'      ? true
    : apptFilter === 'today'  ? a.date === today
    : apptFilter === 'upcoming' ? a.status === 'confirmed' && !started(a)
    : started(a) || a.status !== 'confirmed'
  );
  if (apptFilter === 'past' || apptFilter === 'all') filteredAppts.reverse(); // newest first
  // Appointments a prescription can be written for
  const rxEligible = appointments.filter(a => ['confirmed', 'completed'].includes(a.status) && started(a) && !a.prescription)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const fmtVisit = (d?: string) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }) : '—';

  const filteredReports = displayReports.filter((r: any) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      (r.patient?.name || '').toLowerCase().includes(q) ||
      (r.testName      || '').toLowerCase().includes(q) ||
      (r.labName       || '').toLowerCase().includes(q);
    const matchFilter = reportFilter === 'All' ||
      (reportFilter === 'Read'   && r.isRead) ||
      (reportFilter === 'Unread' && !r.isRead);
    return matchSearch && matchFilter;
  });

  const pageBreadcrumbs: Record<string, string> = {
    dashboard:    'Dashboard',
    appointments: 'Appointments',
    patients:     'My Patients',
    availability: 'Manage Availability',
    prescribe:    'Prescribe Test',
    reports:      'Patient Reports',
    profile:      'My Profile',
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="doctor-dashboard-wrapper">
      <div className="doc-shell">

        {/* ─── SIDEBAR ────────────────────────────────────────────────────── */}
        <aside className={`doc-sidebar ${!sidebarOpen ? 'collapsed' : ''}`} id="sidebar">
          <div className="doc-sidebar-logo">
            <div className="doc-logo-mark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </div>
            <span className="doc-logo-name">carefirst</span>
          </div>

          <div className="doc-sidebar-doctor">
            <div className="doc-avatar">{((sessionUser as any)?.name || 'D')[0].toUpperCase()}</div>
            <div className="doc-doctor-info">
              <div className="doc-name">{(sessionUser as any)?.name || 'Doctor'}</div>
              <div className="doc-spec">{displaySpec}</div>
            </div>
          </div>

          <nav className="doc-sidebar-nav">
            <div className="doc-nav-label">Main</div>
            <button className={`doc-nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('dashboard')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </button>
            <button className={`doc-nav-item ${currentPage === 'appointments' ? 'active' : ''}`} onClick={() => navigate('appointments')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Appointments
              {upcomingCount > 0 && <span className="doc-nav-badge">{upcomingCount}</span>}
            </button>
            <button className={`doc-nav-item ${currentPage === 'patients' ? 'active' : ''}`} onClick={() => navigate('patients')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              My Patients
            </button>
            <button className={`doc-nav-item ${currentPage === 'availability' ? 'active' : ''}`} onClick={() => navigate('availability')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>
              Manage Availability
            </button>
            <button className={`doc-nav-item ${currentPage === 'prescribe' ? 'active' : ''}`} onClick={() => navigate('prescribe')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5L19.5 7"/><circle cx="12" cy="12" r="10"/></svg>
              Prescribe Test
            </button>
            <button className={`doc-nav-item ${currentPage === 'reports' ? 'active' : ''}`} onClick={() => navigate('reports')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Patient Reports
              {displayPrescriptions.length > 0 && <span className="doc-nav-badge">{displayPrescriptions.length}</span>}
            </button>

            <div className="doc-nav-label">Account</div>
            <button className={`doc-nav-item ${currentPage === 'profile' ? 'active' : ''}`} onClick={() => navigate('profile')}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              Profile
            </button>
          </nav>

          <div className="doc-sidebar-footer">
            <button className="doc-nav-item" style={{ color: 'var(--red)' }} onClick={signOut}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* ─── MAIN ────────────────────────────────────────────────────────── */}
        <main className={`doc-main ${!sidebarOpen ? 'expanded' : ''}`} id="main">

          {/* TOPBAR */}
          <header className="doc-topbar">
            <div className="doc-topbar-left">
              <button className="doc-toggle-btn" onClick={toggleSidebar} title="Toggle Sidebar">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <div className="doc-page-breadcrumb">
                <span>carefirst</span>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                <span className="doc-current" id="breadcrumb-text">{pageBreadcrumbs[currentPage]}</span>
              </div>
            </div>
            <div className="doc-topbar-right">
              <div className="doc-search-wrap">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  className="doc-search-input"
                  type="text"
                  placeholder="Search reports…"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); if (currentPage !== 'reports') navigate('reports'); }}
                />
              </div>

              {/* Notification bell */}
              <div style={{ position: 'relative' }}>
                <button className="doc-icon-btn" onClick={() => setShowNotifDropdown(v => !v)} style={{ position: 'relative' }}>
                  <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {displayNotifBadge > 0 && (
                    <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--red)', color: '#fff', fontSize: '0.58rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', fontWeight: 700 }}>
                      {displayNotifBadge}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowNotifDropdown(false)} />
                    <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320, maxHeight: 400, overflowY: 'auto', background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 200 }}>
                      <div style={{ padding: '14px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Notifications</div>
                        <button onClick={() => setShowNotifDropdown(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                      {displayNotifications.length === 0 ? (
                        <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No notifications yet.</div>
                      ) : displayNotifications.slice(0, 12).map((n: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => markNotifRead(n)}
                          style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10, background: n.read ? 'transparent' : 'rgba(220,38,38,0.04)', cursor: n.read ? 'default' : 'pointer' }}
                        >
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.read ? 'var(--border)' : 'var(--red)', marginTop: 5, flexShrink: 0 }}></div>
                          <div style={{ flex: 1 }}>
                            {n.title && <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{n.title}</div>}
                            <div style={{ fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.45 }}>{n.message || n.body || 'New notification'}</div>
                            {n.createdAt && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{new Date(n.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="doc-date-chip" id="date-display">{dateString}</div>
            </div>
          </header>

          {/* CONTENT */}
          <div className="doc-content">

            {/* ══ DASHBOARD ══════════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'dashboard' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up">
                <div className="doc-page-title">Good morning, {(sessionUser as any)?.name?.replace(/^dr\.?\s+/i, '').split(' ')[0] || 'Doctor'}</div>
                <div className="doc-page-title-rule"></div>
                <div className="doc-page-subtitle">Here's what's happening today, {dateString}</div>
              </div>

              {/* Hero Card */}
              <div className="doc-hero-card doc-fade-up doc-fade-up-1">
                <div className="doc-hero-inner">
                  <div className="doc-hero-left">
                    <div className="doc-greeting">CareFirst Medical Partner</div>
                    <div className="doc-doctor-name">{(sessionUser as any)?.name || 'Doctor'}</div>
                    <div className="doc-spec-tag">
                      {displaySpec}{displayExp ? ` · ${displayExp} Years Experience` : ''}
                    </div>
                    <div className="doc-hero-pills">
                      
                      <div className="doc-hero-pill doc-red">Fee: PKR {displayFee.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="doc-hero-stats">
                    <div className="doc-hero-stat">
                      <div className="doc-val">{uniquePatientCount}</div>
                      <div className="doc-lbl">Patients</div>
                    </div>
                    <div className="doc-hero-divider"></div>
                    <div className="doc-hero-stat">
                      <div className="doc-val">{displayPrescriptions.length}</div>
                      <div className="doc-lbl">Prescriptions</div>
                    </div>
                    <div className="doc-hero-divider"></div>
                    <div className="doc-hero-stat">
                      <div className="doc-val">{displayRating}</div>
                      <div className="doc-lbl">Rating</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="doc-stats-grid doc-fade-up doc-fade-up-2">
                <div className="doc-stat-card">
                  <div className="doc-stat-top">
                    <div>
                      <div className="doc-stat-label">Unique Patients</div>
                      <div className="doc-stat-value">{uniquePatientCount}</div>
                    </div>
                    <div className="doc-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </div>
                  </div>
                  <div className="doc-stat-trend" style={{ color: 'var(--text-muted)' }}>
                    Patients who booked with you
                  </div>
                </div>

                <div className="doc-stat-card">
                  <div className="doc-stat-top">
                    <div>
                      <div className="doc-stat-label">Prescriptions Issued</div>
                      <div className="doc-stat-value">{displayPrescriptions.length}</div>
                    </div>
                    <div className="doc-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    </div>
                  </div>
                  <div className="doc-stat-trend" style={{ color: 'var(--text-muted)' }}>
                    Total prescriptions created
                  </div>
                </div>

                <div className="doc-stat-card">
                  <div className="doc-stat-top">
                    <div>
                      <div className="doc-stat-label">Consultation Fee</div>
                      <div className="doc-stat-value" style={{ fontSize: '1.4rem' }}>PKR {displayFee.toLocaleString()}</div>
                    </div>
                    <div className="doc-stat-icon">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    </div>
                  </div>
                  <div className="doc-stat-trend" style={{ color: 'var(--text-muted)' }}>Per consultation</div>
                </div>
              </div>

              {/* Two Column */}
              <div className="doc-two-col doc-fade-up doc-fade-up-3">

                {/* Recent Prescriptions */}
                <div className="doc-card">
                  <div className="doc-card-header">
                    <div className="doc-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      Recent Prescriptions
                    </div>
                    <div className="doc-card-action" onClick={() => navigate('reports')} style={{ cursor: 'pointer' }}>
                      View all
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  {displayPrescriptions.slice(0, 5).map((p: any, idx: number) => (
                    <div className="doc-patient-item" key={idx}>
                      <div className="doc-patient-row1">
                        <div className="doc-patient-name">{p.patient?.name || '—'}</div>
                        <span className="doc-status-badge doc-stable"><span className="doc-status-dot"></span>Prescribed</span>
                      </div>
                      <div className="doc-patient-condition">{p.tests?.map((t: any) => t.testName).join(', ') || '—'}</div>
                      <div className="doc-patient-meta">
                        <span className="doc-patient-time">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Today's Schedule */}
                <div className="doc-card">
                  <div className="doc-card-header">
                    <div className="doc-card-title">
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      Today's Appointments
                    </div>
                    <div className="doc-card-action" onClick={() => { setApptFilter('today'); navigate('appointments'); }} style={{ cursor: 'pointer' }}>
                      View all
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  <div className="doc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Patient</th>
                          <th style={{ textAlign: 'right' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todaysAppts.length === 0 ? (
                          <tr><td colSpan={3} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No appointments today.</td></tr>
                        ) : todaysAppts.map((a: any) => (
                          <tr key={a._id}>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{time12(a.time)}</td>
                            <td>{a.patient?.name || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{statusPill(a.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* ══ MANAGE AVAILABILITY ════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'availability' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="doc-page-title">Manage Availability</div>
                  <div className="doc-page-title-rule"></div>
                  <div className="doc-page-subtitle">Configure your weekly schedule and consultation slots</div>
                </div>
                <button className="doc-btn-primary doc-red doc-fade-up doc-fade-up-1" disabled={availSaving} onClick={handleSaveAvailability}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  {availSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>

              <div className="doc-card doc-fade-up doc-fade-up-1" style={{ padding: '16px 22px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)' }}>Consultation duration</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Each time range is split into appointments of this length. Patients book them up to 14 days ahead.
                  </div>
                </div>
                <select className="doc-filter-select" value={consultationDuration} onChange={e => setConsultationDuration(Number(e.target.value))}>
                  {[...new Set([...DURATION_OPTIONS, consultationDuration])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m} minutes</option>)}
                </select>
              </div>

              <div className="doc-avail-grid doc-fade-up doc-fade-up-2">
                {availability.map((day) => (
                  <div className={`doc-avail-row ${!day.active ? 'inactive' : ''}`} key={day.id}>
                    <div className="doc-avail-row-header">
                      <div className="doc-avail-day-info">
                        <div className={`doc-toggle ${day.active ? 'doc-on' : ''}`} onClick={() => toggleDay(day.id)}></div>
                        <div className="doc-avail-day">
                          {day.day}
                          {!day.active && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>— Day off</span>}
                        </div>
                      </div>
                    </div>
                    {day.active && (
                      <div className="doc-avail-slots">
                        {day.slots.map((slot, sIdx) => (
                          <div className="doc-slot-pill" key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            {slot}
                            <span style={{ fontSize: '0.7rem', opacity: 0.65 }}>· {slotsInRange(slot, consultationDuration)} appts</span>
                            <button onClick={() => removeSlot(day.id, sIdx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-muted)', lineHeight: 1 }} title="Remove slot">
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        ))}
                        {addingSlotDay === day.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>From</span>
                            <input
                              type="time"
                              className="doc-form-input"
                              style={{ height: 32, padding: '0 10px', fontSize: '0.8rem', width: 118 }}
                              value={newSlotStart}
                              onChange={e => setNewSlotStart(e.target.value)}
                              autoFocus
                            />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>To</span>
                            <input
                              type="time"
                              className="doc-form-input"
                              style={{ height: 32, padding: '0 10px', fontSize: '0.8rem', width: 118 }}
                              value={newSlotEnd}
                              onChange={e => setNewSlotEnd(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') addSlot(day.id); if (e.key === 'Escape') setAddingSlotDay(null); }}
                            />
                            <button className="doc-btn-primary" style={{ padding: '5px 12px', fontSize: '0.75rem' }} onClick={() => addSlot(day.id)}>Add</button>
                            <button className="doc-btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setAddingSlotDay(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="doc-add-slot" onClick={() => setAddingSlotDay(day.id)}>
                            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add Slot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {availMsg && (
                <div style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, background: availMsg.includes('saved') ? '#dcfce7' : '#fee2e2', color: availMsg.includes('saved') ? '#166534' : '#991b1b', fontSize: '0.82rem' }}>
                  {availMsg}
                </div>
              )}

              {/* Consultation Fee */}
              <div className="doc-fee-section doc-fade-up doc-fade-up-4">
                <div className="doc-fee-info">
                  <div className="doc-label">Consultation Fee</div>
                  <div className="doc-fee-value"><span className="doc-fee-currency">PKR </span>{displayFee.toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input className="doc-fee-input" type="number" value={feeInput} onChange={e => setFeeInput(e.target.value)} placeholder="Fee…" />
                    <button className="doc-btn-primary" onClick={handleUpdateFee}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      Update Fee
                    </button>
                  </div>
                  {feeMsg && <div style={{ fontSize: '0.75rem', color: feeMsg.includes('updated') ? '#166534' : '#991b1b' }}>{feeMsg}</div>}
                </div>
              </div>
            </section>

            {/* ══ APPOINTMENTS ═══════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'appointments' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="doc-page-title">Appointments</div>
                  <div className="doc-page-title-rule"></div>
                  <div className="doc-page-subtitle">Clinic visits booked by patients — confirmed automatically</div>
                </div>
                <div className="doc-filter-row doc-fade-up doc-fade-up-1">
                  <select className="doc-filter-select" value={apptFilter} onChange={e => setApptFilter(e.target.value as any)}>
                    <option value="upcoming">Upcoming</option>
                    <option value="today">Today</option>
                    <option value="past">Past & closed</option>
                    <option value="all">All</option>
                  </select>
                </div>
              </div>

              {apptMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: '0.82rem', background: apptMsg.ok ? '#dcfce7' : '#fee2e2', color: apptMsg.ok ? '#166534' : '#991b1b' }}>
                  {apptMsg.text}
                </div>
              )}

              <div className="doc-card doc-fade-up doc-fade-up-2">
                <div className="doc-table-wrap">
                  <table>
                    <thead>
                      <tr><th>When</th><th>Patient</th><th>Status</th><th>Prescription</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {!apptsLoaded ? (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
                      ) : filteredAppts.length === 0 ? (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                          {appointments.length === 0 ? 'No appointments yet. Patients book the free times from your availability.' : 'No appointments in this view.'}
                        </td></tr>
                      ) : filteredAppts.map((a: any) => (
                        <React.Fragment key={a._id}>
                          <tr>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{a.date === today ? 'Today' : dayLabel(a.date)}</div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{time12(a.time)} · {a.durationMinutes} min</div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{a.patient?.name || '—'}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{[a.patient?.cnic, a.patient?.phone].filter(Boolean).join(' · ') || a.patient?.email}</div>
                            </td>
                            <td>
                              {statusPill(a.status)}
                              {a.status === 'cancelled' && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3, maxWidth: 200 }}>
                                  {a.cancelledBy === 'doctor' ? `By you: ${a.cancellationReason}` : 'By the patient'}
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: '0.78rem' }}>
                              {a.prescription
                                ? (a.prescription.tests || []).map((t: any) => t.testName).join(', ')
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {a.status === 'confirmed' && started(a) && <>
                                  <button className="doc-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem', color: '#166534' }} onClick={() => closeAppt(a, 'complete')}>Completed</button>
                                  <button className="doc-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => closeAppt(a, 'no-show')}>No-show</button>
                                </>}
                                {['confirmed', 'completed'].includes(a.status) && started(a) && !a.prescription && (
                                  <button className="doc-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem', color: 'var(--red)' }} onClick={() => openPrescribe(a)}>Prescribe</button>
                                )}
                                {a.status === 'confirmed' && (
                                  <button className="doc-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => { setCancelId(a._id); setCancelReason(''); setApptMsg(null); }}>Cancel</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {cancelId === a._id && (
                            <tr>
                              <td colSpan={5} style={{ background: 'rgba(220,38,38,0.04)', padding: '10px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#991b1b' }}>Reason for cancelling (sent to {a.patient?.name}):</span>
                                  <input className="doc-form-input" style={{ flex: 1, minWidth: 220, height: 34 }} autoFocus value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') cancelAppt(); if (e.key === 'Escape') setCancelId(null); }}
                                    placeholder="e.g. Called into emergency surgery" />
                                  <button className="doc-btn-primary doc-red" style={{ padding: '6px 14px', fontSize: '0.78rem' }} onClick={cancelAppt}>Cancel appointment</button>
                                  <button className="doc-btn-ghost" style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={() => setCancelId(null)}>Keep</button>
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
            </section>

            {/* ══ MY PATIENTS ════════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'patients' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up">
                <div className="doc-page-title">My Patients</div>
                <div className="doc-page-title-rule"></div>
                <div className="doc-page-subtitle">Everyone who has booked an appointment with you</div>
              </div>
              <div className="doc-card doc-fade-up doc-fade-up-1">
                <div className="doc-table-wrap">
                  <table>
                    <thead>
                      <tr><th>Patient</th><th>CNIC</th><th>Contact</th><th>Appointments</th><th>Last visit</th><th>Next visit</th></tr>
                    </thead>
                    <tbody>
                      {myPatients.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>No patients yet — they appear here once they book with you.</td></tr>
                      ) : myPatients.map((p: any) => (
                        <tr key={p.patient._id}>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.patient.name}</td>
                          <td className="doc-report-id">{p.patient.cnic || '—'}</td>
                          <td style={{ fontSize: '0.78rem' }}>{p.patient.phone || p.patient.email}</td>
                          <td>{p.appointments}</td>
                          <td style={{ fontSize: '0.8rem' }}>{fmtVisit(p.lastVisit)}</td>
                          <td style={{ fontSize: '0.8rem' }}>{fmtVisit(p.nextVisit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ══ PRESCRIBE TEST ═════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'prescribe' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up">
                <div className="doc-page-title">Prescribe Test</div>
                <div className="doc-page-title-rule"></div>
                <div className="doc-page-subtitle">Write a prescription for a consultation — the patient can then find labs for each test</div>
              </div>

              <div className="doc-card doc-fade-up doc-fade-up-1" style={{ padding: 28 }}>
                {rxMsg && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: '0.82rem', background: rxMsg.ok ? '#dcfce7' : '#fee2e2', color: rxMsg.ok ? '#166534' : '#991b1b' }}>
                    {rxMsg.text}
                  </div>
                )}

                <div className="doc-form-section">
                  <label className="doc-form-label">Appointment</label>
                  {rxEligible.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      No appointments waiting for a prescription. A prescription can be written once an appointment has started (and isn't cancelled or a no-show).
                    </div>
                  ) : (
                    <select className="doc-form-input" value={rxAppointmentId} onChange={e => setRxAppointmentId(e.target.value)}>
                      <option value="">Choose an appointment…</option>
                      {rxEligible.map((a: any) => (
                        <option key={a._id} value={a._id}>{a.patient?.name} — {dayLabel(a.date)}, {time12(a.time)} ({APPT_STATUS[a.status]?.label})</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="doc-form-section">
                  <label className="doc-form-label">Tests</label>
                  <datalist id="doc-test-names">{labTestNames.map(n => <option key={n} value={n} />)}</datalist>
                  {rxTests.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <input className="doc-form-input" style={{ flex: '2 1 220px' }} list="doc-test-names" placeholder="Test name (pick a lab test so the patient can book it)"
                        value={t.testName} onChange={e => setRxTests(prev => prev.map((x, j) => j === i ? { ...x, testName: e.target.value } : x))} />
                      <input className="doc-form-input" style={{ flex: '3 1 220px' }} placeholder="Notes for this test (optional)"
                        value={t.notes} onChange={e => setRxTests(prev => prev.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
                      {rxTests.length > 1 && (
                        <button className="doc-btn-ghost" style={{ padding: '4px 10px' }} title="Remove" onClick={() => setRxTests(prev => prev.filter((_, j) => j !== i))}>✕</button>
                      )}
                    </div>
                  ))}
                  <button className="doc-add-slot" onClick={() => setRxTests(prev => [...prev, { testName: '', notes: '' }])}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add another test
                  </button>
                </div>

                <div className="doc-form-section">
                  <label className="doc-form-label">General notes</label>
                  <textarea className="doc-form-input doc-form-textarea" placeholder="Instructions for the patient (optional)" value={rxNotes} onChange={e => setRxNotes(e.target.value)}></textarea>
                </div>

                <button className="doc-btn-primary doc-red" disabled={rxBusy || rxEligible.length === 0} onClick={submitPrescription}
                  style={rxBusy || rxEligible.length === 0 ? { opacity: 0.55 } : {}}>
                  {rxBusy ? 'Sending…' : 'Send Prescription'}
                </button>
              </div>
            </section>

            {/* ══ PATIENT REPORTS ════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'reports' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="doc-page-title">Lab Reports</div>
                  <div className="doc-page-title-rule"></div>
                  <div className="doc-page-subtitle">Test reports uploaded by labs for your patients</div>
                </div>
                <div className="doc-filter-row doc-fade-up doc-fade-up-1">
                  <select className="doc-filter-select" value={reportFilter} onChange={e => setReportFilter(e.target.value)}>
                    <option value="All">All Reports</option>
                    <option value="Unread">Unread</option>
                    <option value="Read">Read</option>
                  </select>
                </div>
              </div>

              <div className="doc-card doc-fade-up doc-fade-up-2">
                {filteredReports.length === 0 ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No reports match your search criteria.
                  </div>
                ) : (
                  <div className="doc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Report ID</th>
                          <th>Patient</th>
                          <th>Test Name</th>
                          <th>Lab</th>
                          <th>Date</th>
                          <th style={{ textAlign: 'right' }}>Download</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReports.map((r: any, i: number) => (
                          <React.Fragment key={i}>
                          <tr style={{ opacity: r.isRead ? 0.75 : 1 }}>
                            <td className="doc-report-id">{r._id?.toString().slice(-6).toUpperCase()}</td>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.patient?.name || '—'}</td>
                            <td>{r.testName || '—'}</td>
                            <td>{r.labName || r.lab?.name || '—'}</td>
                            <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>
                              {r.reportUrl && r.reportUrl !== '#' ? (
                                <a href={r.reportUrl} target="_blank" rel="noreferrer" className="doc-action-btn" style={{ color: 'var(--red)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="Download Report">
                                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                </a>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                              )}
                            </td>
                          </tr>
                          {(r.summary || r.summaryUrdu || r.autoRead?.findings?.length > 0) && (
                            <tr>
                              <td colSpan={6} style={{ padding: '8px 16px 14px', background: 'rgba(255,255,255,0.35)' }}>
                                {(() => {
                                  const flagged = (r.autoRead?.findings || []).filter((f: any) => ['high', 'low', 'abnormal'].includes(f.status));
                                  return flagged.length > 0 && (
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: '0.74rem' }}>
                                      <strong style={{ color: 'var(--text)' }}>Outside range:</strong>
                                      {flagged.map((f: any, i: number) => (
                                        <span key={i} style={{ padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
                                          {f.name} {f.result}{f.unit && !String(f.result).includes(f.unit) ? ` ${f.unit}` : ''} ({f.status === 'abnormal' ? 'not normal' : f.status}{f.range ? `; ${f.range}` : ''})
                                        </span>
                                      ))}
                                    </div>
                                  );
                                })()}
                                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', fontSize: '0.8rem' }}>
                                  {r.summary && <div style={{ flex: '1 1 240px', color: 'var(--text-sub)' }}><strong>{r.summarySource === 'auto' ? 'Automatic summary:' : 'Lab summary:'}</strong> {r.summary}</div>}
                                  {r.summaryUrdu && (
                                    <div style={{ flex: '1 1 260px' }}>
                                      <UrduText text={r.summaryUrdu} style={{ color: 'var(--text)' }} />
                                      <div style={{ textAlign: 'right', marginTop: 4 }}><ListenButton compact request={{ source: 'report', id: r._id }} /></div>
                                    </div>
                                  )}
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

            {/* ══ PROFILE ════════════════════════════════════════════════════ */}
            <section className={`doc-page-section ${currentPage === 'profile' ? 'active' : ''}`}>
              <div className="doc-page-header doc-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div className="doc-page-title">My Profile</div>
                  <div className="doc-page-title-rule"></div>
                  <div className="doc-page-subtitle">Update your specialization, experience, and bio</div>
                </div>
                <button className="doc-btn-primary doc-red doc-fade-up doc-fade-up-1" disabled={profileSaving} onClick={saveProfile}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>

              <div className="doc-card doc-fade-up doc-fade-up-2" style={{ padding: 32 }}>
                <div className="doc-form-section">
                  <label className="doc-form-label">Specialization</label>
                  <input className="doc-form-input" type="text" placeholder="e.g. Cardiology" value={profileForm.specialization} onChange={e => setProfileForm(f => ({ ...f, specialization: e.target.value }))} />
                </div>
                <div className="doc-form-section">
                  <label className="doc-form-label">Years of Experience</label>
                  <input className="doc-form-input" type="number" placeholder="e.g. 10" value={profileForm.experience} onChange={e => setProfileForm(f => ({ ...f, experience: e.target.value }))} />
                </div>
                <div className="doc-form-section">
                  <label className="doc-form-label">Professional Bio</label>
                  <textarea className="doc-form-input doc-form-textarea" placeholder="A short professional bio visible to patients…" value={profileForm.bio} onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))}></textarea>
                </div>
                {profileMsg && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: profileMsg.includes('success') ? '#dcfce7' : '#fee2e2', color: profileMsg.includes('success') ? '#166534' : '#991b1b', fontSize: '0.82rem' }}>
                    {profileMsg}
                  </div>
                )}
              </div>
            </section>

          </div>{/* /content */}
        </main>
      </div>
    </div>
  );
};

export default DoctorDashboard;
