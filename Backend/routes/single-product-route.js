import express from 'express';

const router = express.Router();

const singleProductRoute = router.get('/product/:id', (req, res) => {

    const products = [{
        id: 1,
        name: 'Product 1',
    }]

    res.json({
        success: true,
        message: 'Single product route working fine',
        data: products
            
    });
});

export default singleProductRoute;