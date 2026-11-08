// Types shared between backend and frontend.
// Frontend imports these with `import type` only, so nothing ends up in the bundle.

export type CameraStatus = 'online' | 'offline' | 'recording';
export type Rotation = 0 | 90 | 180 | 270;
export type AutofocusMode = 'manual' | 'continuous' | 'auto';
export type AutofocusRange = 'normal' | 'macro' | 'full';
export type HdrMode = 'auto' | 'off';

export interface ScriptSyncStatus {
  state: 'unknown' | 'checking' | 'syncing' | 'ready' | 'error';
  version?: string; // script bundle version on the manager
  checkedAt?: string;
  updatedAt?: string; // last time scripts were uploaded
  error?: string;
  warnings?: string[];
  cameras?: string[]; // sensor models found by the self-check
}

export interface Camera {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  status: CameraStatus;
  lastSeen?: string | Date;
  photoRotation: Rotation;
  videoRotation: Rotation;
  sync: ScriptSyncStatus; // only "ready" cameras may capture/record
}

export interface CaptureOptions {
  resolution?: string; // "WIDTHxHEIGHT"
  quality?: number; // JPEG quality 1-100
  autofocusMode?: AutofocusMode;
  autofocusRange?: AutofocusRange;
  hdr?: HdrMode;
  roi?: string; // "x,y,w,h", each 0.0-1.0
}

export interface RecordingOptions extends CaptureOptions {
  duration?: number; // seconds
  audio?: boolean; // add sound from the manager's microphone
  fps?: number; // frames per second (default 30)
}

export interface GroupRecordingRequest extends RecordingOptions {
  cameraIds?: string[]; // default: all cameras
}

export interface GroupRecordingResult {
  groupId: string;
  startAt: string; // ISO time all cars start at
  started: Array<{ cameraId: string; cameraName: string; sessionId: string }>;
  skipped: Array<{ cameraId: string; cameraName: string; reason: string }>;
}

export interface AudioStatus {
  configured: boolean;
  input: string | null;
  recording: boolean;
  users: number;
  lastError?: string;
}

export interface RecordingSession {
  id: string;
  cameraId: string;
  cameraName: string;
  startTime: string | Date;
  duration: number; // seconds
  filename: string;
  remoteFile: string;
  status: 'waiting' | 'recording' | 'stopping' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
  warning?: string; // e.g. audio could not be added – the video itself is fine
  audio?: boolean;
  groupId?: string; // set for "record all"
  startOffsetMs?: number; // actual start minus planned start (synchronised start)
}

export interface CaptureSchedule extends CaptureOptions {
  id: string;
  name: string;
  cameraIds: string[];
  interval: number; // minutes, 1-10
  enabled: boolean;
  startTime?: string; // HH:mm, optional
  endTime?: string; // HH:mm, optional
  createdAt: string;
}

export interface ScheduleStatus {
  scheduleId: string;
  lastExecution?: string;
  nextExecution?: string;
  progress: number; // 0-100 within the current interval
  isRunning: boolean;
  inTimeWindow: boolean;
  lastError?: string;
}

export interface MediaFile {
  filename: string;
  size: number;
  created: string;
  url: string; // download (attachment)
  viewUrl: string; // inline, for <img>/<video>
  thumbnailUrl?: string; // small JPEG preview, if available
}

export interface DiagnosticResult {
  cameraId: string;
  host: string;
  user: string;
  port: number;
  success: boolean;
  message?: string;
  error?: string;
  timestamp: string;
  recommendations: string[];
}
