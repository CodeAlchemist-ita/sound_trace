import * as SecureStore from 'expo-secure-store';

const options: SecureStore.SecureStoreOptions = {
  // Readable while the phone is locked, so the background sync can use it.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const tokenStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, options),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, options),
  remove: (key: string) => SecureStore.deleteItemAsync(key, options),
};
