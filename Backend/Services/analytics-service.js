import Product from "../models/product-model.js";
import Order from "../models/order-model.js";
import User from "../models/user-model.js";
import { assertAggregationResult } from "../utils/analyticsGuard.js";
import { orderStatsPipeline, productStatsPipeline, userStatsPipeline } from "../constants/analytics-pipelines.js";

export const getAdminStatsService = async () => {
  const productStats = await Product.aggregate(productStatsPipeline);
  assertAggregationResult(productStats, "Product stats aggregation");

  const orderStats = await Order.aggregate(orderStatsPipeline);
  assertAggregationResult(orderStats, "Order stats aggregation");

  const userStats = await User.aggregate(userStatsPipeline);
  assertAggregationResult(userStats, "User stats aggregation");

  return {
    products: productStats[0],
    orders: orderStats[0],
    users: userStats[0]
  };
};
