import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config('config/config.env');

const connectDB = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully');
};

export default connectDB;
