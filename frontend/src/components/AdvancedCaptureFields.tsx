import React from 'react';
import type { AutofocusMode, AutofocusRange, HdrMode } from '@shared/types';

export interface AdvancedCaptureValue {
  autofocusMode: AutofocusMode;
  autofocusRange: AutofocusRange;
  hdr: HdrMode;
  roi: string;
}

export const defaultAdvanced: AdvancedCaptureValue = {
  autofocusMode: 'manual',
  autofocusRange: 'normal',
  hdr: 'off',
  roi: ''
};

const ROI_PATTERN = /^\s*\d*\.?\d+\s*,\s*\d*\.?\d+\s*,\s*\d*\.?\d+\s*,\s*\d*\.?\d+\s*$/;

/** Returns an error text for an invalid ROI, or null if valid/empty. */
export function roiError(roi: string): string | null {
  if (!roi.trim()) return null;
  if (!ROI_PATTERN.test(roi)) return 'Format: x,y,w,h';
  const [x, y, w, h] = roi.split(',').map(Number);
  if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return 'Werte 0–1, x+w ≤ 1 und y+h ≤ 1';
  return null;
}

const selectClass = 'input';

/** Autofocus / HDR / ROI fields used by photo, video and schedule forms. */
export const AdvancedCaptureFields: React.FC<{
  value: AdvancedCaptureValue;
  onChange: (value: AdvancedCaptureValue) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const set = <K extends keyof AdvancedCaptureValue>(key: K, v: AdvancedCaptureValue[K]) => onChange({ ...value, [key]: v });
  const roiErr = roiError(value.roi);

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div>
        <label className="field-label">Autofokus-Modus</label>
        <select value={value.autofocusMode} onChange={e => set('autofocusMode', e.target.value as AutofocusMode)} disabled={disabled} className={selectClass}>
          <option value="manual">Manuell (fest)</option>
          <option value="auto">Einmalig vor der Aufnahme</option>
          <option value="continuous">Kontinuierlich</option>
        </select>
      </div>

      <div>
        <label className="field-label">Autofokus-Bereich</label>
        <select value={value.autofocusRange} onChange={e => set('autofocusRange', e.target.value as AutofocusRange)} disabled={disabled} className={selectClass}>
          <option value="normal">Normal</option>
          <option value="macro">Makro (nah)</option>
          <option value="full">Vollständig</option>
        </select>
      </div>

      <div>
        <label className="field-label">HDR</label>
        <select value={value.hdr} onChange={e => set('hdr', e.target.value as HdrMode)} disabled={disabled} className={selectClass}>
          <option value="off">Aus</option>
          <option value="auto">An (nur Camera Module 3)</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="field-label">Bildausschnitt / Zoom (ROI, optional)</label>
        <input
          type="text"
          placeholder="x,y,w,h – z.B. 0.25,0.25,0.5,0.5"
          value={value.roi}
          onChange={e => set('roi', e.target.value)}
          disabled={disabled}
          className={`${selectClass} text-sm ${roiErr ? '!border-bad' : ''}`}
        />
        <p className={`text-xs mt-1 ${roiErr ? 'text-bad' : 'text-muted'}`}>
          {roiErr ?? 'Bildausschnitt, 0.0–1.0 pro Achse. Leer = ganzes Bild. Autofokus/HDR wirken nur, wenn die Kamera es unterstützt.'}
        </p>
      </div>
    </div>
  );
};
