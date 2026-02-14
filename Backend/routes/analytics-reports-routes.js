import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  generateBusinessPerformanceReport,
  generateSalesReport,
  generateCustomerReport,
  generateProductReport,
  generateFinancialReport,
  exportReportCSV
} from "../controller/analytics-reports-controller.js"; 

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin"), adminAnalyticsLimiter);

// ============================================
// REPORT GENERATION ROUTES
// ============================================

/**
 * Generate comprehensive business performance report
 * @route GET /api/v1/analytics/reports/business-performance
 * @access Admin
 */
router.get("/business-performance", generateBusinessPerformanceReport);

/**
 * Generate detailed sales report
 * @route GET /api/v1/analytics/reports/sales
 * @access Admin
 */
router.get("/sales", generateSalesReport);

/**
 * Generate customer analytics report
 * @route GET /api/v1/analytics/reports/customers
 * @access Admin
 */
router.get("/customers", generateCustomerReport);

/**
 * Generate product performance report
 * @route GET /api/v1/analytics/reports/products
 * @access Admin
 */
router.get("/products", generateProductReport);

/**
 * Generate financial summary report
 * @route GET /api/v1/analytics/reports/financial
 * @access Admin
 */
router.get("/financial", generateFinancialReport);

// ============================================
// EXPORT ROUTES
// ============================================

/**
 * Export report data in CSV format
 * @route GET /api/v1/analytics/reports/export/csv
 * @access Admin
 * @query reportType - Type of report to export (sales, products, customers)
 * @query timeframe - Time period (day, week, month, year)
 * @query startDate - Optional custom start date
 * @query endDate - Optional custom end date
 */
router.get("/export/csv", exportReportCSV);

export default router;