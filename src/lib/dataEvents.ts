import { useEffect, useState } from 'react';

// Tiny pub/sub so every screen refreshes after a sync or an import.
let version = 0;
const listeners = new Set<(v: number) => void>();

export function notifyDataChanged() {
  version += 1;
  listeners.forEach((l) => l(version));
}

export function useDataVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
