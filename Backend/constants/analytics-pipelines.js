import { ORDER_STATUSES } from "./analytics.constants.js";

export const productStatsPipeline = [
  {
    $group: {
      _id: null,
      products: { $sum: 1 },
      outOfStock: {
        $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] }
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

export const orderStatsPipeline = [
  {
    $group: {
      _id: null,
      orders: { $sum: 1 },
      revenue: {
        $sum: {
          $cond: [
            { $ne: ["$orderStatus", ORDER_STATUSES.CANCELLED] },
            "$totalPrice",
            0
          ]
        }
      }
    }
  }
];

export const userStatsPipeline = [
  {
    $group: {
      _id: null,
      users: { $sum: 1 },
      adminCount: {
        $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] }
      }
    }
  }
];