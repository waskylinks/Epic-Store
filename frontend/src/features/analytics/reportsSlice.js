// reportsSlice.js
// Business, sales, customer, product, and financial report generation.
// CSV export with automatic browser download trigger.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// ============================================
// THUNKS
// ============================================

export const generateBusinessReport = createAsyncThunk(
    "reports/generateBusinessReport",
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append("timeframe", timeframe);
            if (startDate) params.append("startDate", startDate);
            if (endDate)   params.append("endDate", endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/business-performance?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to generate business report"
            );
        }
    }
);

export const generateSalesReport = createAsyncThunk(
    "reports/generateSalesReport",
    async (
        { timeframe, startDate, endDate, groupBy = "day" },
        { rejectWithValue, signal }
    ) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append("timeframe", timeframe);
            if (startDate) params.append("startDate", startDate);
            if (endDate)   params.append("endDate", endDate);
            params.append("groupBy", groupBy);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/sales?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to generate sales report"
            );
        }
    }
);

export const generateCustomerReport = createAsyncThunk(
    "reports/generateCustomerReport",
    async (includeDetails = false, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/customers?includeDetails=${includeDetails}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to generate customer report"
            );
        }
    }
);

export const generateProductReport = createAsyncThunk(
    "reports/generateProductReport",
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append("timeframe", timeframe);
            if (startDate) params.append("startDate", startDate);
            if (endDate)   params.append("endDate", endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/products?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to generate product report"
            );
        }
    }
);

export const generateFinancialReport = createAsyncThunk(
    "reports/generateFinancialReport",
    async ({ timeframe, startDate, endDate }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams();
            if (timeframe) params.append("timeframe", timeframe);
            if (startDate) params.append("startDate", startDate);
            if (endDate)   params.append("endDate", endDate);
            const { data } = await axios.get(
                `${API_BASE}/analytics/reports/financial?${params.toString()}`,
                { signal }
            );
            return data.report;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to generate financial report"
            );
        }
    }
);

export const exportReportCSV = createAsyncThunk(
    "reports/exportReportCSV",
    async ({ reportType, timeframe, startDate, endDate }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({ reportType });
            if (timeframe) params.append("timeframe", timeframe);
            if (startDate) params.append("startDate", startDate);
            if (endDate)   params.append("endDate", endDate);

            const response = await axios.get(
                `${API_BASE}/analytics/reports/export/csv?${params.toString()}`,
                { responseType: "blob" }
            );

            const blob = new Blob([response.data], { type: "text/csv" });
            const url  = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href     = url;
            link.download = `${reportType}-report-${new Date().toISOString().split("T")[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            return { success: true, message: "Report downloaded successfully" };
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || "Failed to export report"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const reportsSlice = createSlice({
    name: "reports",
    initialState: {
        currentReport: null,
        reportType:    null,
        reportLoading: false,
        loading:       false,
        error:         null,
        success:       false,
        message:       null,
    },
    reducers: {
        clearReport: (state) => {
            state.currentReport = null;
            state.reportType    = null;
        },
        removeReportError: (state) => {
            state.error = null;
        },
        removeReportSuccess: (state) => {
            state.success = false;
            state.message = null;
        },
    },
    extraReducers: (builder) => {
        // ── generateBusinessReport ───────────────────────────────────────────
        builder
            .addCase(generateBusinessReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateBusinessReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = "business";
            })
            .addCase(generateBusinessReport.rejected, (state, action) => {
                state.reportLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── generateSalesReport ──────────────────────────────────────────────
        builder
            .addCase(generateSalesReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateSalesReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = "sales";
            })
            .addCase(generateSalesReport.rejected, (state, action) => {
                state.reportLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── generateCustomerReport ───────────────────────────────────────────
        builder
            .addCase(generateCustomerReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateCustomerReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = "customer";
            })
            .addCase(generateCustomerReport.rejected, (state, action) => {
                state.reportLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── generateProductReport ────────────────────────────────────────────
        builder
            .addCase(generateProductReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateProductReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = "product";
            })
            .addCase(generateProductReport.rejected, (state, action) => {
                state.reportLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── generateFinancialReport ──────────────────────────────────────────
        builder
            .addCase(generateFinancialReport.pending, (state) => {
                state.reportLoading = true;
                state.error         = null;
            })
            .addCase(generateFinancialReport.fulfilled, (state, action) => {
                state.reportLoading = false;
                state.currentReport = action.payload;
                state.reportType    = "financial";
            })
            .addCase(generateFinancialReport.rejected, (state, action) => {
                state.reportLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── exportReportCSV ──────────────────────────────────────────────────
        builder
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
    },
});

export const {
    clearReport,
    removeReportError,
    removeReportSuccess,
} = reportsSlice.actions;

export default reportsSlice.reducer;