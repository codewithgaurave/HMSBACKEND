const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const PatientProfile = require('../models/PatientProfile');
const DoctorProfile = require('../models/DoctorProfile');
const Appointment = require('../models/Appointment');
const Prescription = require('../models/Prescription');
const MedicalRecord = require('../models/MedicalRecord');
const LabRequest = require('../models/LabRequest');
const AuditLog = require('../models/AuditLog');

// @desc    Get all patients with search & pagination (Admin, Doctor)
// @route   GET /api/patients
// @access  Private (Admin, Doctor)
exports.getAllPatients = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    const userQuery = { role: 'patient' };
    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(userQuery);
    const patients = await User.find(userQuery)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Attach patient profile info
    const patientIds = patients.map(p => p._id);
    const profiles = await PatientProfile.find({ user: { $in: patientIds } });

    const patientMap = profiles.reduce((acc, prof) => {
      acc[prof.user.toString()] = prof;
      return acc;
    }, {});

    const enrichedPatients = patients.map(p => ({
      user: p,
      profile: patientMap[p._id.toString()] || null
    }));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      patients: enrichedPatients
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single patient details by User ID
// @route   GET /api/patients/:id
// @access  Private (Admin, Doctor, or Self)
exports.getPatientById = async (req, res, next) => {
  try {
    const patientUserId = req.params.id;

    // Ownership check: Patient can only view their own
    if (req.user.role === 'patient' && req.user.id !== patientUserId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only access your own patient profile.'
      });
    }

    const user = await User.findById(patientUserId).select('-password');
    if (!user || user.role !== 'patient') {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    let profile = await PatientProfile.findOne({ user: user._id });
    if (!profile) {
      // create empty default profile if not yet created
      profile = await PatientProfile.create({ user: user._id });
    }

    res.status(200).json({
      success: true,
      patient: {
        user,
        profile
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update patient profile
// @route   PUT /api/patients/:id
// @access  Private (Patient self or Admin)
// @desc    Update patient profile
// @route   PUT /api/patients/:id
// @access  Private (Patient self or Admin)
exports.updatePatientProfile = async (req, res, next) => {
  try {
    const patientUserId = req.params.id;

    if (req.user.role === 'patient' && req.user.id !== patientUserId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update your own profile.'
      });
    }

    const {
      name,
      email,
      phone,
      avatar,
      dateOfBirth,
      gender,
      bloodGroup,
      address,
      emergencyContact,
      knownAllergies,
      chronicConditions,
      insuranceProvider,
      insurancePolicyNumber
    } = req.body;

    const user = await User.findById(patientUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Patient user not found.' });
    }

    let emailChanged = false;

    // Email update check
    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      }

      const existingUser = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: user._id }
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email address already exists.'
        });
      }

      user.email = email.toLowerCase();
      emailChanged = true;
    }

    // Input validation
    if (gender && !['Male', 'Female', 'Other', 'Not Specified'].includes(gender)) {
      return res.status(400).json({ success: false, message: 'Invalid gender value provided.' });
    }

    if (bloodGroup && !['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].includes(bloodGroup)) {
      return res.status(400).json({ success: false, message: 'Invalid blood group provided.' });
    }

    if (dateOfBirth) {
      const dobDate = new Date(dateOfBirth);
      if (isNaN(dobDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date of birth format.' });
      }
      if (dobDate > new Date()) {
        return res.status(400).json({ success: false, message: 'Date of birth cannot be in the future.' });
      }
    }

    if (phone !== undefined && phone !== '') {
      if (!/^[6-9]\d{9}$/.test(String(phone).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Patient phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
        });
      }
      user.phone = String(phone).trim();
    } else if (phone === '') {
      user.phone = '';
    }

    if (emergencyContact && emergencyContact.phone && !/^[6-9]\d{9}$/.test(String(emergencyContact.phone).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Emergency contact phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
      });
    }

    if (name) user.name = name.trim();
    if (avatar !== undefined && avatar !== user.avatar) {
      if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
        const oldFilename = path.basename(user.avatar);
        const oldFilePath = path.join(__dirname, '../uploads/avatars', oldFilename);
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
          } catch (unlinkErr) {
            console.warn('Patient old avatar unlink error:', unlinkErr.message);
          }
        }
      }
      user.avatar = avatar;
    }
    await user.save();

    let profile = await PatientProfile.findOne({ user: patientUserId });
    if (!profile) {
      profile = new PatientProfile({ user: patientUserId });
    }

    if (dateOfBirth) profile.dateOfBirth = dateOfBirth;
    if (gender) profile.gender = gender;
    if (bloodGroup) profile.bloodGroup = bloodGroup;
    if (address !== undefined) profile.address = address.trim();
    if (emergencyContact) profile.emergencyContact = emergencyContact;
    if (knownAllergies) profile.knownAllergies = Array.isArray(knownAllergies) ? knownAllergies : [];
    if (chronicConditions) profile.chronicConditions = Array.isArray(chronicConditions) ? chronicConditions : [];
    if (insuranceProvider !== undefined) profile.insuranceProvider = insuranceProvider.trim();
    if (insurancePolicyNumber !== undefined) profile.insurancePolicyNumber = insurancePolicyNumber.trim();

    await profile.save();

    // Audit log for Admin visibility
    await AuditLog.create({
      action: 'PATIENT_PROFILE_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'PatientProfile',
      targetId: profile._id.toString(),
      details: {
        patientId: user._id.toString(),
        patientName: user.name,
        patientEmail: user.email,
        updatedFields: Object.keys(req.body).filter(k => k !== 'password')
      }
    });

    res.status(200).json({
      success: true,
      message: emailChanged
        ? 'Email address changed. Please log in again with your new credentials.'
        : 'Patient profile updated successfully.',
      emailChanged,
      patient: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar || '',
          status: user.status,
          role: user.role
        },
        profile
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get complete real-time dashboard data for patient
// @route   GET /api/patients/:id/dashboard
// @access  Private (Patient self, Doctor, or Admin)
exports.getPatientDashboard = async (req, res, next) => {
  try {
    const patientUserId = req.params.id;

    if (req.user.role === 'patient' && req.user.id !== patientUserId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view your own patient dashboard.'
      });
    }

    const patient = await User.findById(patientUserId).select('-password');
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Parallel queries to fetch real live patient data
    const [
      allAppointments,
      allLabRequests,
      allPrescriptions,
      allMedicalRecords,
      patientProfile
    ] = await Promise.all([
      Appointment.find({ patient: patientUserId })
        .populate({
          path: 'doctor',
          select: 'name email phone avatar status'
        })
        .sort({ appointmentDate: -1, 'timeSlot.start': 1 }),
      LabRequest.find({ patient: patientUserId })
        .populate('labTest')
        .populate('doctor', 'name phone')
        .sort({ createdAt: -1 }),
      Prescription.find({ patient: patientUserId })
        .populate('doctor', 'name')
        .sort({ createdAt: -1 }),
      MedicalRecord.find({ patient: patientUserId })
        .populate('doctor', 'name')
        .sort({ recordedDate: -1 }),
      PatientProfile.findOne({ user: patientUserId })
    ]);

    // Real stats
    const totalAppointments = allAppointments.length;
    const completedAppointments = allAppointments.filter((a) => a.status === 'Completed').length;
    const cancelledAppointments = allAppointments.filter((a) =>
      ['Cancelled', 'Rejected'].includes(a.status)
    ).length;

    // Upcoming appointments (date >= today and status in ['Pending', 'Confirmed'])
    const upcomingAppointmentsList = allAppointments
      .filter((a) => {
        const d = new Date(a.appointmentDate);
        return ['Pending', 'Confirmed'].includes(a.status) && d >= todayStart;
      })
      .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));

    const upcomingAppointments = upcomingAppointmentsList.length;
    const nextUpcoming = upcomingAppointmentsList[0] || null;

    // Recent activity: recent appointments
    const recentActivity = allAppointments.slice(0, 6);

    // Assigned/attending doctors details where available
    const doctorIds = [
      ...new Set(
        allAppointments.map((a) => a.doctor?._id?.toString()).filter(Boolean)
      )
    ];

    const doctorProfiles = await DoctorProfile.find({ user: { $in: doctorIds } }).populate({
      path: 'user',
      select: 'name email phone avatar status'
    });

    const doctorProfileMap = {};
    doctorProfiles.forEach((dp) => {
      if (dp.user?._id) {
        doctorProfileMap[dp.user._id.toString()] = dp;
      }
    });

    const assignedDoctors = doctorProfiles
      .filter((dp) => dp.user && dp.user.status === 'active')
      .map((dp) => ({
        doctorId: dp.user._id,
        name: dp.user.name,
        email: dp.user.email,
        phone: dp.user.phone,
        avatar: dp.user.avatar || '',
        specialization: dp.specialization,
        department: dp.department,
        roomNumber: dp.roomNumber,
        consultationFee: dp.consultationFee,
        availableDays: dp.availableDays,
        isAvailable: dp.isAvailable,
        qualifications: dp.qualifications,
        experienceYears: dp.experienceYears
      }));

    // ==================== DYNAMIC CHARTS & ANALYTICS ==================== //
    // 1. Dynamic 6-Month Rolling Timeline
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrends = [];
    const monthlyAttendance = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const label = monthNames[month];

      const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const monthAppts = allAppointments.filter((a) => {
        const ad = new Date(a.appointmentDate);
        return ad >= startOfMonth && ad <= endOfMonth;
      });

      const monthCompleted = monthAppts.filter((a) => a.status === 'Completed').length;
      const monthLabs = allLabRequests.filter((l) => {
        const ld = new Date(l.createdAt);
        return ld >= startOfMonth && ld <= endOfMonth;
      }).length;

      const totalEncounters = monthAppts.length + monthLabs;

      monthlyTrends.push({
        label,
        month: month + 1,
        year,
        encounters: totalEncounters,
        appointments: monthAppts.length,
        completed: monthCompleted,
        labs: monthLabs
      });

      monthlyAttendance.push({
        label,
        val1: monthAppts.length,
        val2: monthCompleted
      });
    }

    // 2. Encounters Trend Badge
    const currentMonthEncounters = monthlyTrends[5]?.encounters || 0;
    const prevMonthEncounters = monthlyTrends[4]?.encounters || 0;
    let badgeText = 'Consistent Care Track';
    let badgePositive = true;

    if (currentMonthEncounters > prevMonthEncounters) {
      const pct = prevMonthEncounters > 0
        ? Math.round(((currentMonthEncounters - prevMonthEncounters) / prevMonthEncounters) * 100)
        : 100;
      badgeText = `+${pct}% High Activity`;
      badgePositive = true;
    } else if (currentMonthEncounters < prevMonthEncounters && prevMonthEncounters > 0) {
      const pct = Math.round(((prevMonthEncounters - currentMonthEncounters) / prevMonthEncounters) * 100);
      badgeText = `-${pct}% Activity`;
      badgePositive = false;
    } else if (currentMonthEncounters > 0) {
      badgeText = `${currentMonthEncounters} Encounters Active`;
      badgePositive = true;
    } else {
      badgeText = 'Care Track Active';
      badgePositive = true;
    }

    // 3. Department & Specialization Consultation Breakdown
    const deptCounts = {};
    allAppointments.forEach((a) => {
      const docId = a.doctor?._id?.toString();
      const dp = docId ? doctorProfileMap[docId] : null;
      const dept = dp?.department || dp?.specialization || 'General OPD';
      if (!deptCounts[dept]) {
        deptCounts[dept] = { scheduled: 0, completed: 0 };
      }
      deptCounts[dept].scheduled += 1;
      if (a.status === 'Completed') {
        deptCounts[dept].completed += 1;
      }
    });

    const departmentBreakdown = Object.keys(deptCounts).map((dept) => ({
      label: dept.length > 10 ? dept.substring(0, 9) + '…' : dept,
      fullName: dept,
      val1: deptCounts[dept].scheduled,
      val2: deptCounts[dept].completed
    }));

    if (departmentBreakdown.length === 0) {
      departmentBreakdown.push(
        { label: 'General', fullName: 'General Medicine', val1: 0, val2: 0 },
        { label: 'Cardio', fullName: 'Cardiology', val1: 0, val2: 0 },
        { label: 'OPD', fullName: 'Outpatient Care', val1: 0, val2: 0 },
        {
          label: 'Lab/Diag',
          fullName: 'Laboratory & Diagnostics',
          val1: allLabRequests.length,
          val2: allLabRequests.filter((l) => ['Completed', 'Published', 'Reviewed'].includes(l.status)).length
        }
      );
    } else if (allLabRequests.length > 0) {
      departmentBreakdown.push({
        label: 'Lab/Diag',
        fullName: 'Laboratory & Diagnostics',
        val1: allLabRequests.length,
        val2: allLabRequests.filter((l) => ['Completed', 'Published', 'Reviewed'].includes(l.status)).length
      });
    }

    // 4. Diagnostic Lab Request Status Breakdown
    const labStatusBreakdown = [
      {
        label: 'Published / Ready',
        value: allLabRequests.filter((l) => ['Completed', 'Published', 'Reviewed'].includes(l.status)).length,
        color: '#10B981'
      },
      {
        label: 'Sample Processing',
        value: allLabRequests.filter((l) => ['Processing', 'Sample Collected', 'Accepted'].includes(l.status)).length,
        color: '#0E9FAD'
      },
      {
        label: 'Pending Request',
        value: allLabRequests.filter((l) => l.status === 'Requested').length,
        color: '#F59E0B'
      },
      {
        label: 'Cancelled',
        value: allLabRequests.filter((l) => ['Cancelled', 'Rejected'].includes(l.status)).length,
        color: '#F43F5E'
      }
    ];

    res.status(200).json({
      success: true,
      patient: {
        id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
        avatar: patient.avatar || '',
        status: patient.status
      },
      profile: patientProfile,
      stats: {
        totalAppointments,
        upcomingAppointments,
        completedAppointments,
        cancelledAppointments,
        totalLabRequests: allLabRequests.length,
        totalPrescriptions: allPrescriptions.length,
        totalMedicalRecords: allMedicalRecords.length
      },
      charts: {
        monthlyTrends,
        monthlyAttendance,
        departmentBreakdown,
        labStatusBreakdown,
        badgeText,
        badgePositive
      },
      nextUpcoming,
      upcomingAppointments: upcomingAppointmentsList,
      recentActivity,
      assignedDoctors,
      recentLabReports: allLabRequests.slice(0, 6),
      recentPrescriptions: allPrescriptions.slice(0, 5)
    });
  } catch (error) {
    next(error);
  }
};


// @desc    Get complete clinical history for patient (Doctor, Admin, or Patient self)
// @route   GET /api/patients/:id/history
// @access  Private
exports.getPatientHistory = async (req, res, next) => {
  try {
    const patientUserId = req.params.id;

    if (req.user.role === 'patient' && req.user.id !== patientUserId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot access clinical history of other patients.'
      });
    }

    const appointments = await Appointment.find({ patient: patientUserId })
      .populate('doctor', 'name email phone')
      .sort({ appointmentDate: -1 });

    const prescriptions = await Prescription.find({ patient: patientUserId })
      .populate('doctor', 'name email')
      .sort({ createdAt: -1 });

    const medicalRecords = await MedicalRecord.find({ patient: patientUserId })
      .populate('doctor', 'name email')
      .sort({ recordedDate: -1 });

    const labRequests = await LabRequest.find({ patient: patientUserId })
      .populate('labTest')
      .populate('doctor', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      history: {
        appointments,
        prescriptions,
        medicalRecords,
        labRequests
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin deletes a patient
// @route   DELETE /api/patients/:id
// @access  Private/Admin
exports.deletePatient = async (req, res, next) => {
  try {
    const patientIdentifier = req.params.id;

    let profile = await PatientProfile.findOne({
      $or: [{ _id: patientIdentifier }, { user: patientIdentifier }]
    });

    let userId = profile ? profile.user : patientIdentifier;
    const user = await User.findById(userId);

    if (!user && !profile) {
      return res.status(404).json({ success: false, message: 'Patient record not found.' });
    }

    if (profile) {
      await PatientProfile.findByIdAndDelete(profile._id);
    }
    if (user) {
      await User.findByIdAndDelete(user._id);
    }

    await AuditLog.create({
      action: 'ADMIN_DELETED_PATIENT',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Patient',
      targetId: String(userId),
      details: { patientName: user?.name, email: user?.email }
    });

    res.status(200).json({
      success: true,
      message: 'Patient and clinical profile record deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

