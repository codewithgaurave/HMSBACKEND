const HospitalSetting = require('../models/HospitalSetting');
const AuditLog = require('../models/AuditLog');

// @desc    Get active hospital configurations and appointment policies
// @route   GET /api/settings
// @access  Public / Protected
exports.getHospitalSettings = async (req, res, next) => {
  try {
    let settings = await HospitalSetting.findOne().sort({ updatedAt: -1 });

    if (!settings) {
      settings = await HospitalSetting.create({
        hospitalName: process.env.HOSPITAL_NAME || 'Hospital Management System',
        contactNumber: '+91 800-467-7482',
        emergencyContact: '+91 800-467-9999',
        email: 'contact@hospitalmanagement.com',
        address: '742 Healthcare Boulevard, Medical Enclave, New Delhi, 110001',
        timezone: process.env.HOSPITAL_TIMEZONE || 'Asia/Kolkata',
        appointmentSettings: {
          slotDurationMinutes: 30,
          maxAppointmentsPerDay: 50,
          workingHoursStart: '09:00',
          workingHoursEnd: '18:00',
          advanceBookingDays: 30,
          allowPatientCancellation: true
        }
      });
    }

    res.status(200).json({
      success: true,
      settings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update hospital settings & appointment policies
// @route   PUT /api/settings
// @access  Private (Admin only)
exports.updateHospitalSettings = async (req, res, next) => {
  try {
    const {
      hospitalName,
      contactNumber,
      emergencyContact,
      email,
      address,
      timezone,
      appointmentSettings
    } = req.body;

    if (!hospitalName || hospitalName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Hospital name is required.' });
    }

    if (email && !/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid hospital email address.' });
    }

    let settings = await HospitalSetting.findOne().sort({ updatedAt: -1 });

    if (!settings) {
      settings = new HospitalSetting({});
    }

    if (hospitalName) settings.hospitalName = hospitalName.trim();
    if (contactNumber !== undefined) settings.contactNumber = contactNumber.trim();
    if (emergencyContact !== undefined) settings.emergencyContact = emergencyContact.trim();
    if (email !== undefined) settings.email = email.trim().toLowerCase();
    if (address !== undefined) settings.address = address.trim();
    if (timezone !== undefined) settings.timezone = timezone.trim();

    if (appointmentSettings) {
      if (appointmentSettings.slotDurationMinutes) {
        const slot = Number(appointmentSettings.slotDurationMinutes);
        if (slot < 10 || slot > 180) {
          return res.status(400).json({ success: false, message: 'Slot duration must be between 10 and 180 minutes.' });
        }
        settings.appointmentSettings.slotDurationMinutes = slot;
      }
      if (appointmentSettings.maxAppointmentsPerDay) {
        settings.appointmentSettings.maxAppointmentsPerDay = Number(appointmentSettings.maxAppointmentsPerDay);
      }
      if (appointmentSettings.workingHoursStart) {
        settings.appointmentSettings.workingHoursStart = appointmentSettings.workingHoursStart;
      }
      if (appointmentSettings.workingHoursEnd) {
        settings.appointmentSettings.workingHoursEnd = appointmentSettings.workingHoursEnd;
      }
      if (appointmentSettings.advanceBookingDays) {
        settings.appointmentSettings.advanceBookingDays = Number(appointmentSettings.advanceBookingDays);
      }
      if (appointmentSettings.allowPatientCancellation !== undefined) {
        settings.appointmentSettings.allowPatientCancellation = Boolean(appointmentSettings.allowPatientCancellation);
      }
    }

    settings.updatedBy = req.user.id;
    await settings.save();

    await AuditLog.create({
      action: 'HOSPITAL_SETTINGS_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'HospitalSetting',
      targetId: settings._id.toString(),
      details: { hospitalName: settings.hospitalName }
    });

    res.status(200).json({
      success: true,
      message: 'Hospital settings successfully updated.',
      settings
    });
  } catch (error) {
    next(error);
  }
};
