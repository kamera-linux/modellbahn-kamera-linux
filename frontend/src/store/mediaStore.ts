import { create } from 'zustand';
import { api, errorMessage, type MediaFile } from '../api/client';

interface MediaState {
  videos: MediaFile[];
  photos: MediaFile[];
  error: string;
  refresh: () => Promise<void>;
  removeLocal: (kind: 'video' | 'photo', filename: string) => void;
}

/** Videos and photos, polled once for the whole page (overview cards and gallery). */
export const useMediaStore = create<MediaState>((set, get) => ({
  videos: [],
  photos: [],
  error: '',
  refresh: async () => {
    try {
      const [videos, photos] = await Promise.all([api.getVideos(), api.getPhotos()]);
      set({ videos: videos.data || [], photos: photos.data || [], error: '' });
    } catch (err) {
      set({ error: errorMessage(err, 'Aufnahmen konnten nicht geladen werden') });
    }
  },
  removeLocal: (kind, filename) =>
    kind === 'video'
      ? set({ videos: get().videos.filter(f => f.filename !== filename) })
      : set({ photos: get().photos.filter(f => f.filename !== filename) })
}));
