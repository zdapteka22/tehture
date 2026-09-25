import { createHash } from "node:crypto";

import { hasYookassa, type PayConfig } from "./pay-config";

export type YookassaPayment = {
  id: string;
  status: string;
  paid: boolean;
  confirmationUrl: string;
  amount: string;
};

export type YoomoneyOperation = {
  operationId: string;
  status: string;
  amount: number;
  label: string;
  datetime: string;
};

let payFetch: typeof fetch = fetch;

export function setPayFetch(fn: typeof fetch): void {
  payFetch = fn;
}

function basicAuth(shopId: string, secret: string): string {
  return `Basic ${Buffer.from(`${shopId}:${secret}`, "utf8").toString("base64")}`;
}

export function yoomoneyQuickpayUrl(input: {
  receiver: string;
  sum: number;
  label: string;
  targets: string;
  paymentType?: "SB" | "PC" | "AC";
}): string {
  const params = new URLSearchParams({
    receiver: input.receiver,
    "quickpay-form": "shop",
    targets: input.targets,
    paymentType: input.paymentType || "SB",
    sum: Number(input.sum).toFixed(2),
    label: input.label,
  });
  return `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;
}

export async function createYookassaPayment(input: {
  cfg: PayConfig;
  invoiceId: string;
  amountRub: number;
  description: string;
  returnUrl?: string;
  sbp?: boolean;
}): Promise<YookassaPayment> {
  if (!hasYookassa(input.cfg)) throw new Error("ЮKassa не настроена");
  const body: Record<string, unknown> = {
    amount: { value: Number(input.amountRub).toFixed(2), currency: "RUB" },
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: input.returnUrl || "http://127.0.0.1:43223/pay",
    },
    description: input.description.slice(0, 128),
    metadata: { invoiceId: input.invoiceId },
  };
  if (input.sbp) body.payment_method_data = { type: "sbp" };
  const response = await payFetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: basicAuth(input.cfg.yookassaShopId, input.cfg.yookassaSecret),
      "Content-Type": "application/json",
      "Idempotence-Key": input.invoiceId,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    id?: string;
    status?: string;
    paid?: boolean;
    confirmation?: { confirmation_url?: string };
    amount?: { value?: string };
    description?: string;
    type?: string;
    code?: string;
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.description || payload.code || `ЮKassa не создала платёж (${response.status})`);
  }
  return {
    id: payload.id,
    status: payload.status || "pending",
    paid: Boolean(payload.paid),
    confirmationUrl: payload.confirmation?.confirmation_url || "",
    amount: payload.amount?.value || Number(input.amountRub).toFixed(2),
  };
}

export async function getYookassaPayment(cfg: PayConfig, paymentId: string): Promise<YookassaPayment> {
  if (!hasYookassa(cfg)) throw new Error("ЮKassa не настроена");
  const response = await payFetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: basicAuth(cfg.yookassaShopId, cfg.yookassaSecret) },
  });
  const payload = (await response.json()) as {
    id?: string;
    status?: string;
    paid?: boolean;
    confirmation?: { confirmation_url?: string };
    amount?: { value?: string };
    description?: string;
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.description || `ЮKassa не ответила (${response.status})`);
  }
  return {
    id: payload.id,
    status: payload.status || "",
    paid: Boolean(payload.paid) || payload.status === "succeeded",
    confirmationUrl: payload.confirmation?.confirmation_url || "",
    amount: payload.amount?.value || "",
  };
}

export async function yoomoneyOperationsByLabel(cfg: PayConfig, label: string): Promise<YoomoneyOperation[]> {
  if (!cfg.yoomoneyToken) throw new Error("Нет токена истории ЮMoney");
  const body = new URLSearchParams({
    records: "30",
    label,
  });
  const response = await payFetch("https://yoomoney.ru/api/operation-history", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.yoomoneyToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json()) as {
    operations?: Array<{
      operation_id?: string;
      status?: string;
      amount?: number | string;
      label?: string;
      datetime?: string;
    }>;
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `История ЮMoney (${response.status})`);
  }
  return (payload.operations || []).map((item) => ({
    operationId: String(item.operation_id || ""),
    status: String(item.status || ""),
    amount: Number(item.amount || 0),
    label: String(item.label || ""),
    datetime: String(item.datetime || ""),
  }));
}

/** Official HTTP-notification digest. Fields in this exact order. */
export function yoomoneyNotificationHash(input: {
  notification_type: string;
  operation_id: string;
  amount: string;
  currency: string;
  datetime: string;
  sender: string;
  codepro: string;
  notification_secret: string;
  label: string;
}): string {
  const raw = [
    input.notification_type,
    input.operation_id,
    input.amount,
    input.currency,
    input.datetime,
    input.sender,
    input.codepro,
    input.notification_secret,
    input.label,
  ].join("&");
  return createHash("sha1").update(raw, "utf8").digest("hex");
}

export function verifyYoomoneyNotification(
  fields: Record<string, string>,
  notificationSecret: string,
): { ok: boolean; label: string; operationId: string; amount: string } {
  const pick = (name: string) => String(fields[name] ?? "").trim();
  const expected = yoomoneyNotificationHash({
    notification_type: pick("notification_type"),
    operation_id: pick("operation_id"),
    amount: pick("amount"),
    currency: pick("currency"),
    datetime: pick("datetime"),
    sender: pick("sender"),
    codepro: pick("codepro"),
    notification_secret: notificationSecret,
    label: pick("label"),
  });
  const given = pick("sha1_hash").toLowerCase();
  return {
    ok: Boolean(given) && given === expected.toLowerCase(),
    label: pick("label"),
    operationId: pick("operation_id"),
    amount: pick("amount"),
  };
}
