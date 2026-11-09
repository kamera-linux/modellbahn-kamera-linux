import { create } from 'zustand';

export interface Toast {
  id: number;
  type: 'success' | 'error';
  text: string;
}

interface ToastState {
  toasts: Toast[];
  show: (type: Toast['type'], text: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Messages in the bottom right corner – visible wherever the page is scrolled to. */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (type, text) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, type, text }].slice(-4) });
    setTimeout(() => get().dismiss(id), type === 'error' ? 8000 : 5000);
  },
  dismiss: id => set({ toasts: get().toasts.filter(t => t.id !== id) })
}));

export const toast = {
  success: (text: string) => useToastStore.getState().show('success', text),
  error: (text: string) => useToastStore.getState().show('error', text)
};
