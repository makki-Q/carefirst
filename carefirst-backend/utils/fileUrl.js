const fs   = require('fs');
const path = require('path');

// Public URL for a file stored by middleware/upload.js under uploads/<subfolder>
const fileUrl = (subfolder, filename) => {
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base}/uploads/${subfolder}/${filename}`;
};

// Deletes files multer already wrote when the request is rejected afterwards
const removeUploadedFiles = (req) => {
  const files = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : []),
  ];
  for (const f of files) {
    fs.unlink(path.resolve(f.path), () => {});
  }
};

module.exports = { fileUrl, removeUploadedFiles };
