const cloudinary = require('../config/cloudinary');

function uploadBuffer(
  buffer,
  folder = 'wildlife-conflict-reports'
) {
  return new Promise((resolve, reject) => {
    const uploadStream =
      cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
        },

        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(result);
        }
      );

    uploadStream.end(buffer);
  });
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) {
    return;
  }

  await cloudinary.uploader.destroy(publicId);
}

module.exports = {
  uploadBuffer,
  deleteCloudinaryImage,
};