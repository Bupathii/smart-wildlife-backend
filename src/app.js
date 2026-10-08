const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('node:path');
const {
  notFoundHandler,
  errorHandler,
} = require('./middleware/error.middleware');
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.use(
  '/uploads',
  express.static(path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'))
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Wildlife Conservation API is running' });
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/animals', require('./routes/animal.routes'));
app.use('/api/tracking', require('./routes/tracking.routes'));
app.use('/api/risk-zones', require('./routes/highRiskZone.routes'));

app.use(
  '/api/conflicts',
  require('./routes/conflict.routes')
);

require('./patrol.container').mountPatrolMonitoring(app);

app.use(notFoundHandler);

app.use(errorHandler);



// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
