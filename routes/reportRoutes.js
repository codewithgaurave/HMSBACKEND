const express = require('express');
const router = express.Router();
const {
  getAdminDashboardStats,
  getReportsSummary,
  getAuditLogs
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/admin-dashboard', authorize('admin'), getAdminDashboardStats);
router.get('/summary', authorize('admin'), getReportsSummary);
router.get('/audit-logs', authorize('admin'), getAuditLogs);

module.exports = router;
