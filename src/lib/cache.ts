const PREFIX = "pn_cache_";

export function setCache(key: string, data: any): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

export function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw).data as T;
  } catch {
    return null;
  }
}

export function getCacheAge(key: string): number {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return Infinity;
    return (Date.now() - JSON.parse(raw).ts) / 1000 / 60; // minutes
  } catch {
    return Infinity;
  }
}
