import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';

//http://localhost:8000/api/v1/product/69189630f8a419d4bf0dd35a?keyword=shirt



// creating products 
export const createProducts = handleAsyncError(async (req, res, next) => {

    const product = await Product.create(req.body)
    res.status(201).json({
        success: true,
        product,
    });
    
});

//get all products
export const getAllProducts = handleAsyncError(async (req, res, next) => {

    const resultPerPage = 3;
    
    const apiFeatures = new APIFunctionality(Product.find(), req.query).search().filter();

    //get filtered query before pagination
    const filteredQuery = apiFeatures.query.clone();
    const productsCount = await filteredQuery.countDocuments();
    
    //calculate total pages based on products count
    const totalPages = Math.ceil(productsCount / resultPerPage);
    
    const page = Number(req.query.page) || 1;
    if(page > totalPages && productsCount > 0){
        return next(new HandleError("Page not found", 404));
    }

    //apply pagination
    apiFeatures.pagination(resultPerPage);

    const products = await apiFeatures.query;

    if(!products || products.length === 0){
        return next(new HandleError("No products found", 404));
    }

    res.status(200).json({
        success: true,
        products,
        productsCount,
        resultPerPage,
        totalPages,
        currentPage: page,
    });
    
});

//update products
 export const updateProduct = handleAsyncError(async (req, res, next) => {

        let product = await Product.findById(req.params.id);

        if(!product){
            return next(new HandleError("Product not found", 404))
        }

        product = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
            useFindAndModify: false,
        })

        res.status(200).json({
            success: true,
            product,    
        });
 });

 //delete products
 export const deleteProduct = handleAsyncError(async (req, res, next) => {

        let product = await Product.findById(req.params.id);

        if(!product){
            return next(new HandleError("Product not found", 404))
        }

        product = await Product.findByIdAndDelete(req.params.id)

        res.status(200).json({
            success: true,
            message: 'Product deleted successfully'   
        });
 });

 // get single product details
    export const getProductDetails = handleAsyncError(async (req, res, next) => {

        const product = await Product.findById(req.params.id); 

        if(!product){
            return next(new HandleError("Product not found", 404))
        }

        res.status(200).json({
            success: true,
            product,
        });
    });