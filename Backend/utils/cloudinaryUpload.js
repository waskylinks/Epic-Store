import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Debug log configuration (remove in production)
console.log('🔧 Cloudinary Configuration:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '❌ MISSING',
  api_key: process.env.CLOUDINARY_API_KEY ? 'Set ✅' : '❌ MISSING',
  api_secret: process.env.CLOUDINARY_API_SECRET ? 'Set ✅' : '❌ MISSING'
});

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {Object} options - Additional upload options
 * @returns {Promise} Cloudinary upload result
 */
export const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    // Validate inputs
    if (!fileBuffer) {
      return reject(new Error('File buffer is required'));
    }

    // Default upload options
    const uploadOptions = {
      folder: options.folder || 'products',
      resource_type: options.resource_type || 'auto',
      transformation: options.transformation || [
        { width: 1000, height: 1000, crop: 'limit' },
        { quality: 'auto:good' }
      ],
      ...options
    };

    console.log('⬆️ Starting Cloudinary upload with options:', uploadOptions);

    // Create upload stream
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload stream error:', {
            message: error.message,
            name: error.name,
            http_code: error.http_code,
            error: error
          });
          reject(error);
        } else {
          console.log('✅ Cloudinary upload successful:', {
            public_id: result.public_id,
            url: result.secure_url,
            format: result.format,
            size: result.bytes
          });
          resolve(result);
        }
      }
    );

    // Handle stream errors
    uploadStream.on('error', (error) => {
      console.error('❌ Upload stream error:', error);
      reject(error);
    });

    // Pipe the buffer to Cloudinary
    try {
      streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    } catch (error) {
      console.error('❌ Stream creation error:', error);
      reject(error);
    }
  });
};

/**
 * Delete an image from Cloudinary
 * @param {string} publicId - The public ID of the image to delete
 * @returns {Promise} Cloudinary deletion result
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { 
      invalidate: true 
    });
    console.log(`🗑️ Deleted image from Cloudinary: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error(`❌ Failed to delete image: ${publicId}`, error);
    throw error;
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param {Array} publicIds - Array of public IDs to delete
 * @returns {Promise} Array of deletion results
 */
export const deleteMultipleFromCloudinary = async (publicIds) => {
  try {
    const deletePromises = publicIds.map(id => 
      cloudinary.uploader.destroy(id, { invalidate: true })
    );
    const results = await Promise.allSettled(deletePromises);
    console.log(`🗑️ Deleted ${results.length} images from Cloudinary`);
    return results;
  } catch (error) {
    console.error('❌ Failed to delete multiple images', error);
    throw error;
  }
};