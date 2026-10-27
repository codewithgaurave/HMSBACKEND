const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema(
  {
    testName: {
      type: String,
      required: [true, 'Test name is required'],
      trim: true
    },
    testCode: {
      type: String,
      required: [true, 'Test code is required'],
      unique: true,
      trim: true,
      uppercase: true
    },
    category: {
      type: String,
      required: [true, 'Test category is required'],
      trim: true
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: 0
    },
    turnaroundHours: {
      type: Number,
      default: 24
    },
    sampleType: {
      type: String,
      required: [true, 'Sample type is required'],
      trim: true
    },
    normalRange: {
      type: String,
      default: 'Refer to report notes'
    },
    units: {
      type: String,
      default: 'N/A'
    },
    description: {
      type: String,
      default: ''
    },
    preparationInstructions: {
      type: String,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

labTestSchema.index({ category: 1, isActive: 1 });
labTestSchema.index({ testName: 1 });

module.exports = mongoose.model('LabTest', labTestSchema);
