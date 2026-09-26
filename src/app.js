const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || 'uploads'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Wildlife Conservation API is running' });
});

app.use('/api/auth', require('./routes/auth.routes'));

// Further routes will be mounted here as each module is implemented, e.g.:
// app.use('/api/patrols', require('./routes/patrol.routes'));

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
