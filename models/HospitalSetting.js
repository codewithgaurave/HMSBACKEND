const mongoose = require('mongoose');

const hospitalSettingSchema = new mongoose.Schema(
  {
    hospitalName: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true,
      default: 'Hospital Management System'
    },
    contactNumber: {
      type: String,
      trim: true,
      default: '+91 800-467-7482'
    },
    emergencyContact: {
      type: String,
      trim: true,
      default: '+91 800-467-9999'
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'contact@hospitalmanagement.com'
    },
    address: {
      type: String,
      trim: true,
      default: '742 Healthcare Boulevard, Medical Enclave, New Delhi, 110001'
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata'
    },
    appointmentSettings: {
      slotDurationMinutes: {
        type: Number,
        default: 30,
        min: 15,
        max: 120
      },
      maxAppointmentsPerDay: {
        type: Number,
        default: 50,
        min: 1
      },
      workingHoursStart: {
        type: String,
        default: '09:00'
      },
      workingHoursEnd: {
        type: String,
        default: '18:00'
      },
      advanceBookingDays: {
        type: Number,
        default: 30,
        min: 1,
        max: 90
      },
      allowPatientCancellation: {
        type: Boolean,
        default: true
      }
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('HospitalSetting', hospitalSettingSchema);
