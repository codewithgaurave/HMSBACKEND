const mongoose = require('mongoose');

const labRequestSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Patient ID is required']
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    labTest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LabTest',
      required: [true, 'Lab test is required']
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    priority: {
      type: String,
      enum: ['Normal', 'Urgent', 'Stat'],
      default: 'Normal'
    },
    status: {
      type: String,
      enum: [
        'Requested',
        'Accepted',
        'Sample Collected',
        'Processing',
        'Completed',
        'Reviewed',
        'Published',
        'Rejected',
        'Cancelled'
      ],
      default: 'Requested'
    },
    clinicalNotes: {
      type: String,
      trim: true,
      default: ''
    },
    expectedCompletionDate: {
      type: Date
    },
    sampleType: {
      type: String,
      trim: true,
      default: ''
    },
    sampleCollectedAt: {
      type: Date
    },
    sampleCollectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    sampleNotes: {
      type: String,
      trim: true,
      default: ''
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: ''
    },
    rejectedAt: {
      type: Date
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: ''
    },
    publishedAt: {
      type: Date
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        note: { type: String, default: '' }
      }
    ]
  },
  {
    timestamps: true
  }
);

// Performance Indexes
labRequestSchema.index({ status: 1, createdAt: -1 });
labRequestSchema.index({ patient: 1, status: 1 });
labRequestSchema.index({ doctor: 1, createdAt: -1 });
labRequestSchema.index({ assignedStaff: 1 });
labRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LabRequest', labRequestSchema);
