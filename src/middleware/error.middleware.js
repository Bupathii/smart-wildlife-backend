const multer = require('multer');

/*
 * =====================================================
 * NOT FOUND HANDLER
 * =====================================================
 */
function notFoundHandler(
  req,
  res
) {
  return res.status(404).json({
    success: false,
    message: 'Route not found',
  });
}

/*
 * =====================================================
 * GLOBAL ERROR HANDLER
 * =====================================================
 */
function errorHandler(
  err,
  req,
  res,
  next
) {
  console.error(
    'Application Error:',
    err
  );

  /*
   * -------------------------
   * Multer errors
   * -------------------------
   */

  if (
    err instanceof
    multer.MulterError
  ) {
    if (
      err.code ===
      'LIMIT_FILE_SIZE'
    ) {
      return res.status(413).json({
        success: false,
        message:
          'Each evidence image must be 5 MB or smaller',
      });
    }

    if (
      err.code ===
      'LIMIT_FILE_COUNT'
    ) {
      return res.status(400).json({
        success: false,
        message:
          'A maximum of 5 evidence images can be uploaded',
      });
    }

    if (
      err.code ===
      'LIMIT_UNEXPECTED_FILE'
    ) {
      return res.status(400).json({
        success: false,
        message:
          'A maximum of 5 evidence images can be uploaded using the evidence field',
      });
    }

    return res.status(400).json({
      success: false,
      message:
        err.message ||
        'File upload failed',
    });
  }

  /*
   * -------------------------
   * File type errors
   * -------------------------
   */

  if (err.statusCode) {
    return res
      .status(err.statusCode)
      .json({
        success: false,
        message:
          err.message ||
          'Request failed',
      });
  }

  /*
   * -------------------------
   * Mongoose validation
   * -------------------------
   */

  if (
    err.name ===
    'ValidationError'
  ) {
    const messages =
      Object.values(
        err.errors
      ).map(
        (error) =>
          error.message
      );

    return res.status(400).json({
      success: false,
      message:
        messages[0] ||
        'Validation failed',
      errors: messages,
    });
  }

  /*
   * -------------------------
   * Invalid MongoDB ID
   * -------------------------
   */

  if (
    err.name ===
    'CastError'
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Invalid resource ID',
    });
  }

  /*
   * -------------------------
   * MongoDB duplicate key
   * -------------------------
   */

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message:
        'A record with this value already exists',
    });
  }

  /*
   * -------------------------
   * Default server error
   * -------------------------
   */

  return res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV ===
      'production'
        ? 'Internal server error'
        : err.message ||
          'Internal server error',
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};