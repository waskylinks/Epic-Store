import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';

//http://localhost:8000/api/v1/product/69189630f8a419d4bf0dd35a?keyword=shirt



// creating products 
export const createProducts = handleAsyncError(async (req, res, next) => {
    req.body.user = req.user.id;

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

// creating and updating review
export const createProductReview = handleAsyncError(async(req, res, next) => {
    const {rating, comment, productID} = req.body;
    const review = {
        user: req.user._id,
        name: req.user.name,
        rating: Number(rating),
        comment
    } 

    const product = await Product.findById(productID);

    // product can be null
    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    const reviewExists = product.reviews.find(review => review.user.toString() === req.user._id.toString());

    if(reviewExists) {
        product.reviews.forEach(review => {
            if(req.user.toString === req.user._id.toString()) {
                review.rating = rating,
                review.comment = comment
            }
        })
    } else {
        product.reviews.push(review)
        product.numOfReviews = product.reviews.length;
    }

    let avg = 0;
    product.reviews.forEach(review => {
        avg += review.rating;
    })

    if(product.reviews.length === 0) {
        product.ratings = 0;
        return
    } else {
        product.ratings = Math.ceil((avg / product.reviews.length) * 10) / 10;
    }
    

    await product.save({
        validateBeforeSave: false
    })

    res.status(200).json({
        success: true,
        product
    })
});

//getting reviews 
export const getProductReviews = handleAsyncError(async(req, res, next) => {
    const product = await Product.findById(req.query.id);
    if(!product) {
        return next(new HandleError(`Product not found`, 400))
    }

    res.status(200).json({
        success: true,
        reviews: product.reviews
    })
});

//delete product reviews
export const deleteReview = handleAsyncError(async(req, res, next) => {
    const product = await Product.findById(req.query.productID);
    if(!product) {
        return next(new HandleError(`Product not found`, 400))
    }

    const reviews = product.reviews.filter(review => review._id.toString() !== req.query.id.toString()); 
    let avg = 0;

    reviews.forEach(review => {
        avg += review.rating;
    })

    const ratings = reviews.length > 0 
    ? Number((avg / reviews.length).toFixed(1)) 
    : 0;

    const numOfReviews = reviews.length;

    await Product.findByIdAndUpdate(req.query.productID, {
        reviews,
        ratings,
        numOfReviews
    }, {
        new: true,
        runValidators: true
    })

    res.status(200).json({
        success: true,
        message: `Review deleted successfully`
    })

});

//admin - get all products
export const getAdminProducts = handleAsyncError(async(req, res, next) => {
    const products = await Product.find();
    res.status(200).json({
        success: true,
        products
    })
});