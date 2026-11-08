import React, { useEffect, useState } from 'react';
import { useSelectedCamera } from '../store/cameraStore';
import { api, errorMessage } from '../api/client';
import type { AutofocusMode as AutofocusModeT, AutofocusRange as AutofocusRangeT, HdrMode as HdrT } from '@shared/types';
import { Camera, Video, Square, Settings, RotateCw, Mic } from 'lucide-react';
import { RotationSettings } from './RotationSettings';
import { isReady, notReadyReason } from './SyncBadge';
import { AdvancedCaptureFields } from './AdvancedCaptureFields';

interface CameraControlProps {
  onSuccess?: (message: string) => void;
  onError?: (error: string) => void;
}

export const CameraControl: React.FC<CameraControlProps> = ({ onSuccess, onError }) => {
  const camera = useSelectedCamera();
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [resolution, setResolution] = useState('1920x1080');
  const [quality, setQuality] = useState(90);
  const [recordDuration, setRecordDuration] = useState(5); // minutes

  const [autofocusMode, setAutofocusMode] = useState<AutofocusModeT>('manual');
  const [autofocusRange, setAutofocusRange] = useState<AutofocusRangeT>('normal');
  const [hdr, setHdr] = useState<HdrT>('off');
  const [roi, setRoi] = useState('');
  const [withAudio, setWithAudio] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    api.getAudioStatus().then(r => setAudioReady(r.data.configured)).catch(() => setAudioReady(false));
  }, []);

  if (!camera) {
    return (
      <div className="card">
        <p className="text-gray-400">Bitte wählen Sie eine Kamera aus</p>
      </div>
    );
  }

  // Server-side status is the source of truth (refreshed every 5 s by CameraList).
  const recording = camera.status === 'recording';
  const ready = isReady(camera);
  const advanced = { autofocusMode, autofocusRange, hdr, roi: roi || undefined };

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      setLoading(true);
      await action();
      onSuccess?.(success);
    } catch (err) {
      onError?.(`${failure}: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = () =>
    run(
      () => api.captureImage(camera.id, { resolution, quality, ...advanced }),
      `Foto von ${camera.name} aufgenommen`,
      'Foto fehlgeschlagen'
    );

  const handleStartRecording = () =>
    run(
      () => api.startRecording(camera.id, { duration: recordDuration * 60, resolution, audio: withAudio && audioReady, ...advanced }),
      `Aufnahme auf ${camera.name} gestartet (${recordDuration} Minute${recordDuration > 1 ? 'n' : ''})`,
      'Aufnahme fehlgeschlagen'
    );

  const handleStopRecording = () =>
    run(() => api.stopRecording(camera.id), `Aufnahme auf ${camera.name} wird beendet …`, 'Stopp fehlgeschlagen');

  return (
    <div className="card space-y-4">
      <h3 className="text-xl font-bold">Kontrolle: {camera.name}</h3>

      {!ready && !recording && (
        <div className="p-2 bg-gray-800 border border-yellow-600 rounded text-sm text-yellow-200">
          Kamera nicht bereit: {notReadyReason(camera)}
        </div>
      )}

      {camera.videoRotation !== 0 && (
        <div className="p-2 bg-orange-900/30 border border-orange-600 rounded text-sm text-orange-200 flex items-center gap-2">
          <RotateCw className="w-4 h-4" />
          <span>Videos werden automatisch um {camera.videoRotation}° rotiert</span>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-2">Auflösung</label>
          <select
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            disabled={loading || recording}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 disabled:opacity-50"
          >
            <option>1920x1080</option>
            <option>1280x720</option>
            <option>640x480</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Foto-Qualität: {quality}%</label>
          <input
            type="range"
            min="50"
            max="100"
            value={quality}
            onChange={e => setQuality(parseInt(e.target.value, 10))}
            disabled={loading || recording}
            className="w-full disabled:opacity-50"
          />
        </div>

        {!recording && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Aufnahmedauer: {recordDuration} Minute{recordDuration > 1 ? 'n' : ''}
            </label>
            <input
              type="range"
              min="1"
              max="60"
              value={recordDuration}
              onChange={e => setRecordDuration(parseInt(e.target.value, 10))}
              disabled={loading}
              className="w-full disabled:opacity-50"
            />
            {audioReady && (
              <label className="mt-2 flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={withAudio} onChange={e => setWithAudio(e.target.checked)} className="w-4 h-4" />
                <Mic className="w-4 h-4" /> Ton vom Mikrofon des Servers aufnehmen
              </label>
            )}
          </div>
        )}

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          disabled={loading || recording}
          className="w-full flex items-center justify-center gap-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-3 py-2"
        >
          <Settings className="w-4 h-4" />
          {showAdvanced ? 'Erweiterte Einstellungen ausblenden' : 'Erweiterte Einstellungen anzeigen'}
        </button>

        {showAdvanced && (
          <div className="p-3 bg-gray-800 rounded border border-gray-700">
            <AdvancedCaptureFields
              disabled={loading || recording}
              value={{ autofocusMode, autofocusRange, hdr, roi }}
              onChange={v => {
                setAutofocusMode(v.autofocusMode);
                setAutofocusRange(v.autofocusRange);
                setHdr(v.hdr);
                setRoi(v.roi);
              }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleCapture}
          disabled={loading || recording || !ready}
          className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Camera className="w-4 h-4" />
          Foto
        </button>

        {!recording ? (
          <button
            onClick={handleStartRecording}
            disabled={loading || !ready}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Video className="w-4 h-4" />
            Aufnahme
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            disabled={loading}
            className="btn-secondary flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            <Square className="w-4 h-4" />
            Stopp
          </button>
        )}
      </div>

      <RotationSettings camera={camera} />
    </div>
  );
};
