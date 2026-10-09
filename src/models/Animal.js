const mongoose = require('mongoose');

const animalSchema = new mongoose.Schema(
  {
    animalId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    species: {
      type: String,
      required: true,
      trim: true,
    },
    sex: {
      type: String,
      enum: ['MALE', 'FEMALE', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    age: {
      type: Number,
      min: 0,
    },
    conservationStatus: {
      type: String,
      default: 'VULNERABLE',
    },
    currentLocation: {
      latitude: Number,
      longitude: Number,
      lastUpdated: Date,
    },
    trackingSession: {
      status: {
        type: String,
        enum: ['STOPPED', 'REQUESTED', 'ACTIVE'],
        default: 'STOPPED',
      },
      requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      requestedAt: Date,
      startedAt: Date,
      stoppedAt: Date,
    },
    photo: {
      url: String,
      publicId: String,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Animal', animalSchema);
