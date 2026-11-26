const sanitizeErrorText = (msg) => {
  if (!msg || typeof msg !== 'string') return 'An unexpected error occurred';
  let sanitized = msg
    .replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_KEY]')
    .replace(/sk-[0-9A-Za-z_-]+/g, '[REDACTED_KEY]')
    .replace(/(key|api_key|api-key|token|secret)\s*[:=]\s*([^\s&,;'"]+)/gi, '$1=[REDACTED]')
    .replace(/(mongodb(\+srv)?:\/\/[^:/@\s]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$4');
  if (process.env.SERVICE_API_KEY && sanitized.includes(process.env.SERVICE_API_KEY)) {
    sanitized = sanitized.split(process.env.SERVICE_API_KEY).join('[REDACTED_SECRET]');
  }
  return sanitized;
};

export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message;

  // Check for Mongoose bad ObjectId
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    message = 'Resource not found';
    statusCode = 404;
  }

  // Check for Mongoose ValidationError
  if (err.name === 'ValidationError') {
    message = Object.values(err.errors).map((val) => val.message).join(', ');
    statusCode = 400;
  }

  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.error('[Server Error]', err.stack || message);
  }

  // Never reveal internal stack traces or secrets in HTTP error responses
  res.status(statusCode).json({
    status: statusCode >= 500 ? 'error' : 'fail',
    message: sanitizeErrorText(message),
  });
};
