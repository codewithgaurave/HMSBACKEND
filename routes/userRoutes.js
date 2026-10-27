const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus,
  adminResetPassword,
  uploadUserAvatar,
  removeUserAvatar,
  updateUserProfile
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadAvatar } = require('../middleware/uploadMiddleware');

router.use(protect);

router.post('/avatar', uploadAvatar.single('avatar'), uploadUserAvatar);
router.delete('/avatar', removeUserAvatar);
router.put('/profile', updateUserProfile);

router
  .route('/')
  .get(authorize('admin'), getUsers)
  .post(authorize('admin'), createUser);

router
  .route('/:id')
  .get(getUserById)
  .put(authorize('admin'), updateUser)
  .delete(authorize('admin'), deleteUser);

router.patch('/:id/toggle-status', authorize('admin'), toggleUserStatus);
router.patch('/:id/reset-password', authorize('admin'), adminResetPassword);

module.exports = router;
