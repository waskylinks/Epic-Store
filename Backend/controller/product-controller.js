import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';

// creating products 
export const createProducts = handleAsyncError(async (req, res, next) => {

    const product = await Product.create(req.body)
    res.status(201).json({
        success: true,
        product,
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