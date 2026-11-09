import React from 'react';

const PRESETS = [10, 30, 60, 5 * 60, 15 * 60, 30 * 60, 60 * 60];

export const formatDuration = (s: number) =>
  s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;

/** Recording length: quick choices plus a slider in whole minutes. Value in seconds. */
export const DurationPicker: React.FC<{ value: number; onChange: (seconds: number) => void; disabled?: boolean }> = ({
  value,
  onChange,
  disabled
}) => (
  <div>
    <label className="field-label">
      Dauer: <span className="text-accent font-semibold">{formatDuration(value)}</span>
    </label>
    <div className="flex flex-wrap gap-1.5 mb-2">
      {PRESETS.map(p => (
        <button key={p} type="button" disabled={disabled} onClick={() => onChange(p)} className={p === value ? 'chip-active' : 'chip'}>
          {formatDuration(p)}
        </button>
      ))}
    </div>
    <input
      type="range"
      min={1}
      max={60}
      value={Math.max(1, Math.round(value / 60))}
      onChange={e => onChange(parseInt(e.target.value, 10) * 60)}
      disabled={disabled}
      className="w-full disabled:opacity-50"
      aria-label="Dauer in Minuten"
    />
  </div>
);
