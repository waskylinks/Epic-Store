import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import axios from 'axios';

// all products
export const getProduct = createAsyncThunk('product/getProduct', async({keyword, page=1, category}, {rejectWithValue}) => {
    try{
        
        let link = '/api/v1/products?page=' + page;
        if(category) {
            link += `&category=${category}`;
        }
        if(keyword) {
            link += `&keyword=${keyword}`;
        }
        // const link = keyword?`/api/v1/products?keyword=${encodeURIComponent(keyword)}&page=${page}` :
        // `/api/v1/products?page=${page}`
        const {data} = await axios.get(link)
        return data;

    } catch (error){
        return rejectWithValue(error.response?.data || `An error occurred`)
    }
})

// product details
export const getProductDetails = createAsyncThunk('product/getProductDetails', async(id, {rejectWithValue}) => {
    try{
        
        const link = `/api/v1/product/${id}`;
        const {data} = await axios.get(link);
        return data;

    } catch (error){
        return rejectWithValue(error.response?.data || `An error occurred`);
    }
})

//submit review
export const createReviews = createAsyncThunk('product/createReviews', async({rating, comment, productId}, {rejectWithValue}) => {
    try{

        const config = {
            headers: {
                'Content-Type' : 'application/json'
            }
        }
        const link = `/api/v1/review`;
        const {data} = await axios.put(link, {rating, comment, productId}, config);
        return data;

    } catch (error){
        return rejectWithValue(error.response?.data || 'Unable to create review. Please try again');
    }
})

const productSlice = createSlice({
    name: 'product',
    initialState: {
        products: [],
        productCount: 0,
        loading: false,
        error: null,
        product: null,
        resultsPerPage: 0,
        totalPages: 0,
        reviewSuccess: false,
        reviewLoading: false
    },
    reducers: {
        removeErrors: (state) => {
            state.error = null
        },
        removeSuccess: (state) => {
            state.reviewSuccess = false
        }
    },
    extraReducers: (builder) => {
        builder.addCase(getProduct.pending, (state) => {
            state.loading = true;
            state.error = null;
        })
        .addCase(getProduct.fulfilled, (state, action) => {
            state.loading = false;
            state.error = null;
            state.products = action.payload.products;
            state.productCount = action.payload.productCount;
            state.resultsPerPage = action.payload.resultsPerPage;
            state.totalPages = action.payload.totalPages;

        })
        .addCase(getProduct.rejected,(state, action) => {
            state.loading = false;
            state.error = action.payload || 'Something went wrong'
            state.products = []
        })

        // product details
        builder.addCase(getProductDetails.pending, (state) => {
            state.loading = true;
            state.error = null;
        })
        .addCase(getProductDetails.fulfilled, (state, action) => {
            state.loading = false;
            state.error = null;
            state.product = action.payload.product;
        })
        .addCase(getProductDetails.rejected,(state, action) => {
            state.loading = false;
            state.error = action.payload || 'Something went wrong'
        })

        // create review
        builder.addCase(createReviews.pending, (state) => {
            state.reviewLoading = true;
            state.error = null;
        })
        .addCase(createReviews.fulfilled, (state) => {
            state.reviewLoading = false;
            state.reviewSuccess = true;
        })
        .addCase(createReviews.rejected,(state, action) => {
            state.reviewLoading = false;
            state.error = action.payload || 'Unable to create review. Please try again'
        })
    }
});

export const {removeErrors, removeSuccess} = productSlice.actions;
export default productSlice.reducer;
