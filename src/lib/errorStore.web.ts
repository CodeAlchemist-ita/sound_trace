// Browser: the error log lives in this site's localStorage.
const KEY = 'error_log';

export const errorStore = {
  async read(): Promise<string | null> {
    return window.localStorage.getItem(KEY);
  },
  async write(text: string) {
    window.localStorage.setItem(KEY, text);
  },
  async clear() {
    window.localStorage.removeItem(KEY);
  },
};
