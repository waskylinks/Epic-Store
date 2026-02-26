/**
 * Fraud Risk Calculator
 * Single source of truth — imported by orderController and paymentController.
 *
 * Billing address extraction is handled internally per gateway so callers
 * pass the raw gatewayResponse and gateway name rather than pre-extracting
 * a field that varies in location across Stripe / Paystack / Flutterwave.
 *
 * @param {Object} order          - { totalPrice, shippingInfo, orderItems }
 * @param {Object} user           - Mongoose User document
 * @param {Object} [gatewayData]  - Optional: { gateway, gatewayResponse }
 * @returns {Object} fraudCheck subdocument ready to attach to Order
 */

/**
 * Extract billing address line from a raw gateway response.
 * Returns null if the gateway does not expose a billing address.
 *
 * @param {string} gateway          - 'stripe' | 'paystack' | 'flutterwave'
 * @param {Object} gatewayResponse  - Raw response object from the gateway
 * @returns {string|null}
 */
const extractBillingAddress = (gateway, gatewayResponse) => {
  if (!gateway || !gatewayResponse) return null;

  switch (gateway) {
    case 'stripe':
      // Stripe: billing address is on the charge's billing_details
      return (
        gatewayResponse.charges?.data?.[0]?.billing_details?.address?.line1 ||
        null
      );

    case 'paystack':
      // Paystack does not expose a billing address in its verify response
      return null;

    case 'flutterwave':
      // Flutterwave exposes card.address_1 when present
      return gatewayResponse.card?.address_1 || null;

    default:
      return null;
  }
};

export const calculateFraudRisk = (order, user, gatewayData = null) => {
  let riskScore = 0;
  const flags = [];

  // ── High order value ────────────────────────────────────────────
  if (order.totalPrice > 1000) {
    riskScore += 20;
    flags.push('high_order_value');
  }

  // ── Account age checks ──────────────────────────────────────────
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

  // ── First purchase with high value ──────────────────────────────
  if (!user.orderHistory || user.orderHistory.length === 0) {
    if (order.totalPrice > 500) {
      riskScore += 15;
      flags.push('first_purchase_high_value');
    }
  }

  // ── Shipping / billing address mismatch ─────────────────────────
  // Extract billing address from the gateway response if provided.
  // This keeps callers free of gateway-specific field knowledge.
  const billingAddress = gatewayData
    ? extractBillingAddress(gatewayData.gateway, gatewayData.gatewayResponse)
    : (order.billingAddress || null); // fallback for callers that pre-extract (e.g. orderController)

  if (
    order.shippingInfo?.address &&
    billingAddress &&
    order.shippingInfo.address !== billingAddress
  ) {
    riskScore += 15;
    flags.push('address_mismatch');
  }

  // ── Many line items ─────────────────────────────────────────────
  if (order.orderItems && order.orderItems.length > 5) {
    riskScore += 10;
    flags.push('many_items');
  }

  // ── International shipping ──────────────────────────────────────
  if (
    order.shippingInfo?.country &&
    user.country &&
    order.shippingInfo.country !== user.country
  ) {
    riskScore += 10;
    flags.push('international_shipping');
  }

  // ── Risk level thresholds ───────────────────────────────────────
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