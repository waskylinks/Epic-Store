import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// Fetch all products - admin
export const fetchAdminProducts = createAsyncThunk(
    'admin/fetchAdminProducts',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/products');
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data || 'Failed to Fetch Products');
        }
    }
);

// Create product
export const createProduct = createAsyncThunk(
    'admin/createProduct',
    async (productData, { rejectWithValue }) => {
        try {
            const { data } = await axios.post('/api/v1/admin/products/create', productData);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data || { message: 'Failed to Create Product' });
        }
    }
);

// Update product
export const updateProduct = createAsyncThunk(
    'admin/updateProduct',
    async ({ id, productData }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(`/api/v1/admin/product/${id}`, productData);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data || { message: 'Failed to Update Product' });
        }
    }
);

// Delete product
export const deleteProduct = createAsyncThunk(
    'admin/deleteProduct',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.delete(`/api/v1/admin/product/${id}`);
            return { id, message: data.message };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to Delete Product');
        }
    }
);

// === USER MANAGEMENT ===

export const fetchAllUsers = createAsyncThunk(
    'admin/fetchAllUsers',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/users');
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch users');
        }
    }
);

export const getSingleUser = createAsyncThunk(
    'admin/getSingleUser',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`/api/v1/admin/user/${id}`);
            return data.user;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch user');
        }
    }
);

export const updateUserRole = createAsyncThunk(
    'admin/updateUserRole',
    async ({ id, role }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(`/api/v1/admin/user/${id}`, { role });
            return data.user;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to update user role');
        }
    }
);

export const deleteUser = createAsyncThunk(
    'admin/deleteUser',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.delete(`/api/v1/admin/user/${id}`);
            return { id, message: data.message };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to delete user');
        }
    }
);

// === DASHBOARD STATS & ANALYTICS ===

export const fetchAdminStats = createAsyncThunk(
    'admin/fetchAdminStats',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/stats');
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard stats');
        }
    }
);

export const fetchAnalytics = createAsyncThunk(
    'admin/fetchAnalytics',
    async (timeframe = 'month', { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`/api/v1/admin/analytics?timeframe=${timeframe}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch analytics');
        }
    }
);

// === ORDER MANAGEMENT ===

export const fetchAllOrders = createAsyncThunk(
    'admin/fetchAllOrders',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/orders');
            return data.orders;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch orders');
        }
    }
);

export const getSingleOrder = createAsyncThunk(
    'admin/getSingleOrder',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`/api/v1/admin/order/${id}`);
            return data.order;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch order');
        }
    }
);

export const updateOrder = createAsyncThunk(
    'admin/updateOrder',
    async ({ id, status }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(`/api/v1/admin/order/${id}`, { status });
            return data.order;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to update order');
        }
    }
);

export const deleteOrder = createAsyncThunk(
    'admin/deleteOrder',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.delete(`/api/v1/admin/order/${id}`);
            return { id, message: data.message };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to delete order');
        }
    }
);

export const cancelOrder = createAsyncThunk(
    'admin/cancelOrder',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(`/api/v1/admin/order/${id}`, { status: 'Cancelled' });
            return data.order;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to cancel order');
        }
    }
);

// === REVIEW MANAGEMENT ===

export const fetchAllReviews = createAsyncThunk(
    'admin/fetchAllReviews',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/products');
            
            const allReviews = [];
            data.products.forEach(product => {
                if (product.reviews && product.reviews.length > 0) {
                    product.reviews.forEach(review => {
                        allReviews.push({
                            ...review,
                            productId: product._id,
                            productName: product.name,
                            productImage: product.images?.[0]?.url || ''
                        });
                    });
                }
            });
            
            return allReviews;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch reviews');
        }
    }
);

export const deleteReview = createAsyncThunk(
    'admin/deleteReview',
    async ({ reviewId, productId }, { rejectWithValue }) => {
        try {
            const { data } = await axios.delete(`/api/v1/reviews?id=${reviewId}&productID=${productId}`);
            return { reviewId, productId, message: data.message };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to delete review');
        }
    }
);

// === REFUND MANAGEMENT ===

export const fetchAllRefunds = createAsyncThunk(
    'admin/fetchAllRefunds',
    async (filters = {}, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams(filters).toString();
            const { data } = await axios.get(
                `/api/v1/admin/refunds${params ? `?${params}` : ''}`
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch refunds');
        }
    }
);

export const reviewRefundRequest = createAsyncThunk(
    'admin/reviewRefund',
    async ({ orderId, action, adminNote }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(
                `/api/v1/admin/orders/${orderId}/refund/review`,
                { action, adminNote }
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to review refund');
        }
    }
);

export const processRefundPayment = createAsyncThunk(
    'admin/processRefund',
    async ({ orderId, refundAmount, merchantNote }, { rejectWithValue }) => {
        try {
            const { data } = await axios.post(
                `/api/v1/admin/orders/${orderId}/refund/process`,
                { refundAmount, merchantNote }
            );
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to process refund');
        }
    }
);


const adminSlice = createSlice({
    name: 'admin',
    initialState: {
        products: [],
        users: [],  
        stats: {              
            products: 0,
            orders: 0,
            revenue: 0,
            users: 0,
            outOfStock: 0,
            inStock: 0,
            adminCount: 0
        },
        analytics: {
            trends: {
                revenue: 0,
                orders: 0,
                users: 0,
                products: 0
            },
            orderStatusBreakdown: {
                processing: 0,
                shipped: 0,
                delivered: 0,
                cancelled: 0
            },
            topProducts: [],
            recentOrders: [],
            currentPeriod: {
                orders: 0,
                revenue: 0,
                users: 0,
                products: 0
            },
            previousPeriod: {
                orders: 0,
                revenue: 0,
                users: 0,
                products: 0
            }
        },
        currentUser: null, 
        orders: [],  
        currentOrder: null,    
        reviews: [],
        refunds: [], 
        refundStats: null, 
        success: false,
        loading: false,
        analyticsLoading: false,
        error: null
    },
    reducers: {
        removeErrors: (state) => {
            state.error = null;
        },
        removeSuccess: (state) => {
            state.success = false;
        },
        clearCurrentUser: (state) => {
            state.currentUser = null;
        },
        clearCurrentOrder: (state) => {
            state.currentOrder = null;
        }
    },
    extraReducers: (builder) => {
        builder
            // Products
            .addCase(fetchAdminProducts.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAdminProducts.fulfilled, (state, action) => {
                state.loading = false;
                state.products = action.payload.products;
            })
            .addCase(fetchAdminProducts.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Failed to Fetch Products';
            })

            .addCase(createProduct.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(createProduct.fulfilled, (state, action) => {
                state.loading = false;
                state.success = action.payload.success;
                state.products.push(action.payload.product);
            })
            .addCase(createProduct.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Failed to Create Product';
            })

            .addCase(updateProduct.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updateProduct.fulfilled, (state, action) => {
                state.loading = false;
                state.success = action.payload.success;
                const index = state.products.findIndex(p => p._id === action.payload.product._id);
                if (index !== -1) state.products[index] = action.payload.product;
            })
            .addCase(updateProduct.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Failed to Update Product';
            })

            .addCase(deleteProduct.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteProduct.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.products = state.products.filter(p => p._id !== action.payload.id);
            })
            .addCase(deleteProduct.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || 'Failed to Delete Product';
            })

            // Users
            .addCase(fetchAllUsers.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAllUsers.fulfilled, (state, action) => {
                state.loading = false;
                state.users = action.payload.users;
            })
            .addCase(fetchAllUsers.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(getSingleUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getSingleUser.fulfilled, (state, action) => {
                state.loading = false;
                state.currentUser = action.payload;
            })
            .addCase(getSingleUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(updateUserRole.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updateUserRole.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                const index = state.users.findIndex(u => u._id === action.payload._id);
                if (index !== -1) state.users[index] = action.payload;
                if (state.currentUser?._id === action.payload._id) {
                    state.currentUser = action.payload;
                }
            })
            .addCase(updateUserRole.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(deleteUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteUser.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.users = state.users.filter(u => u._id !== action.payload.id);
            })
            .addCase(deleteUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            // Admin Stats 
            .addCase(fetchAdminStats.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAdminStats.fulfilled, (state, action) => {
                state.loading = false;
                state.stats = action.payload; 
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            // Analytics
            .addCase(fetchAnalytics.pending, (state) => {
                state.analyticsLoading = true;
                state.error = null;
            })
            .addCase(fetchAnalytics.fulfilled, (state, action) => {
                state.analyticsLoading = false;
                state.analytics = action.payload;
            })
            .addCase(fetchAnalytics.rejected, (state, action) => {
                state.analyticsLoading = false;
                state.error = action.payload;
            })

            // Orders
            .addCase(fetchAllOrders.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAllOrders.fulfilled, (state, action) => {
                state.loading = false;
                state.orders = action.payload;
            })
            .addCase(fetchAllOrders.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(getSingleOrder.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getSingleOrder.fulfilled, (state, action) => {
                state.loading = false;
                state.currentOrder = action.payload;
            })
            .addCase(getSingleOrder.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(updateOrder.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updateOrder.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                const index = state.orders.findIndex(o => o._id === action.payload._id);
                if (index !== -1) state.orders[index] = action.payload;
                if (state.currentOrder?._id === action.payload._id) {
                    state.currentOrder = action.payload;
                }
            })
            .addCase(updateOrder.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(deleteOrder.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteOrder.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.orders = state.orders.filter(o => o._id !== action.payload.id);
            })
            .addCase(deleteOrder.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(cancelOrder.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(cancelOrder.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                const index = state.orders.findIndex(o => o._id === action.payload._id);
                if (index !== -1) state.orders[index] = action.payload;
                if (state.currentOrder?._id === action.payload._id) {
                    state.currentOrder = action.payload;
                }
            })
            .addCase(cancelOrder.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            // Reviews
            .addCase(fetchAllReviews.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAllReviews.fulfilled, (state, action) => {
                state.loading = false;
                state.reviews = action.payload;
            })
            .addCase(fetchAllReviews.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(deleteReview.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteReview.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.reviews = state.reviews.filter(
                    review => review._id.toString() !== action.payload.reviewId.toString()
                );
            })
            .addCase(deleteReview.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            // Refunds
            .addCase(fetchAllRefunds.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAllRefunds.fulfilled, (state, action) => {
                state.loading = false;
                state.refunds = action.payload.orders;
                state.refundStats = action.payload.stats;
            })
            .addCase(fetchAllRefunds.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(reviewRefundRequest.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(reviewRefundRequest.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                // Update the refund in the list
                const index = state.refunds.findIndex(r => r._id === action.payload.order._id);
                if (index !== -1) state.refunds[index] = action.payload.order;
            })
            .addCase(reviewRefundRequest.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            .addCase(processRefundPayment.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(processRefundPayment.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                // Update the refund in the list
                const index = state.refunds.findIndex(r => r._id === action.payload.order._id);
                if (index !== -1) state.refunds[index] = action.payload.order;
            })
            .addCase(processRefundPayment.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });

    }
});

export const { removeErrors, removeSuccess, clearCurrentUser, clearCurrentOrder } = adminSlice.actions;
export default adminSlice.reducer;