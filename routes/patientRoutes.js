const express = require('express');
const router = express.Router();
const {
  getAllPatients,
  getPatientById,
  updatePatientProfile,
  getPatientHistory,
  getPatientDashboard,
  deletePatient
} = require('../controllers/patientController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', authorize('admin', 'doctor'), getAllPatients);
router.get('/:id', getPatientById);
router.get('/:id/dashboard', getPatientDashboard);
router.put('/:id', authorize('patient', 'admin'), updatePatientProfile);
router.delete('/:id', authorize('admin'), deletePatient);
router.get('/:id/history', getPatientHistory);

module.exports = router;

