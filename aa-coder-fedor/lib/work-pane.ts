export const WORK_W_DEFAULT = 320;
export const WORK_W_SHOW = 240;
export const WORK_W_MIN = 0;
export const WORK_W_MAX = 1600;
export const WORK_W_SNAP = 80;
/** Kept so old builds still import the name. Hover-peek is off: closed stays closed. */
export const WORK_HOVER_HIDE_MS = 0;

export function loadWorkWidth(saved: unknown): number {
  if (typeof saved !== "number" || !Number.isFinite(saved) || saved < WORK_W_SHOW) {
    return WORK_W_DEFAULT;
  }
  return Math.min(WORK_W_MAX, Math.max(WORK_W_SHOW, Math.round(saved)));
}

/** Unpinned at start — like Cursor. Only an explicit true keeps it docked. */
export function loadWorkPinned(saved: unknown): boolean {
  return saved === true;
}

export function workDockShown(pinned: boolean, hovering = false): boolean {
  void hovering;
  return pinned === true;
}

export function restoreWorkWidth(width: number): number {
  return width < WORK_W_SHOW ? WORK_W_DEFAULT : width;
}

export function dragWorkWidth(current: number, delta: number): { width: number; open: boolean } {
  const next = Math.min(WORK_W_MAX, Math.max(WORK_W_MIN, Math.round(current - delta)));
  if (next < WORK_W_SNAP) {
    return { width: WORK_W_DEFAULT, open: false };
  }
  return { width: next, open: true };
}
