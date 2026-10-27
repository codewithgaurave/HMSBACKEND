const express = require('express');
const router = express.Router();
const {
  getLabDashboardStats,
  getLabTests,
  getLabTestById,
  createLabTest,
  updateLabTest,
  toggleLabTestStatus,
  deleteLabTest,
  createLabRequest,
  getLabRequests,
  getLabRequestById,
  updateRequestStatus,
  recordLabResult,
  reviewAndReleaseResult,
  getLabResult,
  downloadReportFile,
  deleteLabRequest
} = require('../controllers/labController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// ==================== TESTS CATALOG ==================== //
router.get('/tests', getLabTests);
router.get('/tests/:id', getLabTestById);
router.post('/tests', protect, authorize('admin', 'lab'), createLabTest);
router.put('/tests/:id', protect, authorize('admin', 'lab'), updateLabTest);
router.patch('/tests/:id/toggle-status', protect, authorize('admin', 'lab'), toggleLabTestStatus);
router.delete('/tests/:id', protect, authorize('admin'), deleteLabTest);

// ==================== DASHBOARD STATS ==================== //
router.get('/dashboard-stats', protect, authorize('admin', 'lab'), getLabDashboardStats);

// ==================== REQUESTS PIPELINE ==================== //
router.use(protect);
router
  .route('/requests')
  .get(getLabRequests)
  .post(createLabRequest);

router.get('/requests/:id', getLabRequestById);
router.patch('/requests/:id/status', authorize('admin', 'lab'), updateRequestStatus);
router.delete('/requests/:id', authorize('admin'), deleteLabRequest);

// ==================== RESULTS, REVIEWS & REPORTS ==================== //
router.post('/results', authorize('admin', 'lab'), upload.single('reportFile'), recordLabResult);
router.patch('/results/:requestId/review', authorize('admin', 'lab'), reviewAndReleaseResult);
router.get('/results/:requestId', getLabResult);
router.get('/reports/:requestId/download', downloadReportFile);

module.exports = router;
