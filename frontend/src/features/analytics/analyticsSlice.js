// analyticsSlice.js - COMPLETE ANALYTICS MANAGEMENT FOR ADMIN
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

// ============================================
// BASIC ADMIN STATS (LEGACY)
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
// DASHBOARD ANALYTICS
// ============================================

/**
 * Get comprehensive dashboard overview
 * Aggregates all analytics in one endpoint
 */
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

/**
 * Get key performance indicators
 */
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

/**
 * Get revenue trends over time
 */
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

/**
 * Get top performers (products, customers, categories)
 */
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

/**
 * Get dashboard alerts and notifications
 */
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
// REPORTS GENERATION
// ============================================

/**
 * Generate business performance report
 */
export const generateBusinessReport = createAsyncThunk(
    'analytics/generateBusinessReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/business-performance?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate business report');
        }
    }
);

/**
 * Generate sales report
 */
export const generateSalesReport = createAsyncThunk(
    'analytics/generateSalesReport',
    async ({ timeframe, startDate, endDate, groupBy = 'day' }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
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

/**
 * Generate customer analytics report
 */
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

/**
 * Generate product performance report
 */
export const generateProductReport = createAsyncThunk(
    'analytics/generateProductReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/products?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate product report');
        }
    }
);

/**
 * Generate financial report
 */
export const generateFinancialReport = createAsyncThunk(
    'analytics/generateFinancialReport',
    async ({ timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/financial?${params.toString()}`
            );
            return data.report;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to generate financial report');
        }
    }
);

/**
 * Export report as CSV
 */
export const exportReportCSV = createAsyncThunk(
    'analytics/exportReportCSV',
    async ({ reportType, timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({ reportType });
            if (timeframe) params.append('timeframe', timeframe);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const response = await axios.get(
                `${API_BASE}/analytics/reports/export/csv?${params.toString()}`,
                { responseType: 'blob' }
            );

            // Create download link
            const blob = new Blob([response.data], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
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
// CUSTOMER ANALYTICS
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

// ============================================
// ATTRIBUTION ANALYTICS
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

// ============================================
// CHECKOUT ANALYTICS
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
                hours: hours.toString(),
                minValue: minValue.toString(),
                limit: limit.toString(),
                page: page.toString(),
                sortBy
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
// PRODUCT ANALYTICS
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

// ============================================
// OPERATIONAL ANALYTICS
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

// ============================================
// RETURNS & REFUNDS ANALYTICS
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

// ============================================
// SLICE DEFINITION
// ============================================

const analyticsSlice = createSlice({
    name: 'analytics',
    initialState: {
        // Basic Stats (Legacy)
        basicStats: {
            products: 0,
            orders: 0,
            revenue: 0,
            users: 0,
            outOfStock: 0,
            inStock: 0,
            adminCount: 0
        },
        basicAnalytics: {
            trends: {
                revenue: 0,
                orders: 0,
                users: 0,
                products: 0
            },
            orderStatusBreakdown: {},
            topProducts: [],
            recentOrders: [],
            currentPeriod: {},
            previousPeriod: {}
        },

        // Dashboard
        dashboardOverview: null,
        kpis: null,
        revenueTrends: null,
        topPerformers: null,
        alerts: [],

        // Reports
        currentReport: null,
        reportType: null,

        // Customer Analytics
        customerOverview: null,
        segmentDistribution: null,
        customersBySegment: [],
        highValueCustomers: [],
        atRiskCustomers: [],
        vipCustomers: [],

        // Attribution
        channelPerformance: null,
        campaignPerformance: null,
        devicePerformance: null,

        // Checkout
        checkoutAbandonment: null,
        abandonedCheckouts: [],
        recoveryOpportunities: [],

        // Products
        productPerformance: null,
        productConversion: null,
        inventoryTurnover: null,
        lowStockAlerts: null,
        categoryPerformance: null,

        // Operations
        fulfillmentAnalytics: null,
        slaBreaches: null,
        fraudAnalytics: null,

        // Returns & Refunds
        returnOverview: null,
        refundOverview: null,
        returnsByProduct: [],

        // UI States
        loading: false,
        dashboardLoading: false,
        reportLoading: false,
        error: null,
        success: false,
        message: null,
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
            state.reportType = null;
        },
        setDashboardLoading: (state, action) => {
            state.dashboardLoading = action.payload;
        }
    },
    extraReducers: (builder) => {
        // ============================================
        // BASIC STATS (LEGACY)
        // ============================================
        builder
            .addCase(fetchAdminStats.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAdminStats.fulfilled, (state, action) => {
                state.loading = false;
                state.basicStats = action.payload;
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(fetchBasicAnalytics.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchBasicAnalytics.fulfilled, (state, action) => {
                state.loading = false;
                state.basicAnalytics = action.payload;
            })
            .addCase(fetchBasicAnalytics.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });

        // ============================================
        // DASHBOARD
        // ============================================
        builder
            .addCase(fetchDashboardOverview.pending, (state) => {
                state.dashboardLoading = true;
                state.error = null;
            })
            .addCase(fetchDashboardOverview.fulfilled, (state, action) => {
                state.dashboardLoading = false;
                state.dashboardOverview = action.payload;
            })
            .addCase(fetchDashboardOverview.rejected, (state, action) => {
                state.dashboardLoading = false;
                state.error = action.payload;
            })

            .addCase(fetchDashboardKPIs.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDashboardKPIs.fulfilled, (state, action) => {
                state.loading = false;
                state.kpis = action.payload.kpis;
            })
            .addCase(fetchDashboardKPIs.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(fetchRevenueTrends.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchRevenueTrends.fulfilled, (state, action) => {
                state.loading = false;
                state.revenueTrends = action.payload;
            })
            .addCase(fetchRevenueTrends.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(fetchTopPerformers.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchTopPerformers.fulfilled, (state, action) => {
                state.loading = false;
                state.topPerformers = action.payload;
            })
            .addCase(fetchTopPerformers.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(fetchDashboardAlerts.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDashboardAlerts.fulfilled, (state, action) => {
                state.loading = false;
                state.alerts = action.payload.alerts;
            })
            .addCase(fetchDashboardAlerts.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });

        // ============================================
        // REPORTS
        // ============================================
        builder
            .addCase(generateBusinessReport.pending, (state) => {
                state.reportLoading = true;
                state.error = null;
            })
            .addCase(generateBusinessReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType = 'business';
            })
            .addCase(generateBusinessReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error = action.payload;
            })

            .addCase(generateSalesReport.pending, (state) => {
                state.reportLoading = true;
                state.error = null;
            })
            .addCase(generateSalesReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType = 'sales';
            })
            .addCase(generateSalesReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error = action.payload;
            })

            .addCase(generateCustomerReport.pending, (state) => {
                state.reportLoading = true;
                state.error = null;
            })
            .addCase(generateCustomerReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType = 'customer';
            })
            .addCase(generateCustomerReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error = action.payload;
            })

            .addCase(generateProductReport.pending, (state) => {
                state.reportLoading = true;
                state.error = null;
            })
            .addCase(generateProductReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType = 'product';
            })
            .addCase(generateProductReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error = action.payload;
            })

            .addCase(generateFinancialReport.pending, (state) => {
                state.reportLoading = true;
                state.error = null;
            })
            .addCase(generateFinancialReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType = 'financial';
            })
            .addCase(generateFinancialReport.rejected, (state, action) => {
                state.reportLoading = false;
                state.error = action.payload;
            })

            .addCase(exportReportCSV.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(exportReportCSV.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.message = action.payload.message;
            })
            .addCase(exportReportCSV.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });

        // ============================================
        // CUSTOMER ANALYTICS
        // ============================================
        builder
            .addCase(fetchCustomerOverview.fulfilled, (state, action) => {
                state.customerOverview = action.payload;
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
            });

        // ============================================
        // OPERATIONS
        // ============================================
        builder
            .addCase(fetchFulfillmentAnalytics.fulfilled, (state, action) => {
                state.fulfillmentAnalytics = action.payload;
            })
            .addCase(fetchSLABreaches.fulfilled, (state, action) => {
                state.slaBreaches = action.payload;
            })
            .addCase(fetchFraudAnalytics.fulfilled, (state, action) => {
                state.fraudAnalytics = action.payload;
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
            });
    }
});

export const { 
    removeErrors, 
    removeSuccess, 
    clearReport,
    setDashboardLoading 
} = analyticsSlice.actions;

export default analyticsSlice.reducer;