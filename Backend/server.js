import app from './app.js';
import dotenv from 'dotenv';
import connectDB from './Database/database.js';
import router from './routes/all-products-route.js';

// Connect to the database
connectDB();

//home route
const allProductsRoute = router;

app.use('/api/v1', allProductsRoute);








dotenv.config('config/config.env');
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Server is listening on PORT ${PORT}`)
})

/*
require('dotenv').config();

const connectDB = require('./Database/database');
// Connect to the database
connectDB();

app.use(express.json());
/ home route

    */