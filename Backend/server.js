import app from './app.js';
import dotenv from 'dotenv';






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
app.get('/', (req, res) => {
    res.send('Welcome to the Epic Store Backend!');
});
    */