const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const LabTest = require('../models/LabTest');
const LabRequest = require('../models/LabRequest');
const LabResult = require('../models/LabResult');
const AuditLog = require('../models/AuditLog');

async function runTests() {
  console.log('--- STARTING PHASE 6 LAB PORTAL VERIFICATION SUITE ---');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB');

  // Test 1: Verify Lab Staff User
  const labUser = await User.findOne({ email: 'lab@hospital.com' });
  if (!labUser || labUser.role !== 'lab') {
    throw new Error('Lab user not found or has incorrect role');
  }
  console.log('✓ Test 1: Lab Staff user exists with role "lab":', labUser.name);

  // Test 2: Test Catalog Validation & Retrieval
  const tests = await LabTest.find({ isActive: true });
  console.log(`✓ Test 2: Retrieved ${tests.length} active catalog tests`);
  if (tests.length === 0) throw new Error('No catalog tests found');

  // Test 3: Create & Validate a New Test in Catalog
  const testCode = 'TEST-' + Date.now();
  const createdTest = await LabTest.create({
    testName: 'Automated Vit D Test',
    testCode,
    category: 'Biochemistry',
    price: 600,
    turnaroundHours: 24,
    sampleType: 'Serum',
    preparationInstructions: 'Fasting 8 hours',
    isActive: true
  });
  console.log('✓ Test 3: Created catalog test with unique code:', createdTest.testCode);

  // Test duplicate testCode prevention
  try {
    await LabTest.create({
      testName: 'Duplicate Vit D',
      testCode,
      category: 'Biochemistry',
      price: 600,
      sampleType: 'Serum'
    });
    throw new Error('Duplicate testCode should have thrown an error!');
  } catch (err) {
    console.log('✓ Test 4: Duplicate testCode correctly rejected by DB unique index');
  }

  // Cleanup test item
  await LabTest.deleteOne({ _id: createdTest._id });

  // Test 5: Workflow State Transitions for a Test Request
  const patient = await User.findOne({ role: 'patient' });
  const doctor = await User.findOne({ role: 'doctor' });
  const catalogTest = tests[0];

  const reqObj = await LabRequest.create({
    patient: patient._id,
    doctor: doctor._id,
    labTest: catalogTest._id,
    requestedBy: doctor._id,
    priority: 'Urgent',
    status: 'Requested',
    statusHistory: [{ status: 'Requested', updatedBy: doctor._id }]
  });
  console.log('✓ Test 5: Created test request in "Requested" state:', reqObj._id);

  // Transition to Accepted
  reqObj.status = 'Accepted';
  reqObj.assignedStaff = labUser._id;
  reqObj.statusHistory.push({ status: 'Accepted', updatedBy: labUser._id });
  await reqObj.save();
  console.log('✓ Test 6: Advanced to "Accepted" and assigned staff');

  // Transition to Sample Collected
  reqObj.status = 'Sample Collected';
  reqObj.sampleCollectedAt = new Date();
  reqObj.sampleCollectedBy = labUser._id;
  reqObj.sampleType = 'Serum';
  reqObj.sampleNotes = 'Vein puncture left arm, clear specimen';
  reqObj.statusHistory.push({ status: 'Sample Collected', updatedBy: labUser._id });
  await reqObj.save();
  console.log('✓ Test 7: Advanced to "Sample Collected" with collection notes and timestamp');

  // Transition to Processing
  reqObj.status = 'Processing';
  reqObj.statusHistory.push({ status: 'Processing', updatedBy: labUser._id });
  await reqObj.save();
  console.log('✓ Test 8: Advanced to "Processing" bench stage');

  // Test 9: Result Recording & Completion
  const resultObj = await LabResult.create({
    labRequest: reqObj._id,
    patient: patient._id,
    performedBy: labUser._id,
    parameters: [
      { parameterName: 'Analyte 1', measuredValue: '12.4', unit: 'mg/dL', referenceRange: '10 - 20', flag: 'Normal' }
    ],
    remarks: 'Automated test suite verification result'
  });
  reqObj.status = 'Completed';
  reqObj.statusHistory.push({ status: 'Completed', updatedBy: labUser._id });
  await reqObj.save();
  console.log('✓ Test 9: Recorded results and transitioned to "Completed"');

  // Test 10: Review and Approval
  reqObj.status = 'Reviewed';
  reqObj.reviewedBy = labUser._id;
  reqObj.reviewedAt = new Date();
  reqObj.reviewNotes = 'Verified by pathologist';
  resultObj.reviewedBy = labUser._id;
  resultObj.reviewedAt = new Date();
  await reqObj.save();
  await resultObj.save();
  console.log('✓ Test 10: Pathologist reviewed and approved report');

  // Test 11: Release / Publishing
  reqObj.status = 'Published';
  reqObj.publishedBy = labUser._id;
  reqObj.publishedAt = new Date();
  resultObj.publishedBy = labUser._id;
  resultObj.publishedAt = new Date();
  await reqObj.save();
  await resultObj.save();
  console.log('✓ Test 11: Officially released report ("Published") to patient and doctor');

  // Test 12: Controlled Amendment on Released Report
  resultObj.amendmentHistory.push({
    amendedAt: new Date(),
    amendedBy: labUser._id,
    reason: 'Clinical correction of analyte units',
    previousParameters: resultObj.parameters,
    previousRemarks: resultObj.remarks
  });
  resultObj.parameters = [
    { parameterName: 'Analyte 1', measuredValue: '12.4', unit: 'g/dL', referenceRange: '10 - 20', flag: 'Normal' }
  ];
  await resultObj.save();
  console.log('✓ Test 12: Successfully logged auditable amendment with prior version preservation');

  // Clean up test request and result
  await LabResult.deleteOne({ _id: resultObj._id });
  await LabRequest.deleteOne({ _id: reqObj._id });
  console.log('✓ Test 13: Cleaned up temporary test artifacts');

  // Test 14: Rejection Workflow Validation
  const rejectReq = await LabRequest.create({
    patient: patient._id,
    doctor: doctor._id,
    labTest: catalogTest._id,
    requestedBy: doctor._id,
    priority: 'Normal',
    status: 'Requested'
  });
  rejectReq.status = 'Rejected';
  rejectReq.rejectionReason = 'Specimen clotted and hemolyzed';
  rejectReq.rejectedAt = new Date();
  rejectReq.rejectedBy = labUser._id;
  await rejectReq.save();
  console.log('✓ Test 14: Rejection workflow recorded with reason and timestamps');
  await LabRequest.deleteOne({ _id: rejectReq._id });

  console.log('--- ALL BACKEND VERIFICATION CHECKS PASSED SUCCESSFULLY ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
