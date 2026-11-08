import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Zap, Terminal } from 'lucide-react';
import { useCameraStore } from '../store/cameraStore';
import { api, errorMessage, type Camera, type DiagnosticResult } from '../api/client';

export const DiagnosticsPanel: React.FC = () => {
  const cameras = useCameraStore(state => state.cameras);
  const [results, setResults] = useState<Map<string, DiagnosticResult>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const testSSHConnection = async (camera: Camera) => {
    const key = camera.id;
    setLoading(prev => new Set([...prev, key]));

    try {
      const response = await api.testConnection(camera.id);
      setResults(prev => new Map(prev).set(key, response.data));
    } catch (err) {
      setResults(prev => new Map(prev).set(key, {
        cameraId: camera.id,
        host: camera.host,
        user: camera.user,
        port: camera.port,
        success: false,
        error: errorMessage(err),
        timestamp: new Date().toISOString(),
        recommendations: ['Fehler beim SSH-Test - prüfe Netzwerk-Verbindung']
      }));
    } finally {
      setLoading(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-6">
        <Terminal className="w-6 h-6" />
        <h2 className="text-2xl font-bold">SSH-Diagnose</h2>
      </div>

      <p className="text-gray-400 text-sm mb-4">
        Teste SSH-Verbindungen zu den Kameras. Dies hilft dir Verbindungsprobleme zu diagnostizieren.
      </p>

      <div className="space-y-3">
        {cameras.map(camera => (
          <div key={camera.id} className="bg-gray-700 p-4 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">{camera.name}</h3>
              <button
                onClick={() => testSSHConnection(camera)}
                disabled={loading.has(camera.id)}
                className={`px-3 py-1 rounded text-sm ${
                  loading.has(camera.id)
                    ? 'bg-gray-600 text-gray-400 cursor-wait'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {loading.has(camera.id) ? '⏳ Teste...' : 'Test SSH'}
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3">
              {camera.user}@{camera.host}:{camera.port}
            </p>

            {results.has(camera.id) && (
              (() => {
                const result = results.get(camera.id)!;
                return (
                  <div className={`p-3 rounded text-sm border ${
                    result.success
                      ? 'bg-green-900 border-green-700 text-green-200'
                      : 'bg-red-900 border-red-700 text-red-200'
                  }`}>
                    <div className="flex items-start gap-2 mb-2">
                      {result.success ? (
                        <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        {result.success ? (
                          <p>✅ SSH-Verbindung erfolgreich!</p>
                        ) : (
                          <>
                            <p className="font-semibold">❌ {result.error}</p>
                            {result.recommendations && (
                              <div className="mt-2 space-y-1 text-xs">
                                {result.recommendations.map((rec, idx) => (
                                  <p key={idx} className="pl-5">
                                    {rec}
                                  </p>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-xs opacity-75">
                      {new Date(result.timestamp).toLocaleTimeString('de-DE')}
                    </p>
                  </div>
                );
              })()
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-blue-900 border border-blue-700 rounded text-sm text-blue-200">
        <div className="flex gap-2">
          <Zap className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold mb-1">💡 Hinweise zum Beheben von SSH-Problemen:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Stelle sicher, dass die Raspberry Pis im selben Netz sind (ping testen)</li>
              <li>SSH muss auf dem Pi aktiviert sein (sudo raspi-config → Interface Options → SSH)</li>
              <li>Der public key muss in ~/.ssh/authorized_keys auf dem Pi eingetragen sein</li>
              <li>SSH-Key-Berechtigungen: chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys</li>
              <li>Manueller Test: ssh -i &lt;dein-key&gt; {'<user>'}@IP_ADRESSE</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
