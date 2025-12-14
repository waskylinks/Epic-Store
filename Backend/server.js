import dotenv from 'dotenv';
dotenv.config({ path: './.env' });


import app from './app.js';
import connectDB from './Database/database.js';
import { v2 as cloudinary } from 'cloudinary';


// Cloudinary Configuration

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});


// Connect to Database

connectDB();


// Handle Uncaught Exceptions

process.on("uncaughtException", (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
  console.error("Shutting down the server due to uncaught exception");
  process.exit(1);
});


// Start Server

const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on PORT ${PORT}`);
});


// Handle Unhandled Promise Rejections

process.on("unhandledRejection", (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  console.error("Shutting down the server due to unhandled promise rejection");

  server.close(() => {
    process.exit(1);
  });
});
