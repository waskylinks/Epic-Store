import multer from 'multer';
import HandleError from '../utils/handleError.js';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// ============================================
// SAFE UPLOAD WRAPPER
// ============================================
//
// The root cause of the "stuck updating" bug:
//
// When multer encounters ANY error (file too large, wrong mimetype,
// unexpected field, etc.) it calls next(err) WITHOUT populating
// req.body — even for the non-file text fields that were already
// parsed before the error occurred.
//
// This means the controller receives req.body = undefined, logs
// show bodyExists: false, and the request either hangs or fails
// silently depending on whether the global error handler catches
// the multer error shape correctly.
//
// This wrapper runs multer manually inside a try/catch so that:
//   1. If multer succeeds → req.body and req.files are populated normally
//   2. If multer errors  → we return a clean 400 JSON response immediately
//                          instead of letting the error bubble up unparsed
//
// Usage in router:  safeUpload.array('images', 10)
// Replaces:         upload.array('images', 10)
// ============================================

const wrapMulter = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (!err) return next();

    // MulterError covers: LIMIT_FILE_SIZE, LIMIT_FILE_COUNT,
    // LIMIT_UNEXPECTED_FILE, LIMIT_PART_COUNT, etc.
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new HandleError('One or more images exceed the 10MB limit. Please reduce file size and try again.', 400));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new HandleError('Too many images. Maximum 10 images allowed per product.', 400));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new HandleError(`Unexpected field "${err.field}". Images must be uploaded under the "images" field name.`, 400));
    }

    // fileFilter rejection (non-image mimetype)
    if (err.message === 'Only image files are allowed!') {
      return next(new HandleError('Only image files (JPEG, PNG, WebP, GIF) are allowed.', 400));
    }

    // Any other multer or stream error
    return next(new HandleError(`File upload error: ${err.message}`, 400));
  });
};

// Pre-wrapped instances ready to drop into routes
export const safeUploadArray = (fieldName = 'images', maxCount = 10) =>
  wrapMulter(upload.array(fieldName, maxCount));

export const uploadProductImages = safeUploadArray('images', 10);

export default upload;