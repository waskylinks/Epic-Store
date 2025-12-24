import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

//fetch all products
export const fetchAdminProducts = createAsyncThunk('admin/fetchAdminProducts', async(_, {rejectWithValue}) => {
    try {
        const {data} = await axios.get('/api/v1/admin/products')
        console.log(data)
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data ||  'Failed to Fetch Products')
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
    }
})

export const {removeErrors, removeSuccess} = adminSlice.actions;
export default adminSlice.reducer;