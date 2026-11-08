import axios from 'axios';
import type {
  Camera,
  CaptureOptions,
  RecordingOptions,
  CaptureSchedule,
  ScheduleStatus,
  RecordingSession,
  MediaFile,
  DiagnosticResult,
  Rotation
} from '@shared/types';

export type {
  Camera,
  CaptureOptions,
  RecordingOptions,
  CaptureSchedule,
  ScheduleStatus,
  RecordingSession,
  MediaFile,
  DiagnosticResult,
  Rotation
};

export type ScheduleInput = Omit<CaptureSchedule, 'id' | 'createdAt'>;

const API_BASE = '/api';
const http = axios.create({ baseURL: API_BASE });

/** Best error text from an axios error: the backend's `{ error }` if present. */
export function errorMessage(err: unknown, fallback = 'Unbekannter Fehler'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

const enc = encodeURIComponent;

export const api = {
  // Cameras
  getCameras: () => http.get<Camera[]>('/cameras'),
  getCamera: (id: string) => http.get<Camera>(`/cameras/${enc(id)}`),
  captureImage: (id: string, options: CaptureOptions = {}) =>
    http.post<{ success: boolean; file: string }>(`/cameras/${enc(id)}/capture`, options),
  startRecording: (id: string, options: RecordingOptions = {}) =>
    http.post<{ success: boolean; sessionId: string }>(`/cameras/${enc(id)}/record/start`, options),
  stopRecording: (id: string) => http.post(`/cameras/${enc(id)}/record/stop`),
  updateRotation: (id: string, photoRotation?: Rotation, videoRotation?: Rotation) =>
    http.put(`/cameras/${enc(id)}/rotation`, { photoRotation, videoRotation }),

  // Schedules
  getSchedules: () => http.get<CaptureSchedule[]>('/schedules'),
  getSchedulesStatus: () => http.get<ScheduleStatus[]>('/schedules/status/all'),
  getScheduleStatus: (id: string) => http.get<ScheduleStatus>(`/schedules/${enc(id)}/status`),
  createSchedule: (config: ScheduleInput) => http.post<CaptureSchedule>('/schedules', config),
  updateSchedule: (id: string, config: Partial<ScheduleInput>) => http.put<CaptureSchedule>(`/schedules/${enc(id)}`, config),
  deleteSchedule: (id: string) => http.delete(`/schedules/${enc(id)}`),

  // Videos
  getVideos: () => http.get<MediaFile[]>('/videos'),
  getRecordingSessions: () => http.get<RecordingSession[]>('/videos/sessions'),
  getRecordingProgress: (sessionId: string) => http.get<RecordingSession>(`/videos/sessions/${enc(sessionId)}`),
  downloadVideo: (filename: string) => `${API_BASE}/videos/download/${enc(filename)}`,
  deleteVideo: (filename: string) => http.delete(`/videos/${enc(filename)}`),

  // Photos
  getPhotos: () => http.get<MediaFile[]>('/photos'),
  downloadPhoto: (filename: string) => `${API_BASE}/photos/download/${enc(filename)}`,
  deletePhoto: (filename: string) => http.delete(`/photos/${enc(filename)}`),

  // System
  getStatus: () => http.get('/system/status'),
  getDevices: () => http.get('/system/devices'),
  testConnection: (cameraId: string) => http.post<DiagnosticResult>(`/system/cameras/${enc(cameraId)}/test`)
};
