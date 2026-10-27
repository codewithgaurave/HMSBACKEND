const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const Appointment = require('../models/Appointment');
const PatientProfile = require('../models/PatientProfile');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const LabRequest = require('../models/LabRequest');
const AuditLog = require('../models/AuditLog');

// Time slot helpers
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;

  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatMinutesTo12Hour(totalMinutes) {
  let hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const paddedHours = hours.toString().padStart(2, '0');
  const paddedMinutes = minutes.toString().padStart(2, '0');
  return `${paddedHours}:${paddedMinutes} ${ampm}`;
}

// @desc    Get all doctors with profile details, advanced filtering & pagination
// @route   GET /api/doctors
// @access  Public / Protected
exports.getAllDoctors = async (req, res, next) => {
  try {
    const {
      specialization,
      department,
      search,
      isAvailable,
      minExperience,
      maxFee,
      sortBy,
      page,
      limit
    } = req.query;

    let profileQuery = {};

    if (specialization && specialization !== 'All') {
      profileQuery.specialization = { $regex: specialization, $options: 'i' };
    }

    if (department && department !== 'All') {
      profileQuery.department = { $regex: department, $options: 'i' };
    }

    if (isAvailable !== undefined && isAvailable !== '') {
      profileQuery.isAvailable = isAvailable === 'true';
    }

    if (minExperience) {
      profileQuery.experienceYears = { $gte: Number(minExperience) };
    }

    if (maxFee) {
      profileQuery.consultationFee = { ...(profileQuery.consultationFee || {}), $lte: Number(maxFee) };
    }

    const doctorProfiles = await DoctorProfile.find(profileQuery).populate({
      path: 'user',
      select: 'name email phone avatar status'
    });

    // Filter active doctors and never expose private/privileged fields
    let doctors = doctorProfiles.filter(dp => dp.user && dp.user.status === 'active');

    // Search by doctor name, specialization, or department
    if (search) {
      const term = search.toLowerCase();
      doctors = doctors.filter(
        dp =>
          dp.user?.name?.toLowerCase().includes(term) ||
          dp.specialization?.toLowerCase().includes(term) ||
          dp.department?.toLowerCase().includes(term)
      );
    }

    // Sorting
    if (sortBy === 'experience') {
      doctors.sort((a, b) => b.experienceYears - a.experienceYears);
    } else if (sortBy === 'fee_asc') {
      doctors.sort((a, b) => a.consultationFee - b.consultationFee);
    } else if (sortBy === 'fee_desc') {
      doctors.sort((a, b) => b.consultationFee - a.consultationFee);
    } else if (sortBy === 'name') {
      doctors.sort((a, b) => (a.user?.name || '').localeCompare(b.user?.name || ''));
    }

    const total = doctors.length;

    // Apply pagination if page or limit is specified
    if (page || limit) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit) || 9;
      const skip = (pageNum - 1) * limitNum;
      const paginatedDoctors = doctors.slice(skip, skip + limitNum);

      return res.status(200).json({
        success: true,
        count: paginatedDoctors.length,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        doctors: paginatedDoctors
      });
    }

    res.status(200).json({
      success: true,
      count: doctors.length,
      total: doctors.length,
      page: 1,
      totalPages: 1,
      doctors
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get doctor by user ID or profile ID
// @route   GET /api/doctors/:id
// @access  Public / Protected
exports.getDoctorById = async (req, res, next) => {
  try {
    let profile = await DoctorProfile.findOne({
      $or: [{ _id: req.params.id }, { user: req.params.id }]
    }).populate('user', 'name email phone avatar status');

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    res.status(200).json({
      success: true,
      doctor: profile
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update doctor profile (Doctor self or Admin)
// @route   PUT /api/doctors/:id
// @access  Private (Doctor, Admin)
exports.updateDoctorProfile = async (req, res, next) => {
  try {
    const doctorIdentifier = req.params.id;

    // Resolve profile
    let profile = await DoctorProfile.findOne({
      $or: [{ _id: doctorIdentifier }, { user: doctorIdentifier }]
    });

    if (!profile) {
      // Check if identifier is user id
      const userDoc = await User.findById(doctorIdentifier);
      if (userDoc && userDoc.role === 'doctor') {
        profile = await DoctorProfile.create({ user: userDoc._id });
      } else {
        return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
      }
    }

    // Ownership check: doctor can only update their own profile unless admin
    if (req.user.role === 'doctor' && req.user.id !== profile.user.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update your own doctor profile.'
      });
    }

    const user = await User.findById(profile.user);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Doctor user not found.' });
    }

    const {
      name,
      email,
      phone,
      avatar,
      specialization,
      qualifications,
      experienceYears,
      consultationFee,
      department,
      roomNumber,
      availableDays,
      workingHours,
      slotDuration,
      breakTimes,
      unavailableDates,
      bio,
      isActive
    } = req.body;

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

    // Update user fields
    if (name) user.name = name.trim();
    if (phone !== undefined && phone !== '') {
      if (!/^[6-9]\d{9}$/.test(String(phone).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Doctor phone number must be exactly 10 digits and start with 6, 7, 8, or 9.'
        });
      }
      user.phone = String(phone).trim();
    } else if (phone === '') {
      user.phone = '';
    }
    if (avatar !== undefined) {
      if (user.avatar && user.avatar !== avatar && user.avatar.startsWith('/uploads/avatars/')) {
        const oldFilePath = path.join(__dirname, '..', user.avatar.replace(/^\//, ''));
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
          } catch (e) {
            console.error('Failed to unlink old doctor avatar:', e);
          }
        }
      }
      user.avatar = avatar;
    }
    await user.save();

    // Update profile fields
    if (specialization !== undefined) profile.specialization = specialization;
    if (qualifications !== undefined) profile.qualifications = qualifications;
    if (experienceYears !== undefined) profile.experienceYears = Number(experienceYears) || 0;
    if (consultationFee !== undefined) profile.consultationFee = Number(consultationFee) || 0;
    if (department !== undefined) profile.department = department;
    if (roomNumber !== undefined) profile.roomNumber = roomNumber;
    if (availableDays !== undefined) profile.availableDays = availableDays;
    if (workingHours !== undefined) profile.workingHours = workingHours;
    if (slotDuration !== undefined) profile.slotDuration = Number(slotDuration) || 30;
    if (breakTimes !== undefined) profile.breakTimes = breakTimes;
    if (unavailableDates !== undefined) profile.unavailableDates = unavailableDates;
    if (bio !== undefined) profile.bio = bio;
    if (isActive !== undefined) profile.isActive = Boolean(isActive);

    await profile.save();

    // System Audit Log for Admin visibility
    await AuditLog.create({
      action: 'DOCTOR_PROFILE_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'DoctorProfile',
      targetId: profile._id.toString(),
      details: {
        doctorId: user._id.toString(),
        doctorName: user.name,
        doctorEmail: user.email,
        updatedFields: Object.keys(req.body).filter(k => k !== 'password')
      }
    });

    const populatedProfile = await DoctorProfile.findById(profile._id).populate('user', 'name email phone avatar status');

    res.status(200).json({
      success: true,
      message: emailChanged
        ? 'Email address changed. Please log in again with your new credentials.'
        : 'Doctor profile updated successfully.',
      emailChanged,
      doctor: populatedProfile
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get real-time available appointment slots for a doctor on a specific date
// @route   GET /api/doctors/:id/available-slots
// @access  Public / Protected
exports.getDoctorAvailableSlots = async (req, res, next) => {
  try {
    const doctorIdentifier = req.params.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid date parameter (YYYY-MM-DD).'
      });
    }

    let profile = await DoctorProfile.findOne({
      $or: [{ _id: doctorIdentifier }, { user: doctorIdentifier }]
    }).populate('user', 'name email phone avatar status');

    if (!profile || !profile.user || profile.user.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Active doctor not found.'
      });
    }

    if (!profile.isAvailable) {
      return res.status(200).json({
        success: true,
        isDoctorAccepting: false,
        message: `Dr. ${profile.user.name} is currently not accepting new appointments.`,
        totalSlots: 0,
        availableSlotsCount: 0,
        morningSlots: [],
        afternoonSlots: [],
        slots: []
      });
    }

    // Check if appointment date is valid and not in the past
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (targetDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot view or book appointments for past dates.'
      });
    }

    // Check if doctor has explicitly blocked this date (leave / vacation / off)
    const targetDateStr = date.split('T')[0];
    if (profile.unavailableDates && profile.unavailableDates.length > 0) {
      const isUnavailable = profile.unavailableDates.some(d => {
        const dStr = typeof d === 'string' ? d.split('T')[0] : new Date(d).toISOString().split('T')[0];
        return dStr === targetDateStr;
      });

      if (isUnavailable) {
        return res.status(200).json({
          success: true,
          isDoctorAccepting: false,
          isAvailableDay: false,
          message: `Dr. ${profile.user.name} is on scheduled leave/unavailable on ${targetDateStr}.`,
          totalSlots: 0,
          availableSlotsCount: 0,
          morningSlots: [],
          afternoonSlots: [],
          slots: []
        });
      }
    }

    // Check day-of-week doctor availability
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[targetDate.getDay()];

    const isAvailableDay = profile.availableDays?.includes(dayOfWeek) ?? true;
    if (!isAvailableDay) {
      return res.status(200).json({
        success: true,
        isAvailableDay: false,
        dayOfWeek,
        availableDays: profile.availableDays,
        message: `Dr. ${profile.user.name} does not have clinic hours scheduled on ${dayOfWeek}s. Scheduled days: ${profile.availableDays.join(', ')}`,
        totalSlots: 0,
        availableSlotsCount: 0,
        morningSlots: [],
        afternoonSlots: [],
        slots: []
      });
    }

    // Working hours (defaults 09:00 to 17:00)
    const workStartStr = profile.workingHours?.start || '09:00';
    const workEndStr = profile.workingHours?.end || '17:00';

    const startMinutes = parseTimeToMinutes(workStartStr);
    const endMinutes = parseTimeToMinutes(workEndStr);
    const slotDuration = profile.slotDuration || 30; // 15, 20, 30, 45, or 60 min slots

    // Break time checking
    const breakEnabled = profile.breakTimes?.enabled !== false;
    const breakStartMinutes = breakEnabled ? parseTimeToMinutes(profile.breakTimes?.start || '13:00') : -1;
    const breakEndMinutes = breakEnabled ? parseTimeToMinutes(profile.breakTimes?.end || '14:00') : -1;

    // Fetch existing appointments on that date to check conflicts
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const bookedAppointments = await Appointment.find({
      doctor: profile.user._id,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      status: { $nin: ['Cancelled', 'Rejected'] }
    }).select('timeSlot');

    // Create a Set of booked start times in uppercase
    const bookedSlotStarts = new Set(
      bookedAppointments.map(a => a.timeSlot?.start?.trim().toUpperCase()).filter(Boolean)
    );

    // Current time comparison for today's bookings
    const isToday = targetDate.getTime() === today.getTime();
    const currentTotalMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    // Generate slots
    const allSlots = [];
    for (let current = startMinutes; current + slotDuration <= endMinutes; current += slotDuration) {
      // Skip if slot overlaps configured break time
      if (breakEnabled && current < breakEndMinutes && current + slotDuration > breakStartMinutes) {
        continue;
      }

      const slotStart = formatMinutesTo12Hour(current);
      const slotEnd = formatMinutesTo12Hour(current + slotDuration);
      const period = current < 720 ? 'morning' : 'afternoon';

      const isBooked = bookedSlotStarts.has(slotStart.toUpperCase());
      const isPast = isToday && current <= currentTotalMinutes;
      const isAvailable = !isBooked && !isPast;

      allSlots.push({
        start: slotStart,
        end: slotEnd,
        period,
        isBooked,
        isPast,
        isAvailable
      });
    }

    const morningSlots = allSlots.filter(s => s.period === 'morning');
    const afternoonSlots = allSlots.filter(s => s.period === 'afternoon');
    const availableSlotsCount = allSlots.filter(s => s.isAvailable).length;

    res.status(200).json({
      success: true,
      doctorId: profile.user._id,
      doctorName: profile.user.name,
      specialization: profile.specialization,
      date,
      dayOfWeek,
      isAvailableDay: true,
      workingHours: profile.workingHours,
      slotDuration,
      breakTimes: profile.breakTimes,
      totalSlots: allSlots.length,
      availableSlotsCount,
      morningSlots,
      afternoonSlots,
      slots: allSlots
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update doctor profile & operational availability
// @route   PUT /api/doctors/:id
// @access  Private (Doctor or Admin)
exports.updateDoctorProfile = async (req, res, next) => {
  try {
    let profile = await DoctorProfile.findOne({
      $or: [{ _id: req.params.id }, { user: req.params.id }]
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    // Role check: Admin can update any, Doctor can only update own
    if (req.user.role === 'doctor' && profile.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update another doctor profile.'
      });
    }

    const {
      specialization,
      qualifications,
      experienceYears,
      consultationFee,
      department,
      roomNumber,
      availableDays,
      workingHours,
      slotDuration,
      breakTimes,
      unavailableDates,
      maxAppointmentsPerDay,
      bio,
      isAvailable,
      name,
      phone,
      avatar
    } = req.body;

    // Update User name, phone & avatar if provided
    if (name || phone !== undefined || avatar !== undefined) {
      const user = await User.findById(profile.user);
      if (user) {
        if (name) user.name = name;
        if (phone !== undefined) user.phone = phone;
        if (avatar !== undefined) {
          if (user.avatar && user.avatar !== avatar && user.avatar.startsWith('/uploads/avatars/')) {
            const oldFilePath = path.join(__dirname, '..', user.avatar.replace(/^\//, ''));
            if (fs.existsSync(oldFilePath)) {
              try {
                fs.unlinkSync(oldFilePath);
              } catch (e) {
                console.error('Failed to unlink old doctor avatar:', e);
              }
            }
          }
          user.avatar = avatar;
        }
        await user.save();
      }
    }

    // Validate working hours
    if (workingHours) {
      const s = parseTimeToMinutes(workingHours.start);
      const e = parseTimeToMinutes(workingHours.end);
      if (s >= e) {
        return res.status(400).json({
          success: false,
          message: 'Shift start time must be earlier than shift end time.'
        });
      }
      profile.workingHours = workingHours;
    }

    // Validate slot duration
    if (slotDuration !== undefined) {
      const durationNum = Number(slotDuration);
      if (![15, 20, 30, 45, 60].includes(durationNum)) {
        return res.status(400).json({
          success: false,
          message: 'Slot duration must be 15, 20, 30, 45, or 60 minutes.'
        });
      }
      profile.slotDuration = durationNum;
    }

    // Validate break times
    if (breakTimes !== undefined) {
      if (breakTimes.enabled) {
        const bs = parseTimeToMinutes(breakTimes.start);
        const be = parseTimeToMinutes(breakTimes.end);
        if (bs >= be) {
          return res.status(400).json({
            success: false,
            message: 'Break start time must be before break end time.'
          });
        }
      }
      profile.breakTimes = breakTimes;
    }

    // Unavailable dates (array of YYYY-MM-DD strings)
    if (unavailableDates !== undefined) {
      profile.unavailableDates = Array.isArray(unavailableDates) ? unavailableDates : [];
    }

    if (specialization) profile.specialization = specialization;
    if (qualifications) profile.qualifications = qualifications;
    if (experienceYears !== undefined) profile.experienceYears = experienceYears;
    if (consultationFee !== undefined) profile.consultationFee = consultationFee;
    if (department) profile.department = department;
    if (roomNumber) profile.roomNumber = roomNumber;
    if (availableDays) profile.availableDays = availableDays;
    if (maxAppointmentsPerDay !== undefined) profile.maxAppointmentsPerDay = maxAppointmentsPerDay;
    if (bio !== undefined) profile.bio = bio;
    if (isAvailable !== undefined) profile.isAvailable = isAvailable;

    await profile.save();

    const updatedProfile = await DoctorProfile.findById(profile._id).populate('user', 'name email phone avatar status');

    res.status(200).json({
      success: true,
      message: 'Doctor profile and availability updated successfully.',
      doctor: updatedProfile
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get real-time live metrics and recent activity for authenticated doctor's dashboard
// @route   GET /api/doctors/dashboard
// @access  Private (Doctor or Admin)
exports.getDoctorDashboard = async (req, res, next) => {
  try {
    let doctorId = req.user.id;
    if (req.user.role === 'admin' && req.query.doctorId) {
      doctorId = req.query.doctorId;
    }

    const doctorProfile = await DoctorProfile.findOne({ user: doctorId })
      .populate('user', 'name email phone avatar status');

    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Run parallel aggregation & queries
    const [
      todayAppointmentsList,
      upcomingCount,
      completedCount,
      cancelledCount,
      assignedPatientIds,
      recentActivityAppointments,
      prescriptionsCount,
      labOrdersCount,
      medicalRecordsCount
    ] = await Promise.all([
      Appointment.find({
        doctor: doctorId,
        appointmentDate: { $gte: todayStart, $lte: todayEnd }
      })
        .populate('patient', 'name email phone avatar')
        .sort({ 'timeSlot.start': 1 }),

      Appointment.countDocuments({
        doctor: doctorId,
        appointmentDate: { $gt: todayEnd },
        status: { $nin: ['Cancelled', 'Rejected'] }
      }),

      Appointment.countDocuments({
        doctor: doctorId,
        status: 'Completed'
      }),

      Appointment.countDocuments({
        doctor: doctorId,
        status: 'Cancelled'
      }),

      Appointment.distinct('patient', { doctor: doctorId }),

      Appointment.find({ doctor: doctorId })
        .populate('patient', 'name email phone avatar')
        .sort({ updatedAt: -1, appointmentDate: -1 })
        .limit(8),

      Prescription.countDocuments({ doctor: doctorId }),

      LabRequest.countDocuments({
        $or: [{ doctor: doctorId }, { requestedBy: doctorId }]
      }),

      MedicalRecord.countDocuments({ doctor: doctorId })
    ]);

    // ==================== 1. DAILY 7-DAY CONSULTATION TREND ==================== //
    const now = new Date();
    const daysTrend = [];
    let weekTotal = 0;
    let prevWeekTotal = 0;

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const startOfDay = new Date(d.setHours(0, 0, 0, 0));
      const endOfDay = new Date(d.setHours(23, 59, 59, 999));
      const dayName = startOfDay.toLocaleDateString('en-US', { weekday: 'short' });

      const [apptCount, compCount] = await Promise.all([
        Appointment.countDocuments({
          doctor: doctorId,
          $or: [
            { appointmentDate: { $gte: startOfDay, $lte: endOfDay } },
            { createdAt: { $gte: startOfDay, $lte: endOfDay } }
          ]
        }),
        Appointment.countDocuments({
          doctor: doctorId,
          status: 'Completed',
          updatedAt: { $gte: startOfDay, $lte: endOfDay }
        })
      ]);

      weekTotal += apptCount;

      daysTrend.push({
        day: dayName,
        date: startOfDay.toISOString().split('T')[0],
        appointments: apptCount,
        completed: compCount
      });
    }

    // Previous 7-day window for trend badge calculation
    const prevWeekStart = new Date();
    prevWeekStart.setDate(now.getDate() - 13);
    prevWeekStart.setHours(0, 0, 0, 0);
    const prevWeekEnd = new Date();
    prevWeekEnd.setDate(now.getDate() - 7);
    prevWeekEnd.setHours(23, 59, 59, 999);

    prevWeekTotal = await Appointment.countDocuments({
      doctor: doctorId,
      createdAt: { $gte: prevWeekStart, $lte: prevWeekEnd }
    });

    let badgeText = `Today OPD: ${todayAppointmentsList.length}`;
    let badgePositive = todayAppointmentsList.length > 0;
    if (weekTotal > prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100);
      badgeText = `+${pct}% High Activity`;
      badgePositive = true;
    } else if (weekTotal < prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((prevWeekTotal - weekTotal) / prevWeekTotal) * 100);
      badgeText = `-${pct}% Patient Flow`;
      badgePositive = false;
    }

    // ==================== 2. MONTHLY 6-MONTH ROLLING TIMELINE & ATTENDANCE ==================== //
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyIntake = [];
    const monthlyCompletionBars = [];

    for (let m = 5; m >= 0; m--) {
      const mDate = new Date();
      mDate.setMonth(now.getMonth() - m);
      const mStart = new Date(mDate.getFullYear(), mDate.getMonth(), 1);
      const mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0, 23, 59, 59, 999);
      const mLabel = monthNames[mStart.getMonth()];

      const [mTotal, mCompleted] = await Promise.all([
        Appointment.countDocuments({
          doctor: doctorId,
          $or: [
            { appointmentDate: { $gte: mStart, $lte: mEnd } },
            { createdAt: { $gte: mStart, $lte: mEnd } }
          ]
        }),
        Appointment.countDocuments({
          doctor: doctorId,
          status: 'Completed',
          $or: [
            { appointmentDate: { $gte: mStart, $lte: mEnd } },
            { updatedAt: { $gte: mStart, $lte: mEnd } }
          ]
        })
      ]);

      monthlyIntake.push({
        month: mLabel,
        total: mTotal,
        completed: mCompleted
      });

      monthlyCompletionBars.push({
        label: mLabel,
        val1: mTotal,
        val2: mCompleted
      });
    }

    // ==================== 3. TOP CHIEF COMPLAINTS AGGREGATION ==================== //
    let doctorObjectId;
    try {
      doctorObjectId = new mongoose.Types.ObjectId(doctorId);
    } catch {
      doctorObjectId = doctorId;
    }

    const complaintsAgg = await Appointment.aggregate([
      { $match: { doctor: doctorObjectId } },
      { $group: { _id: '$reasonForVisit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 4 }
    ]);

    const complaintColors = ['#10B981', '#0E9FAD', '#F59E0B', '#6366F1', '#EC4899'];
    const complaintsBreakdown = complaintsAgg
      .filter(item => item._id)
      .map((item, idx) => ({
        label: item._id.length > 20 ? item._id.substring(0, 18) + '...' : item._id,
        value: item.count,
        color: complaintColors[idx % complaintColors.length]
      }));

    // Determine next immediate upcoming appointment
    const nextUpcoming = await Appointment.findOne({
      doctor: doctorId,
      appointmentDate: { $gte: todayStart },
      status: { $in: ['Confirmed', 'Pending', 'In Progress'] }
    })
      .populate('patient', 'name email phone avatar')
      .sort({ appointmentDate: 1, 'timeSlot.start': 1 });

    res.status(200).json({
      success: true,
      metrics: {
        todayCount: todayAppointmentsList.length,
        upcomingCount,
        completedCount,
        cancelledCount,
        totalAssignedPatients: assignedPatientIds.length,
        prescriptionsCount,
        labOrdersCount,
        medicalRecordsCount
      },
      charts: {
        weeklyTrend: {
          labels: daysTrend.map(d => d.day),
          data: daysTrend.map(d => d.appointments),
          completedData: daysTrend.map(d => d.completed),
          badgeText,
          badgePositive
        },
        monthlyTrend: {
          labels: monthlyIntake.map(m => m.month),
          data: monthlyIntake.map(m => m.total),
          completedData: monthlyIntake.map(m => m.completed)
        },
        monthlyCompletionBars,
        clinicalOrdersDistribution: [
          { label: 'Prescriptions', value: prescriptionsCount, color: '#0E9FAD' },
          { label: 'Diagnostic Orders', value: labOrdersCount, color: '#8B5CF6' },
          { label: 'Clinical Records', value: medicalRecordsCount, color: '#3B82F6' },
          { label: 'Completed Visits', value: completedCount, color: '#10B981' }
        ],
        complaintsDistribution: complaintsBreakdown.length > 0 ? complaintsBreakdown : [
          { label: 'Routine OPD Consultation', value: completedCount || 1, color: '#10B981' }
        ]
      },
      nextUpcoming,
      todayAppointments: todayAppointmentsList,
      recentActivity: recentActivityAppointments,
      profile: doctorProfile
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get authorized patient directory for this doctor (only patients who have booked appointments)
// @route   GET /api/doctors/patients
// @access  Private (Doctor)
exports.getDoctorPatients = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { search, page = 1, limit = 10 } = req.query;

    // Get all distinct patient IDs that have appointments with this doctor
    const patientIds = await Appointment.distinct('patient', { doctor: doctorId });

    if (patientIds.length === 0) {
      return res.status(200).json({
        success: true,
        patients: [],
        total: 0,
        page: Number(page),
        totalPages: 0
      });
    }

    // Build user query
    let userQuery = { _id: { $in: patientIds }, role: 'patient' };
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      userQuery.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const total = await User.countDocuments(userQuery);
    const skip = (Number(page) - 1) * Number(limit);

    const patients = await User.find(userQuery)
      .select('name email phone avatar status createdAt')
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // For each patient, fetch their PatientProfile and appointment count with this doctor
    const populatedPatients = await Promise.all(
      patients.map(async (pt) => {
        const [profile, apptStats, latestAppt] = await Promise.all([
          PatientProfile.findOne({ user: pt._id }).lean(),
          Appointment.countDocuments({ doctor: doctorId, patient: pt._id }),
          Appointment.findOne({ doctor: doctorId, patient: pt._id })
            .sort({ appointmentDate: -1 })
            .select('appointmentDate status reasonForVisit')
            .lean()
        ]);

        return {
          ...pt,
          profile: profile || {},
          totalVisitsWithDoctor: apptStats,
          latestAppointment: latestAppt || null
        };
      })
    );

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      patients: populatedPatients
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed medical summary of a specific assigned patient (enforcing clinical relationship)
// @route   GET /api/doctors/patients/:patientId
// @access  Private (Doctor)
exports.getDoctorPatientDetails = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { patientId } = req.params;

    // Strict Clinical Relationship verification
    const hasRelationship = await Appointment.exists({ doctor: doctorId, patient: patientId });
    if (!hasRelationship) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not have an authorized clinical relationship with this patient.'
      });
    }

    const patientUser = await User.findById(patientId).select('name email phone avatar status createdAt');
    if (!patientUser) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    const [profile, appointments, medicalRecords, prescriptions] = await Promise.all([
      PatientProfile.findOne({ user: patientId }),
      Appointment.find({ doctor: doctorId, patient: patientId })
        .sort({ appointmentDate: -1 }),
      MedicalRecord.find({
        patient: patientId,
        $or: [{ doctor: doctorId }, { recordType: { $in: ['Consultation', 'Diagnosis'] } }]
      })
        .populate('doctor', 'name email')
        .sort({ recordedDate: -1 }),
      Prescription.find({ patient: patientId, doctor: doctorId })
        .populate('doctor', 'name email phone')
        .sort({ createdAt: -1 })
    ]);

    res.status(200).json({
      success: true,
      patient: patientUser,
      profile: profile || {},
      appointments,
      medicalRecords,
      prescriptions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin deletes a doctor
// @route   DELETE /api/doctors/:id
// @access  Private/Admin
exports.deleteDoctor = async (req, res, next) => {
  try {
    const doctorIdentifier = req.params.id;

    // Profile can be found by profile _id or user id
    let profile = await DoctorProfile.findOne({
      $or: [{ _id: doctorIdentifier }, { user: doctorIdentifier }]
    });

    let userId = profile ? profile.user : doctorIdentifier;
    const user = await User.findById(userId);

    if (!user && !profile) {
      return res.status(404).json({ success: false, message: 'Doctor record not found.' });
    }

    if (profile) {
      await DoctorProfile.findByIdAndDelete(profile._id);
    }
    if (user) {
      await User.findByIdAndDelete(user._id);
    }

    await AuditLog.create({
      action: 'ADMIN_DELETED_DOCTOR',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Doctor',
      targetId: String(userId),
      details: { doctorName: user?.name, email: user?.email }
    });

    res.status(200).json({
      success: true,
      message: 'Doctor and physician profile deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

