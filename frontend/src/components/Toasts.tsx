import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

export const Toasts: React.FC = () => {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-96" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`bg-surface border rounded-lg px-4 py-3 text-sm shadow-xl flex items-start gap-2 ${
            t.type === 'success' ? 'border-ok/50' : 'border-bad/60'
          }`}
        >
          {t.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-ok shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 text-bad shrink-0" />}
          <span className="flex-1 break-words">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" title="Schließen">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
