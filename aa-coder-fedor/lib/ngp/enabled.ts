/** New-generation path. Off by default — the shipped coder stays unchanged. */
export function isNgpOn(): boolean {
  const raw = String(process.env.FEDOR_NGP || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}
