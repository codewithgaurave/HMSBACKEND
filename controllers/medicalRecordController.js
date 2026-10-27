const MedicalRecord = require('../models/MedicalRecord');
const Appointment = require('../models/Appointment');
const AuditLog = require('../models/AuditLog');

// @desc    Add clinical medical record / Consultation Record
// @route   POST /api/medical-records
// @access  Private (Doctor or Admin)
exports.createRecord = async (req, res, next) => {
  try {
    const {
      patientId,
      appointmentId,
      recordType,
      title,
      description,
      symptoms,
      clinicalObservations,
      diagnosis,
      vitalSigns,
      treatmentPlan,
      doctorNotes,
      followUpDate,
      recordedDate
    } = req.body;

    if (!patientId || !title || (!description && !diagnosis)) {
      return res.status(400).json({
        success: false,
        message: 'Patient, title, and clinical description or diagnosis are required.'
      });
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
          message: 'Access denied: You cannot create medical records for patients without an authorized clinical appointment.'
        });
      }
    }

    // If linked to an appointment, perform integrity checks
    if (appointmentId) {
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ success: false, message: 'Associated appointment not found.' });
      }

      if (req.user.role === 'doctor' && appointment.doctor.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot record consultations for another physician\'s appointment.'
        });
      }

      if (appointment.patient.toString() !== patientId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'The selected patient does not match the patient registered for this appointment.'
        });
      }

      // Prevent duplicate consultation records for the exact same appointment
      const existingConsultation = await MedicalRecord.findOne({
        appointment: appointmentId,
        recordType: recordType || 'Consultation'
      });

      if (existingConsultation) {
        return res.status(400).json({
          success: false,
          message: 'A consultation record has already been logged for this appointment.'
        });
      }
    }

    const record = await MedicalRecord.create({
      patient: patientId,
      doctor: req.user.id,
      appointment: appointmentId || null,
      recordType: recordType || 'Consultation',
      title,
      description: description || `Consultation: ${diagnosis || title}`,
      symptoms: symptoms || '',
      clinicalObservations: clinicalObservations || '',
      diagnosis: diagnosis || '',
      vitalSigns: vitalSigns || {},
      treatmentPlan: treatmentPlan || '',
      doctorNotes: doctorNotes || '',
      followUpDate: followUpDate || null,
      recordedDate: recordedDate || new Date()
    });

    // If an appointment was linked, automatically update appointment status to Completed
    if (appointmentId) {
      await Appointment.findByIdAndUpdate(appointmentId, {
        status: 'Completed',
        notes: doctorNotes || description || 'Consultation completed.'
      });
    }

    await AuditLog.create({
      action: 'MEDICAL_RECORD_CREATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'MedicalRecord',
      targetId: record._id.toString(),
      details: { patient: patientId, appointment: appointmentId, title, recordType }
    });

    const populated = await MedicalRecord.findById(record._id)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Clinical consultation record saved successfully.',
      record: populated
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get medical records (Patient gets own, Doctor gets authorized patients, Admin gets all)
// @route   GET /api/medical-records
// @access  Private
exports.getRecords = async (req, res, next) => {
  try {
    const { patientId, recordType, appointmentId, page = 1, limit = 10 } = req.query;
    const query = {};

    if (req.user.role === 'patient') {
      query.patient = req.user.id;
    } else if (req.user.role === 'doctor') {
      if (patientId) {
        // Enforce clinical relationship verification for doctors
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
        // If doctor didn't specify patientId, only return records created by this doctor
        query.doctor = req.user.id;
      }
    } else if (req.user.role === 'admin') {
      if (patientId) query.patient = patientId;
    }

    if (recordType && recordType !== 'All') {
      query.recordType = recordType;
    }

    if (appointmentId) {
      query.appointment = appointmentId;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await MedicalRecord.countDocuments(query);
    const records = await MedicalRecord.find(query)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone')
      .sort({ recordedDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      records
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single medical record by ID
// @route   GET /api/medical-records/:id
// @access  Private
exports.getRecordById = async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id)
      .populate('doctor', 'name email phone')
      .populate('patient', 'name email phone');

    if (!record) {
      return res.status(404).json({ success: false, message: 'Medical record not found.' });
    }

    if (req.user.role === 'patient' && record.patient._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (req.user.role === 'doctor') {
      const isAuthor = record.doctor && record.doctor._id.toString() === req.user.id;
      if (!isAuthor) {
        const hasRelationship = await Appointment.exists({
          doctor: req.user.id,
          patient: record.patient._id
        });
        if (!hasRelationship) {
          return res.status(403).json({ success: false, message: 'Access denied.' });
        }
      }
    }

    res.status(200).json({
      success: true,
      record
    });
  } catch (error) {
    next(error);
  }
};
