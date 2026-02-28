// analyticsSlice.js — FIXED: all race conditions, payload shape, abort handling, loading states

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

// ============================================
// ABORT HELPER
// Distinguishes intentional cancellation from real errors.
// Prevents spurious error banners when timeframe switches abort in-flight requests.
// ============================================
const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// ============================================
// BASIC STATS THUNKS
// ============================================

export const fetchAdminStats = createAsyncThunk(
    'analytics/fetchAdminStats',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/stats`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard stats');
        }
    }
);

export const fetchOrderStatusBreakdown = createAsyncThunk(
    'analytics/fetchOrderStatusBreakdown',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/order-status-breakdown`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch order status breakdown');
        }
    }
);

export const fetchInventoryBreakdown = createAsyncThunk(
    'analytics/fetchInventoryBreakdown',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/inventory-breakdown`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory breakdown');
        }
    }
);

export const fetchBasicAnalytics = createAsyncThunk(
    'analytics/fetchBasicAnalytics',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/analytics?timeframe=${timeframe}`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch analytics');
        }
    }
);

// ============================================
// DASHBOARD THUNKS
// All timeframe-dependent thunks now:
// 1. Accept signal from RTK and pass to axios (real cancellation)
// 2. Return timeframe in payload so slice can reject stale responses
// ============================================

export const fetchDashboardOverview = createAsyncThunk(
    'analytics/fetchDashboardOverview',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard overview');
        }
    }
);

export const fetchDashboardKPIs = createAsyncThunk(
    'analytics/fetchDashboardKPIs',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/kpis?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch KPIs');
        }
    }
);

export const fetchRevenueTrends = createAsyncThunk(
    'analytics/fetchRevenueTrends',
    async ({ timeframe = 'month', groupBy = 'day' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/revenue-trends?timeframe=${timeframe}&groupBy=${groupBy}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch revenue trends');
        }
    }
);

export const fetchTopPerformers = createAsyncThunk(
    'analytics/fetchTopPerformers',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/top-performers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch top performers');
        }
    }
);

export const fetchDashboardAlerts = createAsyncThunk(
    'analytics/fetchDashboardAlerts',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/dashboard/alerts`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch alerts');
        }
    }
);

// ============================================
// REPORT THUNKS
// ============================================

export const generateBusinessReport = createAsyncThunk(
    'analytics/generateBusinessReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/business-performance?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to generate business report');
        }
    }
);

export const generateSalesReport = createAsyncThunk(
    'analytics/generateSalesReport',
    async ({ timeframe, startDate, endDate, groupBy = 'day' }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);
            params.append('groupBy', groupBy);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/sales?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to generate sales report');
        }
    }
);

export const generateCustomerReport = createAsyncThunk(
    'analytics/generateCustomerReport',
    async (includeDetails = false, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/customers?includeDetails=${includeDetails}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to generate customer report');
        }
    }
);

export const generateProductReport = createAsyncThunk(
    'analytics/generateProductReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/products?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to generate product report');
        }
    }
);

export const generateFinancialReport = createAsyncThunk(
    'analytics/generateFinancialReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate)   params.append('endDate', endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/financial?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
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
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/overview`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customer overview');
        }
    }
);

export const fetchSegmentDistribution = createAsyncThunk(
    'analytics/fetchSegmentDistribution',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/segments`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch segment distribution');
        }
    }
);

export const fetchCustomersBySegment = createAsyncThunk(
    'analytics/fetchCustomersBySegment',
    async ({ segment, limit = 100, page = 1 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/segments/${segment}?limit=${limit}&page=${page}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customers by segment');
        }
    }
);

export const fetchHighValueCustomers = createAsyncThunk(
    'analytics/fetchHighValueCustomers',
    async ({ minRevenue = 1000, limit = 50 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/high-value?minRevenue=${minRevenue}&limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch high-value customers');
        }
    }
);

export const fetchAtRiskCustomers = createAsyncThunk(
    'analytics/fetchAtRiskCustomers',
    async ({ limit = 100, riskLevel }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams({ limit: limit.toString() });
            if (riskLevel) params.append('riskLevel', riskLevel);
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/at-risk?${params.toString()}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch at-risk customers');
        }
    }
);

export const fetchVIPCustomers = createAsyncThunk(
    'analytics/fetchVIPCustomers',
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/vip?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch VIP customers');
        }
    }
);

export const fetchCLVDistribution = createAsyncThunk(
    'analytics/fetchCLVDistribution',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/clv-distribution`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch CLV distribution');
        }
    }
);

export const fetchCustomersNeedingAttention = createAsyncThunk(
    'analytics/fetchCustomersNeedingAttention',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/needs-attention`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customers needing attention');
        }
    }
);

export const fetchCustomerCohorts = createAsyncThunk(
    'analytics/fetchCustomerCohorts',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/cohorts?timeframe=${timeframe}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch customer cohorts');
        }
    }
);

export const fetchRepeatPurchaseAnalytics = createAsyncThunk(
    'analytics/fetchRepeatPurchaseAnalytics',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/repeat-purchase`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch repeat purchase analytics');
        }
    }
);

export const fetchPurchaseFrequencyAnalytics = createAsyncThunk(
    'analytics/fetchPurchaseFrequencyAnalytics',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/purchase-frequency`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch purchase frequency');
        }
    }
);

export const fetchAcquisitionSourceAnalytics = createAsyncThunk(
    'analytics/fetchAcquisitionSourceAnalytics',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/customers/acquisition-sources`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch acquisition sources');
        }
    }
);

// ============================================
// ATTRIBUTION ANALYTICS THUNKS
// ============================================

export const fetchChannelPerformance = createAsyncThunk(
    'analytics/fetchChannelPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/channels?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch channel performance');
        }
    }
);

export const fetchCampaignPerformance = createAsyncThunk(
    'analytics/fetchCampaignPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/campaigns?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaign performance');
        }
    }
);

export const fetchDevicePerformance = createAsyncThunk(
    'analytics/fetchDevicePerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/devices?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch device performance');
        }
    }
);

export const fetchBrowserPerformance = createAsyncThunk(
    'analytics/fetchBrowserPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/browsers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch browser performance');
        }
    }
);

export const fetchReferrerPerformance = createAsyncThunk(
    'analytics/fetchReferrerPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/referrers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch referrer performance');
        }
    }
);

export const fetchLandingPagePerformance = createAsyncThunk(
    'analytics/fetchLandingPagePerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/landing-pages?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch landing page performance');
        }
    }
);

export const fetchAttributionModels = createAsyncThunk(
    'analytics/fetchAttributionModels',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/models?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch attribution models');
        }
    }
);

// ============================================
// CHECKOUT ANALYTICS THUNKS
// ============================================

export const fetchCheckoutAbandonmentStats = createAsyncThunk(
    'analytics/fetchCheckoutAbandonmentStats',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandonment?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch abandonment stats');
        }
    }
);

export const fetchAbandonedCheckouts = createAsyncThunk(
    'analytics/fetchAbandonedCheckouts',
    async ({ hours = 24, minValue = 0, limit = 50, page = 1, sortBy = 'priority' }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams({
                hours:    hours.toString(),
                minValue: minValue.toString(),
                limit:    limit.toString(),
                page:     page.toString(),
                sortBy,
            });
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandoned-list?${params.toString()}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch abandoned checkouts');
        }
    }
);

export const fetchRecoveryOpportunities = createAsyncThunk(
    'analytics/fetchRecoveryOpportunities',
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/recovery-opportunities?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch recovery opportunities');
        }
    }
);

export const markRecoveryEmailSent = createAsyncThunk(
    'analytics/markRecoveryEmailSent',
    async (checkoutId, { rejectWithValue }) => {
        try {
            const { data } = await axios.post(
                `${API_BASE}/analytics/checkout/${checkoutId}/mark-recovery-sent`,
                {},
                { withCredentials: true }
            );
            return { checkoutId, result: data.result };
        } catch (error) {
            // Always return a consistent object shape to prevent destructure crash
            return rejectWithValue({
                checkoutId,
                message: error.response?.data?.message || 'Failed to send recovery email'
            });
        }
    }
);

// ============================================
// PRODUCT ANALYTICS THUNKS
// ============================================

export const fetchProductPerformanceOverview = createAsyncThunk(
    'analytics/fetchProductPerformanceOverview',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch product performance');
        }
    }
);

export const fetchProductConversionMetrics = createAsyncThunk(
    'analytics/fetchProductConversionMetrics',
    async ({ limit = 20, sortBy = 'conversionRate' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/conversion?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch conversion metrics');
        }
    }
);

export const fetchInventoryTurnover = createAsyncThunk(
    'analytics/fetchInventoryTurnover',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/inventory-turnover?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory turnover');
        }
    }
);

export const fetchLowStockAlerts = createAsyncThunk(
    'analytics/fetchLowStockAlerts',
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/analytics/products/low-stock-alerts`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch low stock alerts');
        }
    }
);

export const fetchCategoryPerformance = createAsyncThunk(
    'analytics/fetchCategoryPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/category-performance?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch category performance');
        }
    }
);

export const fetchProductProfitMargins = createAsyncThunk(
    'analytics/fetchProductProfitMargins',
    async ({ limit = 20, sortBy = 'margin' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/profit-margins?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profit margins');
        }
    }
);

export const fetchProductsBoughtTogether = createAsyncThunk(
    'analytics/fetchProductsBoughtTogether',
    async ({ productId, limit = 10 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/bought-together?productId=${productId}&limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch products bought together');
        }
    }
);

// ============================================
// OPERATIONAL ANALYTICS THUNKS
// ============================================

export const fetchFulfillmentAnalytics = createAsyncThunk(
    'analytics/fetchFulfillmentAnalytics',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fulfillment?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch fulfillment analytics');
        }
    }
);

export const fetchSLABreaches = createAsyncThunk(
    'analytics/fetchSLABreaches',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/sla-breaches?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch SLA breaches');
        }
    }
);

export const fetchFraudAnalytics = createAsyncThunk(
    'analytics/fetchFraudAnalytics',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fraud?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch fraud analytics');
        }
    }
);

export const fetchShippingCarrierPerformance = createAsyncThunk(
    'analytics/fetchShippingCarrierPerformance',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipping-carriers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch shipping carriers');
        }
    }
);

export const fetchShipmentTrackingAnalytics = createAsyncThunk(
    'analytics/fetchShipmentTrackingAnalytics',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipment-tracking?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch shipment tracking');
        }
    }
);

export const fetchCancellationAnalytics = createAsyncThunk(
    'analytics/fetchCancellationAnalytics',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/cancellations?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch cancellations');
        }
    }
);

export const fetchHighRiskOrders = createAsyncThunk(
    'analytics/fetchHighRiskOrders',
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/high-risk-orders?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch high risk orders');
        }
    }
);

// ============================================
// RETURNS & REFUNDS THUNKS
// ============================================

export const fetchReturnOverview = createAsyncThunk(
    'analytics/fetchReturnOverview',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch return overview');
        }
    }
);

export const fetchRefundOverview = createAsyncThunk(
    'analytics/fetchRefundOverview',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refund overview');
        }
    }
);

export const fetchReturnsByProduct = createAsyncThunk(
    'analytics/fetchReturnsByProduct',
    async ({ limit = 20, sortBy = 'returnRate' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-product?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch returns by product');
        }
    }
);

export const fetchReturnsByCategory = createAsyncThunk(
    'analytics/fetchReturnsByCategory',
    async ({ limit = 20, sortBy = 'returnRate' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-category?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch returns by category');
        }
    }
);

export const fetchRefundsByPaymentMethod = createAsyncThunk(
    'analytics/fetchRefundsByPaymentMethod',
    async (timeframe = 'month', { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/by-payment-method?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refunds by payment method');
        }
    }
);

export const fetchRefundTimeline = createAsyncThunk(
    'analytics/fetchRefundTimeline',
    async ({ timeframe = 'month', groupBy = 'day' }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/timeline?timeframe=${timeframe}&groupBy=${groupBy}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refund timeline');
        }
    }
);

// ============================================
// SLICE DEFINITION
// ============================================

const EMPTY_CUSTOMER_OVERVIEW = {
    totalCustomers:     0,
    newCustomers:       0,
    newCustomersGrowth: 0,
    activeCustomers:    0,
    avgOrderValue:      0,
    avgLifetimeValue:   0,
    totalRevenue:       0,
    avgOrders:          0,
    vipCount:           0,
    atRiskCount:        0,
    segments:           [],
    valueTiers:         [],
    churnRisk:          [],
};

// Validates that a KPI payload has the expected shape before writing to state.
// Prevents setting kpis to undefined/error objects when API shape varies.
const isValidKpiPayload = (kpis) =>
    kpis !== null &&
    kpis !== undefined &&
    typeof kpis === 'object' &&
    !Array.isArray(kpis) &&
    ('revenue' in kpis || 'orders' in kpis || 'customers' in kpis);

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
        basicStatsFetched: false,
        ordersByStatus:    null,
        inventoryStatus:   null,
        basicAnalytics: {
            trends: { revenue: 0, orders: 0, users: 0, products: 0 },
            orderStatusBreakdown: {},
            topProducts:    [],
            recentOrders:   [],
            currentPeriod:  {},
            previousPeriod: {},
        },

        // Dashboard
        // activeTimeframe: tracks what timeframe is currently selected in Redux
        // so fulfilled cases can reject stale out-of-order responses
        activeTimeframe:  'month',
        dashboardOverview: null,
        kpis:              null,
        kpisLoading:       false, // dedicated loading flag — never clears kpis to null
        revenueTrends:     null,
        topPerformers:     null,
        alerts:            [],

        // Reports
        currentReport: null,
        reportType:    null,

        // Customer Analytics
        customerOverview:           { ...EMPTY_CUSTOMER_OVERVIEW },
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
        checkoutAbandonment:   null,
        abandonedCheckouts:    [],
        recoveryOpportunities: [],
        emailSendLoading:      {},
        emailSendResults:      {},
        emailSendError:        {},

        // Products
        productPerformance:     null,
        productConversion:      null,
        inventoryTurnover:      null,
        lowStockAlerts:         null,
        categoryPerformance:    null,
        productProfitMargins:   null,
        productsBoughtTogether: null,

        // Operations
        fulfillmentAnalytics:  null,
        slaBreaches:           null,
        fraudAnalytics:        null,
        shippingCarriers:      null,
        shipmentTracking:      null,
        cancellationAnalytics: null,
        highRiskOrders:        null,

        // Returns & Refunds
        returnOverview:         null,
        refundOverview:         null,
        returnsByProduct:       [],
        returnsByCategory:      [],
        refundsByPaymentMethod: null,
        refundTimeline:         null,

        // UI States
        loading:          false,
        dashboardLoading: false,
        reportLoading:    false,
        error:            null,
        success:          false,
        message:          null,
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
        // Called before dispatching timeframe thunks so fulfilled
        // cases can compare against the correct active timeframe
        setActiveTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
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
                state.basicStatsFetched = true;
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                // Don't set error for intentional aborts
                if (!action.payload?.aborted) {
                    state.error = typeof action.payload === 'string'
                        ? action.payload
                        : action.payload?.message || 'Failed to fetch stats';
                }
            })

            .addCase(fetchBasicAnalytics.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchBasicAnalytics.fulfilled, (state, action) => {
                state.loading        = false;
                state.basicAnalytics = action.payload;
            })
            .addCase(fetchBasicAnalytics.rejected, (state, action) => {
                state.loading = false;
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ============================================
        // DASHBOARD
        // fetchDashboardKPIs:
        //   pending  → kpisLoading: true (never nulls out kpis — preserves existing data)
        //   fulfilled → validates payload shape before writing, checks activeTimeframe
        //   rejected → kpisLoading: false, no error banner for aborts
        // ============================================
        builder
            .addCase(fetchDashboardOverview.pending, (state) => {
                state.dashboardLoading = true;
                state.error            = null;
            })
            .addCase(fetchDashboardOverview.fulfilled, (state, action) => {
                state.dashboardLoading = false;
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.dashboardOverview = data;
                }
            })
            .addCase(fetchDashboardOverview.rejected, (state, action) => {
                state.dashboardLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchDashboardKPIs.pending, (state) => {
                // Set loading flag but preserve existing kpis data
                // so the UI shows stale-but-valid data while refreshing
                state.kpisLoading = true;
            })
            .addCase(fetchDashboardKPIs.fulfilled, (state, action) => {
                state.kpisLoading = false;
                // Reject stale responses from previous timeframe switches
                if (action.payload._timeframe !== state.activeTimeframe) return;
                // Support both { kpis: {...} } and flat { revenue: {...}, ... } API shapes
                const kpisData = action.payload.kpis ?? action.payload;
                const { _timeframe, success, ...rest } = kpisData;
                if (isValidKpiPayload(rest)) {
                    state.kpis = rest;
                }
            })
            .addCase(fetchDashboardKPIs.rejected, (state, action) => {
                state.kpisLoading = false;
                // No error banner for aborts — these are intentional from timeframe switches
                if (!action.payload?.aborted) {
                    state.error = typeof action.payload === 'string'
                        ? action.payload
                        : action.payload?.message || 'Failed to fetch KPIs';
                }
            })

            .addCase(fetchRevenueTrends.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.revenueTrends = data;
                }
            })
            .addCase(fetchTopPerformers.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.topPerformers = data;
                }
            })
            .addCase(fetchDashboardAlerts.fulfilled, (state, action) => {
                state.alerts = action.payload.alerts || [];
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                if (!action.payload?.aborted) state.error = action.payload;
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
                state.loading          = false;
                state.customerOverview = { ...EMPTY_CUSTOMER_OVERVIEW };
                // Don't overwrite existing errors with abort noise
                if (!action.payload?.aborted) {
                    state.error = typeof action.payload === 'string'
                        ? action.payload
                        : action.payload?.message || 'Failed to fetch customer overview';
                }
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
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.channelPerformance = data;
                }
            })
            .addCase(fetchCampaignPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.campaignPerformance = data;
                }
            })
            .addCase(fetchDevicePerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.devicePerformance = data;
                }
            })
            .addCase(fetchBrowserPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.browserPerformance = data;
                }
            })
            .addCase(fetchReferrerPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.referrerPerformance = data;
                }
            })
            .addCase(fetchLandingPagePerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.landingPagePerformance = data;
                }
            })
            .addCase(fetchAttributionModels.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.attributionModels = data;
                }
            });

        // ============================================
        // CHECKOUT
        // ============================================
        builder
            .addCase(fetchCheckoutAbandonmentStats.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.checkoutAbandonment = data;
                }
            })
            .addCase(fetchAbandonedCheckouts.fulfilled, (state, action) => {
                state.abandonedCheckouts = action.payload;
            })
            .addCase(fetchRecoveryOpportunities.fulfilled, (state, action) => {
                state.recoveryOpportunities = action.payload;
            })

            .addCase(markRecoveryEmailSent.pending, (state, action) => {
                state.emailSendLoading[action.meta.arg] = true;
                delete state.emailSendError[action.meta.arg];
            })
            .addCase(markRecoveryEmailSent.fulfilled, (state, action) => {
                const { checkoutId, result } = action.payload;
                state.emailSendLoading[checkoutId] = false;
                state.emailSendResults[checkoutId] = result;
                state.success = true;
                state.message = `Recovery email #${result.attemptNumber} sent to ${result.recipient}`;

                const list = state.abandonedCheckouts?.abandonedCheckouts;
                if (Array.isArray(list)) {
                    const idx = list.findIndex(c => c._id === checkoutId);
                    if (idx !== -1) {
                        list[idx] = {
                            ...list[idx],
                            abandonment: {
                                ...list[idx].abandonment,
                                recoveryEmailSent:   true,
                                recoveryEmailSentAt: result.sentAt,
                                recoveryEmailCount:  result.attemptNumber,
                            }
                        };
                    }
                }
                const opps = state.recoveryOpportunities?.opportunities;
                if (Array.isArray(opps)) {
                    const idx = opps.findIndex(c => c._id === checkoutId);
                    if (idx !== -1) {
                        opps[idx] = {
                            ...opps[idx],
                            abandonment: {
                                ...opps[idx].abandonment,
                                recoveryEmailSent:   true,
                                recoveryEmailSentAt: result.sentAt,
                                recoveryEmailCount:  result.attemptNumber,
                            }
                        };
                    }
                }
            })
            .addCase(markRecoveryEmailSent.rejected, (state, action) => {
                // action.payload is always { checkoutId, message } — safe to destructure
                const { checkoutId, message } = action.payload;
                state.emailSendLoading[checkoutId] = false;
                state.emailSendError[checkoutId]   = message;
                state.error = message;
            });

        // ============================================
        // PRODUCTS
        // ============================================
        builder
            .addCase(fetchProductPerformanceOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.productPerformance = data;
                }
            })
            .addCase(fetchProductConversionMetrics.fulfilled, (state, action) => {
                state.productConversion = action.payload;
            })
            .addCase(fetchInventoryTurnover.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.inventoryTurnover = data;
                }
            })
            .addCase(fetchLowStockAlerts.fulfilled, (state, action) => {
                state.lowStockAlerts = action.payload;
            })
            .addCase(fetchCategoryPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.categoryPerformance = data;
                }
            })
            .addCase(fetchProductProfitMargins.fulfilled, (state, action) => {
                state.productProfitMargins = action.payload;
            })
            .addCase(fetchProductsBoughtTogether.fulfilled, (state, action) => {
                state.productsBoughtTogether = action.payload;
            });

        // ============================================
        // OPERATIONS
        // ============================================
        builder
            .addCase(fetchFulfillmentAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const fm = action.payload.fulfillmentMetrics || {};
                const dm = action.payload.deliveryMetrics    || {};
                const sb = action.payload.statusBreakdown    || {};
                state.fulfillmentAnalytics = {
                    onTimeRate:        action.payload.onTimeRate     ?? 0,
                    deliveredToday:    action.payload.deliveredToday  ?? 0,
                    avgProcessingTime: fm.avgFulfillmentHours         || 0,
                    avgShippingTime:   dm.avgDeliveryDays             || 0,
                    pendingShipments:  (sb.Processing || 0) + (sb.Shipped || 0),
                    _raw:              action.payload,
                };
            })

            .addCase(fetchSLABreaches.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const summary      = action.payload.summary  || {};
                const breachesList = action.payload.breaches || [];
                const complianceRate =
                    typeof summary.breachRate === 'number'
                        ? Math.round((100 - summary.breachRate) * 100) / 100
                        : 0;
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
                if (action.payload._timeframe !== state.activeTimeframe) return;
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
                    revenueSaved:  fraudPrev.totalValue          || 0,
                    pendingReview: action.payload.pendingReviews || 0,
                    _raw:          action.payload,
                };
            })

            .addCase(fetchShippingCarrierPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.shippingCarriers = data;
                }
            })
            .addCase(fetchShipmentTrackingAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.shipmentTracking = data;
                }
            })
            .addCase(fetchCancellationAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.cancellationAnalytics = data;
                }
            })
            .addCase(fetchHighRiskOrders.fulfilled, (state, action) => {
                state.highRiskOrders = action.payload;
            });

        // ============================================
        // RETURNS & REFUNDS
        // ============================================
        builder
            .addCase(fetchReturnOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.returnOverview = data;
                }
            })
            .addCase(fetchRefundOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.refundOverview = data;
                }
            })
            .addCase(fetchReturnsByProduct.fulfilled, (state, action) => {
                state.returnsByProduct = action.payload;
            })
            .addCase(fetchReturnsByCategory.fulfilled, (state, action) => {
                state.returnsByCategory = action.payload;
            })
            .addCase(fetchRefundsByPaymentMethod.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.refundsByPaymentMethod = data;
                }
            })
            .addCase(fetchRefundTimeline.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.refundTimeline = data;
                }
            });
    },
});

export const {
    removeErrors,
    removeSuccess,
    clearReport,
    setDashboardLoading,
    setActiveTimeframe,
} = analyticsSlice.actions;

export default analyticsSlice.reducer;