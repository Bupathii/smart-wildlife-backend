require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const dummyUsers = [
  {
    name: 'Nimal Perera',
    email: 'admin.demo@wildlife.lk',
    password: 'Admin@123',
    role: 'ADMIN',
    phone: '0771000001',
    status: 'ACTIVE',
  },
  {
    name: 'Kasun Silva',
    email: 'manager.demo@wildlife.lk',
    password: 'Manager@123',
    role: 'PARK_MANAGER',
    phone: '0771000002',
    status: 'ACTIVE',
  },
  {
    name: 'Tharindu Jayasinghe',
    email: 'supervisor.demo@wildlife.lk',
    password: 'Supervisor@123',
    role: 'RANGER_SUPERVISOR',
    phone: '0771000003',
    status: 'ACTIVE',
  },
  {
    name: 'Dilan Fernando',
    email: 'ranger.demo@wildlife.lk',
    password: 'Ranger@123',
    role: 'RANGER',
    phone: '0771000004',
    status: 'ACTIVE',
  },
  {
    name: 'Amaya Senanayake',
    email: 'liaison.demo@wildlife.lk',
    password: 'Liaison@123',
    role: 'COMMUNITY_LIAISON_OFFICER',
    phone: '0771000005',
    status: 'ACTIVE',
  },
  {
    name: 'Saman Kumara',
    email: 'community.demo@wildlife.lk',
    password: 'Community@123',
    role: 'COMMUNITY_MEMBER',
    phone: '0771000006',
    status: 'ACTIVE',
  },
  {
    name: 'Ishara Wickramasinghe',
    email: 'researcher.demo@wildlife.lk',
    password: 'Researcher@123',
    role: 'RESEARCHER',
    phone: '0771000007',
    status: 'ACTIVE',
  },
];

const seedUsers = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing in the .env file');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log('MongoDB connected for seeding');

    // Optional migration from old role name
    await User.updateMany(
      { role: 'MANAGER' },
      { $set: { role: 'PARK_MANAGER' } }
    );

    for (const userData of dummyUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      await User.findOneAndUpdate(
        { email: userData.email.toLowerCase() },
        {
          $set: {
            name: userData.name,
            email: userData.email.toLowerCase(),
            password: hashedPassword,
            role: userData.role,
            phone: userData.phone,
            status: userData.status,
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );

      console.log(
        `Created/Updated: ${userData.role} - ${userData.email}`
      );
    }

    console.log('\nDummy users seeded successfully.\n');

    console.log('Login Accounts');
    console.log('-------------------------------------------');

    dummyUsers.forEach((user) => {
      console.log(`${user.role}`);
      console.log(`Email    : ${user.email}`);
      console.log(`Password : ${user.password}`);
      console.log('-------------------------------------------');
    });

  } catch (error) {
    console.error('Seed error:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed');
  }
};

seedUsers();