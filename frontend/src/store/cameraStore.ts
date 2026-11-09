import { create } from 'zustand';
import { api, errorMessage, type Camera } from '../api/client';

interface CameraState {
  cameras: Camera[];
  selectedCameraId: string | null;
  loading: boolean;
  error: string;
  lastUpdate: Date | null;
  refresh: () => Promise<void>;
  setCameras: (cameras: Camera[]) => void;
  setSelectedCamera: (camera: Camera | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  cameras: [],
  selectedCameraId: null,
  loading: false,
  error: '',
  lastUpdate: null,
  refresh: async () => {
    try {
      set({ loading: true });
      const cameras = (await api.getCameras()).data;
      // Pick a camera automatically so the controls are visible right away:
      // the first ready one, otherwise the first one.
      const selected = get().selectedCameraId;
      const keep = selected && cameras.some(c => c.id === selected);
      const auto = cameras.find(c => c.status !== 'offline' && c.sync?.state === 'ready') ?? cameras[0];
      set({ cameras, error: '', lastUpdate: new Date(), selectedCameraId: keep ? selected : (auto?.id ?? null) });
    } catch (err) {
      set({ error: errorMessage(err, 'Kameras konnten nicht geladen werden') });
    } finally {
      set({ loading: false });
    }
  },
  setCameras: cameras => set({ cameras }),
  setSelectedCamera: camera => set({ selectedCameraId: camera?.id ?? null }),
  setLoading: loading => set({ loading })
}));

/** The selected camera with its *current* status (re-fetched every few seconds). */
export const useSelectedCamera = (): Camera | null =>
  useCameraStore(state => state.cameras.find(c => c.id === state.selectedCameraId) ?? null);
