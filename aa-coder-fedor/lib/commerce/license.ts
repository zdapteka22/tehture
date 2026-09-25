import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { planById, type PlanId } from "./plans";

/** Public half of the seller key. Private key stays out of the installer. */
export const LICENSE_PUBLIC_KEY_SPKI = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuLYWG+InMNCFah/pow/IsnuYc1I3GPy7vQbMEQhbyWI=
-----END PUBLIC KEY-----
`;

export type LicensePayload = {
  v: 1;
  email: string;
  planId: PlanId;
  extraTokens?: number;
  invoiceId?: string;
  jti: string;
  iat: number;
  exp: number;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function encodeLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(sign(null, Buffer.from(body, "utf8"), createPrivateKey(privateKeyPem)));
  return `FEDOR1.${body}.${sig}`;
}

export function issueLicense(input: {
  email: string;
  planId?: PlanId;
  extraTokens?: number;
  invoiceId?: string;
  days?: number;
  privateKeyPem: string;
}): { code: string; payload: LicensePayload } {
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Нужна почта покупателя");
  const plan = planById(input.planId);
  const now = Date.now();
  const payload: LicensePayload = {
    v: 1,
    email,
    planId: plan.id === "free" && !input.extraTokens ? "super" : plan.id,
    extraTokens: input.extraTokens && input.extraTokens > 0 ? Math.floor(input.extraTokens) : undefined,
    invoiceId: input.invoiceId,
    jti: createHash("sha256").update(`${email}:${now}:${Math.random()}`).digest("hex").slice(0, 20),
    iat: now,
    exp: now + Math.max(1, input.days || 400) * 24 * 60 * 60 * 1000,
  };
  if (payload.planId === "free" && !payload.extraTokens) payload.planId = "super";
  return { code: encodeLicense(payload, input.privateKeyPem), payload };
}

export function verifyLicense(code: string): LicensePayload {
  const raw = String(code || "").trim().replace(/\s+/g, "");
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "FEDOR1") throw new Error("Неверный код активации");
  const ok = verify(
    null,
    Buffer.from(parts[1], "utf8"),
    createPublicKey(LICENSE_PUBLIC_KEY_SPKI),
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("Код активации не принят");
  let payload: LicensePayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as LicensePayload;
  } catch {
    throw new Error("Код активации повреждён");
  }
  if (payload.v !== 1 || !payload.email || !payload.jti) throw new Error("Код активации неполный");
  if (payload.exp && Date.now() > payload.exp) throw new Error("Код активации просрочен");
  planById(payload.planId);
  return payload;
}

export function licenseFingerprint(code: string): string {
  return createHash("sha256").update(String(code || "").trim()).digest("hex");
}
