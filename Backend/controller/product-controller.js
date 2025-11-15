import Product from '../models/product-model.js';

// creating products 
export const createProducts = async (req, res) => {
    try {
        const product = await Product.create(req.body)
    res.status(201).json({
        success: true,
        product,
    });
    
    } catch (e) {
        res.status(500).json({
            success: false,
            message: e.message,
        });
    }
    
}
