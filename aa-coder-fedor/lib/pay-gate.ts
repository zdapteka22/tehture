import { IS_FREE_EDITION } from "./brand";

export type PayGatePayload = {
  error?: string;
  openPay?: boolean;
  payUrl?: string;
  quota?: { blocked?: boolean; planId?: string };
};

export function payPath(reason = "trial"): string {
  return `/pay?reason=${encodeURIComponent(reason)}&auto=1`;
}

export function shouldOpenPay(payload: PayGatePayload | null | undefined, status?: number): boolean {
  if (IS_FREE_EDITION) return false;
  if (!payload) return false;
  if (payload.openPay === true) return true;
  if (payload.quota?.blocked) return true;
  void status;
  return false;
}

export function openPayPage(reason = "trial", payUrl?: string): void {
  if (IS_FREE_EDITION) return;
  const path = payUrl || payPath(reason);
  const url = path.startsWith("http") ? path : new URL(path, window.location.origin).toString();
  try {
    if (window.location.pathname.startsWith("/pay")) return;
  } catch {
    // ignore
  }
  window.location.assign(url);
}
