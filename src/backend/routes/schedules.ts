import express from 'express';
import { getScheduleManager } from '../services/ScheduleManagerSingleton.js';
import { schemas, validateBody, HttpError } from '../validation.js';

export const scheduleRouter = express.Router();

scheduleRouter.get('/', (_req, res) => {
  res.json(getScheduleManager().listSchedules());
});

scheduleRouter.get('/status/all', (_req, res) => {
  res.json(getScheduleManager().getAllSchedulesStatus());
});

scheduleRouter.get('/:id/status', (req, res, next) => {
  const status = getScheduleManager().getScheduleStatus(req.params.id);
  if (!status) return next(new HttpError(404, 'Schedule not found'));
  res.json(status);
});

scheduleRouter.post('/', validateBody(schemas.scheduleCreate), (req, res, next) => {
  try {
    res.status(201).json(getScheduleManager().createSchedule(req.body));
  } catch (err) {
    next(err);
  }
});

scheduleRouter.put('/:id', validateBody(schemas.scheduleUpdate), (req, res, next) => {
  try {
    res.json(getScheduleManager().updateSchedule(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

scheduleRouter.delete('/:id', (req, res, next) => {
  try {
    getScheduleManager().deleteSchedule(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
