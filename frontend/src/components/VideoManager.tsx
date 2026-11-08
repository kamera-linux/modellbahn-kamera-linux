import React from 'react';
import { api } from '../api/client';
import { MediaGallery } from './MediaGallery';

export const VideoManager: React.FC = () => (
  <MediaGallery kind="video" title="📹 Videos" emptyText="Keine Videos vorhanden" load={api.getVideos} remove={api.deleteVideo} />
);
