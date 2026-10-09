const cloudinary = require('../config/cloudinary');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const CLOUDINARY_ENVIRONMENT_VARIABLES = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function cloudinaryIsConfigured() {
  return CLOUDINARY_ENVIRONMENT_VARIABLES.every(
    (name) => process.env[name]?.trim()
  );
}

function getLocalUploadDirectory(folder) {
  const safeFolder = String(folder || 'wildlife-uploads')
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean);
  const uploadRoot = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || 'uploads');
  const destination = path.resolve(uploadRoot, ...safeFolder);

  if (safeFolder.length > 0 && !destination.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error('Invalid upload folder');
  }

  return { uploadRoot, destination, safeFolder };
}

function uploadBuffer(
  buffer,
  folder = 'wildlife-conflict-reports',
  originalName = 'image.jpg'
) {
  if (!cloudinaryIsConfigured()) {
    return saveLocally(buffer, folder, originalName);
  }

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

async function saveLocally(buffer, folder, originalName) {
  const { destination, safeFolder } = getLocalUploadDirectory(folder);
  const requestedExtension = path.extname(String(originalName || '')).toLowerCase();
  const extension = ['.jpg', '.jpeg', '.png', '.webp'].includes(requestedExtension)
    ? requestedExtension
    : '.jpg';
  const filename = `${randomUUID()}${extension}`;
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, filename), buffer, { flag: 'wx' });

  const relativePath = [...safeFolder, filename].join('/');
  return {
    secure_url: `/uploads/${relativePath}`,
    public_id: `local:${relativePath}`,
  };
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) {
    return;
  }

  if (publicId.startsWith('local:')) {
    const relativePath = publicId.slice('local:'.length);
    const { uploadRoot } = getLocalUploadDirectory('');
    const filePath = path.resolve(uploadRoot, relativePath);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new Error('Invalid local upload path');
    }
    await fs.unlink(filePath);
    return;
  }

  await cloudinary.uploader.destroy(publicId);
}

module.exports = {
  uploadBuffer,
  deleteCloudinaryImage,
};