// utils/fulfillmentSLA.js

/**
 * calculateFulfillmentSLA(orderDate, status)
 *
 * Expected usage (both controllers):
 * calculateFulfillmentSLA(order.createdAt, 'Processing')
 * calculateFulfillmentSLA(order.createdAt, 'Shipped')
 * calculateFulfillmentSLA(order.createdAt, status)
 *
 * Returns:
 * {
 *   targetFulfillmentHours,
 *   actualFulfillmentHours,
 *   slaBreached,
 *   delayInHours,
 *   delayInDays,
 *   calculatedAt
 * }
 */

export const calculateFulfillmentSLA = (orderDate, status = 'Processing') => {
  const now = new Date();
  const orderTime = new Date(orderDate);

  const hoursElapsed = (now - orderTime) / (1000 * 60 * 60);

  // SLA lifecycle targets aligned with order status updates
  const targets = {
    Processing: 24,
    Shipped: 72,
    Delivered: 120,
    Cancelled: 0
  };

  const targetHours = targets[status] ?? 24;

  const slaBreached = targetHours > 0 && hoursElapsed > targetHours;
  const delayHours = slaBreached ? hoursElapsed - targetHours : 0;

  return {
    targetFulfillmentHours: targetHours,
    actualFulfillmentHours: hoursElapsed,
    slaBreached,
    delayInHours: delayHours,
    delayInDays: delayHours / 24,
    calculatedAt: now
  };
};
