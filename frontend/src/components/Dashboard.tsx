import React, { useEffect, useState } from 'react';
import { Topbar } from './Topbar';
import { StatusCards } from './StatusCards';
import { RecordingProgress } from './RecordingProgress';
import { GroupRecording } from './GroupRecording';
import { CameraPanel } from './CameraPanel';
import { ScheduleManager } from './ScheduleManager';
import { MediaSection } from './MediaSection';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { HelpModal } from './HelpModal';
import { Toasts } from './Toasts';
import { useCameraStore } from '../store/cameraStore';
import { useMediaStore } from '../store/mediaStore';

/** Poll camera status and media list once for the whole page. */
function usePolling() {
  const refreshCameras = useCameraStore(s => s.refresh);
  const refreshMedia = useMediaStore(s => s.refresh);
  useEffect(() => {
    void refreshCameras();
    void refreshMedia();
    const cams = setInterval(() => void refreshCameras(), 5000);
    const media = setInterval(() => void refreshMedia(), 10000);
    return () => {
      clearInterval(cams);
      clearInterval(media);
    };
  }, [refreshCameras, refreshMedia]);
}

export const Dashboard: React.FC = () => {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  usePolling();

  return (
    <div className="min-h-screen">
      <Topbar diagnostics={showDiagnostics} onDiagnostics={() => setShowDiagnostics(!showDiagnostics)} onHelp={() => setShowHelp(true)} />

      <main className="max-w-6xl mx-auto p-3 sm:p-6 space-y-6">
        {showDiagnostics && <DiagnosticsPanel />}

        <StatusCards />
        <RecordingProgress />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3">
            <CameraPanel />
          </div>
          <div className="lg:col-span-2">
            <GroupRecording />
          </div>
        </div>

        <MediaSection />
        <ScheduleManager />
      </main>

      <footer className="text-center text-muted text-xs py-8">Modellbahn Kamera Manager v{__APP_VERSION__}</footer>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <Toasts />
    </div>
  );
};
