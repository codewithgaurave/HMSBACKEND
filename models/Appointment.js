const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Patient ID is required']
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Doctor ID is required']
    },
    appointmentDate: {
      type: Date,
      required: [true, 'Appointment date is required']
    },
    timeSlot: {
      start: {
        type: String,
        required: [true, 'Start time is required']
      },
      end: {
        type: String,
        required: [true, 'End time is required']
      }
    },
    reasonForVisit: {
      type: String,
      required: [true, 'Reason for visit is required'],
      trim: true,
      maxlength: [500, 'Reason cannot exceed 500 characters']
    },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'Rejected'],
      default: 'Pending'
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Index to ensure efficient lookup and prevent double booking for same doctor at same date and slot
appointmentSchema.index({ doctor: 1, appointmentDate: 1, 'timeSlot.start': 1 });
appointmentSchema.index({ patient: 1, appointmentDate: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
