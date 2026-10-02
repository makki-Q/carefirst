const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized — no token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User belonging to this token no longer exists' });

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token is invalid or has expired' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: `Access denied — requires role: ${roles.join(' or ')}` });
  }
  next();
};

// Blocks pending / rejected / suspended users from accessing protected routes
const requireActive = (req, res, next) => {
  if (req.user.status !== 'active') {
    const messages = {
      pending:   'Your account is awaiting admin approval.',
      rejected:  'Your registration was not approved.',
      suspended: 'Your account has been suspended. Contact support.',
    };
    return res.status(403).json({ message: messages[req.user.status] || 'Account inactive.' });
  }
  next();
};

module.exports = { protect, requireRole, requireActive };
