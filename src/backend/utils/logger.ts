import winston from 'winston';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { appConfig, paths } from '../config.js';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize(), winston.format.simple())
  })
];

// File logging (with size-based rotation). Disabled in tests.
if (process.env.NODE_ENV !== 'test') {
  try {
    mkdirSync(paths.logsDir, { recursive: true });
    const rotation = { maxsize: 5 * 1024 * 1024, maxFiles: 5, tailable: true };
    transports.push(
      new winston.transports.File({ filename: join(paths.logsDir, 'error.log'), level: 'error', ...rotation }),
      new winston.transports.File({ filename: join(paths.logsDir, 'combined.log'), ...rotation })
    );
  } catch (err) {
    console.warn(`File logging disabled: ${(err as Error).message}`);
  }
}

export const logger = winston.createLogger({
  level: appConfig.logLevel,
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports
});
