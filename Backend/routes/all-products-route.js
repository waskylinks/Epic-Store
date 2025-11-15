import express from 'express';

const router = express.Router();

const allProductsRoute = router.get('/products', (req, res) => {
    res.json({
        success: true,
        message: 'All products route working fine',
            
    });
});

export default allProductsRoute;