import rateLimit from 'express-rate-limit';

// General API rate limiter: 100 requests per minute
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests, please try again later' }
});

// Strict rate limiter for data-intensive endpoints: 20 requests per minute
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Rate limit exceeded for this endpoint' }
});
