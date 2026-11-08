import Joi from 'joi';
import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const MAX_WIDTH = 4608;
const MAX_HEIGHT = 2592;

const resolution = Joi.string()
  .pattern(/^\d{2,4}x\d{2,4}$/)
  .custom((value: string, helpers) => {
    const [w, h] = value.split('x').map(Number);
    if (w < 64 || h < 64 || w > MAX_WIDTH || h > MAX_HEIGHT) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .messages({ 'any.invalid': `resolution must be between 64x64 and ${MAX_WIDTH}x${MAX_HEIGHT}` });

const roi = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    if (value === '') return value;
    const parts = value.split(',').map(p => p.trim());
    if (parts.length !== 4 || parts.some(p => !/^\d*\.?\d+$/.test(p))) {
      return helpers.error('any.invalid');
    }
    const [x, y, w, h] = parts.map(Number);
    if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return helpers.error('any.invalid');
    return parts.join(',');
  })
  .messages({ 'any.invalid': 'roi must be "x,y,w,h" with values 0.0-1.0 and x+w<=1, y+h<=1' });

const time = Joi.string()
  .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
  .allow('')
  .messages({ 'string.pattern.base': 'time must be HH:mm' });

const rotation = Joi.number().valid(0, 90, 180, 270);

const captureFields = {
  resolution: resolution.default('1920x1080'),
  quality: Joi.number().integer().min(1).max(100).default(90),
  autofocusMode: Joi.string().valid('manual', 'continuous', 'auto').default('manual'),
  autofocusRange: Joi.string().valid('normal', 'macro', 'full').default('normal'),
  hdr: Joi.string().valid('auto', 'off').default('off'),
  roi
};

export const schemas = {
  capture: Joi.object(captureFields),

  recording: Joi.object({
    ...captureFields,
    duration: Joi.number().integer().min(1).max(3600).default(5)
  }),

  rotation: Joi.object({
    photoRotation: rotation,
    videoRotation: rotation
  }).or('photoRotation', 'videoRotation'),

  scheduleCreate: Joi.object({
    ...captureFields,
    name: Joi.string().trim().min(1).max(100).required(),
    cameraIds: Joi.array().items(Joi.string().max(100)).min(1).unique().required(),
    interval: Joi.number().integer().min(1).max(10).required(),
    startTime: time,
    endTime: time,
    enabled: Joi.boolean().default(false)
  }),

  scheduleUpdate: Joi.object({
    name: Joi.string().trim().min(1).max(100),
    cameraIds: Joi.array().items(Joi.string().max(100)).min(1).unique(),
    interval: Joi.number().integer().min(1).max(10),
    startTime: time,
    endTime: time,
    enabled: Joi.boolean(),
    resolution,
    quality: Joi.number().integer().min(1).max(100),
    autofocusMode: Joi.string().valid('manual', 'continuous', 'auto'),
    autofocusRange: Joi.string().valid('normal', 'macro', 'full'),
    hdr: Joi.string().valid('auto', 'off'),
    roi
  }).min(1),

  // Media filenames as produced by CameraManager
  mediaFilename: Joi.string().pattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/).invalid('.', '..')
};

/** Validate `value` against `schema`; throws HttpError(400) on failure. Returns the normalized value. */
export function validate<T>(schema: Joi.Schema, value: unknown): T {
  const { error, value: result } = schema.validate(value ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
  if (error) {
    throw new HttpError(400, error.details.map(d => d.message).join('; '), error.details);
  }
  return result as T;
}

/** Express middleware: validate and replace req.body. */
export function validateBody(schema: Joi.Schema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = validate(schema, req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
