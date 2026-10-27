const mongoose = require('mongoose');

const doctorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    specialization: {
      type: String,
      required: [true, 'Please provide doctor specialization'],
      trim: true
    },
    qualifications: {
      type: String,
      required: [true, 'Please provide qualifications (e.g., MBBS, MD)'],
      trim: true
    },
    experienceYears: {
      type: Number,
      required: [true, 'Please provide years of experience'],
      min: 0,
      default: 1
    },
    consultationFee: {
      type: Number,
      required: [true, 'Please provide consultation fee'],
      min: 0,
      default: 500
    },
    department: {
      type: String,
      default: 'General'
    },
    roomNumber: {
      type: String,
      trim: true,
      default: 'OPD-101'
    },
    availableDays: {
      type: [String],
      default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    },
    workingHours: {
      start: { type: String, default: '09:00' },
      end: { type: String, default: '17:00' }
    },
    slotDuration: {
      type: Number,
      default: 30,
      enum: [15, 20, 30, 45, 60]
    },
    breakTimes: {
      enabled: { type: Boolean, default: true },
      start: { type: String, default: '13:00' },
      end: { type: String, default: '14:00' }
    },
    unavailableDates: {
      type: [String],
      default: []
    },
    maxAppointmentsPerDay: {
      type: Number,
      default: 25
    },
    bio: {
      type: String,
      trim: true,
      default: ''
    },
    isAvailable: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

doctorProfileSchema.index({ specialization: 1, isAvailable: 1 });
doctorProfileSchema.index({ department: 1, isAvailable: 1 });

module.exports = mongoose.model('DoctorProfile', doctorProfileSchema);
