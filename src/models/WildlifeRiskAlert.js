const mongoose = require('mongoose');

const wildlifeRiskAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    animalId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    animalName: {
      type: String,
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    zoneId: {
      type: String,
      trim: true,
    },
    zoneName: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['NEW', 'ACKNOWLEDGED', 'RESPONSE_INITIATED', 'RESOLVED', 'ESCALATED'],
      default: 'NEW',
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'HIGH',
    },
    assignedResponderId: {
      type: String,
      trim: true,
    },
    assignedResponderName: {
      type: String,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    responseType: {
      type: String,
      default: 'INVESTIGATE',
    },
    responseNotes: {
      type: String,
      default: '',
    },
    notifiedAt: {
      type: Date,
      default: Date.now,
    },
    acknowledgedAt: Date,
    resolvedAt: Date,
    escalatedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('WildlifeRiskAlert', wildlifeRiskAlertSchema);
