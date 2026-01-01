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
            const { data } = await axios.post(
                '/api/v1/admin/products/create',
                productData
            );
            return data;
        } catch (error) {
            return rejectWithValue(
                error.response?.data || { message: 'Failed to Create Product' }
            );
        }
    }
);

// Update product
export const updateProduct = createAsyncThunk(
    'admin/updateProduct',
    async ({ id, productData }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(
                `/api/v1/admin/product/${id}`,
                productData
            );
            return data;
        } catch (error) {
            return rejectWithValue(
                error.response?.data || { message: 'Failed to Update Product' }
            );
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
            return rejectWithValue(
                error.response?.data?.message || 'Failed to Delete Product'
            );
        }
    }
);

// === USER MANAGEMENT ===

// Fetch all users - admin
export const fetchAllUsers = createAsyncThunk(
    'admin/fetchAllUsers',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/users');
            return data;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch users'
            );
        }
    }
);

// Get single user - admin
export const getSingleUser = createAsyncThunk(
    'admin/getSingleUser',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`/api/v1/admin/user/${id}`);
            return data.user;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch user'
            );
        }
    }
);

// Update user role - admin
export const updateUserRole = createAsyncThunk(
    'admin/updateUserRole',
    async ({ id, role }, { rejectWithValue }) => {
        try {
            const { data } = await axios.put(
                `/api/v1/admin/user/${id}`,
                { role }
            );
            return data.user;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to update user role'
            );
        }
    }
);

// Delete user - admin
export const deleteUser = createAsyncThunk(
    'admin/deleteUser',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.delete(`/api/v1/admin/user/${id}`);
            return { id, message: data.message };
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to delete user'
            );
        }
    }
);

// Fetch Admin Dashboard Stats ===
export const fetchAdminStats = createAsyncThunk(
    'admin/fetchAdminStats',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/stats');
            console.log(data, 'stats')
            return data; // Expected: { products, orders, revenue, users, outOfStock, inStock }
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch dashboard stats'
            );
        }
    }
);

// Fetch all orders - admin
export const fetchAllOrders = createAsyncThunk(
    'admin/fetchAllOrders',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.get('/api/v1/admin/orders');
            return data.orders;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch orders'
            );
        }
    }
);

// Get single order - admin
export const getSingleOrder = createAsyncThunk(
    'admin/getSingleOrder',
    async (id, { rejectWithValue }) => {
        try {
            const { data } = await axios.get(`/api/v1/admin/order/${id}`);
            return data.order;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch order'
            );
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
            inStock: 0
        },     
        currentUser: null,          
        success: false,
        loading: false,
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
                // Update in users list
                const index = state.users.findIndex(u => u._id === action.payload._id);
                if (index !== -1) state.users[index] = action.payload;
                // Update currentUser if viewing
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

            // === NEW: Admin Stats ===
            .addCase(fetchAdminStats.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAdminStats.fulfilled, (state, action) => {
                state.loading = false;
                state.stats = action.payload; // { products, orders, revenue, users, outOfStock, inStock }
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });
    }
});

export const { removeErrors, removeSuccess, clearCurrentUser } = adminSlice.actions;
export default adminSlice.reducer;