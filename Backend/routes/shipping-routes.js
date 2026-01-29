import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import {
  validateAddress,
  getSavedAddresses,
  saveAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} from '../controller/shipping-controller.js';

const router = express.Router();

// ============================================
// PUBLIC SHIPPING ROUTES
// ============================================

/**
 * Validate shipping address format
 * @route POST /api/v1/shipping/validate-address
 * @access Public
 */
router.post('/validate-address', validateAddress);

// ============================================
// AUTHENTICATED SHIPPING ROUTES
// ============================================

/**
 * Get all saved addresses
 * @route GET /api/v1/shipping/addresses
 * @access Private
 */
router.get('/addresses', verifyUserAuth, getSavedAddresses);

/**
 * Save new address
 * @route POST /api/v1/shipping/address
 * @access Private
 */
router.post('/address', verifyUserAuth, saveAddress);

/**
 * Update existing address
 * @route PUT /api/v1/shipping/address/:id
 * @access Private
 */
router.put('/address/:id', verifyUserAuth, updateAddress);

/**
 * Delete address
 * @route DELETE /api/v1/shipping/address/:id
 * @access Private
 */
router.delete('/address/:id', verifyUserAuth, deleteAddress);

/**
 * Set address as default
 * @route PUT /api/v1/shipping/address/:id/default
 * @access Private
 */
router.put('/address/:id/default', verifyUserAuth, setDefaultAddress);

export default router;