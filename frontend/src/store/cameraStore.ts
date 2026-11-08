import { create } from 'zustand';
import type { Camera } from '../api/client';

interface CameraState {
  cameras: Camera[];
  selectedCameraId: string | null;
  loading: boolean;
  setCameras: (cameras: Camera[]) => void;
  setSelectedCamera: (camera: Camera | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useCameraStore = create<CameraState>(set => ({
  cameras: [],
  selectedCameraId: null,
  loading: false,
  setCameras: cameras => set({ cameras }),
  setSelectedCamera: camera => set({ selectedCameraId: camera?.id ?? null }),
  setLoading: loading => set({ loading })
}));

/** The selected camera with its *current* status (re-fetched every few seconds). */
export const useSelectedCamera = (): Camera | null =>
  useCameraStore(state => state.cameras.find(c => c.id === state.selectedCameraId) ?? null);
