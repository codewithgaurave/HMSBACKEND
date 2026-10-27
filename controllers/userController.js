const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const PatientProfile = require('../models/PatientProfile');
const AuditLog = require('../models/AuditLog');

// @desc    Get all users with search, role filter & pagination
// @route   GET /api/users
// @access  Private/Admin
exports.getUsers = async (req, res, next) => {
  try {
    const { search, role, status, page = 1, limit = 10 } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const totalUsers = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total: totalUsers,
      page: Number(page),
      totalPages: Math.ceil(totalUsers / Number(limit)),
      users
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single user by ID
// @route   GET /api/users/:id
// @access  Private (Admin or Self)
exports.getUserById = async (req, res, next) => {
  try {
    // Only admin or the user themselves can view their full user record
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to user profile.' });
    }

    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let profile = null;
    if (user.role === 'doctor') {
      profile = await DoctorProfile.findOne({ user: user._id });
    } else if (user.role === 'patient') {
      profile = await PatientProfile.findOne({ user: user._id });
    }

    res.status(200).json({
      success: true,
      user,
      profile
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin creates new user (Doctor, Lab staff, Admin, Patient)
// @route   POST /api/users
// @access  Private/Admin
exports.createUser = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role,
      phone,
      specialization,
      qualifications,
      experienceYears,
      consultationFee,
      department,
      roomNumber,
      gender,
      bloodGroup,
      dateOfBirth,
      address,
      emergencyContact,
      emergencyName,
      emergencyPhone,
      emergencyRel
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and role are required fields.'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    if (phone && !/^[6-9]\d{9}$/.test(String(phone).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
      });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role,
      phone: phone ? String(phone).trim() : '',
      status: 'active'
    });

    // Automatically create profile corresponding to role
    if (role === 'doctor') {
      await DoctorProfile.create({
        user: user._id,
        specialization: specialization || 'General Medicine',
        qualifications: qualifications || 'MBBS',
        experienceYears: experienceYears || 1,
        consultationFee: consultationFee || 500,
        department: department || 'General OPD',
        roomNumber: roomNumber || 'OPD-101'
      });
    } else if (role === 'patient') {
      const emContact = emergencyContact || {
        name: emergencyName || '',
        relationship: emergencyRel || '',
        phone: emergencyPhone || ''
      };
      await PatientProfile.create({
        user: user._id,
        gender: gender || 'Not Specified',
        bloodGroup: bloodGroup || 'Unknown',
        dateOfBirth: dateOfBirth || null,
        address: address || '',
        emergencyContact: emContact
      });
    }

    await AuditLog.create({
      action: 'ADMIN_CREATED_USER',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: { role: user.role, email: user.email }
    });

    res.status(201).json({
      success: true,
      message: `User with role '${role}' created successfully.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user details & status
// @route   PUT /api/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res, next) => {
  try {
    const { name, phone, status, role, password } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Prevent admin from deactivating or demoting themselves
    if (req.user.id === user._id.toString()) {
      if (status && status !== 'active') {
        return res.status(400).json({
          success: false,
          message: 'You cannot deactivate your own administrative account.'
        });
      }
      if (role && role !== 'admin') {
        return res.status(400).json({
          success: false,
          message: 'You cannot change your own administrator role.'
        });
      }
    }

    if (phone !== undefined && phone !== '') {
      if (!/^[6-9]\d{9}$/.test(String(phone).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
        });
      }
      user.phone = String(phone).trim();
    } else if (phone === '') {
      user.phone = '';
    }

    if (name) user.name = name;
    if (status) user.status = status;
    if (role) user.role = role;
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
      }
      user.password = password;
    }

    await user.save();

    await AuditLog.create({
      action: 'USER_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: { updatedFields: { name, phone, status, role, passwordChanged: !!password } }
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin resets user password directly
// @route   PATCH /api/users/:id/reset-password
// @access  Private/Admin
exports.adminResetPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.'
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.password = newPassword;
    await user.save();

    await AuditLog.create({
      action: 'ADMIN_RESET_PASSWORD',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: { email: user.email, name: user.name, role: user.role }
    });

    res.status(200).json({
      success: true,
      message: `Password for ${user.name} (${user.role}) has been reset successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle user status (active/inactive)
// @route   PATCH /api/users/:id/toggle-status
// @access  Private/Admin
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (req.user.id === user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot toggle status on your own administrator account.'
      });
    }

    user.status = user.status === 'active' ? 'inactive' : 'active';
    await user.save();

    res.status(200).json({
      success: true,
      message: `User status changed to ${user.status}.`,
      status: user.status
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload user profile avatar
// @route   POST /api/users/avatar
// @access  Private
exports.uploadUserAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Delete previous avatar file from disk if it was an uploaded file
    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldFilename = path.basename(user.avatar);
      const oldFilePath = path.join(__dirname, '../uploads/avatars', oldFilename);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.warn('Failed to delete old avatar file:', unlinkErr.message);
        }
      }
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    user.avatar = avatarUrl;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Avatar image uploaded successfully.',
      avatar: avatarUrl
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove user profile avatar
// @route   DELETE /api/users/avatar
// @access  Private
exports.removeUserAvatar = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldFilename = path.basename(user.avatar);
      const oldFilePath = path.join(__dirname, '../uploads/avatars', oldFilename);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.warn('Failed to delete old avatar file:', unlinkErr.message);
        }
      }
    }

    user.avatar = '';
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile photo removed successfully.',
      avatar: ''
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user and associated profile
// @route   DELETE /api/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user._id.toString() === req.user.id.toString()) {
      return res.status(400).json({ success: false, message: 'Admin cannot delete their own account.' });
    }

    // Delete corresponding profile
    if (user.role === 'patient') {
      await PatientProfile.deleteMany({ user: user._id });
    } else if (user.role === 'doctor') {
      await DoctorProfile.deleteMany({ user: user._id });
    }

    await User.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'ADMIN_DELETED_USER',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: { role: user.role, email: user.email, name: user.name }
    });

    res.status(200).json({
      success: true,
      message: `${user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User'} deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update current authenticated user's profile (name, email, phone, avatar)
// @route   PUT /api/users/profile
// @access  Private (All authenticated users)
exports.updateUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const { name, email, phone, avatar } = req.body;
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

    if (name) user.name = name.trim();
    if (phone !== undefined && phone !== '') {
      if (!/^[6-9]\d{9}$/.test(String(phone).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
        });
      }
      user.phone = String(phone).trim();
    } else if (phone === '') {
      user.phone = '';
    }

    // Avatar update & file removal
    if (avatar !== undefined) {
      if (user.avatar && user.avatar !== avatar && user.avatar.startsWith('/uploads/avatars/')) {
        const oldFilePath = path.join(__dirname, '..', user.avatar.replace(/^\//, ''));
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
          } catch (unlinkErr) {
            console.warn('Failed to delete old avatar file:', unlinkErr.message);
          }
        }
      }
      user.avatar = avatar;
    }

    await user.save();

    await AuditLog.create({
      action: 'USER_PROFILE_UPDATED',
      performedBy: user._id.toString(),
      role: user.role,
      targetEntity: 'User',
      targetId: user._id.toString(),
      details: {
        emailChanged,
        name: user.name,
        email: user.email,
        phone: user.phone,
        hasAvatar: !!user.avatar
      }
    });

    res.status(200).json({
      success: true,
      message: emailChanged
        ? 'Email address changed. Please log in again with your new credentials.'
        : 'Profile details updated successfully.',
      emailChanged,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

