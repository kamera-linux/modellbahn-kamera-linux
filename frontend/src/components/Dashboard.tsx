import React, { useState } from 'react';
import { CameraList } from './CameraList';
import { CameraControl } from './CameraControl';
import { ScheduleManager } from './ScheduleManager';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { RecordingProgress } from './RecordingProgress';
import { VideoManager } from './VideoManager';
import { PhotoManager } from './PhotoManager';
import { PhotoCaptureSettings } from './PhotoCaptureSettings';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useSelectedCamera } from '../store/cameraStore';

export const Dashboard: React.FC = () => {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const selectedCamera = useSelectedCamera();

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <header className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white flex items-center gap-3">
            📹 Modellbahn Kamera Manager
          </h1>
          <p className="text-gray-400 mt-2">Zentrale Verwaltungsplattform</p>
        </div>
        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 whitespace-nowrap"
        >
          {showDiagnostics ? '🔧 Diagnose ausblenden' : '🔧 Diagnose anzeigen'}
        </button>
      </header>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            message.type === 'success'
              ? 'bg-green-900 text-green-100'
              : 'bg-red-900 text-red-100'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          {message.text}
        </div>
      )}

      {showDiagnostics && (
        <div className="mb-8 bg-gray-800 p-6 rounded-lg border border-gray-700">
          <DiagnosticsPanel />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <CameraList />
        </div>

        <div className="lg:col-span-2 space-y-6">
          <RecordingProgress />
          {selectedCamera && (
            <PhotoCaptureSettings
              onSuccess={(msg) => showMessage('success', msg)}
              onError={(err) => showMessage('error', err)}
            />
          )}
          <CameraControl
            onSuccess={(msg) => showMessage('success', msg)}
            onError={(err) => showMessage('error', err)}
          />
          <ScheduleManager />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <VideoManager />
        <PhotoManager />
      </div>

      <footer className="mt-12 text-center text-gray-500 text-sm">
        <p>Modellbahn Kamera Manager v1.1.0</p>
      </footer>
    </div>
  );
};
