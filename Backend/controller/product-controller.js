import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';
import { v2 as cloudinary } from 'cloudinary';
import { deleteCachePattern } from '../utils/redis.js';

// Helper: Invalidate product-related caches
const invalidateProductCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
};

// creating products 
export const createProducts = handleAsyncError(async (req, res, next) => {
    const imageLinks = [];

    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            try {
                const result = await uploadToCloudinary(file.buffer);
                imageLinks.push({
                    public_id: result.public_id,
                    url: result.secure_url,
                });
            } catch (uploadError) {
                return next(new HandleError('Failed to upload image to Cloudinary', 500));
            }
        }
    }

    if (imageLinks.length === 0) {
        return next(new HandleError('Please upload at least one product image', 400));
    }

    req.body.image = imageLinks;
    req.body.user = req.user.id;

    const product = await Product.create(req.body);

    // Invalidate caches
    await invalidateProductCaches();

    res.status(201).json({
        success: true,
        product,
    });
});

//get all products
export const getAllProducts = handleAsyncError(async (req, res, next) => {
    const resultPerPage = 4;
    
    const apiFeatures = new APIFunctionality(Product.find(), req.query).search().filter();
    const filteredQuery = apiFeatures.query.clone();
    const productsCount = await filteredQuery.countDocuments();
    const totalPages = Math.ceil(productsCount / resultPerPage);
    
    const page = Number(req.query.page) || 1;
    if(page > totalPages && productsCount > 0){
        return next(new HandleError("Page not found", 404));
    }

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

// update products
export const updateProduct = handleAsyncError(async (req, res, next) => {
    let product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    let imageLinks = [...product.image];

    if (req.body.imagesToDelete) {
        let imagesToDelete;
        try {
            imagesToDelete = JSON.parse(req.body.imagesToDelete);
        } catch (e) {
            imagesToDelete = Array.isArray(req.body.imagesToDelete)
                ? req.body.imagesToDelete
                : [req.body.imagesToDelete];
        }

        for (const publicId of imagesToDelete) {
            try {
                await cloudinary.uploader.destroy(publicId, { invalidate: true });
            } catch (cloudinaryError) {
                console.warn(`Cloudinary delete failed for ${publicId}:`, cloudinaryError.message);
            }
        }

        imageLinks = imageLinks.filter(
            (img) => !imagesToDelete.includes(img.public_id)
        );
    }

    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            try {
                const result = await uploadToCloudinary(file.buffer);
                imageLinks.push({
                    public_id: result.public_id,
                    url: result.secure_url,
                });
            } catch (uploadError) {
                return next(new HandleError('Failed to upload new image to Cloudinary', 500));
            }
        }
    }

    if (imageLinks.length === 0) {
        return next(new HandleError('Product must have at least one image', 400));
    }

    req.body.image = imageLinks;

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
        useFindAndModify: false,
    });

    // Invalidate caches (stock changes affect analytics)
    await invalidateProductCaches();

    res.status(200).json({
        success: true,
        product,
    });
});

// delete products
export const deleteProduct = handleAsyncError(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    if (product.image && product.image.length > 0) {
        for (const img of product.image) {
            try {
                await cloudinary.uploader.destroy(img.public_id, { invalidate: true });
            } catch (error) {
                console.warn(`Failed to delete Cloudinary image: ${img.public_id}`, error.message);
            }
        }
    }

    await Product.findByIdAndDelete(req.params.id);

    // Invalidate caches
    await invalidateProductCaches();

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

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    const reviewExists = product.reviews.find(review => review.user.toString() === req.user._id.toString());

    if (reviewExists) {
        product.reviews.forEach(review => {
            if (review.user.toString() === req.user._id.toString()) {
                review.rating = rating;
                review.comment = comment;
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