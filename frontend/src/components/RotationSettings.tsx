import React, { useState, useEffect } from 'react';
import { api, errorMessage, type Camera, type Rotation } from '../api/client';

const rotationOptions: Array<{ value: Rotation; label: string }> = [
  { value: 0, label: '0° (Normal)' },
  { value: 90, label: '90° (im Uhrzeigersinn)' },
  { value: 180, label: '180° (Kopfüber)' },
  { value: 270, label: '270° (gegen Uhrzeigersinn)' }
];

const selectClass = 'input';

export const RotationSettings: React.FC<{ camera: Camera }> = ({ camera }) => {
  const [photoRotation, setPhotoRotation] = useState<Rotation>(camera.photoRotation);
  const [videoRotation, setVideoRotation] = useState<Rotation>(camera.videoRotation);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Only reset when the camera or its stored values change – not on every status poll.
  useEffect(() => {
    setPhotoRotation(camera.photoRotation);
    setVideoRotation(camera.videoRotation);
  }, [camera.id, camera.photoRotation, camera.videoRotation]);

  const save = async () => {
    setLoading(true);
    try {
      await api.updateRotation(camera.id, photoRotation, videoRotation);
      setFeedback({ ok: true, text: '✓ Gespeichert' });
    } catch (err) {
      setFeedback({ ok: false, text: errorMessage(err) });
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Drehung, falls die Kamera kopfüber oder seitlich im Wagen eingebaut ist.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label">Fotos</label>
          <select value={photoRotation} onChange={e => setPhotoRotation(Number(e.target.value) as Rotation)} className={selectClass}>
            {rotationOptions.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Videos</label>
          <select value={videoRotation} onChange={e => setVideoRotation(Number(e.target.value) as Rotation)} className={selectClass}>
            {rotationOptions.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={loading} className="btn-primary disabled:opacity-50">
          {loading ? 'Speichern…' : 'Speichern'}
        </button>
        {feedback && <span className={`text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}>{feedback.text}</span>}
      </div>
      <p className="text-xs text-muted">
        Gilt ab der nächsten Aufnahme. 180° dreht die Kamera selbst; bei 90°/270° werden Fotos nachträglich gedreht und Videos
        erhalten ein Rotations-Flag (der Player dreht beim Abspielen).
      </p>
    </div>
  );
};
