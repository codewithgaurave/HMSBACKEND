const express = require('express');
const router = express.Router();
const {
  getHospitalSettings,
  updateHospitalSettings
} = require('../controllers/settingController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public or authenticated reading of hospital settings
router.get('/', getHospitalSettings);

// Admin-only update of hospital configurations
router.put('/', protect, authorize('admin'), updateHospitalSettings);

module.exports = router;
