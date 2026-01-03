import { ORDER_STATUSES } from "../constants/analytics.constants.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/user-model.js";


export const getAdminStatsService = async () => {
  const [products, orders, users] = await Promise.all([
    Product.aggregate([
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
    ]),

    Order.aggregate([
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
    ]),

    User.aggregate([
      {
        $group: {
          _id: null,
          users: { $sum: 1 },
          adminCount: {
            $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] }
          }
        }
      }
    ])
  ]);

  return {
    products: products[0] || {},
    orders: orders[0] || {},
    users: users[0] || {}
  };
};
