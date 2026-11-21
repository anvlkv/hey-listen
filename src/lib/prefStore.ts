/**
 * Small browser-storage helpers for app-level preferences (toggles that are remembered
 * across projects but are not project content). Storage may be unavailable (private
 * mode), so both calls fall back to the in-memory default rather than throwing.
 */

export function loadBoolPref(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

export function saveBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not persisting is fine; the choice still applies for this session.
  }
}
