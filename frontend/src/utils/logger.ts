export const logger = {
  info: (message: string, data?: unknown) => console.log(`[INFO] ${message}`, data ?? ''),
  error: (message: string, error?: unknown) => console.error(`[ERROR] ${message}`, error ?? ''),
  warn: (message: string, data?: unknown) => console.warn(`[WARN] ${message}`, data ?? ''),
  debug: (message: string, data?: unknown) => {
    if (import.meta.env.DEV) console.debug(`[DEBUG] ${message}`, data ?? '');
  }
};
