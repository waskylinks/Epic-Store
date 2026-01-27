import multer from 'multer';

const storage = multer.memoryStorage(); // ✅ Stores files in memory as buffers

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed!'), false);
    }
  }
});

export default upload;