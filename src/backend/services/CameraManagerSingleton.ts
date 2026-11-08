import { CameraManager } from '../services/CameraManager.js';

// Singleton instance
let cameraManagerInstance: CameraManager | null = null;

export function getCameraManager(): CameraManager {
  if (!cameraManagerInstance) {
    cameraManagerInstance = new CameraManager();
  }
  return cameraManagerInstance;
}
