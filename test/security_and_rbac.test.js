const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

// Set test environment flag before loading app
process.env.NODE_ENV = 'test';
const app = require('../server');

const User = require('../models/User');
const LabTest = require('../models/LabTest');
const LabRequest = require('../models/LabRequest');
const LabResult = require('../models/LabResult');
const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const PasswordResetToken = require('../models/PasswordResetToken');

test('HMS Production Security, RBAC & Data Integrity Test Suite', async (suite) => {
  let adminToken = '';
  let doctorToken = '';
  let patientToken = '';
  let labToken = '';

  let adminUser = null;
  let doctorUser = null;
  let patientUser = null;
  let labUser = null;

  // Setup: Retrieve seed users
  await suite.test('Setup: Verify database connection and seed users', async () => {
    // Wait until database connection is established
    for (let i = 0; i < 50; i++) {
      if (mongoose.connection.readyState === 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.strictEqual(mongoose.connection.readyState, 1, 'Mongoose must be connected to run tests');

    adminUser = await User.findOne({ email: 'admin@hospital.com' });
    doctorUser = await User.findOne({ email: 'doctor@hospital.com' });
    patientUser = await User.findOne({ email: 'patient@hospital.com' });
    labUser = await User.findOne({ email: 'lab@hospital.com' });

    assert.ok(adminUser, 'Admin seed user exists');
    assert.ok(doctorUser, 'Doctor seed user exists');
    assert.ok(patientUser, 'Patient seed user exists');
    assert.ok(labUser, 'Lab seed user exists');
  });

  // 1. Health check & Security headers
  await suite.test('1. Health check & Helmet security headers', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.database, 'connected');
    assert.ok(res.headers['x-dns-prefetch-control']);
    assert.ok(res.headers['x-content-type-options']);
  });

  // 2. Authentication: Login for all 4 roles
  await suite.test('2. Authentication: Login for all four roles', async () => {
    // Admin login
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@hospital.com', password: 'Admin@123' });
    assert.strictEqual(adminRes.statusCode, 200);
    assert.strictEqual(adminRes.body.user.role, 'admin');
    assert.ok(adminRes.body.token);
    adminToken = adminRes.body.token;

    // Doctor login
    const docRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'doctor@hospital.com', password: 'Doctor@123' });
    assert.strictEqual(docRes.statusCode, 200);
    assert.strictEqual(docRes.body.user.role, 'doctor');
    assert.ok(docRes.body.token);
    doctorToken = docRes.body.token;

    // Patient login
    const patRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'patient@hospital.com', password: 'Patient@123' });
    assert.strictEqual(patRes.statusCode, 200);
    assert.strictEqual(patRes.body.user.role, 'patient');
    assert.ok(patRes.body.token);
    patientToken = patRes.body.token;

    // Lab staff login
    const labRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'lab@hospital.com', password: 'Lab@123' });
    assert.strictEqual(labRes.statusCode, 200);
    assert.strictEqual(labRes.body.user.role, 'lab');
    assert.ok(labRes.body.token);
    labToken = labRes.body.token;
  });

  // 3. Authentication: Failure cases
  await suite.test('3. Authentication: Invalid credentials & missing parameters', async () => {
    const badPw = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@hospital.com', password: 'IncorrectPassword' });
    assert.strictEqual(badPw.statusCode, 401);
    assert.strictEqual(badPw.body.success, false);

    const missingFields = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@hospital.com' });
    assert.strictEqual(missingFields.statusCode, 400);
  });

  // 4. Registration Security: Public registration restricted to Patient role only
  await suite.test('4. Registration: Forced Patient role for public register endpoint', async () => {
    const testEmail = `test_patient_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Privilege Escalation Tester',
        email: testEmail,
        password: 'Password@123',
        role: 'admin' // Attempting privilege escalation
      });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.user.role, 'patient', 'Role must remain patient even if admin was submitted');

    // Clean up created test user
    await User.deleteOne({ email: testEmail });
  });

  // 5. RBAC: Administrative route protection
  await suite.test('5. RBAC: Patient, Doctor, Lab blocked from Admin routes', async () => {
    // Patient blocked
    const patRes = await request(app)
      .get('/api/reports/admin-dashboard')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.strictEqual(patRes.statusCode, 403);

    // Doctor blocked
    const docRes = await request(app)
      .get('/api/reports/admin-dashboard')
      .set('Authorization', `Bearer ${doctorToken}`);
    assert.strictEqual(docRes.statusCode, 403);

    // Lab staff blocked
    const labRes = await request(app)
      .get('/api/reports/admin-dashboard')
      .set('Authorization', `Bearer ${labToken}`);
    assert.strictEqual(labRes.statusCode, 403);

    // Admin allowed
    const adminRes = await request(app)
      .get('/api/reports/admin-dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(adminRes.statusCode, 200);
    assert.ok(adminRes.body.stats);
  });

  // 6. Data Isolation: Patient cannot view another patient profile
  await suite.test('6. Data Privacy: Patient cannot access another user profile', async () => {
    const res = await request(app)
      .get(`/api/patients/${adminUser._id}`)
      .set('Authorization', `Bearer ${patientToken}`);
    assert.strictEqual(res.statusCode, 403);
  });

  // 7. Appointment Integrity: Past date scheduling restriction
  await suite.test('7. Appointment Integrity: Past-date booking rejected', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);

    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: doctorUser._id,
        appointmentDate: pastDate.toISOString(),
        timeSlot: { start: '10:00 AM', end: '10:30 AM' },
        reasonForVisit: 'Testing past date rejection'
      });

    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.toLowerCase().includes('past'));
  });

  // 8. Prescription Clinical Relationship Enforcement
  await suite.test('8. Clinical Relationship: Doctor cannot prescribe without appointment', async () => {
    // Create an unlinked dummy patient
    const randomUser = await User.create({
      name: 'Unrelated Patient',
      email: `unrelated_${Date.now()}@example.com`,
      password: 'Password@123',
      role: 'patient'
    });

    const res = await request(app)
      .post('/api/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: randomUser._id,
        diagnosis: 'Test Condition',
        medications: [{ medicineName: 'Paracetamol', dosage: '500mg', duration: '3 days' }]
      });

    assert.strictEqual(res.statusCode, 403);
    assert.ok(res.body.message.toLowerCase().includes('clinical appointment') || res.body.message.toLowerCase().includes('relationship'));

    await User.deleteOne({ _id: randomUser._id });
  });

  // 9. Lab Portal: Patient access to unreleased reports restricted
  await suite.test('9. Lab Security: Patient cannot view draft/unreleased test results', async () => {
    const catalogTest = await LabTest.findOne({ isActive: true });
    assert.ok(catalogTest);

    // Create an unreleased lab request in Processing state
    const unreleasedReq = await LabRequest.create({
      patient: patientUser._id,
      doctor: doctorUser._id,
      labTest: catalogTest._id,
      requestedBy: doctorUser._id,
      status: 'Processing'
    });

    // Create an unreleased result (no publishedAt)
    const draftResult = await LabResult.create({
      labRequest: unreleasedReq._id,
      patient: patientUser._id,
      performedBy: labUser._id,
      parameters: [{ parameterName: 'Analyte X', measuredValue: '10', unit: 'mg/dL' }],
      remarks: 'Draft result'
    });

    // Patient tries to fetch unreleased result
    const patientRes = await request(app)
      .get(`/api/lab/results/${unreleasedReq._id}`)
      .set('Authorization', `Bearer ${patientToken}`);

    assert.strictEqual(patientRes.statusCode, 403, 'Patient must be blocked from unreleased reports');

    // Lab staff can view draft result
    const labRes = await request(app)
      .get(`/api/lab/results/${unreleasedReq._id}`)
      .set('Authorization', `Bearer ${labToken}`);

    assert.strictEqual(labRes.statusCode, 200, 'Lab staff can view draft results');

    // Clean up
    await LabResult.deleteOne({ _id: draftResult._id });
    await LabRequest.deleteOne({ _id: unreleasedReq._id });
  });

  // 10. Lab Portal: Real Dashboard Stats Endpoint
  await suite.test('10. Lab Dashboard: Real database counts returned', async () => {
    const res = await request(app)
      .get('/api/lab/dashboard-stats')
      .set('Authorization', `Bearer ${labToken}`);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.stats);
    assert.strictEqual(typeof res.body.stats.totalAssigned, 'number');
    assert.strictEqual(typeof res.body.stats.pendingRequests, 'number');
    assert.strictEqual(typeof res.body.stats.sampleCollected, 'number');
    assert.strictEqual(typeof res.body.stats.processing, 'number');
    assert.strictEqual(typeof res.body.stats.published, 'number');
    assert.ok(Array.isArray(res.body.recentActivity));
  });

  // 11. Error Handling: CastError handling for invalid ObjectIds
  await suite.test('11. Error Handling: Invalid MongoDB ObjectId returns 404', async () => {
    const res = await request(app)
      .get('/api/doctors/invalid-object-id-12345')
      .set('Authorization', `Bearer ${patientToken}`);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
  });

  // 12. Password Reset Token: Single-use behavior
  await suite.test('12. Security: Password reset token single-use behavior', async () => {
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await PasswordResetToken.create({
      user: patientUser._id,
      token: hashedToken,
      used: false,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    // 1st reset attempt: should succeed
    const res1 = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: 'PatientNew@123' });
    assert.strictEqual(res1.statusCode, 200);

    // 2nd reset attempt with same token: must fail
    const res2 = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: 'PatientAnother@123' });
    assert.strictEqual(res2.statusCode, 400, 'Re-using a spent reset token must be rejected');

    // Restore original demo password
    const userToRestore = await User.findById(patientUser._id);
    if (userToRestore) {
      userToRestore.password = 'Patient@123';
      await userToRestore.save();
    }
    await PasswordResetToken.deleteMany({ user: patientUser._id });
  });

  // 13. Path Traversal Protection on Report Download
  await suite.test('13. File Security: Path traversal on report download is rejected', async () => {
    const res = await request(app)
      .get('/api/lab/reports/../../../../etc/passwd/download')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.ok([400, 404].includes(res.statusCode), 'Path traversal must be safely handled');
  });

  // Teardown: Close database connection
  await mongoose.connection.close();
});

