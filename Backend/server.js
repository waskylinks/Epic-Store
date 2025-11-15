import app from './app.js';
import dotenv from 'dotenv';

app.get('/', (req, res) => {
    res.status(200).json({
        message: 'All products route working fine',

    });
});






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