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
        console.error("Error creating product:", error.message);

        res.status(500).json({
            success: false,
            message: e.message,
        });
    }
    
}

//update products
 export const updateProduct = async (req, res) => {
    try {
        let product = await Product.findById(req.params.id);

        if(!product){
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
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

    } catch (error) {
        console.error("Error updating product:", error.message);

        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
 }