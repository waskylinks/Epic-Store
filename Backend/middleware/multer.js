import multer from 'multer';

// Configure multer to use memory storage
const storage = multer.memoryStorage();

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Create multer instance with configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// FIX: Field name changed from 'image' to 'images' to match
// what both CreateProduct.jsx and UpdateProduct.jsx append:
//   myForm.append('images', img)
// With the old 'image' field name, req.files was always empty
// and no images were ever uploaded.
export const uploadProductImages = upload.array('images', 10);

export default upload;