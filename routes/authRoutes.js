const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  register,
  login,
  getMe,
  forgotPassword,
  resetPassword,
  updatePassword,
  getNotifications
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

// Validation rules
const registerValidation = [
  body('name').trim().notEmpty().withMessage('Please provide your full name').isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
  body('email').trim().isEmail().withMessage('Please provide a valid email address').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  validateRequest
];

const loginValidation = [
  body('email').trim().isEmail().withMessage('Please provide a valid email address').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  validateRequest
];

const passwordUpdateValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long'),
  validateRequest
];

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.get('/me', protect, getMe);
router.get('/notifications', protect, getNotifications);
router.post('/forgot-password', [body('email').isEmail().withMessage('Please provide a valid email address'), validateRequest], forgotPassword);
router.post('/reset-password/:token', [body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'), validateRequest], resetPassword);
router.put('/update-password', protect, passwordUpdateValidation, updatePassword);

module.exports = router;

