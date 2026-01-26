import express from "express";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
  checkWishlistStatus,
  moveToCart
} from "../controllers/wishlist-controller.js";
import { verifyUserAuth } from "../middleware/user-auth.js";

const router = express.Router();

// ===== PROTECTED WISHLIST ROUTES =====
// All wishlist routes require authentication
router.use(verifyUserAuth);

// Get user's wishlist
router.route("/")
  .get(getWishlist);

// Add product to wishlist
router.route("/add")
  .post(addToWishlist);

// Remove product from wishlist
router.route("/remove/:productId")
  .delete(removeFromWishlist);

// Clear entire wishlist
router.route("/clear")
  .delete(clearWishlist);

// Check if product exists in wishlist
router.route("/check/:productId")
  .get(checkWishlistStatus);

// Move product from wishlist to cart
router.route("/move-to-cart/:productId")
  .post(moveToCart);

export default router;
