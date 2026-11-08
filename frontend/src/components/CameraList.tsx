import React, { useCallback, useEffect, useState } from 'react';
import { useCameraStore } from '../store/cameraStore';
import { api, errorMessage } from '../api/client';
import { Camera, Circle, RefreshCw, Wifi, WifiOff } from 'lucide-react';

export const CameraList: React.FC = () => {
  const { cameras, selectedCameraId, setSelectedCamera, setCameras, setLoading } = useCameraStore();
  const [error, setError] = useState('');

  const fetchCameras = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getCameras();
      setCameras(response.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Kameras konnten nicht geladen werden'));
    } finally {
      setLoading(false);
    }
  }, [setCameras, setLoading]);

  useEffect(() => {
    fetchCameras();
    const interval = setInterval(fetchCameras, 5000);
    return () => clearInterval(interval);
  }, [fetchCameras]);


  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <Wifi className="w-4 h-4 text-green-500" />;
      case 'recording':
        return <Circle className="w-4 h-4 text-orange-500 animate-pulse" />;
      default:
        return <WifiOff className="w-4 h-4 text-red-500" />;
    }
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Camera className="w-6 h-6" />
          Kameras ({cameras.filter(c => c.status === 'online').length}/{cameras.length})
        </h2>
        <button
          onClick={fetchCameras}
          className="btn-secondary p-2"
          title="Aktualisieren"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {error && <div className="bg-red-900 text-red-100 p-3 rounded mb-4">{error}</div>}

      <div className="space-y-2">
        {cameras.length === 0 ? (
          <p className="text-gray-400">Keine Kameras konfiguriert</p>
        ) : (
          cameras.map((camera) => (
            <button
              key={camera.id}
              onClick={() => setSelectedCamera(camera)}
              className={`w-full p-4 rounded-lg border-2 transition text-left ${
                selectedCameraId === camera.id
                  ? 'border-blue-500 bg-blue-900/20'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base">{camera.name}</h3>
                  <p className="text-sm text-gray-400">{camera.host}:{camera.port || 22}</p>
                  <p className="text-xs text-gray-500 mt-1">User: {camera.user}</p>
                </div>
                <div className="flex flex-col items-end gap-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(camera.status)}
                    <span className="text-sm capitalize font-medium">
                      {camera.status === 'online' && <span className="text-green-400">Online</span>}
                      {camera.status === 'offline' && <span className="text-red-400">Offline</span>}
                      {camera.status === 'recording' && <span className="text-orange-400">Aufnahme</span>}
                    </span>
                  </div>
                  {camera.lastSeen && (
                    <p className="text-xs text-gray-500">
                      {new Date(camera.lastSeen).toLocaleTimeString('de-DE')}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
