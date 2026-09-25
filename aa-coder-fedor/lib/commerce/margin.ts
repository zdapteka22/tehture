import {
  EXTRA_CREDIT_RUB,
  EXTRA_CREDIT_TOKENS,
  PLANS,
  USD_RUB,
  type Plan,
} from "./plans";

/**
 * Official DeepSeek API card, 16 Sep 2026:
 * https://api-docs.deepseek.com/quick_start/pricing
 * USD per 1M tokens. Peak = Mon–Fri 01:00–04:00 and 06:00–10:00 UTC.
 */
export const DEEPSEEK_DOCS_URL = "https://api-docs.deepseek.com/quick_start/pricing";
export const MARGIN_AS_OF = "2026-09-16";
export const WEEKS_BILLED_PER_MONTH = 4;
export const PEAK_HOUR_SHARE = 35 / 168;

export type RateCard = {
  hit: number;
  miss: number;
  out: number;
};

export type ModelRates = {
  id: string;
  off: RateCard;
  peak: RateCard;
};

export const DEEPSEEK_FLASH: ModelRates = {
  id: "deepseek-flash (V4.1-Flash)",
  off: { hit: 0.003, miss: 0.15, out: 0.6 },
  peak: { hit: 0.006, miss: 0.3, out: 1.2 },
};

export const DEEPSEEK_PRO: ModelRates = {
  id: "deepseek-v4-pro",
  off: { hit: 0.022, miss: 0.66, out: 1.98 },
  peak: { hit: 0.044, miss: 1.32, out: 3.96 },
};

export type Mix = {
  inputShare: number;
  cacheHitRate: number;
};

/** Typical coding chat after prefix cache kicks in. */
export const MIX_BASE: Mix = { inputShare: 0.75, cacheHitRate: 0.5 };
/** No cache, more output — conservative for the seller. */
export const MIX_CONSERVATIVE: Mix = { inputShare: 0.7, cacheHitRate: 0 };
/** Follow-up turns with a warm cache. */
export const MIX_OPTIMISTIC: Mix = { inputShare: 0.8, cacheHitRate: 0.8 };

export function usdToRub(usd: number): number {
  return usd * USD_RUB;
}

export function blendUsdPerMillion(model: ModelRates, mix: Mix): number {
  const one = (card: RateCard) =>
    mix.inputShare * mix.cacheHitRate * card.hit +
    mix.inputShare * (1 - mix.cacheHitRate) * card.miss +
    (1 - mix.inputShare) * card.out;
  return (1 - PEAK_HOUR_SHARE) * one(model.off) + PEAK_HOUR_SHARE * one(model.peak);
}

export type PlanMargin = {
  id: string;
  name: string;
  grokTwin: string;
  usdMonth: number;
  rubMonth: number;
  tokensMonth: number;
  tokensLabel: string;
  costUsd: number;
  costRub: number;
  marginRub: number;
  marginPct: number | null;
  sellRubPerMillion: number | null;
  buyRubPerMillion: number;
  markupX: number | null;
};

function monthTokens(plan: Plan): number | null {
  if (!plan.tokensPerWeek) return null;
  return plan.tokensPerWeek * WEEKS_BILLED_PER_MONTH;
}

export function marginForTokens(options: {
  name: string;
  id: string;
  grokTwin: string;
  usd: number;
  rub: number;
  tokens: number;
  buyUsdPerMillion: number;
}): PlanMargin {
  const costUsd = (options.tokens / 1_000_000) * options.buyUsdPerMillion;
  const costRub = usdToRub(costUsd);
  const marginRub = options.rub - costRub;
  const marginPct = options.rub > 0 ? (100 * marginRub) / options.rub : null;
  const sellRubPerMillion = options.tokens > 0 ? options.rub / (options.tokens / 1_000_000) : null;
  const buyRubPerMillion = usdToRub(options.buyUsdPerMillion);
  const markupX =
    costRub > 0 && options.rub > 0 ? options.rub / costRub : null;
  return {
    id: options.id,
    name: options.name,
    grokTwin: options.grokTwin,
    usdMonth: options.usd,
    rubMonth: options.rub,
    tokensMonth: options.tokens,
    tokensLabel: `${(options.tokens / 1_000_000).toFixed(3).replace(/\.?0+$/, "")} млн`,
    costUsd,
    costRub,
    marginRub,
    marginPct,
    sellRubPerMillion,
    buyRubPerMillion,
    markupX,
  };
}

export function paidPlanMargins(buyUsdPerMillion: number, usage = 1): PlanMargin[] {
  return PLANS.filter((plan) => plan.tokensPerWeek).map((plan) => {
    const tokens = (monthTokens(plan) || 0) * usage;
    return marginForTokens({
      id: plan.id,
      name: plan.name,
      grokTwin: plan.grokTwin,
      usd: plan.usdMonth,
      rub: plan.rubMonth,
      tokens,
      buyUsdPerMillion,
    });
  });
}

export function extraCreditMargin(buyUsdPerMillion: number): PlanMargin {
  return marginForTokens({
    id: "extra",
    name: "Доп. пакет",
    grokTwin: "Extra credits $5",
    usd: 5,
    rub: EXTRA_CREDIT_RUB,
    tokens: EXTRA_CREDIT_TOKENS,
    buyUsdPerMillion,
  });
}

export function freeMonthlyCost(
  buyUsdPerMillion: number,
  messagesPerDay: number,
  tokensPerMessage = 2000,
) {
  const days = 365.25 / 12;
  const tokens = messagesPerDay * tokensPerMessage * days;
  const costUsd = (tokens / 1_000_000) * buyUsdPerMillion;
  return { tokens, costUsd, costRub: usdToRub(costUsd) };
}

export const FLASH_BASE_USD_PER_M = blendUsdPerMillion(DEEPSEEK_FLASH, MIX_BASE);
export const FLASH_CONSERV_USD_PER_M = blendUsdPerMillion(DEEPSEEK_FLASH, MIX_CONSERVATIVE);
export const FLASH_OPT_USD_PER_M = blendUsdPerMillion(DEEPSEEK_FLASH, MIX_OPTIMISTIC);
export const PRO_BASE_USD_PER_M = blendUsdPerMillion(DEEPSEEK_PRO, MIX_BASE);
export const PRO_CONSERV_USD_PER_M = blendUsdPerMillion(DEEPSEEK_PRO, MIX_CONSERVATIVE);

export function formatRub(n: number, digits = 0): string {
  const value = digits === 0 ? Math.round(n) : Number(n.toFixed(digits));
  const [int, frac] = String(value).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return frac ? `${grouped},${frac}` : grouped;
}

export function formatPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1).replace(".", ",")} %`;
}

export function formatUsd(n: number, digits = 4): string {
  return `$${n.toFixed(digits)}`;
}
