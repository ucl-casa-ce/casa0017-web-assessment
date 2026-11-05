import config from '../config/env.js';

const errorHandler = (err, req, res, next) => {
  console.error('[Error]', err.message);

  if (config.env === 'development') {
    console.error(err.stack);
  }

  const status = err.status || 500;
  const response = {
    success: false,
    error: err.message || 'Internal Server Error'
  };

  if (config.env === 'development') {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

export default errorHandler;
