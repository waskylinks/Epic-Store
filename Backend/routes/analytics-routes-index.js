import express from "express";
import dashboardRoutes from "./analytics-dashboard-routes.js";
import reportsRoutes from "./analytics-reports-routes.js";
import customerRoutes from "./customer-analytics-routes.js";
import attributionRoutes from "./attribution-analytics-routes.js";
import checkoutRoutes from "./checkout-analytics-routes.js";
import productRoutes from "./product-analytics-routes.js";
import operationsRoutes from "./operational-analytics-routes.js";
import returnsRoutes from "./return-refund-analytics-routes.js";

const router = express.Router();

/**
 * Analytics Routes Structure:
 * 
 * /api/v1/analytics/dashboard - Main dashboard and KPIs
 * /api/v1/analytics/reports - Report generation and exports
 * /api/v1/analytics/customers - Customer analytics
 * /api/v1/analytics/attribution - Marketing attribution
 * /api/v1/analytics/checkout - Checkout abandonment
 * /api/v1/analytics/products - Product performance
 * /api/v1/analytics/operations - Operational metrics
 * /api/v1/analytics/returns - Returns and refunds
 */

// Main Dashboard Routes
router.use("/dashboard", dashboardRoutes);

// Reports Routes
router.use("/reports", reportsRoutes);

// Customer Analytics Routes
router.use("/customers", customerRoutes);

// Marketing Attribution Routes
router.use("/attribution", attributionRoutes);

// Checkout Analytics Routes
router.use("/checkout", checkoutRoutes);

// Product Analytics Routes
router.use("/products", productRoutes);

// Operational Analytics Routes
router.use("/operations", operationsRoutes);

// Returns & Refunds Analytics Routes
router.use("/", returnsRoutes); // Mounts /returns and /refunds

export default router;