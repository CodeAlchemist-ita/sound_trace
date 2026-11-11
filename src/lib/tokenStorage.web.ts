// Browsers have no keychain: keep the tokens in this site's localStorage.
export const tokenStorage = {
  get: async (key: string) => window.localStorage.getItem(key),
  set: async (key: string, value: string) => window.localStorage.setItem(key, value),
  remove: async (key: string) => window.localStorage.removeItem(key),
};
