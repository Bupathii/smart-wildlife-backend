require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const DUMMY_USERS = [
  { name: 'Alice Admin', email: 'admin@wildlife.test', password: 'Admin@123', role: 'ADMIN' },
  { name: 'Mia Manager', email: 'manager@wildlife.test', password: 'Manager@123', role: 'MANAGER' },
  { name: 'Ross Researcher', email: 'researcher@wildlife.test', password: 'Researcher@123', role: 'RESEARCHER' },
  { name: 'Ravi Ranger', email: 'ranger@wildlife.test', password: 'Ranger@123', role: 'RANGER' },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB for seeding');

  for (const dummy of DUMMY_USERS) {
    const hashedPassword = await bcrypt.hash(dummy.password, 10);
    await User.findOneAndUpdate(
      { email: dummy.email },
      { name: dummy.name, email: dummy.email, password: hashedPassword, role: dummy.role, status: 'ACTIVE' },
      { upsert: true, new: true }
    );
    console.log(`Seeded ${dummy.role}: ${dummy.email} / ${dummy.password}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
