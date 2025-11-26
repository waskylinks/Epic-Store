import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';

createAsyncThunk('product/getProduct')

const productSlice = createSlice({
    name: 'product',
    initialState: {
        products: [],
        productCount: 0,
        loading: false,
        error: null
    },
    reducers: {
        removeErrors: (state) => {
            state.error = null
        }
    }
});

export const {removeErrors} = productSlice.actions;
export default productSlice.reducer;