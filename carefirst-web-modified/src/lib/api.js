const BASE = '/api';

const getToken = () => localStorage.getItem('cf_token');

const request = async (method, path, body = null, isFormData = false) => {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  // Non-JSON bodies (proxy errors, HTML error pages) must not crash the caller
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
};

export const api = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path),
  upload: (path, form)   => request('POST',   path, form, true),
};

// Pakistani CNIC → "#####-#######-#", or null if it isn't 13 digits
export const formatCnic = (value) => {
  const digits = String(value || '').replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

export const saveSession = (token, user) => {
  localStorage.setItem('cf_token', token);
  localStorage.setItem('cf_user',  JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem('cf_token');
  localStorage.removeItem('cf_user');
};

export const getSession = () => {
  const user = localStorage.getItem('cf_user');
  return {
    token: getToken(),
    user:  user ? JSON.parse(user) : null,
  };
};

export const getDashboardPath = (role) => {
  const map = {
    admin:   '/admin-dashboard',
    lawyer:  '/lawyer-dashboard',
    lab:     '/lab-dashboard',
    doctor:  '/doctor-dashboard',
    patient: '/patient-dashboard',
  };
  return map[role] || '/';
};
