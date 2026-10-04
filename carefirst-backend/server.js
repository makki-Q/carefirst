require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const cors      = require('cors');
const path      = require('path');
const multer    = require('multer');

const connectDB              = require('./config/db');
const { initSocket }         = require('./socket/notificationSocket');
const { startDefaulterJob }  = require('./jobs/defaulterJob');

const authRoutes   = require('./routes/auth');
const adminRoutes  = require('./routes/admin');
const lawyerRoutes = require('./routes/lawyer');
const labRoutes    = require('./routes/lab');
const doctorRoutes  = require('./routes/doctor');
const patientRoutes = require('./routes/patient');
const publicRoutes  = require('./routes/public');
const ttsRoutes     = require('./routes/tts');
const documentRoutes = require('./routes/documents');

// ── App & HTTP server ────────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin:  process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});
initSocket(io);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

// Serve uploaded files as static assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/admin',  adminRoutes);
app.use('/api/lawyer', lawyerRoutes);
app.use('/api/lab',    labRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/tts',    ttsRoutes);
app.use('/api/documents', documentRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', service: 'CareFirst API', timestamp: new Date() })
);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// ── Error handler (upload / body-parse errors) — always answer with JSON ─────
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE:       'File is too large (max 10 MB)',
  LIMIT_FILE_COUNT:      'Too many files',
  LIMIT_UNEXPECTED_FILE: 'Too many files or unexpected file field',
};
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: MULTER_MESSAGES[err.code] || err.message });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: status === 500 ? 'Internal server error' : err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`\nCareFirst API running on http://localhost:${PORT}`);
    console.log(`Socket.IO ready`);
    startDefaulterJob();
  });
});
