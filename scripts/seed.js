const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const PatientProfile = require('../models/PatientProfile');
const LabTest = require('../models/LabTest');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');
const LabResult = require('../models/LabResult');
const Prescription = require('../models/Prescription');
const MedicalRecord = require('../models/MedicalRecord');
const AuditLog = require('../models/AuditLog');

const seedData = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hospital_management_db';
    await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB...');

    // Clear existing collections
    await User.deleteMany({});
    await DoctorProfile.deleteMany({});
    await PatientProfile.deleteMany({});
    await LabTest.deleteMany({});
    await Appointment.deleteMany({});
    await LabRequest.deleteMany({});
    await LabResult.deleteMany({});
    await Prescription.deleteMany({});
    await MedicalRecord.deleteMany({});
    await AuditLog.deleteMany({});

    console.log('[Seed] Cleared existing data.');

    // 1. Create Admin
    const admin = await User.create({
      name: 'Dr. Arthur Mitchell (Chief Medical Administrator)',
      email: 'admin@hospital.com',
      password: 'Admin@123',
      role: 'admin',
      phone: '+1 (555) 019-2831',
      status: 'active'
    });

    // 2. Create Doctors
    const doctor1User = await User.create({
      name: 'Dr. Sarah Jenkins',
      email: 'doctor@hospital.com', // Primary demo doctor
      password: 'Doctor@123',
      role: 'doctor',
      phone: '+1 (555) 234-5678',
      status: 'active'
    });

    const doctor1Profile = await DoctorProfile.create({
      user: doctor1User._id,
      specialization: 'Cardiology',
      qualifications: 'MD, FACC, Harvard Medical School',
      experienceYears: 14,
      consultationFee: 900,
      department: 'Cardiology & Vascular Care',
      roomNumber: 'Cardio Suite 302',
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      workingHours: { start: '09:00', end: '16:00' },
      maxAppointmentsPerDay: 20,
      bio: 'Senior Consultant Interventional Cardiologist specializing in cardiovascular prevention and coronary angiography.',
      isAvailable: true
    });

    const doctor2User = await User.create({
      name: 'Dr. Robert Chen',
      email: 'robert.chen@hospital.com',
      password: 'Doctor@123',
      role: 'doctor',
      phone: '+1 (555) 345-6789',
      status: 'active'
    });

    await DoctorProfile.create({
      user: doctor2User._id,
      specialization: 'Neurology',
      qualifications: 'MBBS, MD Neurology, Johns Hopkins',
      experienceYears: 16,
      consultationFee: 1100,
      department: 'Department of Neurosciences',
      roomNumber: 'Neuro Wing 405',
      availableDays: ['Monday', 'Wednesday', 'Friday', 'Saturday'],
      workingHours: { start: '10:00', end: '17:00' },
      maxAppointmentsPerDay: 15,
      bio: 'Expert in clinical neurophysiology, neurodegenerative disorders, and migraine therapies.',
      isAvailable: true
    });

    const doctor3User = await User.create({
      name: 'Dr. Emily Watson',
      email: 'emily.watson@hospital.com',
      password: 'Doctor@123',
      role: 'doctor',
      phone: '+1 (555) 456-7890',
      status: 'active'
    });

    await DoctorProfile.create({
      user: doctor3User._id,
      specialization: 'Pediatrics',
      qualifications: 'MBBS, DCH, MD Pediatrics',
      experienceYears: 9,
      consultationFee: 650,
      department: 'Pediatric & Neonatal Care',
      roomNumber: 'Child Care Suite 108',
      availableDays: ['Monday', 'Tuesday', 'Thursday', 'Friday', 'Saturday'],
      workingHours: { start: '08:30', end: '15:30' },
      maxAppointmentsPerDay: 25,
      bio: 'Dedicated pediatrician focused on developmental milestones, preventive vaccination, and pediatric nutrition.',
      isAvailable: true
    });

    // 3. Create Lab Staff
    const labStaff = await User.create({
      name: 'Marcus Bell, Senior Pathologist',
      email: 'lab@hospital.com',
      password: 'Lab@123',
      role: 'lab',
      phone: '+1 (555) 567-8901',
      status: 'active'
    });

    // 4. Create Patients
    const patient1User = await User.create({
      name: 'John Doe',
      email: 'patient@hospital.com', // Primary demo patient
      password: 'Patient@123',
      role: 'patient',
      phone: '+1 (555) 789-0123',
      status: 'active'
    });

    const patient1Profile = await PatientProfile.create({
      user: patient1User._id,
      gender: 'Male',
      bloodGroup: 'O+',
      dateOfBirth: new Date('1989-04-12'),
      address: '742 Evergreen Terrace, Springfield, IL',
      emergencyContact: {
        name: 'Jane Doe',
        relationship: 'Spouse',
        phone: '+1 (555) 789-0124'
      },
      knownAllergies: ['Penicillin', 'Peanuts'],
      chronicConditions: ['Hypertension', 'Mild Asthma'],
      insuranceProvider: 'Blue Cross Blue Shield Healthcare',
      insurancePolicyNumber: 'BCBS-8921-9871'
    });

    const patient2User = await User.create({
      name: 'Eleanor Vance',
      email: 'eleanor.vance@hospital.com',
      password: 'Patient@123',
      role: 'patient',
      phone: '+1 (555) 890-1234',
      status: 'active'
    });

    await PatientProfile.create({
      user: patient2User._id,
      gender: 'Female',
      bloodGroup: 'B+',
      dateOfBirth: new Date('1994-09-22'),
      address: '108 Beacon Hill Way, Boston, MA',
      emergencyContact: {
        name: 'Thomas Vance',
        relationship: 'Brother',
        phone: '+1 (555) 890-5555'
      },
      knownAllergies: [],
      chronicConditions: [],
      insuranceProvider: 'United Healthcare Global',
      insurancePolicyNumber: 'UHC-4401-2092'
    });

    // 5. Create Lab Tests Catalog
    const labTests = await LabTest.insertMany([
      {
        testName: 'Complete Blood Count (CBC)',
        testCode: 'LAB-CBC-01',
        category: 'Hematology',
        price: 350,
        turnaroundHours: 12,
        sampleType: 'Whole Blood (EDTA)',
        normalRange: 'Hemoglobin: 13.5-17.5 g/dL, WBC: 4,000-11,000 /mcL, Platelets: 150,000-450,000 /mcL',
        units: 'Standard Hematology Units',
        description: 'Comprehensive evaluation of cellular blood components including hemoglobin, RBCs, WBC differential, and platelets.'
      },
      {
        testName: 'Lipid Profile Panel',
        testCode: 'LAB-LIPID-02',
        category: 'Biochemistry',
        price: 550,
        turnaroundHours: 24,
        sampleType: 'Serum (Fasting 12 hrs)',
        normalRange: 'Total Cholesterol: < 200 mg/dL, HDL: > 40 mg/dL, LDL: < 100 mg/dL, Triglycerides: < 150 mg/dL',
        units: 'mg/dL',
        description: 'Assesses cardiovascular risk profiles, cholesterol fractions, and arterial plaque probabilities.'
      },
      {
        testName: 'Glycated Hemoglobin (HbA1c)',
        testCode: 'LAB-HBA1C-03',
        category: 'Biochemistry',
        price: 450,
        turnaroundHours: 12,
        sampleType: 'Whole Blood',
        normalRange: 'Non-diabetic: < 5.7%, Prediabetes: 5.7 - 6.4%, Diabetes: >= 6.5%',
        units: '%',
        description: 'Monitors average blood glucose levels over the preceding 3-month clinical period.'
      },
      {
        testName: 'Comprehensive Metabolic Panel (CMP)',
        testCode: 'LAB-CMP-04',
        category: 'Biochemistry',
        price: 800,
        turnaroundHours: 24,
        sampleType: 'Serum',
        normalRange: 'Glucose: 70-99 mg/dL, Calcium: 8.5-10.2 mg/dL, Creatinine: 0.7-1.3 mg/dL',
        units: 'Mixed Clinical Units',
        description: 'Evaluates electrolyte fluid balance, kidney filtration, and glucose regulation.'
      },
      {
        testName: 'Thyroid Function Panel (T3, T4, TSH)',
        testCode: 'LAB-THYROID-05',
        category: 'Endocrinology',
        price: 700,
        turnaroundHours: 24,
        sampleType: 'Serum',
        normalRange: 'TSH: 0.4 - 4.0 mIU/L, Free T4: 0.8 - 1.8 ng/dL, Free T3: 2.3 - 4.2 pg/mL',
        units: 'mIU/L',
        description: 'Diagnoses hyperthyroidism, hypothyroidism, and pituitary-thyroid feedback disorders.'
      },
      {
        testName: 'Urine Routine & Microscopic Examination',
        testCode: 'LAB-URINE-06',
        category: 'Microbiology',
        price: 250,
        turnaroundHours: 6,
        sampleType: 'Clean catch urine',
        normalRange: 'Pale yellow, clear, pH: 5.0 - 7.5, Specific gravity: 1.005 - 1.030, Protein: Negative',
        units: 'Qualitative',
        description: 'Screening test for renal disorders, urinary tract infections (UTI), and metabolic anomalies.'
      }
    ]);

    // 6. Create Realistic Appointments
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appt1 = await Appointment.create({
      patient: patient1User._id,
      doctor: doctor1User._id,
      appointmentDate: tomorrow,
      timeSlot: { start: '10:00 AM', end: '10:30 AM' },
      reasonForVisit: 'Quarterly cardiovascular review and blood pressure assessment',
      status: 'Confirmed',
      notes: 'Patient advised to bring previous ambulatory BP monitoring chart.'
    });

    const appt2 = await Appointment.create({
      patient: patient2User._id,
      doctor: doctor2User._id,
      appointmentDate: tomorrow,
      timeSlot: { start: '11:30 AM', end: '12:00 PM' },
      reasonForVisit: 'Persistent tension-type headaches and episodic dizziness',
      status: 'Pending',
      notes: 'Initial clinical assessment.'
    });

    // 7. Create Prescriptions
    await Prescription.create({
      patient: patient1User._id,
      doctor: doctor1User._id,
      appointment: appt1._id,
      diagnosis: 'Essential Stage-1 Hypertension',
      symptoms: 'Mild morning headache, elevated systolic BP of 138 mmHg',
      medications: [
        {
          medicineName: 'Telmisartan 40mg',
          dosage: '40 mg',
          frequency: '1-0-0 (Once daily morning)',
          duration: '30 days',
          instructions: 'Take after breakfast with water'
        },
        {
          medicineName: 'Amlodipine 5mg',
          dosage: '5 mg',
          frequency: '0-0-1 (Once daily bedtime)',
          duration: '30 days',
          instructions: 'Take 30 minutes before sleep'
        }
      ],
      clinicalAdvice: 'Maintain low-sodium dietary habits, 30 minutes brisk walking daily, and monitor BP weekly.',
      followUpDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    // 8. Create Medical Records
    await MedicalRecord.create({
      patient: patient1User._id,
      doctor: doctor1User._id,
      recordType: 'Consultation',
      title: 'Routine Cardiological Health Encounter',
      description: 'Patient presented for periodic checkup. Heart sounds S1, S2 audible, no murmurs. Lungs clear to auscultation bilaterally. EKG within normal sinus rhythm.',
      vitalSigns: {
        bloodPressure: '136/84 mmHg',
        heartRate: '72 bpm',
        temperature: '98.4 F',
        respiratoryRate: '16 /min',
        spO2: '99%',
        weight: '78 kg',
        height: '178 cm'
      },
      treatmentPlan: 'Continue current antihypertensive therapy and ordered lipid panel check.',
      recordedDate: new Date()
    });

    // 9. Create Lab Requests & Published Result
    const cbcTest = labTests[0];
    const lipidTest = labTests[1];

    // Completed & Published Lab Test
    const labReq1 = await LabRequest.create({
      patient: patient1User._id,
      doctor: doctor1User._id,
      labTest: lipidTest._id,
      requestedBy: doctor1User._id,
      assignedStaff: labStaff._id,
      priority: 'Normal',
      status: 'Published',
      clinicalNotes: 'Screening for dyslipidemia',
      statusHistory: [
        { status: 'Requested', updatedBy: doctor1User._id, timestamp: new Date(Date.now() - 3600000 * 24) },
        { status: 'Accepted', updatedBy: labStaff._id, timestamp: new Date(Date.now() - 3600000 * 20) },
        { status: 'Sample Collected', updatedBy: labStaff._id, timestamp: new Date(Date.now() - 3600000 * 18) },
        { status: 'Processing', updatedBy: labStaff._id, timestamp: new Date(Date.now() - 3600000 * 8) },
        { status: 'Completed', updatedBy: labStaff._id, timestamp: new Date(Date.now() - 3600000 * 4) },
        { status: 'Published', updatedBy: labStaff._id, timestamp: new Date() }
      ]
    });

    await LabResult.create({
      labRequest: labReq1._id,
      patient: patient1User._id,
      performedBy: labStaff._id,
      parameters: [
        { parameterName: 'Total Cholesterol', measuredValue: '185', unit: 'mg/dL', referenceRange: '< 200 mg/dL', flag: 'Normal' },
        { parameterName: 'HDL (Good) Cholesterol', measuredValue: '48', unit: 'mg/dL', referenceRange: '> 40 mg/dL', flag: 'Normal' },
        { parameterName: 'LDL (Bad) Cholesterol', measuredValue: '112', unit: 'mg/dL', referenceRange: '< 100 mg/dL', flag: 'High' },
        { parameterName: 'Triglycerides', measuredValue: '125', unit: 'mg/dL', referenceRange: '< 150 mg/dL', flag: 'Normal' }
      ],
      remarks: 'Moderate elevation in LDL fraction. Dietary lifestyle modification indicated.',
      publishedAt: new Date()
    });

    // In-Progress Lab Request
    await LabRequest.create({
      patient: patient1User._id,
      doctor: doctor1User._id,
      labTest: cbcTest._id,
      requestedBy: doctor1User._id,
      assignedStaff: labStaff._id,
      priority: 'Urgent',
      status: 'Processing',
      clinicalNotes: 'Check for possible mild anemia.',
      statusHistory: [
        { status: 'Requested', updatedBy: doctor1User._id },
        { status: 'Accepted', updatedBy: labStaff._id },
        { status: 'Sample Collected', updatedBy: labStaff._id },
        { status: 'Processing', updatedBy: labStaff._id }
      ]
    });

    // 10. Audit Logs
    await AuditLog.create({
      action: 'SYSTEM_INITIALIZATION',
      performedBy: admin._id,
      role: 'admin',
      targetEntity: 'System',
      details: { message: 'Hospital database initialized with production seeds' }
    });

    console.log('========================================================');
    console.log('  HOSPITAL MANAGEMENT SYSTEM - DATABASE SEEDED SUCCESS  ');
    console.log('========================================================');
    console.log('Demo Credentials for All 4 User Roles:');
    console.log('--------------------------------------------------------');
    console.log('1. Admin:    admin@hospital.com    / Admin@123');
    console.log('2. Doctor:   doctor@hospital.com   / Doctor@123');
    console.log('3. Lab:      lab@hospital.com      / Lab@123');
    console.log('4. Patient:  patient@hospital.com  / Patient@123');
    console.log('--------------------------------------------------------');

    process.exit(0);
  } catch (err) {
    console.error('[Seed Error]', err);
    process.exit(1);
  }
};

seedData();
