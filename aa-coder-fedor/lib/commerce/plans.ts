/** CBR USD/RUB on 2026-09-16. */
export const USD_RUB = 84.2362;

export function rubFromUsd(usd: number): number {
  return Math.round(usd * USD_RUB);
}

/**
 * Grok (x.ai/pricing, Sep 2026): Free $0, SuperGrok Lite $10, SuperGrok $30,
 * SuperGrok Plus $100, SuperGrok Heavy $300/mo. Extra credits from $5.
 * xAI does not publish token numbers; it meters a weekly compute pool (paid)
 * and a separate Free chat window. Community-reported Free cap is 10 messages
 * per 2 hours; SuperGrok ~1000 messages/day; Heavy ~10000/day. We convert
 * 1 message = 2000 tokens so the meter is numeric and those caps match.
 */
export const TOKENS_PER_MESSAGE = 2000;
export const FREE_MESSAGES_PER_WINDOW = 10;
export const FREE_WINDOW_MS = 2 * 60 * 60 * 1000;

export type PlanId = "free" | "lite" | "super" | "plus" | "heavy";
export type PayMethod = "sbp" | "yoomoney" | "crypto";
export type CryptoAsset = "USDT" | "BTC" | "TON";

export type Plan = {
  id: PlanId;
  name: string;
  grokTwin: string;
  usdMonth: number;
  usdYear: number | null;
  rubMonth: number;
  rubYear: number | null;
  tokensPerWeek: number | null;
  freeWindowTokens: number | null;
  blurb: string;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Пробный",
    grokTwin: "Пробный",
    usdMonth: 0,
    usdYear: null,
    rubMonth: 0,
    rubYear: null,
    tokensPerWeek: null,
    freeWindowTokens: FREE_MESSAGES_PER_WINDOW * TOKENS_PER_MESSAGE,
    blurb: "10 сообщений каждые 2 часа. 20 000 токенов на окно. Без оплаты.",
  },
  {
    id: "lite",
    name: "Fedor Lite",
    grokTwin: "Fedor Lite",
    usdMonth: 10,
    usdYear: null,
    rubMonth: rubFromUsd(10),
    rubYear: null,
    tokensPerWeek: 200 * TOKENS_PER_MESSAGE * 7,
    freeWindowTokens: null,
    blurb: "Входной недельный пул. 2 800 000 токенов / неделя.",
  },
  {
    id: "super",
    name: "Fedor",
    grokTwin: "Fedor",
    usdMonth: 30,
    usdYear: 300,
    rubMonth: rubFromUsd(30),
    rubYear: rubFromUsd(300),
    tokensPerWeek: 1000 * TOKENS_PER_MESSAGE * 7,
    freeWindowTokens: null,
    blurb: "1 000 сообщений/день. 14 000 000 токенов / неделя.",
  },
  {
    id: "plus",
    name: "Fedor Plus",
    grokTwin: "Fedor Plus",
    usdMonth: 100,
    usdYear: null,
    rubMonth: rubFromUsd(100),
    rubYear: null,
    tokensPerWeek: 3333 * TOKENS_PER_MESSAGE * 7,
    freeWindowTokens: null,
    blurb: "Заметно больше, чем Fedor. 46 662 000 токенов / неделя.",
  },
  {
    id: "heavy",
    name: "Fedor Heavy",
    grokTwin: "Fedor Heavy",
    usdMonth: 300,
    usdYear: 3000,
    rubMonth: rubFromUsd(300),
    rubYear: rubFromUsd(3000),
    tokensPerWeek: 10000 * TOKENS_PER_MESSAGE * 7,
    freeWindowTokens: null,
    blurb: "10 000 сообщений/день. 140 000 000 токенов / неделя.",
  },
];

export const EXTRA_CREDIT_USD = 5;
export const EXTRA_CREDIT_RUB = rubFromUsd(EXTRA_CREDIT_USD);
export const EXTRA_CREDIT_TOKENS = 400_000;
export const RATE_DATE = "2026-09-16";

export function planById(id: string | undefined | null): Plan {
  return PLANS.find((item) => item.id === id) ?? PLANS[0];
}

export function estimateTokens(text: string): number {
  const n = String(text || "").length;
  return Math.max(1, Math.ceil(n / 4));
}

/** One Grok-style request = one chat turn = 2000 tokens. */
export function tokensForChatTurn(text: string): number {
  return Math.max(TOKENS_PER_MESSAGE, estimateTokens(text));
}

export function formatRub(amount: number): string {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function tokensLabel(plan: Plan): string {
  if (plan.id === "free") {
    return `${formatTokens(plan.freeWindowTokens || 0)} ток. / 2 ч`;
  }
  return `${formatTokens(plan.tokensPerWeek || 0)} ток. / неделя`;
}
