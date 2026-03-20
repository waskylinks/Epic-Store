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

const wrapMulter = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (!err) return next();

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

// ── Return-specific upload instance ──────────────────────────────────────────
// Allows images, videos (mp4, webm, quicktime), and PDFs.
// Used exclusively by return and plea file upload routes.
// The default upload instance above stays images-only for product uploads.

const returnFileFilter = (req, file, cb) => {
  const ALLOWED = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf',
  ];
  if (ALLOWED.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, MOV, PDF.'), false);
  }
};

const returnUpload = multer({
  storage,
  fileFilter: returnFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

export const safeReturnUploadArray = (fieldName = 'attachments', maxCount = 8) =>
  wrapMulter(returnUpload.array(fieldName, maxCount));

export default upload;