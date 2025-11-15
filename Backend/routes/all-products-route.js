import express from 'express';

const router = express.Router();



router.get('/products', (req, res) => {

    res.json({
        success: true,
        message: 'All products route working fine',
            
    });
});

export default router;