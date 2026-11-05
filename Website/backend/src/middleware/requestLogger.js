import morgan from 'morgan';
import config from '../config/env.js';

// Use 'dev' format in development, 'combined' in production
const format = config.env === 'production' ? 'combined' : 'dev';

const requestLogger = morgan(format);

export default requestLogger;
