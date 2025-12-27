import multer from 'multer';

const storage = multer.memoryStorage(); // Store in memory to stream directly to Cloudinary

const upload = multer({ storage });

export default upload;