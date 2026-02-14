/**
 * Fulfillment SLA Calculator
 * Single source of truth — imported by orderController and paymentController.
 * Both copies were identical, so no logic changes — just centralised.
 *
 * @param {Date}   orderDate     - Order creation date
 * @param {string} currentStatus - Current order status
 * @returns {Object} fulfillmentSLA subdocument ready to attach to Order
 */
export const calculateFulfillmentSLA = (orderDate, currentStatus) => {
  const now = new Date();
  const hoursSinceOrder = (now - orderDate) / (1000 * 60 * 60);

  // Standard SLA: 24 hours for processing, 72 hours for shipping
  const processingTarget = 24;
  const shippingTarget = 72;

  const targetHours =
    currentStatus === 'Shipped' || currentStatus === 'Delivered'
      ? shippingTarget
      : processingTarget;

  const slaBreached = hoursSinceOrder > targetHours;
  const delayInHours = slaBreached ? hoursSinceOrder - targetHours : 0;

  return {
    targetFulfillmentHours: targetHours,
    actualFulfillmentHours: hoursSinceOrder,
    slaBreached,
    delayInHours,
    delayInDays: delayInHours / 24,
    calculatedAt: now
  };
};

export default { calculateFulfillmentSLA };