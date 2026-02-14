// FIX: File was truncated — missing the opening declaration for productStatsPipeline
// and all import statements. ORDER_STATUSES was referenced but never imported.
// FIX: $stock is wrong — Product model stores stock at inventory.stock, not a top-level field.
import { ORDER_STATUSES } from "../constants/analytics.constants.js";

// ============================================
// PRODUCT STATS PIPELINE
// FIX: $eq: ["$stock", 0] → $eq: ["$inventory.stock", 0]
// ============================================
export const productStatsPipeline = [
  {
    $group: {
      _id: null,
      products: { $sum: 1 },
      outOfStock: {
        $sum: { $cond: [{ $eq: ["$inventory.stock", 0] }, 1, 0] }
      }
    }
  },
  {
    $project: {
      _id: 0,
      products: 1,
      outOfStock: 1,
      inStock: { $subtract: ["$products", "$outOfStock"] }
    }
  }
];

// ============================================
// ORDER STATS PIPELINE
// FIX: Now uses imported ORDER_STATUSES constant instead of bare string.
// ============================================
export const orderStatsPipeline = [
  {
    $group: {
      _id: null,
      orders: { $sum: 1 },
      revenue: {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ["$orderStatus", ORDER_STATUSES.CANCELLED] },
                { $eq: ["$paymentInfo.status", "success"] }
              ]
            },
            "$totalPrice",
            0
          ]
        }
      }
    }
  }
];

// ============================================
// ORDER STATUS BREAKDOWN PIPELINE
// Reusable pipeline stage — pass into aggregate([...matchStage, ...orderStatusPipeline])
// ============================================
export const orderStatusBreakdownPipeline = [
  { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
];

// ============================================
// INVENTORY STATUS BREAKDOWN PIPELINE
// ============================================
export const inventoryStatusBreakdownPipeline = [
  { $match: { status: "published" } },
  { $group: { _id: "$inventory.status", count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
];

// ============================================
// TOP PRODUCTS BY REVENUE PIPELINE (reusable base)
// Caller provides the $match stage as first argument.
// ============================================
export const topProductsRevenuePipeline = [
  { $unwind: "$orderItems" },
  {
    $group: {
      _id: "$orderItems.product",
      name: { $first: "$orderItems.name" },
      revenue: {
        $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] }
      },
      quantity: { $sum: "$orderItems.quantity" }
    }
  },
  { $sort: { revenue: -1 } }
];