import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ensureHubRoot, hubRoot } from "./hub-dir";
import { looksLikeYookassaSecret } from "./yookassa-shop";

export type PayConfig = {
  yookassaShopId: string;
  yookassaSecret: string;
  yoomoneyReceiver: string;
  yoomoneySecret: string;
  yoomoneyToken: string;
  sbpPhone: string;
  sbpRequisites: string;
  cryptoUsdt: string;
  cryptoBtc: string;
  cryptoTon: string;
};

export type PayConfigInput = Partial<PayConfig>;

export type PublicPayView = {
  yookassa: boolean;
  yoomoney: boolean;
  sbp: boolean;
  crypto: boolean;
  wallets: { usdt: string; btc: string; ton: string };
  receiver: string;
  shopId: string;
  locked: boolean;
  note: string;
};

export type SellerPayView = {
  locked: boolean;
  yookassaShopId: string;
  yookassaSecretSet: boolean;
  yoomoneyReceiver: string;
  yoomoneySecretSet: boolean;
  yoomoneyTokenSet: boolean;
  sbpPhone: string;
  sbpRequisites: string;
  cryptoUsdt: string;
  cryptoBtc: string;
  cryptoTon: string;
};

const EMPTY: PayConfig = {
  yookassaShopId: "",
  yookassaSecret: "",
  yoomoneyReceiver: "",
  yoomoneySecret: "",
  yoomoneyToken: "",
  sbpPhone: "",
  sbpRequisites: "",
  cryptoUsdt: "",
  cryptoBtc: "",
  cryptoTon: "",
};

const ENV_KEYS: Record<keyof PayConfig, string> = {
  yookassaShopId: "FEDOR_YOOKASSA_SHOP_ID",
  yookassaSecret: "FEDOR_YOOKASSA_SECRET",
  yoomoneyReceiver: "FEDOR_YOOMONEY_RECEIVER",
  yoomoneySecret: "FEDOR_YOOMONEY_SECRET",
  yoomoneyToken: "FEDOR_YOOMONEY_TOKEN",
  sbpPhone: "FEDOR_SBP_PHONE",
  sbpRequisites: "FEDOR_SBP_REQUISITES",
  cryptoUsdt: "FEDOR_CRYPTO_USDT",
  cryptoBtc: "FEDOR_CRYPTO_BTC",
  cryptoTon: "FEDOR_CRYPTO_TON",
};

export function payConfigPath(): string {
  return path.join(hubRoot(), "pay.json");
}

function trim(value: unknown): string {
  return String(value || "").trim();
}

function fromFile(): PayConfig {
  try {
    if (!existsSync(payConfigPath())) return { ...EMPTY };
    const parsed = JSON.parse(readFileSync(payConfigPath(), "utf8")) as Partial<PayConfig>;
    return {
      yookassaShopId: trim(parsed.yookassaShopId),
      yookassaSecret: trim(parsed.yookassaSecret),
      yoomoneyReceiver: trim(parsed.yoomoneyReceiver),
      yoomoneySecret: trim(parsed.yoomoneySecret),
      yoomoneyToken: trim(parsed.yoomoneyToken),
      sbpPhone: trim(parsed.sbpPhone),
      sbpRequisites: trim(parsed.sbpRequisites),
      cryptoUsdt: trim(parsed.cryptoUsdt),
      cryptoBtc: trim(parsed.cryptoBtc),
      cryptoTon: trim(parsed.cryptoTon),
    };
  } catch {
    return { ...EMPTY };
  }
}

function fromEnv(): Partial<PayConfig> {
  const out: Partial<PayConfig> = {};
  (Object.keys(ENV_KEYS) as (keyof PayConfig)[]).forEach((key) => {
    const value = trim(process.env[ENV_KEYS[key]]);
    if (value) out[key] = value;
  });
  return out;
}

export function getPayConfig(): PayConfig {
  return { ...EMPTY, ...fromFile(), ...fromEnv() };
}

/** Baked installer env wins — buyer cannot replace seller wallets from Settings. */
export function payConfigLocked(): boolean {
  const env = fromEnv();
  return Boolean(
    env.yookassaShopId ||
      env.yookassaSecret ||
      env.yoomoneyReceiver ||
      env.yoomoneySecret ||
      env.yoomoneyToken ||
      env.sbpPhone ||
      env.sbpRequisites ||
      env.cryptoUsdt ||
      env.cryptoBtc ||
      env.cryptoTon,
  );
}

export function savePayConfig(input: PayConfigInput, adminKey = ""): PayConfig {
  if (payConfigLocked()) {
    const expected = trim(process.env.FEDOR_HUB_ADMIN_KEY);
    if (!expected || adminKey !== expected) {
      throw new Error("Реквизиты заданы в сборке. Сменить их может только продавец с ключом учёта.");
    }
  }
  const current = fromFile();
  const next: PayConfig = { ...current };
  if (looksLikeYookassaSecret(trim(input.yoomoneyToken)) && !trim(input.yookassaSecret)) {
    input = { ...input, yookassaSecret: trim(input.yoomoneyToken), yoomoneyToken: current.yoomoneyToken };
  }
  if (looksLikeYookassaSecret(trim(input.yoomoneySecret)) && !trim(input.yookassaSecret)) {
    input = { ...input, yookassaSecret: trim(input.yoomoneySecret), yoomoneySecret: current.yoomoneySecret };
  }
  (Object.keys(EMPTY) as (keyof PayConfig)[]).forEach((key) => {
    if (input[key] === undefined) return;
    const value = trim(input[key]);
    if (!value && (key === "yookassaSecret" || key === "yoomoneySecret" || key === "yoomoneyToken")) {
      return;
    }
    next[key] = value;
  });
  ensureHubRoot();
  const dest = payConfigPath();
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, dest);
  } catch {
    writeFileSync(dest, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
  return getPayConfig();
}

export function hasYookassa(cfg = getPayConfig()): boolean {
  return Boolean(cfg.yookassaShopId && cfg.yookassaSecret);
}

export function hasYoomoneyWallet(cfg = getPayConfig()): boolean {
  return Boolean(cfg.yoomoneyReceiver);
}

export function hasYoomoneyVerify(cfg = getPayConfig()): boolean {
  return hasYookassa(cfg) || Boolean(cfg.yoomoneyToken) || Boolean(cfg.yoomoneySecret);
}

export function hasSbp(cfg = getPayConfig()): boolean {
  return hasYookassa(cfg) || hasYoomoneyWallet(cfg) || Boolean(cfg.sbpPhone || cfg.sbpRequisites);
}

export function cryptoAddress(cfg: PayConfig, asset: "USDT" | "BTC" | "TON"): string {
  if (asset === "USDT") return cfg.cryptoUsdt;
  if (asset === "BTC") return cfg.cryptoBtc;
  return cfg.cryptoTon;
}

export function hasCrypto(cfg = getPayConfig(), asset?: "USDT" | "BTC" | "TON"): boolean {
  if (asset) return Boolean(cryptoAddress(cfg, asset));
  return Boolean(cfg.cryptoUsdt || cfg.cryptoBtc || cfg.cryptoTon);
}

export function paymentsReady(cfg = getPayConfig()): boolean {
  return hasYookassa(cfg) || hasYoomoneyWallet(cfg) || hasSbp(cfg) || hasCrypto(cfg);
}

export function payReadinessNote(cfg = getPayConfig()): string {
  if (paymentsReady(cfg)) {
    return "Оплата российской картой, СБП и криптовалютой. После перевода нажмите «Проверить оплату».";
  }
  return "Вставьте реквизиты карты/СБП и адреса кошельков в Настройки → Приём оплаты. Выдуманных реквизитов нет.";
}

export function publicPayView(cfg = getPayConfig()): PublicPayView {
  return {
    yookassa: hasYookassa(cfg),
    yoomoney: hasYookassa(cfg) || hasYoomoneyWallet(cfg),
    sbp: hasSbp(cfg),
    crypto: hasCrypto(cfg),
    wallets: {
      usdt: cfg.cryptoUsdt,
      btc: cfg.cryptoBtc,
      ton: cfg.cryptoTon,
    },
    receiver: cfg.yoomoneyReceiver,
    shopId: cfg.yookassaShopId,
    locked: payConfigLocked(),
    note: payReadinessNote(cfg),
  };
}

export function sellerPayView(cfg = getPayConfig()): SellerPayView {
  return {
    locked: payConfigLocked(),
    yookassaShopId: cfg.yookassaShopId,
    yookassaSecretSet: Boolean(cfg.yookassaSecret),
    yoomoneyReceiver: cfg.yoomoneyReceiver,
    yoomoneySecretSet: Boolean(cfg.yoomoneySecret),
    yoomoneyTokenSet: Boolean(cfg.yoomoneyToken),
    sbpPhone: cfg.sbpPhone,
    sbpRequisites: cfg.sbpRequisites,
    cryptoUsdt: cfg.cryptoUsdt,
    cryptoBtc: cfg.cryptoBtc,
    cryptoTon: cfg.cryptoTon,
  };
}

/** Lines for Setup.bat .env.local. Empty values are skipped. Never invent wallets. */
export function bakePayEnvLines(cfg = getPayConfig()): string[] {
  const lines: string[] = [];
  (Object.keys(ENV_KEYS) as (keyof PayConfig)[]).forEach((key) => {
    if (cfg[key]) lines.push(`${ENV_KEYS[key]}=${cfg[key]}`);
  });
  return lines;
}
