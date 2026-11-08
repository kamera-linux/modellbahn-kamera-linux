import React, { useState } from 'react';
import { Settings, Camera, RotateCw } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useSelectedCamera } from '../store/cameraStore';
import { AdvancedCaptureFields, defaultAdvanced, roiError, type AdvancedCaptureValue } from './AdvancedCaptureFields';

interface CaptureSettings extends AdvancedCaptureValue {
  resolution: string;
  quality: number;
}

const presets: Record<string, CaptureSettings> = {
  standard: { ...defaultAdvanced, resolution: '1920x1080', quality: 90, autofocusMode: 'auto' },
  hochwertig: { ...defaultAdvanced, resolution: '4608x2592', quality: 100, autofocusMode: 'auto', autofocusRange: 'full' }
};

export const PhotoCaptureSettings: React.FC<{
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ onSuccess, onError }) => {
  const camera = useSelectedCamera();
  const [settings, setSettings] = useState<CaptureSettings>(presets.standard);
  const [showROIPreview, setShowROIPreview] = useState(false);
  const [capturing, setCapturing] = useState(false);

  if (!camera) return null;

  const roiInvalid = roiError(settings.roi) !== null;

  const handleCapture = async () => {
    try {
      setCapturing(true);
      const { roi, ...rest } = settings;
      const response = await api.captureImage(camera.id, { ...rest, ...(roi.trim() ? { roi } : {}) });
      onSuccess(`Foto aufgenommen: ${response.data.file}`);
    } catch (err) {
      onError(`Foto fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setCapturing(false);
    }
  };

  const roiData = !roiInvalid && settings.roi.trim() ? settings.roi.split(',').map(Number) : null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5" />
        <h3 className="text-lg font-bold">📷 Foto-Einstellungen</h3>
      </div>

      {camera.photoRotation !== 0 && (
        <div className="mb-4 p-2 bg-blue-900/30 border border-blue-600 rounded text-sm text-blue-200 flex items-center gap-2">
          <RotateCw className="w-4 h-4" />
          <span>Fotos werden automatisch um {camera.photoRotation}° rotiert</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Auflösung</label>
          <select
            value={settings.resolution}
            onChange={e => setSettings({ ...settings, resolution: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
          >
            <option value="1920x1080">1920x1080 (Full HD)</option>
            <option value="2560x1440">2560x1440 (1440p)</option>
            <option value="3840x2160">3840x2160 (4K)</option>
            <option value="4608x2592">4608x2592 (Maximum, Camera Module 3)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Qualität: <span className="text-blue-400">{settings.quality}%</span>
          </label>
          <input
            type="range"
            min="50"
            max="100"
            value={settings.quality}
            onChange={e => setSettings({ ...settings, quality: parseInt(e.target.value, 10) })}
            className="w-full"
          />
        </div>

        <AdvancedCaptureFields value={settings} onChange={v => setSettings({ ...settings, ...v })} />

        <div>
          <button
            onClick={() => setShowROIPreview(!showROIPreview)}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {showROIPreview ? '📊 ROI-Vorschau verstecken' : '👁️ ROI-Vorschau'}
          </button>
          {showROIPreview && roiData && (
            <div className="mt-2 relative w-full aspect-video bg-gray-700 border border-gray-600 rounded overflow-hidden">
              <div
                className="absolute border-2 border-blue-500 bg-blue-500/20"
                style={{
                  left: `${roiData[0] * 100}%`,
                  top: `${roiData[1] * 100}%`,
                  width: `${roiData[2] * 100}%`,
                  height: `${roiData[3] * 100}%`
                }}
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-semibold text-gray-300 block mb-2">Voreinstellungen</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSettings(presets.standard)} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">
              📸 Standard
            </button>
            <button onClick={() => setSettings(presets.hochwertig)} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">
              ⭐ Hochwertig
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={handleCapture}
        disabled={capturing || roiInvalid || camera.status !== 'online'}
        className="w-full mt-6 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg font-semibold text-white flex items-center justify-center gap-2 transition-colors"
      >
        <Camera className="w-5 h-5" />
        {capturing ? '⏳ Fotografiere…' : camera.status === 'online' ? '📸 Foto aufnehmen' : `Kamera ${camera.status}`}
      </button>
    </div>
  );
};
