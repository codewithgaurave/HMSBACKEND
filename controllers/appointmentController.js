const Appointment = require('../models/Appointment');
const DoctorProfile = require('../models/DoctorProfile');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// @desc    Book an appointment
// @route   POST /api/appointments
// @access  Private (Patient or Admin)
exports.bookAppointment = async (req, res, next) => {
  try {
    let { doctorId, patientId, appointmentDate, timeSlot, reasonForVisit, notes } = req.body;

    // If patient is booking, enforce patient is themselves
    if (req.user.role === 'patient') {
      patientId = req.user.id;
    } else if (!patientId) {
      return res.status(400).json({ success: false, message: 'Patient ID is required.' });
    }

    if (!doctorId || !appointmentDate || !timeSlot || !timeSlot.start || !timeSlot.end || !reasonForVisit) {
      return res.status(400).json({
        success: false,
        message: 'Please provide doctor, appointment date, time slot (start & end), and reason for visit.'
      });
    }

    // Check if appointmentDate is in the past
    const selectedDate = new Date(appointmentDate);
    selectedDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Appointments cannot be scheduled for past dates.'
      });
    }

    // Verify doctor exists and has an active profile
    const doctor = await User.findOne({ _id: doctorId, role: 'doctor', status: 'active' });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Active doctor not found.' });
    }

    const doctorProfile = await DoctorProfile.findOne({ user: doctorId });
    if (!doctorProfile || !doctorProfile.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'The selected doctor is currently not accepting appointments.'
      });
    }

    // Check doctor day availability
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const appointmentDay = days[new Date(appointmentDate).getDay()];
    if (doctorProfile.availableDays && !doctorProfile.availableDays.includes(appointmentDay)) {
      return res.status(400).json({
        success: false,
        message: `Dr. ${doctor.name} is not available on ${appointmentDay}s. Available days: ${doctorProfile.availableDays.join(', ')}`
      });
    }

    // Start of day and end of day for conflict checking
    const dayStart = new Date(appointmentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Prevent overlapping / duplicate bookings for the doctor in the same time slot
    const existingConflict = await Appointment.findOne({
      doctor: doctorId,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      'timeSlot.start': timeSlot.start,
      status: { $nin: ['Cancelled', 'Rejected'] }
    });

    if (existingConflict) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked for this doctor. Please choose another time slot.'
      });
    }

    // Check if patient already has an active appointment with the same doctor on that day
    const patientExisting = await Appointment.findOne({
      patient: patientId,
      doctor: doctorId,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      status: { $nin: ['Cancelled', 'Rejected'] }
    });

    if (patientExisting) {
      return res.status(400).json({
        success: false,
        message: 'You already have an appointment booked with this doctor on the selected date.'
      });
    }

    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctorId,
      appointmentDate: selectedDate,
      timeSlot,
      reasonForVisit,
      notes: notes || '',
      status: 'Confirmed' // Auto-confirmed or Pending
    });

    await AuditLog.create({
      action: 'APPOINTMENT_BOOKED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Appointment',
      targetId: appointment._id.toString(),
      details: { doctor: doctorId, patient: patientId, date: appointmentDate, slot: timeSlot }
    });

    const populated = await Appointment.findById(appointment._id)
      .populate('doctor', 'name email phone avatar')
      .populate('patient', 'name email phone avatar');

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully.',
      appointment: populated
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get appointments with role filtering & pagination
// @route   GET /api/appointments
// @access  Private
exports.getAppointments = async (req, res, next) => {
  try {
    const { status, doctorId, patientId, date, page = 1, limit = 10 } = req.query;

    const query = {};

    // Role-based restrictions
    if (req.user.role === 'patient') {
      query.patient = req.user.id;
    } else if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    } else if (req.user.role === 'admin') {
      if (doctorId) query.doctor = doctorId;
      if (patientId) query.patient = patientId;
    }

    if (status && status !== 'All') {
      query.status = status;
    }

    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      query.appointmentDate = { $gte: targetDate, $lt: nextDay };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Appointment.countDocuments(query);
    const appointments = await Appointment.find(query)
      .populate('doctor', 'name email phone avatar')
      .populate('patient', 'name email phone avatar')
      .sort({ appointmentDate: -1, 'timeSlot.start': 1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      appointments
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single appointment by ID
// @route   GET /api/appointments/:id
// @access  Private
exports.getAppointmentById = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('doctor', 'name email phone avatar')
      .populate('patient', 'name email phone avatar');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    // Role check
    if (
      req.user.role === 'patient' &&
      appointment.patient._id.toString() !== req.user.id
    ) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (
      req.user.role === 'doctor' &&
      appointment.doctor._id.toString() !== req.user.id
    ) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.status(200).json({
      success: true,
      appointment
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update appointment status (Confirm, In Progress, Complete, Cancel, Reject)
// @route   PATCH /api/appointments/:id/status
// @access  Private
exports.updateAppointmentStatus = async (req, res, next) => {
  try {
    let { status, cancellationReason, notes } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'Rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status value. Allowed statuses: ${validStatuses.join(', ')}`
      });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    // Role check: Patient can only access own, Doctor can only access assigned
    if (req.user.role === 'patient') {
      if (appointment.patient.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
      if (status !== 'Cancelled') {
        return res.status(403).json({
          success: false,
          message: 'Patients can only cancel their own appointments.'
        });
      }
      if (appointment.status === 'Completed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel an appointment that has already been completed.'
        });
      }
    } else if (req.user.role === 'doctor') {
      if (appointment.doctor.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only update appointments assigned to your schedule.'
        });
      }
    }

    // Workflow transition validations
    if (appointment.status === 'Completed' && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify a consultation encounter that has already been completed.'
      });
    }

    if (['Cancelled', 'Rejected'].includes(appointment.status) && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: `Cannot modify an appointment that is already ${appointment.status.toLowerCase()}.`
      });
    }

    if (status === 'In Progress' && !['Pending', 'Confirmed', 'In Progress'].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only pending or confirmed appointments can be transitioned to In Progress.'
      });
    }

    if (status === 'Completed' && !['Confirmed', 'In Progress'].includes(appointment.status) && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Only confirmed or in-progress consultations can be marked as completed.'
      });
    }

    if (status === 'Cancelled' && !cancellationReason) {
      cancellationReason = `Cancelled by ${req.user.role}`;
    }

    appointment.status = status;
    if (cancellationReason) appointment.cancellationReason = cancellationReason;
    if (notes !== undefined) appointment.notes = notes;

    await appointment.save();

    await AuditLog.create({
      action: 'APPOINTMENT_STATUS_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Appointment',
      targetId: appointment._id.toString(),
      details: { newStatus: status, reason: cancellationReason, notes }
    });

    const updated = await Appointment.findById(appointment._id)
      .populate('doctor', 'name email phone avatar')
      .populate('patient', 'name email phone avatar');

    res.status(200).json({
      success: true,
      message: `Appointment status updated to ${status}.`,
      appointment: updated
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reschedule appointment
// @route   PUT /api/appointments/:id/reschedule
// @access  Private (Admin or Doctor)
exports.rescheduleAppointment = async (req, res, next) => {
  try {
    const { appointmentDate, timeSlot } = req.body;

    if (!appointmentDate || !timeSlot || !timeSlot.start || !timeSlot.end) {
      return res.status(400).json({
        success: false,
        message: 'Appointment date and start/end times are required for rescheduling.'
      });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    // Role check
    if (req.user.role === 'doctor' && appointment.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const newDate = new Date(appointmentDate);
    newDate.setHours(0, 0, 0, 0);

    // Check conflict
    const dayStart = new Date(appointmentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate);
    dayEnd.setHours(23, 59, 59, 999);

    const conflict = await Appointment.findOne({
      _id: { $ne: appointment._id },
      doctor: appointment.doctor,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      'timeSlot.start': timeSlot.start,
      status: { $nin: ['Cancelled', 'Rejected'] }
    });

    if (conflict) {
      return res.status(400).json({
        success: false,
        message: 'The selected time slot is already booked for this doctor.'
      });
    }

    appointment.appointmentDate = newDate;
    appointment.timeSlot = timeSlot;
    appointment.status = 'Confirmed';
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment rescheduled successfully.',
      appointment
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get available slots by doctor query
// @route   GET /api/appointments/available-slots
// @access  Private
exports.getAvailableSlots = async (req, res, next) => {
  const doctorId = req.query.doctorId || req.query.doctor;
  if (!doctorId) {
    return res.status(400).json({ success: false, message: 'Doctor ID is required to fetch available slots.' });
  }
  req.params.id = doctorId;
  const { getDoctorAvailableSlots } = require('./doctorController');
  return getDoctorAvailableSlots(req, res, next);
};

// @desc    Admin deletes an appointment record
// @route   DELETE /api/appointments/:id
// @access  Private/Admin
exports.deleteAppointment = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    await Appointment.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'ADMIN_DELETED_APPOINTMENT',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Appointment',
      targetId: appointment._id.toString(),
      details: {
        patientId: String(appointment.patient),
        doctorId: String(appointment.doctor),
        appointmentDate: appointment.appointmentDate
      }
    });

    res.status(200).json({
      success: true,
      message: 'Appointment record deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};


