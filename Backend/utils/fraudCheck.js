// utils/fraudCheck.js

/**
 * calculateFraudRisk(orderData, user)
 *
 * Expected usage (both controllers):
 * calculateFraudRisk({
 *   totalPrice,
 *   shippingInfo,
 *   orderItems,
 *   billingAddress
 * }, user)
 *
 * Returns:
 * {
 *   riskScore,
 *   riskLevel,
 *   flags,
 *   reviewRequired,
 *   reviewDecision,
 *   checkedAt
 * }
 */

export const calculateFraudRisk = (orderData = {}, user = {}) => {
  const {
    totalPrice = 0,
    shippingInfo = {},
    orderItems = [],
    billingAddress = null
  } = orderData;

  let riskScore = 0;
  const flags = [];

  // ==============================
  // VALUE-BASED SIGNALS
  // ==============================

  if (totalPrice >= 1000) {
    riskScore += 25;
    flags.push('high_order_value');
  }

  if (totalPrice >= 3000) {
    riskScore += 25;
    flags.push('very_high_value');
  }

  // ==============================
  // ACCOUNT-BASED SIGNALS
  // ==============================

  if (user?.createdAt) {
    const accountAgeDays =
      (Date.now() - new Date(user.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);

    if (accountAgeDays < 7) {
      riskScore += 30;
      flags.push('new_account');
    }

    if (accountAgeDays < 1) {
      riskScore += 20;
      flags.push('very_new_account');
    }
  }

  // ==============================
  // ORDER PATTERN SIGNALS
  // ==============================

  // Address mismatch
  if (
    billingAddress &&
    shippingInfo?.address &&
    billingAddress !== shippingInfo.address
  ) {
    riskScore += 20;
    flags.push('address_mismatch');
  }

  // Bulk purchase behavior
  const totalQty = Array.isArray(orderItems)
    ? orderItems.reduce((sum, item) => sum + (item.quantity || 0), 0)
    : 0;

  if (totalQty >= 10) {
    riskScore += 10;
    flags.push('bulk_purchase');
  }

  if (Array.isArray(orderItems) && orderItems.length >= 5) {
    riskScore += 10;
    flags.push('many_items');
  }

  // Country mismatch (only if both exist)
  if (
    shippingInfo?.country &&
    user?.country &&
    shippingInfo.country !== user.country
  ) {
    riskScore += 10;
    flags.push('international_shipping');
  }

  // ==============================
  // CLASSIFICATION
  // ==============================

  let riskLevel = 'low';
  let reviewRequired = false;

  if (riskScore >= 80) {
    riskLevel = 'critical';
    reviewRequired = true;
  } else if (riskScore >= 60) {
    riskLevel = 'high';
    reviewRequired = true;
  } else if (riskScore >= 35) {
    riskLevel = 'medium';
  }

  return {
    riskScore,
    riskLevel,
    flags,
    reviewRequired,
    reviewDecision: reviewRequired ? 'Pending' : 'Approved',
    checkedAt: new Date()
  };
};
