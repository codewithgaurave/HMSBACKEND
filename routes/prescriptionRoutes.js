const express = require('express');
const router = express.Router();
const {
  createPrescription,
  getPrescriptions,
  getPrescriptionById
} = require('../controllers/prescriptionController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router
  .route('/')
  .post(authorize('doctor', 'admin'), createPrescription)
  .get(getPrescriptions);

router.get('/:id', getPrescriptionById);

module.exports = router;
