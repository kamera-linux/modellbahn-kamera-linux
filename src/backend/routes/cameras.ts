import express from 'express';
import { getCameraManager } from '../services/CameraManagerSingleton.js';
import { schemas, validateBody, HttpError } from '../validation.js';
import type { RecordingSession } from '../../shared/types.js';

export const cameraRouter = express.Router();

type Handler = (req: express.Request, res: express.Response) => unknown | Promise<unknown>;
const wrap = (fn: Handler): express.RequestHandler => async (req, res, next) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (err) {
    next(err);
  }
};

cameraRouter.get('/', wrap(() => getCameraManager().listCameras()));

// Must be registered before '/:id' routes.
cameraRouter.post('/record/start-all', validateBody(schemas.groupRecording), wrap(req => getCameraManager().startAll(req.body)));
cameraRouter.post('/record/stop-all', wrap(() => getCameraManager().stopAll()));

cameraRouter.get(
  '/:id',
  wrap(req => {
    const camera = getCameraManager().getCamera(req.params.id);
    if (!camera) throw new HttpError(404, 'Camera not found');
    return camera;
  })
);

cameraRouter.post('/:id/capture', validateBody(schemas.capture), wrap(req => getCameraManager().captureImage(req.params.id, req.body)));

cameraRouter.post(
  '/:id/record/start',
  validateBody(schemas.recording),
  wrap(req => getCameraManager().startRecording(req.params.id, req.body))
);

cameraRouter.post('/:id/sync', wrap(req => getCameraManager().syncCamera(req.params.id)));

cameraRouter.post('/:id/record/stop', wrap(req => getCameraManager().stopRecording(req.params.id)));

cameraRouter.put(
  '/:id/rotation',
  validateBody(schemas.rotation),
  wrap(req => getCameraManager().updateRotation(req.params.id, req.body.photoRotation, req.body.videoRotation))
);

export const sessionsRouter = express.Router();

sessionsRouter.get('/', wrap(() => getCameraManager().getRecordingSessions()));

sessionsRouter.get(
  '/:sessionId',
  wrap(req => {
    const session: RecordingSession | null = getCameraManager().getRecordingProgress(req.params.sessionId);
    if (!session) throw new HttpError(404, 'Session not found');
    return session;
  })
);
