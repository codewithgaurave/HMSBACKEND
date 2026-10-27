const mongoose = require('mongoose');

const medicalRecordSchema = new mongoose.Schema(
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
    recordType: {
      type: String,
      enum: ['Consultation', 'Diagnosis', 'Surgery', 'Discharge Summary', 'Vaccination', 'Emergency'],
      default: 'Consultation'
    },
    title: {
      type: String,
      required: [true, 'Record title is required'],
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    vitalSigns: {
      bloodPressure: { type: String, default: '' }, // e.g., 120/80 mmHg
      heartRate: { type: String, default: '' }, // e.g., 72 bpm
      temperature: { type: String, default: '' }, // e.g., 98.6 F
      respiratoryRate: { type: String, default: '' }, // e.g., 18 /min
      spO2: { type: String, default: '' }, // e.g., 99%
      weight: { type: String, default: '' }, // e.g., 70 kg
      height: { type: String, default: '' } // e.g., 175 cm
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment'
    },
    symptoms: {
      type: String,
      default: ''
    },
    clinicalObservations: {
      type: String,
      default: ''
    },
    diagnosis: {
      type: String,
      default: ''
    },
    treatmentPlan: {
      type: String,
      default: ''
    },
    doctorNotes: {
      type: String,
      default: ''
    },
    followUpDate: {
      type: Date
    },
    recordedDate: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

medicalRecordSchema.index({ patient: 1, recordedDate: -1 });
medicalRecordSchema.index({ doctor: 1, recordedDate: -1 });
medicalRecordSchema.index({ appointment: 1 });

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);
