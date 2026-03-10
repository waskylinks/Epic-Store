import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import {
  createDiscount,
  updateDiscount,
  deleteDiscount,
  getAllDiscounts,
  getDiscountById,
  createCompensationDiscount,
  validateDiscountCode,
  getActivePromos,
  getMyDiscounts,
  getDiscountStats,
  triggerCleanup
} from '../controller/discount-controller.js';

const router = express.Router();

// ============================================
// PUBLIC ROUTES
// ============================================

router.post('/validate', validateDiscountCode);
router.get('/promos', getActivePromos);

// ============================================
// USER ROUTES (Authenticated)
// ============================================

router.get('/my-discounts', verifyUserAuth, getMyDiscounts);

// ============================================
// ADMIN ROUTES
// Note: specific named routes (/stats, /create-compensation, /cleanup)
// must come BEFORE the /:id param route to prevent Express matching
// them as IDs.
// ============================================

router.get('/stats', verifyUserAuth, roleBaseAccess('admin'), getDiscountStats);
router.post('/create-compensation', verifyUserAuth, roleBaseAccess('admin'), createCompensationDiscount);

/**
 * Manual cleanup trigger — useful for on-demand runs or testing.
 * Body: { daysOld: 90 }
 */
router.post('/cleanup', verifyUserAuth, roleBaseAccess('admin'), triggerCleanup);

router.get('/', verifyUserAuth, roleBaseAccess('admin'), getAllDiscounts);
router.post('/', verifyUserAuth, roleBaseAccess('admin'), createDiscount);

router.get('/:id', verifyUserAuth, roleBaseAccess('admin'), getDiscountById);
router.put('/:id', verifyUserAuth, roleBaseAccess('admin'), updateDiscount);
router.delete('/:id', verifyUserAuth, roleBaseAccess('admin'), deleteDiscount);

export default router;