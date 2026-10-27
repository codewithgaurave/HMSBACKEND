const express = require('express');
const router = express.Router();
const {
  getAllDoctors,
  getDoctorById,
  updateDoctorProfile,
  getDoctorAvailableSlots,
  getDoctorDashboard,
  getDoctorPatients,
  getDoctorPatientDetails,
  deleteDoctor
} = require('../controllers/doctorController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Specific doctor console routes (must be mounted before /:id)
router.get('/dashboard', protect, authorize('doctor', 'admin'), getDoctorDashboard);
router.get('/patients', protect, authorize('doctor'), getDoctorPatients);
router.get('/patients/:patientId', protect, authorize('doctor'), getDoctorPatientDetails);

// Public can view list of active doctors & their specialties
router.get('/', getAllDoctors);
router.get('/:id', getDoctorById);
router.get('/:id/available-slots', getDoctorAvailableSlots);

// Protected routes to update and delete doctor profile
router.put('/:id', protect, authorize('doctor', 'admin'), updateDoctorProfile);
router.delete('/:id', protect, authorize('admin'), deleteDoctor);

module.exports = router;
