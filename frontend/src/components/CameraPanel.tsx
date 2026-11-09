import React, { useEffect, useState } from 'react';
import { Camera as CameraIcon, Video, Square, Settings2, ChevronDown, ChevronRight, Mic, RotateCw } from 'lucide-react';
import { useSelectedCamera } from '../store/cameraStore';
import { toast } from '../store/toastStore';
import { api, errorMessage, type Camera } from '../api/client';
import { isReady, notReadyReason } from './SyncBadge';
import { AdvancedCaptureFields, defaultAdvanced, roiError, type AdvancedCaptureValue } from './AdvancedCaptureFields';
import { RotationSettings } from './RotationSettings';
import { DurationPicker, formatDuration } from './DurationPicker';

type Tab = 'photo' | 'video' | 'settings';

interface PhotoSettings extends AdvancedCaptureValue {
  resolution: string;
  quality: number;
}

const photoPresets: Record<'standard' | 'hochwertig', PhotoSettings> = {
  standard: { ...defaultAdvanced, resolution: '1920x1080', quality: 90, autofocusMode: 'auto' },
  hochwertig: { ...defaultAdvanced, resolution: '4608x2592', quality: 100, autofocusMode: 'auto', autofocusRange: 'full' }
};

const PHOTO_RESOLUTIONS: Array<[string, string]> = [
  ['1920x1080', '1920×1080 (Full HD)'],
  ['2560x1440', '2560×1440'],
  ['3840x2160', '3840×2160 (4K)'],
  ['4608x2592', '4608×2592 (Maximum, Camera Module 3)']
];
const VIDEO_RESOLUTIONS: Array<[string, string]> = [
  ['1920x1080', '1920×1080 (Full HD)'],
  ['1280x720', '1280×720'],
  ['640x480', '640×480']
];

/** Collapsible autofocus / HDR / ROI block. */
const Advanced: React.FC<{
  value: AdvancedCaptureValue;
  onChange: (v: AdvancedCaptureValue) => void;
  disabled?: boolean;
  roiPreview?: boolean;
}> = ({ value, onChange, disabled, roiPreview }) => {
  const [open, setOpen] = useState(false);
  const roi = !roiError(value.roi) && value.roi.trim() ? value.roi.split(',').map(Number) : null;
  return (
    <div className="border border-line rounded-lg">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-fg">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Erweitert: Autofokus, HDR, Bildausschnitt
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <AdvancedCaptureFields value={value} onChange={onChange} disabled={disabled} />
          {roiPreview && roi && (
            <div className="relative w-full max-w-sm aspect-video bg-bg border border-line rounded overflow-hidden" title="Bildausschnitt">
              <div
                className="absolute border-2 border-accent bg-accent/20"
                style={{ left: `${roi[0] * 100}%`, top: `${roi[1] * 100}%`, width: `${roi[2] * 100}%`, height: `${roi[3] * 100}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Select: React.FC<{ label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void; disabled?: boolean }> = ({
  label,
  value,
  options,
  onChange,
  disabled
}) => (
  <div>
    <label className="field-label">{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className="input">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </div>
);

const RotationHint: React.FC<{ degrees: number; what: string }> = ({ degrees, what }) =>
  degrees ? (
    <p className="text-xs text-muted flex items-center gap-1.5">
      <RotateCw className="w-3.5 h-3.5" /> {what} werden automatisch um {degrees}° gedreht
    </p>
  ) : null;

const PhotoTab: React.FC<{ camera: Camera }> = ({ camera }) => {
  const [s, setS] = useState<PhotoSettings>(photoPresets.standard);
  const [busy, setBusy] = useState(false);
  const blocked = camera.status === 'recording' ? 'Wagen nimmt gerade ein Video auf' : !isReady(camera) ? `Nicht bereit: ${notReadyReason(camera)}` : '';
  const roiInvalid = roiError(s.roi) !== null;

  const capture = async () => {
    try {
      setBusy(true);
      const { roi, ...rest } = s;
      const r = await api.captureImage(camera.id, { ...rest, ...(roi.trim() ? { roi } : {}) });
      toast.success(`Foto von ${camera.name} gespeichert: ${r.data.file}`);
    } catch (err) {
      toast.error(`Foto fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-muted mr-1">Voreinstellung:</span>
        <button className="btn-neutral btn-sm" onClick={() => setS(photoPresets.standard)}>
          Standard (Full HD)
        </button>
        <button className="btn-neutral btn-sm" onClick={() => setS(photoPresets.hochwertig)}>
          Hochwertig (Maximum)
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Select label="Auflösung" value={s.resolution} options={PHOTO_RESOLUTIONS} onChange={v => setS({ ...s, resolution: v })} />
        <div>
          <label className="field-label">
            JPEG-Qualität: <span className="text-accent font-semibold">{s.quality} %</span>
          </label>
          <input type="range" min={50} max={100} value={s.quality} onChange={e => setS({ ...s, quality: parseInt(e.target.value, 10) })} className="w-full mt-2" />
        </div>
      </div>
      <Advanced value={s} onChange={v => setS({ ...s, ...v })} roiPreview />
      <RotationHint degrees={camera.photoRotation} what="Fotos" />
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={capture} disabled={busy || !!blocked || roiInvalid} className="btn-primary">
          <CameraIcon className="w-4 h-4" /> {busy ? 'Fotografiere…' : 'Foto aufnehmen'}
        </button>
        {blocked && <span className="text-sm text-warn">{blocked}</span>}
      </div>
    </div>
  );
};

const VideoTab: React.FC<{ camera: Camera }> = ({ camera }) => {
  const [duration, setDuration] = useState(60);
  const [resolution, setResolution] = useState('1920x1080');
  const [advanced, setAdvanced] = useState<AdvancedCaptureValue>(defaultAdvanced);
  const [withAudio, setWithAudio] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const recording = camera.status === 'recording';
  const ready = isReady(camera);

  useEffect(() => {
    api.getAudioStatus().then(r => setAudioReady(r.data.configured)).catch(() => setAudioReady(false));
  }, []);

  const start = async () => {
    try {
      setBusy(true);
      const { roi, ...rest } = advanced;
      await api.startRecording(camera.id, { duration, resolution, audio: withAudio && audioReady, ...rest, ...(roi.trim() ? { roi } : {}) });
      toast.success(`Aufnahme auf ${camera.name} gestartet (${formatDuration(duration)})`);
    } catch (err) {
      toast.error(`Aufnahme fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try {
      setBusy(true);
      await api.stopRecording(camera.id);
      toast.success(`Aufnahme auf ${camera.name} wird beendet…`);
    } catch (err) {
      toast.error(`Stopp fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <DurationPicker value={duration} onChange={setDuration} disabled={busy || recording} />
      <div className="grid sm:grid-cols-2 gap-4 items-end">
        <Select label="Auflösung" value={resolution} options={VIDEO_RESOLUTIONS} onChange={setResolution} disabled={busy || recording} />
        <label className={`flex items-center gap-2 text-sm pb-2 ${audioReady ? 'cursor-pointer' : 'opacity-50'}`} title={audioReady ? '' : 'Kein Mikrofon konfiguriert (AUDIO_INPUT)'}>
          <input type="checkbox" checked={withAudio && audioReady} disabled={!audioReady || recording} onChange={e => setWithAudio(e.target.checked)} className="w-4 h-4" />
          <Mic className="w-4 h-4" /> Ton vom Mikrofon des Servers
        </label>
      </div>
      <Advanced value={advanced} onChange={setAdvanced} disabled={busy || recording} />
      <RotationHint degrees={camera.videoRotation} what="Videos" />
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button onClick={start} disabled={busy || !ready || roiError(advanced.roi) !== null} className="btn-primary">
            <Video className="w-4 h-4" /> Aufnahme starten
          </button>
        ) : (
          <button onClick={stop} disabled={busy} className="btn-danger">
            <Square className="w-4 h-4" /> Stopp
          </button>
        )}
        {!ready && !recording && <span className="text-sm text-warn">Nicht bereit: {notReadyReason(camera)}</span>}
      </div>
    </div>
  );
};

/** Controls for the selected camera car: one place for photo, video and its settings. */
export const CameraPanel: React.FC = () => {
  const camera = useSelectedCamera();
  const [tab, setTab] = useState<Tab>('video');
  if (!camera) return null;

  const tabs: Array<[Tab, string, React.ReactNode]> = [
    ['video', 'Video', <Video key="v" className="w-4 h-4" />],
    ['photo', 'Foto', <CameraIcon key="p" className="w-4 h-4" />],
    ['settings', 'Einstellungen', <Settings2 key="s" className="w-4 h-4" />]
  ];

  return (
    <section className="panel">
      <h2 className="panel-title">
        Wagen: <span className="text-fg normal-case tracking-normal">{camera.name}</span>
      </h2>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={tab === id ? 'tab-active' : 'tab'}>
            {icon}
            {label}
          </button>
        ))}
      </div>
      {/* key: reset form state when another car is selected */}
      {tab === 'photo' && <PhotoTab key={camera.id} camera={camera} />}
      {tab === 'video' && <VideoTab key={camera.id} camera={camera} />}
      {tab === 'settings' && <RotationSettings camera={camera} />}
    </section>
  );
};
