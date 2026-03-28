

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError"   ||
    error?.name === "CanceledError";

// ============================================
// THUNKS — CHECKOUT
// ============================================

export const fetchCheckoutAbandonmentStats = createAsyncThunk(
    "operations/fetchCheckoutAbandonmentStats",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandonment?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch abandonment stats"
            );
        }
    }
);

export const fetchAbandonedCheckouts = createAsyncThunk(
    "operations/fetchAbandonedCheckouts",
    async (
        {
            hours    = 24,
            minValue = 0,
            limit    = 50,
            page     = 1,
            sortBy   = "priority",
            // FIX: reAbandoned filter param added so admins can isolate
            // carts that went through a failed recovery cycle.
            reAbandoned,
        },
        { rejectWithValue, signal }
    ) => {
        try {
            const params = new URLSearchParams({
                hours:    hours.toString(),
                minValue: minValue.toString(),
                limit:    limit.toString(),
                page:     page.toString(),
                sortBy,
            });
            if (reAbandoned !== undefined && reAbandoned !== null) {
                params.append('reAbandoned', reAbandoned.toString());
            }

            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/abandoned-list?${params.toString()}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch abandoned checkouts"
            );
        }
    }
);

export const fetchRecoveryOpportunities = createAsyncThunk(
    "operations/fetchRecoveryOpportunities",
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/checkout/recovery-opportunities?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch recovery opportunities"
            );
        }
    }
);

export const markRecoveryEmailSent = createAsyncThunk(
    "operations/markRecoveryEmailSent",
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
                message:
                    error.response?.data?.message || "Failed to send recovery email",
            });
        }
    }
);

// ============================================
// THUNKS — PRODUCTS
// ============================================

export const fetchProductPerformanceOverview = createAsyncThunk(
    "operations/fetchProductPerformanceOverview",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch product performance"
            );
        }
    }
);

export const fetchProductConversionMetrics = createAsyncThunk(
    "operations/fetchProductConversionMetrics",
    async ({ limit = 20, sortBy = "conversionRate" }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/conversion?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch conversion metrics"
            );
        }
    }
);

export const fetchInventoryTurnover = createAsyncThunk(
    "operations/fetchInventoryTurnover",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/inventory-turnover?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch inventory turnover"
            );
        }
    }
);

export const fetchLowStockAlerts = createAsyncThunk(
    "operations/fetchLowStockAlerts",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/low-stock-alerts`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch low stock alerts"
            );
        }
    }
);

export const fetchCategoryPerformance = createAsyncThunk(
    "operations/fetchCategoryPerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/category-performance?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch category performance"
            );
        }
    }
);

export const fetchProductProfitMargins = createAsyncThunk(
    "operations/fetchProductProfitMargins",
    async ({ limit = 20, sortBy = "margin" }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/profit-margins?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch profit margins"
            );
        }
    }
);

export const fetchProductsBoughtTogether = createAsyncThunk(
    "operations/fetchProductsBoughtTogether",
    async ({ productId, limit = 10 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/products/bought-together?productId=${productId}&limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch products bought together"
            );
        }
    }
);

// ============================================
// THUNKS — FULFILLMENT & OPERATIONS
// ============================================

export const fetchFulfillmentAnalytics = createAsyncThunk(
    "operations/fetchFulfillmentAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fulfillment?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch fulfillment analytics"
            );
        }
    }
);

export const fetchSLABreaches = createAsyncThunk(
    "operations/fetchSLABreaches",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/sla-breaches?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch SLA breaches"
            );
        }
    }
);

export const fetchFraudAnalytics = createAsyncThunk(
    "operations/fetchFraudAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/fraud?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch fraud analytics"
            );
        }
    }
);

export const fetchShippingCarrierPerformance = createAsyncThunk(
    "operations/fetchShippingCarrierPerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipping-carriers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch shipping carriers"
            );
        }
    }
);

export const fetchShipmentTrackingAnalytics = createAsyncThunk(
    "operations/fetchShipmentTrackingAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/shipment-tracking?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch shipment tracking"
            );
        }
    }
);

export const fetchCancellationAnalytics = createAsyncThunk(
    "operations/fetchCancellationAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/cancellations?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch cancellations"
            );
        }
    }
);

export const fetchHighRiskOrders = createAsyncThunk(
    "operations/fetchHighRiskOrders",
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/operations/high-risk-orders?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch high risk orders"
            );
        }
    }
);

// ============================================
// THUNKS — REFUNDS
// ============================================

export const fetchRefundOverview = createAsyncThunk(
    "operations/fetchRefundOverview",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch refund overview"
            );
        }
    }
);

export const fetchRefundsByPaymentMethod = createAsyncThunk(
    "operations/fetchRefundsByPaymentMethod",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/by-payment-method?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch refunds by payment method"
            );
        }
    }
);

export const fetchRefundTimeline = createAsyncThunk(
    "operations/fetchRefundTimeline",
    async ({ timeframe = "month", groupBy = "day" }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/timeline?timeframe=${timeframe}&groupBy=${groupBy}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch refund timeline"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const operationsSlice = createSlice({
    name: "operations",
    initialState: {
        activeTimeframe: "month",

        // Checkout
        checkoutAbandonment:   null,
        abandonedCheckouts:    [],
        recoveryOpportunities: [],
        emailSendLoading:      {},
        emailSendResults:      {},
        emailSendError:        {},
        reAbandonedCount:    0,
        failedRecoveriesCount: 0,

        // Products
        productPerformance:     null,
        productConversion:      null,
        inventoryTurnover:      null,
        lowStockAlerts:         null,
        categoryPerformance:    null,
        productProfitMargins:   null,
        productsBoughtTogether: null,

        // Fulfillment & operations
        fulfillmentAnalytics:  null,
        slaBreaches:           null,
        fraudAnalytics:        null,
        shippingCarriers:      null,
        shipmentTracking:      null,
        cancellationAnalytics: null,
        highRiskOrders:        null,

        // Refunds only — returns lives in returnAnalyticsSlice
        refundOverview:         null,
        refundsByPaymentMethod: null,
        refundTimeline:         null,

        // Shared UI
        success: false,
        message: null,
        error:   null,
    },
    reducers: {
        setOperationsTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
        },
        clearOperationsError: (state) => {
            state.error = null;
        },
        removeOperationsSuccess: (state) => {
            state.success = false;
            state.message = null;
        },
    },
    extraReducers: (builder) => {

        // ── CHECKOUT ─────────────────────────────────────────────────────────
        builder
            .addCase(fetchCheckoutAbandonmentStats.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.checkoutAbandonment = data;

                    // FIX: surface reAbandoned and failedRecoveries counts if
                    // the backend returns them so downstream components and
                    // filters have them available in state.
                    if (typeof data.failedRecoveriesCount === 'number') {
                        state.failedRecoveriesCount = data.failedRecoveriesCount;
                    }
                }
            })
            .addCase(fetchCheckoutAbandonmentStats.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchAbandonedCheckouts.fulfilled, (state, action) => {
                state.abandonedCheckouts = action.payload;

                // FIX: capture reAbandoned segment count if returned by backend
                // so the filter badge and KPI strip can display it.
                if (typeof action.payload.reAbandonedCount === 'number') {
                    state.reAbandonedCount = action.payload.reAbandonedCount;
                }
            })
            .addCase(fetchAbandonedCheckouts.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRecoveryOpportunities.fulfilled, (state, action) => {
                state.recoveryOpportunities = action.payload;
            })
            .addCase(fetchRecoveryOpportunities.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // markRecoveryEmailSent — keyed loading/error per checkoutId so
            // individual rows show their own spinner without blocking the list.
            .addCase(markRecoveryEmailSent.pending, (state, action) => {
                const checkoutId = action.meta.arg;
                state.emailSendLoading[checkoutId] = true;
                delete state.emailSendError[checkoutId];
            })

            .addCase(markRecoveryEmailSent.fulfilled, (state, action) => {
                const { checkoutId, result } = action.payload;
                if (!checkoutId || !result) return;          // ← ADD: guard against malformed payload

                state.emailSendLoading[checkoutId] = false;
                state.emailSendResults[checkoutId] = result;
                state.success = true;
                state.message = `Recovery email #${result.attemptNumber} sent to ${result.recipient}`;

                const patch = {
                    recoveryEmailSent:   true,
                    recoveryEmailSentAt: result.sentAt,
                    recoveryEmailCount:  result.attemptNumber,
                    pendingEmailAck:     false,              // ← ADD: mirror the ack clear
                };

                const list = state.abandonedCheckouts?.abandonedCheckouts;
                if (Array.isArray(list)) {
                    const idx = list.findIndex((c) => c._id === checkoutId);
                    if (idx !== -1) {
                        list[idx] = {
                            ...list[idx],
                            abandonment: { ...list[idx].abandonment, ...patch },
                        };
                    }
                }

                const opps = state.recoveryOpportunities?.opportunities;
                if (Array.isArray(opps)) {
                    const idx = opps.findIndex((c) => c._id === checkoutId);
                    if (idx !== -1) {
                        opps[idx] = {
                            ...opps[idx],
                            abandonment: { ...opps[idx].abandonment, ...patch },
                        };
                    }
                }
            })
            .addCase(markRecoveryEmailSent.rejected, (state, action) => {
                const { checkoutId, message } = action.payload;
                state.emailSendLoading[checkoutId] = false;
                state.emailSendError[checkoutId]   = message;
                state.error = message;
            });

        // ── PRODUCTS ─────────────────────────────────────────────────────────
        builder
            .addCase(fetchProductPerformanceOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.productPerformance = data;
                }
            })
            .addCase(fetchProductPerformanceOverview.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchProductConversionMetrics.fulfilled, (state, action) => {
                state.productConversion = action.payload;
            })
            .addCase(fetchProductConversionMetrics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchInventoryTurnover.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.inventoryTurnover = data;
                }
            })
            .addCase(fetchInventoryTurnover.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchLowStockAlerts.fulfilled, (state, action) => {
                state.lowStockAlerts = action.payload;
            })
            .addCase(fetchLowStockAlerts.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCategoryPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.categoryPerformance = data;
                }
            })
            .addCase(fetchCategoryPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchProductProfitMargins.fulfilled, (state, action) => {
                state.productProfitMargins = action.payload;
            })
            .addCase(fetchProductProfitMargins.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchProductsBoughtTogether.fulfilled, (state, action) => {
                state.productsBoughtTogether = action.payload;
            })
            .addCase(fetchProductsBoughtTogether.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── FULFILLMENT & OPERATIONS ──────────────────────────────────────────
        builder
            .addCase(fetchFulfillmentAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
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
            .addCase(fetchFulfillmentAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchSLABreaches.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const summary      = action.payload.summary  || {};
                const breachesList = action.payload.breaches || [];
                const complianceRate =
                    typeof summary.breachRate === "number"
                        ? Math.round((100 - summary.breachRate) * 100) / 100
                        : 0;
                const criticalBreaches =
                    typeof summary.criticalBreaches === "number"
                        ? summary.criticalBreaches
                        : breachesList.filter(
                              (b) => (b.fulfillmentSLA?.delayInDays || 0) >= 2
                          ).length;
                state.slaBreaches = {
                    complianceRate,
                    totalBreaches:     summary.breachedOrders || 0,
                    criticalBreaches,
                    avgResolutionTime:
                        typeof summary.avgDelayDays === "number"
                            ? Math.round(summary.avgDelayDays * 24 * 100) / 100
                            : 0,
                    _raw: action.payload,
                };
            })
            .addCase(fetchSLABreaches.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchFraudAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const riskDist   = action.payload.riskDistribution || [];
                const reviewDecs = action.payload.reviewDecisions  || [];
                const fraudPrev  = action.payload.fraudPrevention  || {};
                const totalRiskOrders = riskDist.reduce(
                    (sum, r) => sum + (r.count || 0),
                    0
                );
                const flaggedOrders = riskDist
                    .filter((r) => r._id === "high" || r._id === "critical")
                    .reduce((sum, r) => sum + (r.count || 0), 0);
                const fraudRate =
                    totalRiskOrders > 0
                        ? Math.round(
                              (flaggedOrders / totalRiskOrders) * 100 * 100
                          ) / 100
                        : 0;
                const rejectedEntry  = reviewDecs.find((d) => d._id === "Rejected");
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
            .addCase(fetchFraudAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchShippingCarrierPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.shippingCarriers = data;
                }
            })
            .addCase(fetchShippingCarrierPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchShipmentTrackingAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.shipmentTracking = data;
                }
            })
            .addCase(fetchShipmentTrackingAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCancellationAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.cancellationAnalytics = data;
                }
            })
            .addCase(fetchCancellationAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchHighRiskOrders.fulfilled, (state, action) => {
                state.highRiskOrders = action.payload;
            })
            .addCase(fetchHighRiskOrders.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── REFUNDS ──────────────────────────────────────────────────────────
        // Returns analytics has been moved to returnAnalyticsSlice.js
        builder
            .addCase(fetchRefundOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { trends } = action.payload;
                state.refundOverview = {
                    totalRefunds:      action.payload.totalRefunds      || 0,
                    refundRate:        action.payload.refundRate        || 0,
                    pending:           action.payload.pending           || 0,
                    totalAmount:       action.payload.totalAmount       || 0,
                    avgAmount:         action.payload.avgAmount         || 0,
                    avgProcessingTime: action.payload.avgProcessingTime || 0,
                    trends,
                    statusBreakdown:   action.payload.statusBreakdown   || [],
                };
            })
            .addCase(fetchRefundOverview.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRefundsByPaymentMethod.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.refundsByPaymentMethod = data;
                }
            })
            .addCase(fetchRefundsByPaymentMethod.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRefundTimeline.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.refundTimeline = data;
                }
            })
            .addCase(fetchRefundTimeline.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const {
    setOperationsTimeframe,
    clearOperationsError,
    removeOperationsSuccess,
} = operationsSlice.actions;

export default operationsSlice.reducer;