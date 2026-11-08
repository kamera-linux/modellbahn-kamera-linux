import React from 'react';
import { api } from '../api/client';
import { MediaGallery } from './MediaGallery';

export const PhotoManager: React.FC = () => (
  <MediaGallery kind="photo" title="📸 Fotos" emptyText="Keine Fotos vorhanden" load={api.getPhotos} remove={api.deletePhoto} />
);
