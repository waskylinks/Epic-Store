/**
 * Fraud Risk Calculator
 * Single source of truth — imported by orderController and paymentController.
 * Uses the more complete paymentController ruleset (adds very_new_account,
 * first_purchase_high_value, many_items, international_shipping checks that
 * were missing from the orderController copy).
 *
 * @param {Object} order  - { totalPrice, shippingInfo, orderItems, billingAddress }
 * @param {Object} user   - Mongoose User document
 * @returns {Object} fraudCheck subdocument ready to attach to Order
 */
export const calculateFraudRisk = (order, user) => {
  let riskScore = 0;
  const flags = [];

  // High order value
  if (order.totalPrice > 1000) {
    riskScore += 20;
    flags.push('high_order_value');
  }

  // Account age checks
  const accountAgeDays =
    (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);

  if (accountAgeDays < 7) {
    riskScore += 30;
    flags.push('new_account');
  }

  if (accountAgeDays < 1) {
    riskScore += 20;
    flags.push('very_new_account');
  }

  // First purchase with high value
  if (!user.orderHistory || user.orderHistory.length === 0) {
    if (order.totalPrice > 500) {
      riskScore += 15;
      flags.push('first_purchase_high_value');
    }
  }

  // Shipping / billing address mismatch
  if (
    order.shippingInfo?.address &&
    order.billingAddress &&
    order.shippingInfo.address !== order.billingAddress
  ) {
    riskScore += 15;
    flags.push('address_mismatch');
  }

  // Many line items
  if (order.orderItems && order.orderItems.length > 5) {
    riskScore += 10;
    flags.push('many_items');
  }

  // International shipping
  if (
    order.shippingInfo?.country &&
    user.country &&
    order.shippingInfo.country !== user.country
  ) {
    riskScore += 10;
    flags.push('international_shipping');
  }

  let riskLevel = 'low';
  let reviewRequired = false;

  if (riskScore >= 70) {
    riskLevel = 'critical';
    reviewRequired = true;
  } else if (riskScore >= 50) {
    riskLevel = 'high';
    reviewRequired = true;
  } else if (riskScore >= 30) {
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

export default { calculateFraudRisk };