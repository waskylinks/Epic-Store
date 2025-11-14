require('dotenv').config();
const express = require('express');
const app = express();

const connectDB = require('./Database/database');
// Connect to the database
connectDB();

app.use(express.json());

const PORT = process.env.PORT || 3000;


app.listen(PORT, () => {
    console.log(`Server is listening on PORT ${PORT}`)
})