import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

//fetch all products - admin
export const fetchAdminProducts = createAsyncThunk('admin/fetchAdminProducts', async(_, {rejectWithValue}) => {
    try {
        const {data} = await axios.get('/api/v1/admin/products')
        console.log(data)
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data ||  'Failed to Fetch Products')
    }
})

//create products
export const createProduct = createAsyncThunk('admin/createProduct', async(productData, {rejectWithValue}) => {
    try {
        const config = {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        }

        const {data} = await axios.post('/api/v1/admin/product/create', productData, config)
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data ||  'Failed to Create Product')
    }
})

const adminSlice = createSlice({
    name: 'admin',
    initialState: {
        products: [],
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
        }
    },
    extraReducers: (builder) => {
        builder
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
            state.error = action.payload?.message || 'Failed to Fetch Products'
        })

        //create product cases
        builder
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
            state.error = action.payload?.message || 'Failed to Create Product'
        })
    }
})

export const {removeErrors, removeSuccess} = adminSlice.actions;
export default adminSlice.reducer;