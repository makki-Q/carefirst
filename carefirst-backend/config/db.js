const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmin = async () => {
  const existing = await User.findOne({ role: 'admin' });
  if (!existing) {
    await User.create({
      name:     'Administrator',
      email:    'admin@carefirst.pk',
      password: process.env.ADMIN_PASSWORD || 'admin123',
      role:     'admin',
      status:   'active',
    });
    console.log('Admin user seeded (username: admin / password: admin123)');
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
    await seedAdmin();
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
