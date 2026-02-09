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
  getDiscountStats
} from '../controller/discount-controller.js';

const router = express.Router();

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * Validate discount code (used in cart)
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
router.post('/validate', validateDiscountCode);

/**
 * Get active public promo codes
 * @route GET /api/v1/discounts/promos
 * @access Public
 */
router.get('/promos', getActivePromos);

// ============================================
// USER ROUTES (Authenticated)
// ============================================

/**
 * Get my personalized discounts
 * @route GET /api/v1/discounts/my-discounts
 * @access Private
 */
router.get('/my-discounts', verifyUserAuth, getMyDiscounts);

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * Get discount statistics
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
router.get('/stats', verifyUserAuth, roleBaseAccess('admin'), getDiscountStats);

/**
 * Get all discounts
 * @route GET /api/v1/discounts
 * @access Admin
 */
router.get('/', verifyUserAuth, roleBaseAccess('admin'), getAllDiscounts);

/**
 * Create new discount
 * @route POST /api/v1/discounts
 * @access Admin
 */
router.post('/', verifyUserAuth, roleBaseAccess('admin'), createDiscount);

/**
 * Create compensation discount (refund/return)
 * @route POST /api/v1/discounts/create-compensation
 * @access Admin
 */
router.post('/create-compensation', verifyUserAuth, roleBaseAccess('admin'), createCompensationDiscount);

/**
 * Get single discount
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
router.get('/:id', verifyUserAuth, roleBaseAccess('admin'), getDiscountById);

/**
 * Update discount
 * @route PUT /api/v1/discounts/:id
 * @access Admin
 */
router.put('/:id', verifyUserAuth, roleBaseAccess('admin'), updateDiscount);

/**
 * Delete discount
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
router.delete('/:id', verifyUserAuth, roleBaseAccess('admin'), deleteDiscount);

export default router;