const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE_URL = 'http://localhost:5000/api';

// Helper for making API requests in tests
function apiRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('Hospital Management System - API Verification Suite', async (t) => {
  let adminToken = '';
  let patientToken = '';
  let doctorToken = '';
  let labToken = '';

  await t.test('1. Health check endpoint responds OK', async () => {
    const res = await apiRequest('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  await t.test('2. Authentication - Admin login with valid credentials', async () => {
    const res = await apiRequest('/auth/login', 'POST', {
      email: 'admin@hospital.com',
      password: 'Admin@123'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.role, 'admin');
    assert.ok(res.body.token);
    adminToken = res.body.token;
  });

  await t.test('3. Authentication - Login failure with invalid password', async () => {
    const res = await apiRequest('/auth/login', 'POST', {
      email: 'admin@hospital.com',
      password: 'WrongPassword'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('4. Authentication - Doctor login', async () => {
    const res = await apiRequest('/auth/login', 'POST', {
      email: 'doctor@hospital.com',
      password: 'Doctor@123'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.role, 'doctor');
    doctorToken = res.body.token;
  });

  await t.test('5. Authentication - Patient login', async () => {
    const res = await apiRequest('/auth/login', 'POST', {
      email: 'patient@hospital.com',
      password: 'Patient@123'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.role, 'patient');
    patientToken = res.body.token;
  });

  await t.test('6. Authentication - Lab staff login', async () => {
    const res = await apiRequest('/auth/login', 'POST', {
      email: 'lab@hospital.com',
      password: 'Lab@123'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.role, 'lab');
    labToken = res.body.token;
  });

  await t.test('7. Role Authorization - Patient is forbidden from admin dashboard', async () => {
    const res = await apiRequest('/reports/admin-dashboard', 'GET', null, patientToken);
    assert.strictEqual(res.status, 403);
  });

  await t.test('8. Role Authorization - Admin can access admin dashboard statistics', async () => {
    const res = await apiRequest('/reports/admin-dashboard', 'GET', null, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.stats.totalDoctors >= 1);
  });

  await t.test('9. Public & Protected - Fetch Doctors Catalog', async () => {
    const res = await apiRequest('/doctors', 'GET');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.doctors.length >= 1);
  });

  await t.test('10. Lab Catalog - Fetch available tests', async () => {
    const res = await apiRequest('/lab/tests', 'GET');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.tests.length >= 1);
  });
});
