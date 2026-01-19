const cloudinary = require('cloudinary');
const CloudinaryStorage = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = CloudinaryStorage({
    cloudinary: cloudinary,
    folder: 'super_images',
    allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }]
});

// Middleware for handling single file upload
const upload = require('multer')({ storage: storage });

// Middleware for handling multiple files
const uploadMultiple = require('multer')({
    storage: storage
}).array('images', 10); // Max 10 images

// Upload single image
const uploadSingleImage = (fieldName) => {
    return upload.single(fieldName);
};

// Upload multiple images
const uploadMultipleImages = () => {
    return uploadMultiple;
};

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
    try {
        const result = await cloudinary.v2.uploader.destroy(publicId);
        return result;
    } catch (error) {
        console.error('Error deleting image:', error);
        throw error;
    }
};

// Extract public ID from Cloudinary URL
const getPublicIdFromUrl = (url) => {
    const matches = url.match(/\/upload\/v\d+\/(.+?)\./);
    return matches ? matches[1] : null;
};

module.exports = {
    cloudinary,
    uploadSingleImage,
    uploadMultipleImages,
    deleteImage,
    getPublicIdFromUrl
};