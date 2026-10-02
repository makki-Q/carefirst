// Pakistani CNIC: 13 digits, canonical form "#####-#######-#"
const CNIC_FORMAT = /^\d{5}-\d{7}-\d$/;

// Accepts "3520212345678", "35202-1234567-8" or with spaces; returns canonical form or null
const normalizeCnic = (input) => {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

module.exports = { CNIC_FORMAT, normalizeCnic };
