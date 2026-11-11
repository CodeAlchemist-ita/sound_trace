// Browsers can't run tasks while the page is closed. On PC the app syncs while
// it is open instead (see useSync's periodic timer).
export async function registerBackgroundSync() {}
export async function unregisterBackgroundSync() {}
