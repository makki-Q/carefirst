const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_SIZE_MB   = 10;

// CNIC pictures are private: kept outside uploads/ (not served statically) and
// only sent through GET /api/documents after an access check
const CNIC_DIR = process.env.CNIC_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'cnic');
const CNIC_PICTURES = {
  patientCnicFront:   'patientFront',
  patientCnicBack:    'patientBack',
  guarantorCnicFront: 'guarantorFront',
  guarantorCnicBack:  'guarantorBack',
};
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

const createStorage = (subfolder, baseDir = path.join(__dirname, '..', 'uploads')) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(baseDir, subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
    },
  });

const filterFor = (allowed) => (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) return cb(null, true);
  const err = new Error(`Only ${allowed.join(', ')} files are allowed`);
  err.status = 400;
  cb(err, false);
};
const fileFilter = filterFor(ALLOWED_EXTENSIONS);

const limits = { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 };

// Lab uploads patient's test result (PDF/image)
const uploadReport = multer({ storage: createStorage('reports'), fileFilter, limits });

// Patient uploads payment receipt (image/PDF)
const uploadReceipt = multer({ storage: createStorage('receipts'), fileFilter, limits });

// Patient uploads community support documents (utility bills etc.)
const uploadCommunityDoc = multer({ storage: createStorage('community-docs'), fileFilter, limits });

// Patient uploads front + back pictures of their own and the guarantor's CNIC
// with an installment plan application
const uploadCnicPictures = multer({ storage: createStorage('', CNIC_DIR), fileFilter: filterFor(IMAGE_EXTENSIONS), limits })
  .fields(Object.keys(CNIC_PICTURES).map(name => ({ name, maxCount: 1 })));

module.exports = { uploadReport, uploadReceipt, uploadCommunityDoc, uploadCnicPictures, CNIC_DIR, CNIC_PICTURES };
