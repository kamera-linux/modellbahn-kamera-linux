import { ScheduleManager } from './ScheduleManager.js';
import { getCameraManager } from './CameraManagerSingleton.js';
import { paths } from '../config.js';

let scheduleManager: ScheduleManager | null = null;

export function getScheduleManager(): ScheduleManager {
  if (!scheduleManager) {
    scheduleManager = new ScheduleManager({
      file: paths.schedulesFile,
      capture: (cameraId, options) => getCameraManager().captureImage(cameraId, options),
      cameraExists: cameraId => getCameraManager().getCamera(cameraId) !== null
    });
  }
  return scheduleManager;
}
