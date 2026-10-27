const mongoose = require('mongoose');

const testParameterSchema = new mongoose.Schema({
  parameterName: { type: String, required: true },
  measuredValue: { type: String, required: true },
  unit: { type: String, default: '' },
  referenceRange: { type: String, default: '' },
  flag: {
    type: String,
    enum: ['Normal', 'High', 'Low', 'Abnormal', 'Critical', 'Pending'],
    default: 'Normal'
  }
});

const labResultSchema = new mongoose.Schema(
  {
    labRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LabRequest',
      required: true,
      unique: true
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    parameters: [testParameterSchema],
    remarks: {
      type: String,
      trim: true,
      default: 'Results verified by clinical laboratory.'
    },
    reportFileUrl: {
      type: String,
      default: ''
    },
    reportFileName: {
      type: String,
      default: ''
    },
    reportFileMimeType: {
      type: String,
      default: ''
    },
    publishedAt: {
      type: Date
    },
    amendmentHistory: [
      {
        amendedAt: { type: Date, default: Date.now },
        amendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String, default: '' },
        previousParameters: [testParameterSchema],
        previousRemarks: { type: String, default: '' }
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('LabResult', labResultSchema);
