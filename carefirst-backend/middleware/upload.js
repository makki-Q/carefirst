const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_SIZE_MB   = 10;

const createStorage = (subfolder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
    },
  });

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) return cb(null, true);
  const err = new Error(`Only ${ALLOWED_EXTENSIONS.join(', ')} files are allowed`);
  err.status = 400;
  cb(err, false);
};

const limits = { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 };

// Lab uploads patient's test result (PDF/image)
const uploadReport = multer({ storage: createStorage('reports'), fileFilter, limits });

// Patient uploads payment receipt (image/PDF)
const uploadReceipt = multer({ storage: createStorage('receipts'), fileFilter, limits });

// Patient uploads community support documents (utility bills etc.)
const uploadCommunityDoc = multer({ storage: createStorage('community-docs'), fileFilter, limits });

module.exports = { uploadReport, uploadReceipt, uploadCommunityDoc };
