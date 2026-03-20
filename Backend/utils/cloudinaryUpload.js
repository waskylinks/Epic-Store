import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

/**
 * Configure Cloudinary with environment variables.
 * Call once at server startup before any uploads.
 */
export const configureCloudinary = () => {
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  };

  const missingFields = [];
  if (!config.cloud_name) missingFields.push('CLOUDINARY_CLOUD_NAME');
  if (!config.api_key)    missingFields.push('CLOUDINARY_API_KEY');
  if (!config.api_secret) missingFields.push('CLOUDINARY_API_SECRET');

  if (missingFields.length > 0) {
    throw new Error(`Missing Cloudinary configuration: ${missingFields.join(', ')}`);
  }

  cloudinary.config(config);

  console.log('✅ Cloudinary configured successfully:', {
    cloud_name: config.cloud_name,
    api_key:    `${config.api_key.substring(0, 5)}...`,
    api_secret: '***hidden***',
  });

  return cloudinary;
};

export { cloudinary };

// ============================================
// UPLOAD
// ============================================

/**
 *
 * @param {Buffer} fileBuffer 
 * @param {Object} options    
 * @returns {Promise<Object>} 
 */
export const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    if (!fileBuffer) {
      return reject(new Error('File buffer is required'));
    }
    if (!Buffer.isBuffer(fileBuffer)) {
      return reject(new Error('Invalid file buffer'));
    }

    const currentConfig = cloudinary.config();
    if (!currentConfig.cloud_name || !currentConfig.api_key) {
      return reject(new Error(
        'Cloudinary not configured. Call configureCloudinary() first.'
      ));
    }

    const isImageOnly =
      !options.resource_type ||
      options.resource_type === 'image';

    const uploadOptions = {
      folder:        options.folder        || 'uploads',
      resource_type: options.resource_type || 'image',
      ...(isImageOnly && {
        transformation: options.transformation || [
          { width: 1000, height: 1000, crop: 'limit' },
          { quality: 'auto:good' },
        ],
      }),
      ...options,
    };

    console.log('⬆️  Starting Cloudinary upload:', {
      folder:        uploadOptions.folder,
      resource_type: uploadOptions.resource_type,
      hasTransform:  !!uploadOptions.transformation,
    });

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload failed:', {
            message:   error.message,
            http_code: error.http_code,
            name:      error.name,
          });

          if (error.http_code === 401) {
            return reject(new Error(
              'Cloudinary authentication failed. Check your API credentials.'
            ));
          }
          if (error.http_code === 403) {
            return reject(new Error(
              'Cloudinary authorization failed. Check your API permissions.'
            ));
          }
          return reject(error);
        }

        console.log('✅ Upload successful:', {
          public_id:     result.public_id,
          resource_type: result.resource_type,
          format:        result.format,
          size:          `${(result.bytes / 1024).toFixed(2)} KB`,
          url:           result.secure_url,
        });

        resolve(result);
      }
    );

    uploadStream.on('error', (error) => {
      console.error('❌ Upload stream error:', error);
      reject(error);
    });

    try {
      streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    } catch (error) {
      console.error('❌ Stream creation error:', error);
      reject(new Error(`Failed to create upload stream: ${error.message}`));
    }
  });
};

// ============================================
// DELETE
// ============================================

/**
 *
 * @param {string} publicId      
 * @param {string} resourceType  
 * @returns {Promise<Object>} 
 */
export const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  if (!publicId) throw new Error('Public ID is required for deletion');

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate:    true,
    });

    if (result.result === 'ok') {
      console.log(`✅ Deleted ${resourceType}: ${publicId}`);
    } else {
      console.warn(`⚠️  Delete returned: ${result.result} for ${publicId}`);
    }

    return result;
  } catch (error) {
    console.error(`❌ Failed to delete ${publicId}:`, error.message);
    throw error;
  }
};

/**
 *
 * @param {Array<{ publicId: string, resourceType?: string }>} files
 * @returns {Promise<Array>} Array of deletion results.
 */
export const deleteMultipleFromCloudinary = async (files) => {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Array of { publicId, resourceType? } objects is required');
  }

  const deletePromises = files.map(({ publicId, resourceType = 'image' }) =>
    cloudinary.uploader
      .destroy(publicId, { resource_type: resourceType, invalidate: true })
      .catch((err) => ({ error: err.message, public_id: publicId }))
  );

  const results  = await Promise.all(deletePromises);
  const failed   = results.filter((r) => r.error).length;
  const succeeded = results.length - failed;

  console.log(
    `🗑️  Deleted ${succeeded}/${results.length} files` +
    (failed > 0 ? ` (${failed} failed)` : '')
  );

  return results;
};

// ============================================
// URL HELPER
// ============================================

/**
 *
 * @param {Object} result - The raw Cloudinary upload result object.
 * @returns {string} The secure delivery URL.
 */
export const resolveCloudinaryUrl = (result) => {
  if (!result?.secure_url) {
    throw new Error('Invalid Cloudinary result: missing secure_url');
  }

  return result.secure_url;
};