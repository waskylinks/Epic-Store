import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

/**
 * Configure Cloudinary with environment variables
 * This should be called once during server startup
 */
export const configureCloudinary = () => {
  // ✅ Use correct environment variable names
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  };

  // Validate configuration
  const missingFields = [];
  if (!config.cloud_name) missingFields.push('CLOUDINARY_CLOUD_NAME');
  if (!config.api_key) missingFields.push('CLOUDINARY_API_KEY');
  if (!config.api_secret) missingFields.push('CLOUDINARY_API_SECRET');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing Cloudinary configuration: ${missingFields.join(', ')}`
    );
  }

  // Configure Cloudinary
  cloudinary.config(config);

  // Log success (safe logging - don't expose secrets)
  console.log('✅ Cloudinary configured successfully:', {
    cloud_name: config.cloud_name,
    api_key: `${config.api_key.substring(0, 5)}...`,
    api_secret: '***hidden***'
  });

  return cloudinary;
};

// Export the cloudinary instance
export { cloudinary };

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

    if (!Buffer.isBuffer(fileBuffer)) {
      return reject(new Error('Invalid file buffer'));
    }

    // Check if Cloudinary is configured
    const currentConfig = cloudinary.config();
    if (!currentConfig.cloud_name || !currentConfig.api_key) {
      return reject(new Error(
        'Cloudinary not configured. Call configureCloudinary() first.'
      ));
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

    console.log('⬆️ Starting Cloudinary upload to folder:', uploadOptions.folder);

    // Create upload stream
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload failed:', {
            message: error.message,
            http_code: error.http_code,
            name: error.name
          });
          
          // Provide more helpful error messages
          if (error.http_code === 401) {
            reject(new Error(
              'Cloudinary authentication failed. Check your API credentials.'
            ));
          } else if (error.http_code === 403) {
            reject(new Error(
              'Cloudinary authorization failed. Check your API permissions.'
            ));
          } else {
            reject(error);
          }
        } else {
          console.log('✅ Upload successful:', {
            public_id: result.public_id,
            format: result.format,
            size: `${(result.bytes / 1024).toFixed(2)} KB`
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
      reject(new Error(`Failed to create upload stream: ${error.message}`));
    }
  });
};

/**
 * Delete an image from Cloudinary
 * @param {string} publicId - The public ID of the image to delete
 * @returns {Promise} Cloudinary deletion result
 */
export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) {
    throw new Error('Public ID is required for deletion');
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, { 
      invalidate: true 
    });
    
    if (result.result === 'ok') {
      console.log(`✅ Deleted image: ${publicId}`);
    } else {
      console.warn(`⚠️ Delete returned: ${result.result} for ${publicId}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to delete ${publicId}:`, error.message);
    throw error;
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param {Array} publicIds - Array of public IDs to delete
 * @returns {Promise} Array of deletion results
 */
export const deleteMultipleFromCloudinary = async (publicIds) => {
  if (!Array.isArray(publicIds) || publicIds.length === 0) {
    throw new Error('Array of public IDs is required');
  }

  try {
    const deletePromises = publicIds.map(id => 
      cloudinary.uploader.destroy(id, { invalidate: true })
        .catch(err => ({ error: err.message, public_id: id }))
    );
    
    const results = await Promise.all(deletePromises);
    
    const successful = results.filter(r => !r.error).length;
    const failed = results.length - successful;
    
    console.log(`🗑️ Deleted ${successful}/${results.length} images` + 
                (failed > 0 ? ` (${failed} failed)` : ''));
    
    return results;
  } catch (error) {
    console.error('❌ Failed to delete multiple images:', error);
    throw error;
  }
};