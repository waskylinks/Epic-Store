// utils/cloudinaryUpload.js
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

// Promisified upload from buffer
export const uploadToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'products', // you can make this dynamic if needed
                resource_type: 'image',
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        // Pipe the buffer into the upload stream
        streamifier.createReadStream(buffer).pipe(uploadStream);
    });
};