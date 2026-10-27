const express = require('express');
const router = express.Router();
const {
  bookAppointment,
  getAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  rescheduleAppointment,
  getAvailableSlots,
  deleteAppointment
} = require('../controllers/appointmentController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router
  .route('/')
  .post(authorize('patient', 'admin'), bookAppointment)
  .get(getAppointments);

router.get('/available-slots', getAvailableSlots);
router.get('/:id', getAppointmentById);
router.patch('/:id/status', updateAppointmentStatus);
router.put('/:id/reschedule', authorize('admin', 'doctor'), rescheduleAppointment);
router.delete('/:id', authorize('admin'), deleteAppointment);

module.exports = router;

