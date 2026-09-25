"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { APP_TITLE, IS_FREE_EDITION } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EXTRA_CREDIT_RUB,
  EXTRA_CREDIT_TOKENS,
  EXTRA_CREDIT_USD,
  PLANS,
  formatRub,
  formatTokens,
  tokensLabel,
  type CryptoAsset,
  type PayMethod,
  type PlanId,
} from "@/lib/commerce/plans";
import type { HubInvoice } from "@/lib/commerce/types";
import type { QuotaView } from "@/lib/commerce/types";

const ACCOUNT_KEY = "fedor2-account-token";

type PlansPayload = {
  extra: { usd: number; rub: number; tokens: number };
  pay: { sbp: boolean; crypto: boolean; yoomoney?: boolean; note: string };
  plans: typeof PLANS;
};

type MePayload = {
  user?: {
    email: string;
    name: string;
    planId: PlanId;
    quota: QuotaView;
  };
  invoices?: HubInvoice[];
  error?: string;
};

function readToken(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) || "";
  } catch {
    return "";
  }
}

function saveToken(token: string) {
  try {
    localStorage.setItem(ACCOUNT_KEY, token);
  } catch {
    // ignore
  }
}

function FreePayNotice() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#070b12] px-4 text-zinc-200">
      <div className="max-w-lg space-y-4 text-center">
        <p className="text-xs uppercase tracking-[0.28em] text-sky-300/80">{APP_TITLE}</p>
        <h1 className="text-3xl font-semibold text-white">Это бесплатный Fedor 3.0</h1>
        <p className="text-sm leading-6 text-zinc-400">
          Отдельная сборка. Лимита сообщений нет. Тарифы и оплата в этой версии выключены.
        </p>
        <p>
          <Link href="/" className="text-sky-300 underline-offset-4 hover:underline">
            ← вернуться в кодер
          </Link>
        </p>
      </div>
    </div>
  );
}

export function PayApp() {
  if (IS_FREE_EDITION) return <FreePayNotice />;
  return <PaidPayApp />;
}

function PaidPayApp() {
  const search = useSearchParams();
  const reason = search.get("reason") || "";
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [me, setMe] = useState<MePayload["user"] | null>(null);
  const [invoices, setInvoices] = useState<HubInvoice[]>([]);
  const [catalog, setCatalog] = useState<PlansPayload | null>(null);
  const [method, setMethod] = useState<PayMethod>("sbp");
  const [asset, setAsset] = useState<CryptoAsset>("USDT");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastInvoice, setLastInvoice] = useState<HubInvoice | null>(null);
  const [license, setLicense] = useState("");

  const loadPlans = useCallback(async () => {
    const response = await fetch("/api/hub?view=plans");
    if (!response.ok) return;
    setCatalog((await response.json()) as PlansPayload);
  }, []);

  const loadMe = useCallback(async (useToken: string) => {
    if (!useToken) return;
    const response = await fetch("/api/hub?view=me", {
      headers: { "x-fedor-account": useToken },
    });
    const payload = (await response.json()) as MePayload;
    if (!response.ok) return;
    if (payload.user) {
      setMe(payload.user);
      setEmail(payload.user.email);
    }
    setInvoices(payload.invoices || []);
  }, []);

  useEffect(() => {
    void loadPlans();
    const saved = readToken();
    if (saved) {
      setToken(saved);
      void loadMe(saved);
    }
  }, [loadMe, loadPlans]);

  const register = async () => {
    setError("");
    setBusy("account");
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          email: email.trim() || `guest.${Date.now().toString(16)}@local.fedor`,
          name: "Покупатель",
          deviceLabel: "pay",
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        user?: MePayload["user"];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти");
      if (payload.token) {
        saveToken(payload.token);
        setToken(payload.token);
        await loadMe(payload.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "вход не удался");
    } finally {
      setBusy("");
    }
  };

  const activate = async () => {
    setError("");
    let useToken = token || readToken();
    if (!useToken) {
      await register();
      useToken = readToken();
    }
    if (!useToken) {
      setError("Сначала укажите почту и нажмите Войти");
      return;
    }
    if (!license.trim()) {
      setError("Вставьте код активации");
      return;
    }
    setBusy("activate");
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          token: useToken,
          license: license.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Код не принят");
      setLicense("");
      await loadMe(useToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "активация не удалась");
    } finally {
      setBusy("");
    }
  };

  const pay = async (kind: "plan" | "extra", planId?: PlanId) => {
    setError("");
    let useToken = token || readToken();
    if (!useToken) {
      await register();
      useToken = readToken();
    }
    if (!useToken) {
      setError("Сначала укажите почту и нажмите Войти");
      return;
    }
    setBusy(planId || kind);
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay",
          token: useToken,
          method,
          kind,
          planId,
          period: kind === "plan" ? period : undefined,
          cryptoAsset: method === "crypto" ? asset : undefined,
        }),
      });
      const payload = (await response.json()) as { invoice?: HubInvoice; error?: string };
      if (!response.ok) throw new Error(payload.error || "Счёт не создан");
      if (payload.invoice) {
        setLastInvoice(payload.invoice);
        await loadMe(useToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "оплата не создана");
    } finally {
      setBusy("");
    }
  };

  const headline = useMemo(() => {
    if (reason === "quota") return "Лимит тарифа исчерпан";
    if (reason === "trial") return "Бесплатное окно закончилось";
    return "Тарифы Fedor 3.0";
  }, [reason]);

  const plans = catalog?.plans || PLANS;
  const payNote =
    catalog?.pay.note ||
    "Оплата российской картой, СБП и криптовалютой. Реквизиты — в «Приём оплаты».";

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#070b12] px-4 py-8 text-zinc-200">
      <div className="mx-auto max-w-5xl space-y-8 pb-16">
        <header className="space-y-2 pt-6">
          <p className="text-xs uppercase tracking-[0.28em] text-sky-300/80">{APP_TITLE}</p>
          <h1 className="text-3xl font-semibold text-white">{headline}</h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400">
            Пробный тариф: 10 сообщений каждые 2 часа. Дальше — Fedor Lite, Fedor, Plus и Heavy.
            Оплата российской картой, СБП и криптовалютой (USDT, BTC, TON).
          </p>
          <p>
            <Link href="/" className="text-sky-300 underline-offset-4 hover:underline">
              ← вернуться в кодер
            </Link>
          </p>
        </header>

        <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="text-sm text-white">Аккаунт</div>
            <p className="mt-1 text-[12px] text-zinc-500">
              {me
                ? `${me.quota.planName} · осталось ${formatTokens(me.quota.tokensLeft)} из ${formatTokens(me.quota.tokensCap)} ток.`
                : "Почта нужна, чтобы счёт и тариф привязались к этому ПК."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              placeholder="почта"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button size="sm" disabled={busy === "account"} onClick={() => void register()}>
              {me ? "Обновить" : "Войти"}
            </Button>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
            <Input
              className="min-w-64 flex-1"
              placeholder="код активации после оплаты"
              value={license}
              onChange={(event) => setLicense(event.target.value)}
            />
            <Button size="sm" variant="outline" disabled={busy === "activate"} onClick={() => void activate()}>
              {busy === "activate" ? "Проверяю…" : "Активировать"}
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-zinc-500">Выберите тариф</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button size="xs" variant={period === "month" ? "default" : "outline"} onClick={() => setPeriod("month")}>
              Месяц
            </Button>
            <Button size="xs" variant={period === "year" ? "default" : "outline"} onClick={() => setPeriod("year")}>
              Год
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const year = period === "year" && plan.usdYear && plan.rubYear;
              const usd = year ? plan.usdYear : plan.usdMonth;
              const rub = year ? plan.rubYear : plan.rubMonth;
              const current = me?.planId === plan.id;
              return (
                <article
                  key={plan.id}
                  className={`rounded-2xl border p-4 ${
                    current ? "border-sky-400/60 bg-sky-400/10" : "border-white/10 bg-[#0d1420]"
                  }`}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-sky-300/80">{plan.grokTwin}</div>
                  <h3 className="mt-1 text-xl text-white">{plan.name}</h3>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {usd ? `$${usd}` : "$0"}
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      {rub ? formatRub(rub) : "бесплатно"}
                      {usd ? (year ? " / год" : " / мес") : ""}
                    </span>
                  </p>
                  <p className="mt-2 text-[12px] leading-5 text-zinc-400">{plan.blurb}</p>
                  <p className="mt-2 text-[12px] text-zinc-300">{tokensLabel(plan)}</p>
                  {plan.id === "free" ? (
                    <p className="mt-4 text-[12px] text-zinc-500">Текущий старт без оплаты.</p>
                  ) : (
                    <Button
                      className="mt-4 w-full"
                      size="sm"
                      disabled={Boolean(busy)}
                      onClick={() => void pay("plan", plan.id)}
                    >
                      {busy === plan.id ? "Создаю счёт…" : "Оплатить"}
                    </Button>
                  )}
                </article>
              );
            })}
            <article className="rounded-2xl border border-white/10 bg-[#0d1420] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-sky-300/80">Extra credits</div>
              <h3 className="mt-1 text-xl text-white">Доп. пакет</h3>
              <p className="mt-2 text-2xl font-semibold text-white">
                ${EXTRA_CREDIT_USD}
                <span className="ml-2 text-sm font-normal text-zinc-500">{formatRub(EXTRA_CREDIT_RUB)}</span>
              </p>
              <p className="mt-2 text-[12px] leading-5 text-zinc-400">
                Дополнительные токены после исчерпания недельного пула.{" "}
                {formatTokens(EXTRA_CREDIT_TOKENS)} токенов.
              </p>
              <Button
                className="mt-4 w-full"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void pay("extra")}
              >
                {busy === "extra" ? "Создаю счёт…" : "Купить пакет"}
              </Button>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0d1420] p-4">
          <h2 className="text-sm uppercase tracking-[0.2em] text-zinc-500">Способ оплаты</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={method === "yoomoney" ? "default" : "outline"}
              onClick={() => setMethod("yoomoney")}
            >
              Карта
            </Button>
            <Button size="sm" variant={method === "sbp" ? "default" : "outline"} onClick={() => setMethod("sbp")}>
              СБП
            </Button>
            <Button size="sm" variant={method === "crypto" ? "default" : "outline"} onClick={() => setMethod("crypto")}>
              Крипта
            </Button>
            {method === "crypto" &&
              (["USDT", "BTC", "TON"] as CryptoAsset[]).map((item) => (
                <Button
                  key={item}
                  size="xs"
                  variant={asset === item ? "default" : "outline"}
                  onClick={() => setAsset(item)}
                >
                  {item}
                </Button>
              ))}
          </div>
          <p className="mt-3 text-[13px] leading-6 text-zinc-400">{payNote}</p>
          {catalog && (
            <p className="mt-1 text-[12px] text-zinc-600">
              Карта: {catalog.pay.yoomoney ? "подключена" : "ждём настройки"} · СБП:{" "}
              {catalog.pay.sbp ? "реквизиты подключены" : "ждём телефон/счёт"} · Крипта:{" "}
              {catalog.pay.crypto ? "кошельки подключены" : "ждём адреса USDT / BTC / TON"}
            </p>
          )}
        </section>

        {(lastInvoice || invoices[0]) && (
          <section className="rounded-2xl border border-sky-400/30 bg-sky-400/5 p-4">
            <h2 className="text-sm text-white">Счёт</h2>
            {(lastInvoice || invoices[0]) && (
              <InvoiceCard
                invoice={lastInvoice || invoices[0]}
                token={token}
                onUpdated={async (invoice) => {
                  setLastInvoice(invoice);
                  if (token) await loadMe(token);
                }}
              />
            )}
          </section>
        )}

        {invoices.length > 1 && (
          <section>
            <h2 className="mb-2 text-sm uppercase tracking-[0.2em] text-zinc-500">История счетов</h2>
            <ul className="space-y-2">
              {invoices.slice(0, 8).map((invoice) => (
                <li key={invoice.id} className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-zinc-400">
                  {invoice.id} · {formatRub(invoice.amountRub)} · {invoice.method} · {invoice.status}
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <p className="pt-4 text-center text-[11px] tracking-wide text-zinc-600">© 2026 · Made with by AA it</p>
      </div>
    </div>
  );
}

function InvoiceCard({
  invoice,
  token,
  onUpdated,
}: {
  invoice: HubInvoice;
  token: string;
  onUpdated: (invoice: HubInvoice) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const check = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", invoiceId: invoice.id, token }),
      });
      const payload = (await response.json()) as {
        invoice?: HubInvoice;
        message?: string;
        paid?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || payload.message || "Не проверилось");
      setMessage(payload.message || (payload.paid ? "Оплачено" : "Пока нет"));
      if (payload.invoice) await onUpdated(payload.invoice);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "проверка не удалась");
    } finally {
      setBusy(false);
    }
  };

  const methodLabel =
    invoice.method === "yoomoney"
      ? "карта"
      : invoice.method === "sbp"
        ? "СБП"
        : `крипта ${invoice.cryptoAsset || ""}`;

  return (
    <div className="mt-2 space-y-1 text-[13px] leading-6 text-zinc-300">
      <div>
        Номер: <span className="font-mono text-white">{invoice.id}</span>
      </div>
      <div>
        Сумма: ${invoice.amountUsd} · {formatRub(invoice.amountRub)}
        {invoice.period ? ` · ${invoice.period === "year" ? "год" : "месяц"}` : ""}
        {invoice.exactPay ? ` · к оплате ${invoice.exactPay}` : ""}
      </div>
      <div>
        Способ: {methodLabel} · статус <span className="text-white">{statusLabel(invoice.status)}</span>
      </div>
      {invoice.payAddress && (
        <div>
          Кошелёк: <span className="break-all font-mono text-white">{invoice.payAddress}</span>
        </div>
      )}
      <p className="text-zinc-400">{invoice.note}</p>
      {invoice.checkNote && <p className="text-[12px] text-zinc-500">{invoice.checkNote}</p>}
      {invoice.status === "waiting_credentials" && (
        <p className="text-[12px] text-amber-200/90">
          Реквизиты ещё не заданы. Вставьте карту/СБП и кошельки в Настройки → Приём оплаты.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        {invoice.payUrl && invoice.status !== "paid" && (
          <Button size="sm" onClick={() => window.open(invoice.payUrl, "_blank", "noopener,noreferrer")}>
            Оплатить
          </Button>
        )}
        {invoice.status !== "paid" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
            {busy ? "Проверяю…" : "Проверить оплату"}
          </Button>
        )}
      </div>
      {message && <p className="text-[12px] text-sky-200/90">{message}</p>}
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "paid") return "оплачен";
  if (status === "pending") return "ждёт оплату";
  if (status === "waiting_credentials") return "ждёт реквизиты";
  if (status === "cancelled") return "отменён";
  return status;
}
