const mongoose = require('mongoose');

const medicationItemSchema = new mongoose.Schema({
  medicineName: { type: String, required: true },
  dosage: { type: String, required: true }, // e.g. "500 mg"
  frequency: { type: String, required: true }, // e.g. "1-0-1 (Twice daily)"
  duration: { type: String, required: true }, // e.g. "5 days"
  instructions: { type: String, default: 'After meals' }
});

const prescriptionSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment'
    },
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis is required'],
      trim: true
    },
    symptoms: {
      type: String,
      trim: true,
      default: ''
    },
    medications: [medicationItemSchema],
    clinicalAdvice: {
      type: String,
      trim: true,
      default: ''
    },
    followUpDate: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ doctor: 1, createdAt: -1 });
prescriptionSchema.index({ appointment: 1 });

module.exports = mongoose.model('Prescription', prescriptionSchema);
