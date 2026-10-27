const crypto = require('crypto');
const User = require('../models/User');
const PatientProfile = require('../models/PatientProfile');
const DoctorProfile = require('../models/DoctorProfile');
const PasswordResetToken = require('../models/PasswordResetToken');
const AuditLog = require('../models/AuditLog');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');

// @desc    Register a new Patient (public registration)
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, gender, bloodGroup, dateOfBirth, address } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, and password.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Role is strictly 'patient' for public registration
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      phone: phone || '',
      role: 'patient',
      status: 'active'
    });

    // Create linked Patient Profile
    await PatientProfile.create({
      user: user._id,
      gender: gender || 'Not Specified',
      bloodGroup: bloodGroup || 'Unknown',
      dateOfBirth: dateOfBirth || null,
      address: address || ''
    });

    await AuditLog.create({
      action: 'PATIENT_REGISTERED',
      performedBy: user._id,
      role: 'patient',
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: { email: user.email }
    });

    const token = user.generateSignedToken();

    res.status(201).json({
      success: true,
      message: 'Registration successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar || '',
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user & return JWT token
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email && !password) {
      return res.status(400).json({
        success: false,
        field: 'both',
        message: 'Please provide both email and password.'
      });
    }
    if (!email) {
      return res.status(400).json({
        success: false,
        field: 'email',
        message: 'Please enter your email address.'
      });
    }
    if (!password) {
      return res.status(400).json({
        success: false,
        field: 'password',
        message: 'Please enter your password.'
      });
    }

    // Include password field which is select: false by default
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        field: 'email',
        message: 'Email not registered. Please check your email address.'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        field: 'password',
        message: 'Incorrect password. Please enter the correct password.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact hospital administrator.'
      });
    }

    // Update lastLogin
    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    const token = user.generateSignedToken();

    await AuditLog.create({
      action: 'USER_LOGIN',
      performedBy: user._id,
      role: user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      ipAddress: req.ip || '127.0.0.1'
    });

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar || '',
        status: user.status,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user details + linked profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    let profileData = null;

    if (user.role === 'doctor') {
      profileData = await DoctorProfile.findOne({ user: user._id });
    } else if (user.role === 'patient') {
      profileData = await PatientProfile.findOne({ user: user._id });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar || '',
        status: user.status,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      profile: profileData
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Forgot Password - generate expiring token
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide email address.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, a password reset token has been generated.'
      });
    }

    // Generate random reset token
    const rawToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Invalidate existing tokens
    await PasswordResetToken.deleteMany({ user: user._id });

    // Store token (valid for 15 minutes)
    await PasswordResetToken.create({
      user: user._id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    res.status(200).json({
      success: true,
      message: 'Password reset token generated successfully. Valid for 15 minutes.',
      resetToken: rawToken // returned for easy test/demo workflows
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset Password using token
// @route   POST /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await PasswordResetToken.findOne({
      token: hashedToken,
      used: false,
      expiresAt: { $gt: Date.now() }
    });

    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    const user = await User.findById(resetRecord.user);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.password = newPassword;
    await user.save();

    resetRecord.used = true;
    await resetRecord.save();

    await AuditLog.create({
      action: 'PASSWORD_RESET',
      performedBy: user._id,
      role: user.role,
      targetEntity: 'User',
      targetId: user._id.toString()
    });

    res.status(200).json({
      success: true,
      message: 'Password has been successfully reset. You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Password for authenticated user
// @route   PUT /api/auth/update-password
// @access  Private
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide current and new passwords.' });
    }

    const user = await User.findById(req.user.id).select('+password');
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to format relative timestamps
const formatRelativeTime = (dateInput) => {
  if (!dateInput) return 'just now';
  const diffMs = Date.now() - new Date(dateInput).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec || 1}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

// @desc    Get live dynamic notifications based on user role and database state
// @route   GET /api/auth/notifications
// @access  Private
exports.getNotifications = async (req, res, next) => {
  try {
    const role = req.user.role;
    let notifications = [];

    if (role === 'admin') {
      const logs = await AuditLog.find()
        .populate('performedBy', 'name role')
        .sort({ createdAt: -1 })
        .limit(10);

      notifications = logs.map((log) => ({
        id: log._id.toString(),
        title: log.action.replace(/_/g, ' '),
        desc: log.performedBy ? `${log.performedBy.name} (${log.performedBy.role})` : 'System action recorded',
        time: formatRelativeTime(log.createdAt),
        type: log.action.toLowerCase().includes('lab') ? 'lab' : log.action.toLowerCase().includes('appoint') ? 'appointment' : 'system',
        unread: true
      }));
    } else if (role === 'doctor') {
      const [appointments, doctorLabRequests] = await Promise.all([
        Appointment.find({ doctor: req.user.id })
          .populate('patient', 'name')
          .sort({ createdAt: -1 })
          .limit(8),
        LabRequest.find({ doctor: req.user.id })
          .populate('labTest', 'testName')
          .populate('patient', 'name')
          .sort({ updatedAt: -1 })
          .limit(8)
      ]);

      const appNotifs = appointments.map((app) => ({
        id: app._id.toString(),
        title: `Appointment ${app.status}`,
        desc: `Patient: ${app.patient ? app.patient.name : 'Patient'} • ${app.appointmentDate ? new Date(app.appointmentDate).toLocaleDateString() : ''} (${app.timeSlot})`,
        time: formatRelativeTime(app.createdAt),
        type: 'appointment',
        unread: app.status === 'Pending',
        createdAt: app.createdAt
      }));

      const labNotifs = doctorLabRequests.map((lab) => ({
        id: lab._id.toString(),
        title: `Lab Investigation: ${lab.status}`,
        desc: `${lab.labTest ? lab.labTest.testName : 'Test'} for ${lab.patient ? lab.patient.name : 'Patient'}${lab.rejectionReason ? ' - Reason: ' + lab.rejectionReason : ''}`,
        time: formatRelativeTime(lab.updatedAt || lab.createdAt),
        type: 'lab',
        unread: lab.status === 'Published' || lab.status === 'Completed' || lab.status === 'Rejected',
        createdAt: lab.updatedAt || lab.createdAt
      }));

      notifications = [...appNotifs, ...labNotifs]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
    } else if (role === 'patient') {
      const [appointments, labRequests] = await Promise.all([
        Appointment.find({ patient: req.user.id })
          .populate('doctor', 'name')
          .sort({ createdAt: -1 })
          .limit(6),
        LabRequest.find({ patient: req.user.id })
          .populate('labTest', 'testName')
          .sort({ updatedAt: -1 })
          .limit(6)
      ]);

      const appNotifs = appointments.map((app) => ({
        id: app._id.toString(),
        title: `Appointment ${app.status}`,
        desc: `Dr. ${app.doctor ? app.doctor.name : 'Assigned Doctor'} on ${new Date(app.appointmentDate).toLocaleDateString()}`,
        time: formatRelativeTime(app.createdAt),
        type: 'appointment',
        unread: app.status === 'Confirmed',
        createdAt: app.createdAt
      }));

      const labNotifs = labRequests.map((lab) => ({
        id: lab._id.toString(),
        title: `Lab Diagnostic: ${lab.status}`,
        desc: `${lab.labTest ? lab.labTest.testName : 'Lab Test'} status is now ${lab.status}${lab.rejectionReason ? ' (' + lab.rejectionReason + ')' : ''}`,
        time: formatRelativeTime(lab.updatedAt || lab.createdAt),
        type: 'lab',
        unread: lab.status === 'Published' || lab.status === 'Rejected',
        createdAt: lab.updatedAt || lab.createdAt
      }));

      notifications = [...appNotifs, ...labNotifs]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
    } else if (role === 'lab') {
      const requests = await LabRequest.find()
        .populate('labTest', 'testName')
        .populate('patient', 'name')
        .sort({ updatedAt: -1 })
        .limit(10);

      notifications = requests.map((reqItem) => ({
        id: reqItem._id.toString(),
        title: `Lab Request: ${reqItem.status}`,
        desc: `${reqItem.labTest ? reqItem.labTest.testName : 'Investigation'} for ${reqItem.patient ? reqItem.patient.name : 'Patient'}`,
        time: formatRelativeTime(reqItem.updatedAt || reqItem.createdAt),
        type: 'lab',
        unread: reqItem.status === 'Requested' || reqItem.status === 'Sample Collected' || reqItem.status === 'Completed'
      }));
    }

    res.status(200).json({
      success: true,
      notifications
    });
  } catch (error) {
    next(error);
  }
};
