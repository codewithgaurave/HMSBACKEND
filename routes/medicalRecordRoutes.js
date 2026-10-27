const express = require('express');
const router = express.Router();
const {
  createRecord,
  getRecords,
  getRecordById
} = require('../controllers/medicalRecordController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router
  .route('/')
  .post(authorize('doctor', 'admin'), createRecord)
  .get(getRecords);

router.get('/:id', getRecordById);

module.exports = router;
