const multer = require('multer');

const MAX_FILE_SIZE =
  5 * 1024 * 1024; // 5 MB

const MAX_FILES = 5;

const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const storage =
  multer.memoryStorage();

const fileFilter = (
  req,
  file,
  cb
) => {
  if (
    allowedMimeTypes.includes(
      file.mimetype
    )
  ) {
    return cb(null, true);
  }

  const error = new Error(
    'Only JPG, JPEG, PNG and WEBP images are allowed'
  );

  error.statusCode = 400;

  return cb(error, false);
};

const upload = multer({
  storage,

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },

  fileFilter,
});

module.exports = upload;