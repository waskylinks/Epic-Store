import Cart from "../models/cart-model.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Cart Tracking Middleware
 * Captures cart events and session data for analytics
 * Works alongside existing cart controller without modification
 */

// ============================================
// HELPER: Get or Create Cart Session
// ============================================
export const getOrCreateCartSession = async (req) => {
  // Get session ID from cookie or create new one
  let sessionId = req.cookies?.cartSessionId;
  
  if (!sessionId) {
    sessionId = uuidv4();
    // Cookie will be set by trackCartEvent middleware
  }
  
  // Try to find existing cart
  let cart = await Cart.findOne({ 
    sessionId, 
    status: { $in: ['active', 'abandoned'] } 
  });
  
  // Create new cart if doesn't exist
  if (!cart) {
    cart = new Cart({
      sessionId,
      user: req.user?._id || null,
      analytics: {
        source: req.query.utm_source || req.cookies?.utm_source || 'direct',
        medium: req.query.utm_medium || req.cookies?.utm_medium,
        campaign: req.query.utm_campaign || req.cookies?.utm_campaign,
        referrer: req.headers.referer || req.headers.referrer,
        device: getDeviceType(req.headers['user-agent']),
        browser: getBrowser(req.headers['user-agent']),
        os: getOS(req.headers['user-agent']),
        country: req.headers['cf-ipcountry'] || req.ip,
        ipAddress: req.ip
      }
    });
    
    await cart.save();
  }
  
  return { cart, sessionId };
};

// ============================================
// MIDDLEWARE: Track Cart Event
// ============================================
export const trackCartEvent = (eventType) => {
  return async (req, res, next) => {
    try {
      const { cart, sessionId } = await getOrCreateCartSession(req);
      
      // Set session cookie (30 days)
      res.cookie('cartSessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        sameSite: 'lax'
      });
      
      // Attach cart to request for use in controller
      req.cartSession = cart;
      
      // Track the event based on type
      switch (eventType) {
        case 'view':
          await handleCartView(cart, req);
          break;
        case 'add':
          await handleCartAdd(cart, req);
          break;
        case 'remove':
          await handleCartRemove(cart, req);
          break;
        case 'update':
          await handleCartUpdate(cart, req);
          break;
        case 'checkout_start':
          await handleCheckoutStart(cart, req);
          break;
        case 'checkout_complete':
          await handleCheckoutComplete(cart, req);
          break;
        default:
          break;
      }
      
      next();
    } catch (error) {
      console.error('Cart tracking error:', error);
      // Don't block the request if tracking fails
      next();
    }
  };
};

// ============================================
// EVENT HANDLERS
// ============================================

// Track cart view
const handleCartView = async (cart, req) => {
  cart.lastActivityAt = new Date();
  cart.analytics.pageViews += 1;
  
  if (!cart.funnelSteps.some(step => step.step === 'cart_view')) {
    cart.addFunnelStep('cart_view', {
      timestamp: new Date(),
      userAgent: req.headers['user-agent']
    });
  }
  
  await cart.save();
};

// Track item added to cart
const handleCartAdd = async (cart, req) => {
  const { product, quantity = 1, price, name, image } = req.body;
  
  if (product) {
    cart.addItem(product, quantity, price, name, image);
    await cart.save();
  }
};

// Track item removed from cart
const handleCartRemove = async (cart, req) => {
  const { productId } = req.body;
  
  if (productId) {
    cart.removeItem(productId);
    await cart.save();
  }
};

// Track cart update (quantity change)
const handleCartUpdate = async (cart, req) => {
  const { productId, quantity } = req.body;
  
  if (productId && quantity) {
    cart.updateItemQuantity(productId, quantity);
    await cart.save();
  }
};

// Track checkout initiation
const handleCheckoutStart = async (cart, req) => {
  cart.addFunnelStep('checkout_start', {
    itemCount: cart.itemCount,
    cartValue: cart.pricing.total
  });
  
  await cart.save();
};

// Track successful checkout
const handleCheckoutComplete = async (cart, req) => {
  const { orderId } = req.body;
  
  if (orderId) {
    cart.markAsConverted(orderId);
    cart.addFunnelStep('order_complete', {
      orderId,
      finalTotal: cart.pricing.total
    });
    
    await cart.save();
  }
};

// ============================================
// MIDDLEWARE: Sync Cart with Request Body
// ============================================
export const syncCartWithRequestBody = async (req, res, next) => {
  try {
    const { items } = req.body;
    
    if (!items || items.length === 0) {
      return next();
    }
    
    const { cart } = await getOrCreateCartSession(req);
    
    // Clear existing items
    cart.items = [];
    
    // Add all items from request
    for (const item of items) {
      cart.addItem(
        item.product,
        item.quantity,
        item.price,
        item.name,
        item.image
      );
    }
    
    await cart.save();
    req.cartSession = cart;
    
    next();
  } catch (error) {
    console.error('Cart sync error:', error);
    next();
  }
};

// ============================================
// MIDDLEWARE: Track Funnel Step
// ============================================
export const trackFunnelStep = (step) => {
  return async (req, res, next) => {
    try {
      const { cart } = await getOrCreateCartSession(req);
      
      cart.addFunnelStep(step, {
        timestamp: new Date(),
        metadata: {
          path: req.path,
          method: req.method
        }
      });
      
      await cart.save();
      req.cartSession = cart;
      
      next();
    } catch (error) {
      console.error('Funnel tracking error:', error);
      next();
    }
  };
};

// ============================================
// MIDDLEWARE: Track Abandonment
// ============================================
export const checkForAbandonment = async (req, res, next) => {
  try {
    // Find carts that should be marked as abandoned
    const staleCarts = await Cart.find({
      status: 'active',
      lastActivityAt: { 
        $lt: new Date(Date.now() - 60 * 60 * 1000) // 60 minutes ago
      }
    });
    
    // Mark them as abandoned
    for (const cart of staleCarts) {
      cart.abandonment.isAbandoned = true;
      cart.abandonment.abandonedAt = new Date();
      cart.abandonment.abandonedAtStep = cart.lastFunnelStep || 'cart';
      cart.status = 'abandoned';
      
      // Determine possible abandonment reasons based on funnel
      const reasons = inferAbandonmentReasons(cart);
      if (reasons.length > 0) {
        cart.abandonment.possibleReasons = reasons;
      }
      
      await cart.save();
    }
    
    next();
  } catch (error) {
    console.error('Abandonment check error:', error);
    next();
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Infer abandonment reasons based on cart state and funnel
const inferAbandonmentReasons = (cart) => {
  const reasons = [];
  
  // High shipping cost
  if (cart.pricing.shipping > 50) {
    reasons.push('high_shipping_cost');
  }
  
  // Abandoned at payment step
  if (cart.lastFunnelStep === 'payment_info') {
    reasons.push('payment_issues');
  }
  
  // Has discount code field touched but not applied
  if (cart.funnelSteps.some(s => s.metadata?.touchedDiscountField)) {
    reasons.push('unexpected_costs');
  }
  
  // Low-value cart (comparison shopping)
  if (cart.pricing.total < 50) {
    reasons.push('comparison_shopping');
  }
  
  // Multiple cart modifications (indecision)
  if (cart.analytics.cartModifications > 5) {
    reasons.push('comparison_shopping');
  }
  
  return reasons;
};

// Get device type from user agent
const getDeviceType = (userAgent) => {
  if (!userAgent) return 'desktop';
  
  const ua = userAgent.toLowerCase();
  
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
};

// Get browser from user agent
const getBrowser = (userAgent) => {
  if (!userAgent) return 'unknown';
  
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('safari/') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('opera/') || ua.includes('opr/')) return 'Opera';
  if (ua.includes('trident/') || ua.includes('msie')) return 'IE';
  
  return 'unknown';
};

// Get OS from user agent
const getOS = (userAgent) => {
  if (!userAgent) return 'unknown';
  
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac')) return 'MacOS';
  if (ua.includes('linux')) return 'Linux';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
  
  return 'unknown';
};

// ============================================
// BACKGROUND JOB: Mark Abandoned Carts
// ============================================
export const markAbandonedCartsJob = async () => {
  try {
    const result = await Cart.updateMany(
      {
        status: 'active',
        lastActivityAt: { 
          $lt: new Date(Date.now() - 60 * 60 * 1000) // 60 minutes
        }
      },
      {
        $set: {
          status: 'abandoned',
          'abandonment.isAbandoned': true,
          'abandonment.abandonedAt': new Date()
        }
      }
    );
    
    console.log(`Marked ${result.modifiedCount} carts as abandoned`);
    return result;
  } catch (error) {
    console.error('Error marking abandoned carts:', error);
    throw error;
  }
};

// ============================================
// BACKGROUND JOB: Cleanup Expired Carts
// ============================================
export const cleanupExpiredCartsJob = async () => {
  try {
    const result = await Cart.deleteMany({
      status: 'expired',
      expiresAt: { $lt: new Date() }
    });
    
    console.log(`Cleaned up ${result.deletedCount} expired carts`);
    return result;
  } catch (error) {
    console.error('Error cleaning up expired carts:', error);
    throw error;
  }
};

export default {
  trackCartEvent,
  syncCartWithRequestBody,
  trackFunnelStep,
  checkForAbandonment,
  markAbandonedCartsJob,
  cleanupExpiredCartsJob
};
