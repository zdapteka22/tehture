"use client";

import { useCallback, useState } from "react";

import { APP_TITLE } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserSort } from "@/lib/commerce/types";

type Row = {
  id?: string;
  email: string;
  name: string;
  planId: string;
  createdAt: number;
  deviceLabel?: string;
  lifetimeTokens?: number;
  lastSeenAt?: number;
  lastTokenReportAt?: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
  quota: { tokensLeft: number; planName: string; tokensCap: number };
};

type Invoice = {
  id: string;
  amountRub: number;
  status: string;
  method: string;
  kind: string;
};

function when(ts?: number): string {
  if (!ts) return "нет визита";
  return new Date(ts).toLocaleString("ru-RU");
}

export default function HubPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [users, setUsers] = useState<Row[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dir, setDir] = useState("");
  const [sort, setSort] = useState<UserSort>("name");
  const [busy, setBusy] = useState(false);

  const applyPayload = (payload: {
    dir?: string;
    users?: Row[];
    invoices?: Invoice[];
    asked?: number;
    received?: number;
    sort?: UserSort;
  }) => {
    setDir(payload.dir || "");
    setUsers(payload.users || []);
    setInvoices(payload.invoices || []);
    if (payload.sort) setSort(payload.sort);
    if (typeof payload.asked === "number") {
      setNote(`Запросил ${payload.asked} копий, ответили ${payload.received ?? 0}. Ниже — токены на этот момент.`);
    }
  };

  const load = useCallback(
    async (nextSort: UserSort = sort) => {
      setError("");
      const response = await fetch(`/api/hub?view=admin&sort=${nextSort}`, {
        headers: { "x-fedor-admin": key },
      });
      const payload = (await response.json()) as {
        error?: string;
        dir?: string;
        users?: Row[];
        invoices?: Invoice[];
        sort?: UserSort;
      };
      if (!response.ok) {
        setError(payload.error || "нет доступа");
        return;
      }
      applyPayload(payload);
    },
    [key, sort],
  );

  const checkTokens = async () => {
    setBusy(true);
    setError("");
    setNote("Запрашиваю токены у копий…");
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-tokens", adminKey: key, sort }),
      });
      const payload = (await response.json()) as {
        error?: string;
        dir?: string;
        users?: Row[];
        invoices?: Invoice[];
        asked?: number;
        received?: number;
        sort?: UserSort;
      };
      if (!response.ok) {
        setError(payload.error || "не проверил");
        setNote("");
        return;
      }
      applyPayload(payload);
    } finally {
      setBusy(false);
    }
  };

  const changeSort = async (next: UserSort) => {
    setSort(next);
    await load(next);
  };

  const markPaid = async (invoiceId: string) => {
    const response = await fetch("/api/hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark-paid", invoiceId, adminKey: key }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "не отмечено");
      return;
    }
    await load();
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0b0b0b] p-6 text-[#cccccc]">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-xl text-white">{APP_TITLE} · хаб учёта</h1>
        <p className="text-sm text-zinc-500">
          «Проверить токены» спрашивает каждую копию отдельно и пишет только её расход.
          20 000 — это окно пробного тарифа, не общая цифра на всех.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            type="password"
            placeholder="ключ админа"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <Button onClick={() => void load()}>Открыть</Button>
          <Button variant="outline" disabled={busy || !key} onClick={() => void checkTokens()}>
            {busy ? "Запрашиваю…" : "Проверить токены"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Сортировка:</span>
          <Button size="xs" variant={sort === "name" ? "default" : "outline"} onClick={() => void changeSort("name")}>
            по имени
          </Button>
          <Button size="xs" variant={sort === "lastSeen" ? "default" : "outline"} onClick={() => void changeSort("lastSeen")}>
            по визиту
          </Button>
          <Button size="xs" variant={sort === "tokens" ? "default" : "outline"} onClick={() => void changeSort("tokens")}>
            по токенам
          </Button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {note && <p className="text-sm text-emerald-400">{note}</p>}
        {dir && <p className="text-[11px] text-zinc-600">Данные: {dir}</p>}
        <h2 className="text-sm text-white">Пользователи · {users.length}</h2>
        <ul className="space-y-2 text-sm">
          {users.map((user) => (
            <li key={user.id || user.email} className="rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-white">{user.name || user.email}</div>
                <div className="text-[12px] text-amber-200">
                  истрачено {(Number(user.lifetimeTokens || 0) || 0).toLocaleString("ru-RU")} ток.
                </div>
              </div>
              <div className="text-[12px] text-zinc-500">{user.email}</div>
              <div className="text-[12px] text-zinc-500">
                {user.quota.planName} · осталось {user.quota.tokensLeft.toLocaleString("ru-RU")} /{" "}
                {user.quota.tokensCap.toLocaleString("ru-RU")}
                {user.deviceLabel ? ` · ${user.deviceLabel}` : ""}
              </div>
              <div className="text-[12px] text-zinc-600">визит: {when(user.lastSeenAt)}</div>
            </li>
          ))}
        </ul>
        <h2 className="text-sm text-white">Счета · {invoices.length}</h2>
        <ul className="space-y-2 text-sm">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <span>
                {invoice.id} · {invoice.amountRub} ₽ · {invoice.method} · {invoice.status}
              </span>
              {invoice.status !== "paid" && (
                <Button size="xs" variant="outline" onClick={() => void markPaid(invoice.id)}>
                  Оплачено
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="pt-6 text-center text-[11px] tracking-wide text-zinc-600">
          © 2026 · Made with by AA it
        </p>
      </div>
    </div>
  );
}
