// analyticsSlice.js — FIXED: operational metrics transformations corrected

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

// ============================================
// BASIC STATS THUNKS
// ============================================

export const fetchAdminStats = createAsyncThunk(
    'analytics/fetchAdminStats',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/stats`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard stats');
        }
    }
);

export const fetchOrderStatusBreakdown = createAsyncThunk(
    'analytics/fetchOrderStatusBreakdown',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/order-status-breakdown`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch order status breakdown');
        }
    }
);

export const fetchInventoryBreakdown = createAsyncThunk(
    'analytics/fetchInventoryBreakdown',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/inventory-breakdown`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory breakdown');
        }
    }
);

export const fetchBasicAnalytics = createAsyncThunk(
    'analytics/fetchBasicAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/analytics?timeframe=${timeframe}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch analytics');
        }
    }
);

// ============================================
// DASHBOARD THUNKS
// ============================================

export const fetchDashboardOverview = createAsyncThunk(
    'analytics/fetchDashboardOverview',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard overview');
        }
    }
);

export const fetchDashboardKPIs = createAsyncThunk(
    'analytics/fetchDashboardKPIs',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/kpis?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch KPIs');
        }
    }
);

export const fetchRevenueTrends = createAsyncThunk(
    'analytics/fetchRevenueTrends',
    async ({ timeframe = 'month', groupBy = 'day' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/revenue-trends?timeframe=${timeframe}&groupBy=${groupBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch revenue trends');
        }
    }
);

export const fetchTopPerformers = createAsyncThunk(
    'analytics/fetchTopPerformers',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/top-performers?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch top performers');
        }
    }
);

export const fetchDashboardAlerts = createAsyncThunk(
    'analytics/fetchDashboardAlerts',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/dashboard/alerts`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch alerts');
        }
    }
);

// ============================================
// REPORT THUNKS
// ============================================

export const generateBusinessReport = createAsyncThunk(
    'analytics/generateBusinessReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/business-performance?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate business report');
        }
    }
);

export const generateSalesReport = createAsyncThunk(
    'analytics/generateSalesReport',
    async ({ timeframe, startDate, endDate, groupBy = 'day' }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);
            params.append('groupBy', groupBy);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/sales?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate sales report');
        }
    }
);

export const generateCustomerReport = createAsyncThunk(
    'analytics/generateCustomerReport',
    async (includeDetails = false, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/customers?includeDetails=${includeDetails}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate customer report');
        }
    }
);

export const generateProductReport = createAsyncThunk(
    'analytics/generateProductReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/products?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate product report');
        }
    }
);

export const generateFinancialReport = createAsyncThunk(
    'analytics/generateFinancialReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/financial?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate financial report');
        }
    }
);

export const exportReportCSV = createAsyncThunk(
    'analytics/exportReportCSV',
    async ({ reportType, timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({ reportType });
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);

            const response = await axios.get(
                `${API_BASE}/analytics/reports/export/csv?${params.toString()}`,
                { responseType: 'blob' }
            );

            const blob = new Blob([response.data], { type: 'text/csv' });
            const url  = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href     = url;
            link.download = `${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            return { success: true, message: 'Report downloaded successfully' };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to export report');
        }
    }
);

// ============================================
// CUSTOMER ANALYTICS THUNKS
// ============================================

export const fetchCustomerOverview = createAsyncThunk(
    'analytics/fetchCustomerOverview',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/overview`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customer overview');
        }
    }
);

export const fetchSegmentDistribution = createAsyncThunk(
    'analytics/fetchSegmentDistribution',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/segments`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch segment distribution');
        }
    }
);

export const fetchCustomersBySegment = createAsyncThunk(
    'analytics/fetchCustomersBySegment',
    async ({ segment, limit = 100, page = 1 }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/segments/${segment}?limit=${limit}&page=${page}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customers by segment');
        }
    }
);

export const fetchHighValueCustomers = createAsyncThunk(
    'analytics/fetchHighValueCustomers',
    async ({ minRevenue = 1000, limit = 50 }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/high-value?minRevenue=${minRevenue}&limit=${limit}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch high-value customers');
        }
    }
);

export const fetchAtRiskCustomers = createAsyncThunk(
    'analytics/fetchAtRiskCustomers',
    async ({ limit = 100, riskLevel }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({ limit: limit.toString() });
            if (riskLevel) params.append('riskLevel', riskLevel);

            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/at-risk?${params.toString()}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch at-risk customers');
        }
    }
);

export const fetchVIPCustomers = createAsyncThunk(
    'analytics/fetchVIPCustomers',
    async (limit = 50, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/vip?limit=${limit}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch VIP customers');
        }
    }
);

export const fetchCLVDistribution = createAsyncThunk(
    'analytics/fetchCLVDistribution',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/clv-distribution`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch CLV distribution');
        }
    }
);

export const fetchCustomersNeedingAttention = createAsyncThunk(
    'analytics/fetchCustomersNeedingAttention',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/needs-attention`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customers needing attention');
        }
    }
);

export const fetchCustomerCohorts = createAsyncThunk(
    'analytics/fetchCustomerCohorts',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/cohorts?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customer cohorts');
        }
    }
);

export const fetchRepeatPurchaseAnalytics = createAsyncThunk(
    'analytics/fetchRepeatPurchaseAnalytics',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/repeat-purchase`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch repeat purchase analytics');
        }
    }
);

export const fetchPurchaseFrequencyAnalytics = createAsyncThunk(
    'analytics/fetchPurchaseFrequencyAnalytics',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/purchase-frequency`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch purchase frequency');
        }
    }
);

export const fetchAcquisitionSourceAnalytics = createAsyncThunk(
    'analytics/fetchAcquisitionSourceAnalytics',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/acquisition-sources`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch acquisition sources');
        }
    }
);

// ============================================
// ATTRIBUTION ANALYTICS THUNKS
// ============================================

export const fetchChannelPerformance = createAsyncThunk(
    'analytics/fetchChannelPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/channels?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch channel performance');
        }
    }
);

export const fetchCampaignPerformance = createAsyncThunk(
    'analytics/fetchCampaignPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/campaigns?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaign performance');
        }
    }
);

export const fetchDevicePerformance = createAsyncThunk(
    'analytics/fetchDevicePerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/devices?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch device performance');
        }
    }
);

export const fetchBrowserPerformance = createAsyncThunk(
    'analytics/fetchBrowserPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/browsers?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch browser performance');
        }
    }
);

export const fetchReferrerPerformance = createAsyncThunk(
    'analytics/fetchReferrerPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/referrers?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch referrer performance');
        }
    }
);

export const fetchLandingPagePerformance = createAsyncThunk(
    'analytics/fetchLandingPagePerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/landing-pages?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch landing page performance');
        }
    }
);

export const fetchAttributionModels = createAsyncThunk(
    'analytics/fetchAttributionModels',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/models?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch attribution models');
        }
    }
);

// ============================================
// CHECKOUT ANALYTICS THUNKS
// ============================================

export const fetchCheckoutAbandonmentStats = createAsyncThunk(
    'analytics/fetchCheckoutAbandonmentStats',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandonment?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch abandonment stats');
        }
    }
);

export const fetchAbandonedCheckouts = createAsyncThunk(
    'analytics/fetchAbandonedCheckouts',
    async ({ hours = 24, minValue = 0, limit = 50, page = 1, sortBy = 'priority' }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({
                hours:    hours.toString(),
                minValue: minValue.toString(),
                limit:    limit.toString(),
                page:     page.toString(),
                sortBy,
            });

            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandoned-list?${params.toString()}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch abandoned checkouts');
        }
    }
);

export const fetchRecoveryOpportunities = createAsyncThunk(
    'analytics/fetchRecoveryOpportunities',
    async (limit = 50, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/recovery-opportunities?limit=${limit}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch recovery opportunities');
        }
    }
);

// ============================================
// PRODUCT ANALYTICS THUNKS
// ============================================

export const fetchProductPerformanceOverview = createAsyncThunk(
    'analytics/fetchProductPerformanceOverview',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/overview?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch product performance');
        }
    }
);

export const fetchProductConversionMetrics = createAsyncThunk(
    'analytics/fetchProductConversionMetrics',
    async ({ limit = 20, sortBy = 'conversionRate' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/conversion?limit=${limit}&sortBy=${sortBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch conversion metrics');
        }
    }
);

export const fetchInventoryTurnover = createAsyncThunk(
    'analytics/fetchInventoryTurnover',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/inventory-turnover?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory turnover');
        }
    }
);

export const fetchLowStockAlerts = createAsyncThunk(
    'analytics/fetchLowStockAlerts',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/products/low-stock-alerts`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch low stock alerts');
        }
    }
);

export const fetchCategoryPerformance = createAsyncThunk(
    'analytics/fetchCategoryPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/category-performance?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch category performance');
        }
    }
);

export const fetchProductProfitMargins = createAsyncThunk(
    'analytics/fetchProductProfitMargins',
    async ({ limit = 20, sortBy = 'margin' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/profit-margins?limit=${limit}&sortBy=${sortBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profit margins');
        }
    }
);

export const fetchProductsBoughtTogether = createAsyncThunk(
    'analytics/fetchProductsBoughtTogether',
    async ({ productId, limit = 10 }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/bought-together?productId=${productId}&limit=${limit}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch products bought together');
        }
    }
);

// ============================================
// OPERATIONAL ANALYTICS THUNKS
// ============================================

export const fetchFulfillmentAnalytics = createAsyncThunk(
    'analytics/fetchFulfillmentAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fulfillment?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch fulfillment analytics');
        }
    }
);

export const fetchSLABreaches = createAsyncThunk(
    'analytics/fetchSLABreaches',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/sla-breaches?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch SLA breaches');
        }
    }
);

export const fetchFraudAnalytics = createAsyncThunk(
    'analytics/fetchFraudAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fraud?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch fraud analytics');
        }
    }
);

export const fetchShippingCarrierPerformance = createAsyncThunk(
    'analytics/fetchShippingCarrierPerformance',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipping-carriers?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch shipping carriers');
        }
    }
);

export const fetchShipmentTrackingAnalytics = createAsyncThunk(
    'analytics/fetchShipmentTrackingAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipment-tracking?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch shipment tracking');
        }
    }
);

export const fetchCancellationAnalytics = createAsyncThunk(
    'analytics/fetchCancellationAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/cancellations?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch cancellations');
        }
    }
);

export const fetchHighRiskOrders = createAsyncThunk(
    'analytics/fetchHighRiskOrders',
    async (limit = 50, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/high-risk-orders?limit=${limit}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch high risk orders');
        }
    }
);

// ============================================
// RETURNS & REFUNDS THUNKS
// ============================================

export const fetchReturnOverview = createAsyncThunk(
    'analytics/fetchReturnOverview',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/overview?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch return overview');
        }
    }
);

export const fetchRefundOverview = createAsyncThunk(
    'analytics/fetchRefundOverview',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/overview?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refund overview');
        }
    }
);

export const fetchReturnsByProduct = createAsyncThunk(
    'analytics/fetchReturnsByProduct',
    async ({ limit = 20, sortBy = 'returnRate' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-product?limit=${limit}&sortBy=${sortBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch returns by product');
        }
    }
);

export const fetchReturnsByCategory = createAsyncThunk(
    'analytics/fetchReturnsByCategory',
    async ({ limit = 20, sortBy = 'returnRate' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-category?limit=${limit}&sortBy=${sortBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch returns by category');
        }
    }
);

export const fetchRefundsByPaymentMethod = createAsyncThunk(
    'analytics/fetchRefundsByPaymentMethod',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/by-payment-method?timeframe=${timeframe}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refunds by payment method');
        }
    }
);

export const fetchRefundTimeline = createAsyncThunk(
    'analytics/fetchRefundTimeline',
    async ({ timeframe = 'month', groupBy = 'day' }, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/timeline?timeframe=${timeframe}&groupBy=${groupBy}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refund timeline');
        }
    }
);

// ============================================
// SLICE DEFINITION
// ============================================

const EMPTY_CUSTOMER_OVERVIEW = {
    totalCustomers:   0,
    newCustomers:     0,
    newCustomersGrowth: 0,
    activeCustomers:  0,
    avgOrderValue:    0,
    avgLifetimeValue: 0,
    totalRevenue:     0,
    avgOrders:        0,
    vipCount:         0,
    atRiskCount:      0,
    segments:         [],
    valueTiers:       [],
    churnRisk:        [],
};

const analyticsSlice = createSlice({
    name: 'analytics',
    initialState: {
        // Basic Stats
        basicStats: {
            products:   0,
            orders:     0,
            revenue:    0,
            users:      0,
            adminCount: 0,
        },
        ordersByStatus:  null,
        inventoryStatus: null,
        basicAnalytics: {
            trends: { revenue: 0, orders: 0, users: 0, products: 0 },
            orderStatusBreakdown: {},
            topProducts:    [],
            recentOrders:   [],
            currentPeriod:  {},
            previousPeriod: {},
        },

        // Dashboard
        dashboardOverview: null,
        kpis:          null,
        revenueTrends: null,
        topPerformers: null,
        alerts:        [],

        // Reports
        currentReport: null,
        reportType:    null,

        // Customer Analytics
        customerOverview: { ...EMPTY_CUSTOMER_OVERVIEW },
        segmentDistribution:        null,
        customersBySegment:         [],
        highValueCustomers:         [],
        atRiskCustomers:            [],
        vipCustomers:               [],
        clvDistribution:            null,
        customersNeedingAttention:  null,
        customerCohorts:            null,
        repeatPurchaseAnalytics:    null,
        purchaseFrequencyAnalytics: null,
        acquisitionSources:         null,

        // Attribution
        channelPerformance:     null,
        campaignPerformance:    null,
        devicePerformance:      null,
        browserPerformance:     null,
        referrerPerformance:    null,
        landingPagePerformance: null,
        attributionModels:      null,

        // Checkout
        checkoutAbandonment:  null,
        abandonedCheckouts:   [],
        recoveryOpportunities: [],

        // Products
        productPerformance:    null,
        productConversion:     null,
        inventoryTurnover:     null,
        lowStockAlerts:        null,
        categoryPerformance:   null,
        productProfitMargins:  null,
        productsBoughtTogether: null,

        // Operations
        fulfillmentAnalytics: null,
        slaBreaches:          null,
        fraudAnalytics:       null,
        shippingCarriers:     null,
        shipmentTracking:     null,
        cancellationAnalytics: null,
        highRiskOrders:       null,

        // Returns & Refunds
        returnOverview:          null,
        refundOverview:          null,
        returnsByProduct:        [],
        returnsByCategory:       [],
        refundsByPaymentMethod:  null,
        refundTimeline:          null,

        // UI States
        loading:       false,
        dashboardLoading: false,
        reportLoading: false,
        error:         null,
        success:       false,
        message:       null,
    },
    reducers: {
        removeErrors: (state) => {
            state.error = null;
        },
        removeSuccess: (state) => {
            state.success = false;
            state.message = null;
        },
        clearReport: (state) => {
            state.currentReport = null;
            state.reportType    = null;
        },
        setDashboardLoading: (state, action) => {
            state.dashboardLoading = action.payload;
        },
    },
    extraReducers: (builder) => {

        // ============================================
        // BASIC STATS
        // ============================================
        builder
            .addCase(fetchAdminStats.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchAdminStats.fulfilled, (state, action) => {
                state.loading = false;
                const { success, ...data } = action.payload;
                state.basicStats = {
                    products:   data.products   || 0,
                    orders:     data.orders     || 0,
                    revenue:    data.revenue    || 0,
                    users:      data.users      || 0,
                    adminCount: data.adminCount || 0,
                };
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                state.error   = action.payload;
            })

            .addCase(fetchBasicAnalytics.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchBasicAnalytics.fulfilled, (state, action) => {
                state.loading       = false;
                state.basicAnalytics = action.payload;
            })
            .addCase(fetchBasicAnalytics.rejected, (state, action) => {
                state.loading = false;
                state.error   = action.payload;
            })

            .addCase(fetchOrderStatusBreakdown.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchOrderStatusBreakdown.fulfilled, (state, action) => {
                state.loading        = false;
                state.ordersByStatus = action.payload.ordersByStatus || {
                    processing: 0,
                    shipped:    0,
                    delivered:  0,
                    cancelled:  0,
                };
            })
            .addCase(fetchOrderStatusBreakdown.rejected, (state, action) => {
                state.loading = false;
                state.error   = action.payload;
            })

            .addCase(fetchInventoryBreakdown.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchInventoryBreakdown.fulfilled, (state, action) => {
                state.loading         = false;
                state.inventoryStatus = action.payload.inventory || {
                    inStock:      0,
                    lowStock:     0,
                    outOfStock:   0,
                    discontinued: 0,
                    total:        0,
                };
            })
            .addCase(fetchInventoryBreakdown.rejected, (state, action) => {
                state.loading = false;
                state.error   = action.payload;
            });

        // ============================================
        // DASHBOARD
        // ============================================
        builder
            .addCase(fetchDashboardOverview.pending, (state) => {
                state.dashboardLoading = true;
                state.error            = null;
            })
            .addCase(fetchDashboardOverview.fulfilled, (state, action) => {
                state.dashboardLoading  = false;
                state.dashboardOverview = action.payload;
            })
            .addCase(fetchDashboardOverview.rejected, (state, action) => {
                state.dashboardLoading = false;
                state.error            = action.payload;
            })

            .addCase(fetchDashboardKPIs.fulfilled, (state, action) => {
                state.kpis = action.payload.kpis;
            })
            .addCase(fetchRevenueTrends.fulfilled, (state, action) => {
                state.revenueTrends = action.payload;
            })
            .addCase(fetchTopPerformers.fulfilled, (state, action) => {
                state.topPerformers = action.payload;
            })
            .addCase(fetchDashboardAlerts.fulfilled, (state, action) => {
                state.alerts = action.payload.alerts;
            });

        // ============================================
        // REPORTS
        // ============================================
        builder
            .addCase(generateBusinessReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateBusinessReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = 'business';
            })
            .addCase(generateBusinessReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error         = action.payload;
            })

            .addCase(generateSalesReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateSalesReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = 'sales';
            })
            .addCase(generateSalesReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error         = action.payload;
            })

            .addCase(generateCustomerReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateCustomerReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = 'customer';
            })
            .addCase(generateCustomerReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error         = action.payload;
            })

            .addCase(generateProductReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateProductReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = 'product';
            })
            .addCase(generateProductReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error         = action.payload;
            })

            .addCase(generateFinancialReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateFinancialReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = 'financial';
            })
            .addCase(generateFinancialReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error         = action.payload;
            })

            .addCase(exportReportCSV.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(exportReportCSV.fulfilled, (state, action) => {
                state.loading  = false;
                state.success  = true;
                state.message  = action.payload.message;
            })
            .addCase(exportReportCSV.rejected, (state, action) => {
                state.loading = false;
                state.error   = action.payload;
            });

        // ============================================
        // CUSTOMER ANALYTICS
        // ============================================
        builder
            .addCase(fetchCustomerOverview.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchCustomerOverview.fulfilled, (state, action) => {
                state.loading = false;
                const { success, ...customerData } = action.payload;
                state.customerOverview = {
                    totalCustomers:     customerData.totalCustomers     || 0,
                    newCustomers:       customerData.newCustomers       || 0,
                    newCustomersGrowth: customerData.newCustomersGrowth || 0,
                    activeCustomers:    customerData.activeCustomers    || 0,
                    avgOrderValue:      customerData.avgOrderValue      || 0,
                    avgLifetimeValue:   customerData.avgLifetimeValue   || 0,
                    totalRevenue:       customerData.totalRevenue       || 0,
                    avgOrders:          customerData.avgOrders          || 0,
                    vipCount:           customerData.vipCount           || 0,
                    atRiskCount:        customerData.atRiskCount        || 0,
                    segments:           customerData.segments           || [],
                    valueTiers:         customerData.valueTiers         || [],
                    churnRisk:          customerData.churnRisk          || [],
                };
            })
            .addCase(fetchCustomerOverview.rejected, (state, action) => {
                state.loading         = false;
                state.error           = action.payload;
                state.customerOverview = { ...EMPTY_CUSTOMER_OVERVIEW };
            })

            .addCase(fetchSegmentDistribution.fulfilled, (state, action) => {
                state.segmentDistribution = action.payload;
            })
            .addCase(fetchCustomersBySegment.fulfilled, (state, action) => {
                state.customersBySegment = action.payload;
            })
            .addCase(fetchHighValueCustomers.fulfilled, (state, action) => {
                state.highValueCustomers = action.payload;
            })
            .addCase(fetchAtRiskCustomers.fulfilled, (state, action) => {
                state.atRiskCustomers = action.payload;
            })
            .addCase(fetchVIPCustomers.fulfilled, (state, action) => {
                state.vipCustomers = action.payload;
            })
            .addCase(fetchCLVDistribution.fulfilled, (state, action) => {
                state.clvDistribution = action.payload;
            })
            .addCase(fetchCustomersNeedingAttention.fulfilled, (state, action) => {
                state.customersNeedingAttention = action.payload;
            })
            .addCase(fetchCustomerCohorts.fulfilled, (state, action) => {
                state.customerCohorts = action.payload;
            })
            .addCase(fetchRepeatPurchaseAnalytics.fulfilled, (state, action) => {
                state.repeatPurchaseAnalytics = action.payload;
            })
            .addCase(fetchPurchaseFrequencyAnalytics.fulfilled, (state, action) => {
                state.purchaseFrequencyAnalytics = action.payload;
            })
            .addCase(fetchAcquisitionSourceAnalytics.fulfilled, (state, action) => {
                state.acquisitionSources = action.payload;
            });

        // ============================================
        // ATTRIBUTION
        // ============================================
        builder
            .addCase(fetchChannelPerformance.fulfilled, (state, action) => {
                state.channelPerformance = action.payload;
            })
            .addCase(fetchCampaignPerformance.fulfilled, (state, action) => {
                state.campaignPerformance = action.payload;
            })
            .addCase(fetchDevicePerformance.fulfilled, (state, action) => {
                state.devicePerformance = action.payload;
            })
            .addCase(fetchBrowserPerformance.fulfilled, (state, action) => {
                state.browserPerformance = action.payload;
            })
            .addCase(fetchReferrerPerformance.fulfilled, (state, action) => {
                state.referrerPerformance = action.payload;
            })
            .addCase(fetchLandingPagePerformance.fulfilled, (state, action) => {
                state.landingPagePerformance = action.payload;
            })
            .addCase(fetchAttributionModels.fulfilled, (state, action) => {
                state.attributionModels = action.payload;
            });

        // ============================================
        // CHECKOUT
        // ============================================
        builder
            .addCase(fetchCheckoutAbandonmentStats.fulfilled, (state, action) => {
                state.checkoutAbandonment = action.payload;
            })
            .addCase(fetchAbandonedCheckouts.fulfilled, (state, action) => {
                state.abandonedCheckouts = action.payload;
            })
            .addCase(fetchRecoveryOpportunities.fulfilled, (state, action) => {
                state.recoveryOpportunities = action.payload;
            });

        // ============================================
        // PRODUCTS
        // ============================================
        builder
            .addCase(fetchProductPerformanceOverview.fulfilled, (state, action) => {
                state.productPerformance = action.payload;
            })
            .addCase(fetchProductConversionMetrics.fulfilled, (state, action) => {
                state.productConversion = action.payload;
            })
            .addCase(fetchInventoryTurnover.fulfilled, (state, action) => {
                state.inventoryTurnover = action.payload;
            })
            .addCase(fetchLowStockAlerts.fulfilled, (state, action) => {
                state.lowStockAlerts = action.payload;
            })
            .addCase(fetchCategoryPerformance.fulfilled, (state, action) => {
                state.categoryPerformance = action.payload;
            })
            .addCase(fetchProductProfitMargins.fulfilled, (state, action) => {
                state.productProfitMargins = action.payload;
            })
            .addCase(fetchProductsBoughtTogether.fulfilled, (state, action) => {
                state.productsBoughtTogether = action.payload;
            });

        // ============================================
        // OPERATIONS — FIXED: Transform nested backend
        // responses into the flat shape Dashboard.jsx expects
        // ============================================
        builder
            .addCase(fetchFulfillmentAnalytics.fulfilled, (state, action) => {
                /**
                 * Backend now returns pre-computed onTimeRate and deliveredToday directly.
                 *
                 * onTimeRate:     Was Delivered/(Processing+Shipped+Delivered) — a delivery
                 *                 completion ratio, not an on-time rate. Fixed: backend now
                 *                 queries fulfillmentSLA.slaBreached=false / total SLA records.
                 *
                 * deliveredToday: Was statusBreakdown.Delivered — counted ALL delivered orders
                 *                 in the entire period, not just those delivered today.
                 *                 Fixed: backend queries { deliveredAt: { $gte: startOfToday } }.
                 */
                const fm = action.payload.fulfillmentMetrics || {};
                const dm = action.payload.deliveryMetrics    || {};
                const sb = action.payload.statusBreakdown    || {};

                state.fulfillmentAnalytics = {
                    onTimeRate:        action.payload.onTimeRate    ?? 0,
                    deliveredToday:    action.payload.deliveredToday ?? 0,
                    avgProcessingTime: fm.avgFulfillmentHours        || 0,
                    avgShippingTime:   dm.avgDeliveryDays            || 0,
                    pendingShipments:  (sb.Processing || 0) + (sb.Shipped || 0),
                    _raw:              action.payload,
                };
            })

            .addCase(fetchSLABreaches.fulfilled, (state, action) => {
                /**
                 * avgResolutionTime: Was averaging delayInDays across ALL orders in the period,
                 *                    including non-breached ones where delayInDays = 0.
                 *                    Fixed: backend now averages only across breached orders.
                 */
                const summary      = action.payload.summary  || {};
                const breachesList = action.payload.breaches || [];

                const complianceRate =
                    typeof summary.breachRate === 'number'
                        ? Math.round((100 - summary.breachRate) * 100) / 100
                        : 0;

                // Prefer backend-computed value; fall back to client-side count
                // for backwards compatibility with un-patched backends.
                const criticalBreaches =
                    typeof summary.criticalBreaches === 'number'
                        ? summary.criticalBreaches
                        : breachesList.filter(
                              (b) => (b.fulfillmentSLA?.delayInDays || 0) >= 2
                          ).length;

                state.slaBreaches = {
                    complianceRate,
                    totalBreaches:     summary.breachedOrders || 0,
                    criticalBreaches,
                    avgResolutionTime:
                        typeof summary.avgDelayDays === 'number'
                            ? Math.round(summary.avgDelayDays * 24 * 100) / 100
                            : 0,
                    _raw: action.payload,
                };
            })

            .addCase(fetchFraudAnalytics.fulfilled, (state, action) => {
                const riskDist   = action.payload.riskDistribution || [];
                const reviewDecs = action.payload.reviewDecisions  || [];
                const fraudPrev  = action.payload.fraudPrevention  || {};

                const totalRiskOrders = riskDist.reduce((sum, r) => sum + (r.count || 0), 0);

                const flaggedOrders = riskDist
                    .filter((r) => r._id === 'high' || r._id === 'critical')
                    .reduce((sum, r) => sum + (r.count || 0), 0);

                const fraudRate =
                    totalRiskOrders > 0
                        ? Math.round((flaggedOrders / totalRiskOrders) * 100 * 100) / 100
                        : 0;

                const rejectedEntry  = reviewDecs.find((d) => d._id === 'Rejected');
                const confirmedFraud = rejectedEntry ? rejectedEntry.count || 0 : 0;

                state.fraudAnalytics = {
                    fraudRate,
                    flaggedOrders,
                    confirmedFraud,
                    revenueSaved:  fraudPrev.totalValue              || 0,
                    pendingReview: action.payload.pendingReviews || 0,
                    _raw:          action.payload,
                };
            })

            .addCase(fetchShippingCarrierPerformance.fulfilled, (state, action) => {
                state.shippingCarriers = action.payload;
            })
            .addCase(fetchShipmentTrackingAnalytics.fulfilled, (state, action) => {
                state.shipmentTracking = action.payload;
            })
            .addCase(fetchCancellationAnalytics.fulfilled, (state, action) => {
                state.cancellationAnalytics = action.payload;
            })
            .addCase(fetchHighRiskOrders.fulfilled, (state, action) => {
                state.highRiskOrders = action.payload;
            });

        // ============================================
        // RETURNS & REFUNDS
        // ============================================
        builder
            .addCase(fetchReturnOverview.fulfilled, (state, action) => {
                state.returnOverview = action.payload;
            })
            .addCase(fetchRefundOverview.fulfilled, (state, action) => {
                state.refundOverview = action.payload;
            })
            .addCase(fetchReturnsByProduct.fulfilled, (state, action) => {
                state.returnsByProduct = action.payload;
            })
            .addCase(fetchReturnsByCategory.fulfilled, (state, action) => {
                state.returnsByCategory = action.payload;
            })
            .addCase(fetchRefundsByPaymentMethod.fulfilled, (state, action) => {
                state.refundsByPaymentMethod = action.payload;
            })
            .addCase(fetchRefundTimeline.fulfilled, (state, action) => {
                state.refundTimeline = action.payload;
            });
    },
});

export const { removeErrors, removeSuccess, clearReport, setDashboardLoading } = analyticsSlice.actions;
export default analyticsSlice.reducer;