const Prescription = require('../models/Prescription');
const Appointment = require('../models/Appointment');
const AuditLog = require('../models/AuditLog');

// @desc    Create prescription
// @route   POST /api/prescriptions
// @access  Private (Doctor or Admin)
exports.createPrescription = async (req, res, next) => {
  try {
    const { patientId, appointmentId, diagnosis, symptoms, medications, clinicalAdvice, followUpDate } = req.body;

    if (!patientId || !diagnosis || !medications || !Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Patient, diagnosis, and at least one medication item are required.'
      });
    }

    // Validate medication items
    for (let i = 0; i < medications.length; i++) {
      const med = medications[i];
      if (!med.medicineName || !med.dosage || !med.duration) {
        return res.status(400).json({
          success: false,
          message: `Medication item #${i + 1} is missing medicine name, dosage, or duration.`
        });
      }
    }

    // Role check: If doctor, enforce clinical relationship with the patient
    if (req.user.role === 'doctor') {
      const hasRelationship = await Appointment.exists({
        doctor: req.user.id,
        patient: patientId
      });

      if (!hasRelationship) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot issue prescriptions to patients without an active clinical appointment.'
        });
      }
    }

    // If appointmentId is passed, verify ownership
    if (appointmentId) {
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ success: false, message: 'Associated appointment not found.' });
      }

      if (req.user.role === 'doctor' && appointment.doctor.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot issue prescriptions for another doctor\'s appointment.'
        });
      }

      if (appointment.patient.toString() !== patientId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Selected patient does not match the registered patient for this appointment.'
        });
      }

      // Mark appointment as Completed if not already
      if (appointment.status !== 'Completed') {
        appointment.status = 'Completed';
        await appointment.save();
      }
    }

    const prescription = await Prescription.create({
      patient: patientId,
      doctor: req.user.id,
      appointment: appointmentId || null,
      diagnosis,
      symptoms: symptoms || '',
      medications,
      clinicalAdvice: clinicalAdvice || '',
      followUpDate: followUpDate || null
    });

    await AuditLog.create({
      action: 'PRESCRIPTION_CREATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'Prescription',
      targetId: prescription._id.toString(),
      details: { patient: patientId, diagnosis, medCount: medications.length }
    });

    const populated = await Prescription.findById(prescription._id)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Prescription issued successfully.',
      prescription: populated
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get prescriptions (Patient sees own, Doctor sees authored or patient's, Admin sees all)
// @route   GET /api/prescriptions
// @access  Private
exports.getPrescriptions = async (req, res, next) => {
  try {
    const { patientId, doctorId, appointmentId, page = 1, limit = 10 } = req.query;
    const query = {};

    if (req.user.role === 'patient') {
      query.patient = req.user.id;
    } else if (req.user.role === 'doctor') {
      if (patientId) {
        // Enforce clinical relationship verification
        const hasRelationship = await Appointment.exists({
          doctor: req.user.id,
          patient: patientId
        });

        if (!hasRelationship) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: You do not have an authorized clinical relationship with this patient.'
          });
        }
        query.patient = patientId;
      } else {
        query.doctor = req.user.id;
      }
    } else if (req.user.role === 'admin') {
      if (patientId) query.patient = patientId;
      if (doctorId) query.doctor = doctorId;
    }

    if (appointmentId) {
      query.appointment = appointmentId;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Prescription.countDocuments(query);
    const prescriptions = await Prescription.find(query)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      prescriptions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single prescription by ID
// @route   GET /api/prescriptions/:id
// @access  Private
exports.getPrescriptionById = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found.' });
    }

    if (req.user.role === 'patient' && prescription.patient._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to prescription.' });
    }

    if (req.user.role === 'doctor') {
      const isAuthor = prescription.doctor._id.toString() === req.user.id;
      if (!isAuthor) {
        const hasRelationship = await Appointment.exists({
          doctor: req.user.id,
          patient: prescription.patient._id
        });
        if (!hasRelationship) {
          return res.status(403).json({ success: false, message: 'Unauthorized access to prescription.' });
        }
      }
    }

    res.status(200).json({
      success: true,
      prescription
    });
  } catch (error) {
    next(error);
  }
};
