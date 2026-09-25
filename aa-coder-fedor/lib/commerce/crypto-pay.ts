import { createHash } from "node:crypto";

import type { CryptoAsset } from "./plans";

export type CryptoQuote = {
  asset: CryptoAsset;
  address: string;
  exactUsd: number;
  exactCrypto: string;
  priced: boolean;
};

export type FoundCryptoTx = {
  txId: string;
  amount: number;
  usd?: number;
  at: number;
};

let payFetch: typeof fetch = fetch;

export function setCryptoFetch(fn: typeof fetch): void {
  payFetch = fn;
}

/** Unique cents so two open invoices to the same wallet do not collide. */
export function uniqueUsdAmount(amountUsd: number, invoiceId: string, asset: CryptoAsset): number {
  const h = createHash("sha256").update(`fedor-pay|${invoiceId}|${asset}`).digest();
  const cents = (h[0] % 90) + 10;
  return Math.round(amountUsd * 100 + cents) / 100;
}

export async function fetchUsdPrices(): Promise<{ btc: number; ton: number }> {
  const out = { btc: 0, ton: 0 };
  try {
    const btc = await payFetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
    const body = (await btc.json()) as { price?: string };
    const n = Number(body.price || 0);
    if (n > 0) out.btc = n;
  } catch {
    // ignore
  }
  if (!out.btc) {
    try {
      const btc = await payFetch("https://blockchain.info/ticker");
      const body = (await btc.json()) as { USD?: { last?: number } };
      const n = Number(body.USD?.last || 0);
      if (n > 0) out.btc = n;
    } catch {
      // ignore
    }
  }
  try {
    const ton = await payFetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
    const body = (await ton.json()) as { rates?: { TON?: { prices?: { USD?: number } } } };
    const n = Number(body.rates?.TON?.prices?.USD || 0);
    if (n > 0) out.ton = n;
  } catch {
    // ignore
  }
  return out;
}

function cryptoAmount(usd: number, price: number, decimals: number): string {
  if (price <= 0) return "";
  const raw = usd / price;
  return raw.toFixed(decimals);
}

export async function quoteCrypto(input: {
  asset: CryptoAsset;
  amountUsd: number;
  invoiceId: string;
  address: string;
  prices?: { btc: number; ton: number };
}): Promise<CryptoQuote> {
  const exactUsd = uniqueUsdAmount(input.amountUsd, input.invoiceId, input.asset);
  if (input.asset === "USDT") {
    return {
      asset: "USDT",
      address: input.address,
      exactUsd,
      exactCrypto: exactUsd.toFixed(2),
      priced: true,
    };
  }
  const prices = input.prices || (await fetchUsdPrices());
  if (input.asset === "BTC") {
    const exactCrypto = cryptoAmount(exactUsd, prices.btc, 8);
    return { asset: "BTC", address: input.address, exactUsd, exactCrypto, priced: Boolean(exactCrypto) };
  }
  const exactCrypto = cryptoAmount(exactUsd, prices.ton, 4);
  return { asset: "TON", address: input.address, exactUsd, exactCrypto, priced: Boolean(exactCrypto) };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function near(actual: number, expected: number, rel: number, abs: number): boolean {
  if (expected <= 0) return false;
  return Math.abs(actual - expected) <= Math.max(abs, expected * rel);
}

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export async function listUsdtTrc20(address: string): Promise<FoundCryptoTx[]> {
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?limit=50&only_to=true&contract_address=${USDT_TRC20}`;
  const response = await payFetch(url);
  const payload = (await response.json()) as {
    data?: Array<{
      transaction_id?: string;
      value?: string;
      to?: string;
      token_info?: { decimals?: number; symbol?: string };
      block_timestamp?: number;
    }>;
  };
  return (payload.data || [])
    .filter((row) => String(row.to || "").toLowerCase() === address.toLowerCase())
    .map((row) => {
      const decimals = Number(row.token_info?.decimals ?? 6);
      return {
        txId: String(row.transaction_id || ""),
        amount: num(row.value) / 10 ** decimals,
        usd: num(row.value) / 10 ** decimals,
        at: num(row.block_timestamp),
      };
    })
    .filter((row) => row.txId && row.amount > 0);
}

export async function listBtc(address: string): Promise<FoundCryptoTx[]> {
  const response = await payFetch(`https://blockstream.info/api/address/${encodeURIComponent(address)}/txs`);
  const payload = (await response.json()) as Array<{
    txid?: string;
    status?: { block_time?: number; confirmed?: boolean };
    vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
  }>;
  if (!Array.isArray(payload)) return [];
  return payload
    .map((tx) => {
      const received = (tx.vout || [])
        .filter((out) => String(out.scriptpubkey_address || "") === address)
        .reduce((sum, out) => sum + num(out.value), 0);
      return {
        txId: String(tx.txid || ""),
        amount: received / 1e8,
        at: num(tx.status?.block_time) * 1000,
      };
    })
    .filter((row) => row.txId && row.amount > 0);
}

export async function listTon(address: string): Promise<FoundCryptoTx[]> {
  const response = await payFetch(
    `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(address)}/transactions?limit=40`,
  );
  const payload = (await response.json()) as {
    transactions?: Array<{
      hash?: string;
      utime?: number;
      in_msg?: { value?: number | string; decoded_body?: unknown };
    }>;
  };
  return (payload.transactions || [])
    .map((tx) => ({
      txId: String(tx.hash || ""),
      amount: num(tx.in_msg?.value) / 1e9,
      at: num(tx.utime) * 1000,
    }))
    .filter((row) => row.txId && row.amount > 0);
}

export async function findCryptoPayment(input: {
  asset: CryptoAsset;
  address: string;
  exactCrypto?: string;
  exactUsd: number;
  createdAt: number;
  usedTxIds: string[];
}): Promise<FoundCryptoTx | null> {
  const used = new Set(input.usedTxIds);
  const since = input.createdAt - 60_000;
  let rows: FoundCryptoTx[] = [];
  if (input.asset === "USDT") rows = await listUsdtTrc20(input.address);
  else if (input.asset === "BTC") rows = await listBtc(input.address);
  else rows = await listTon(input.address);

  const expected = Number(input.exactCrypto || 0);
  const candidates = rows.filter((row) => row.at === 0 || row.at >= since).filter((row) => !used.has(`${input.asset}:${row.txId}`));

  if (expected > 0) {
    const rel = input.asset === "USDT" ? 0.002 : 0.012;
    const abs = input.asset === "USDT" ? 0.005 : input.asset === "BTC" ? 0.000004 : 0.02;
    const hit = candidates.find((row) => near(row.amount, expected, rel, abs));
    if (hit) return hit;
  }

  if (input.asset === "USDT") {
    const hit = candidates.find((row) => near(row.amount, input.exactUsd, 0.002, 0.005));
    if (hit) return hit;
  }

  const prices = await fetchUsdPrices();
  const price = input.asset === "BTC" ? prices.btc : input.asset === "TON" ? prices.ton : 1;
  if (price > 0) {
    const hit = candidates.find((row) => near(row.amount * price, input.exactUsd, 0.08, 0.4));
    if (hit) return hit;
  }
  return null;
}

export function cryptoNote(quote: CryptoQuote): string {
  const unit = quote.asset === "USDT" ? "USDT (TRC20)" : quote.asset;
  const sum = quote.exactCrypto || `${quote.exactUsd} USD`;
  return `${unit}: ${quote.address} · ровно ${sum}. После перевода нажмите «Проверить оплату».`;
}
