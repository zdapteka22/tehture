"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SellerView = {
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

const EMPTY: SellerView = {
  locked: false,
  yookassaShopId: "",
  yookassaSecretSet: false,
  yoomoneyReceiver: "",
  yoomoneySecretSet: false,
  yoomoneyTokenSet: false,
  sbpPhone: "",
  sbpRequisites: "",
  cryptoUsdt: "",
  cryptoBtc: "",
  cryptoTon: "",
};

export function PaySettings() {
  const [seller, setSeller] = useState<SellerView>(EMPTY);
  const [yookassaSecret, setYookassaSecret] = useState("");
  const [yoomoneySecret, setYoomoneySecret] = useState("");
  const [yoomoneyToken, setYoomoneyToken] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/hub?view=pay-config");
    if (!response.ok) return;
    const payload = (await response.json()) as { seller?: SellerView };
    if (payload.seller) setSeller(payload.seller);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError("");
    setOk("");
    setBusy(true);
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay-config",
          adminKey,
          yookassaShopId: seller.yookassaShopId,
          yookassaSecret,
          yoomoneyReceiver: seller.yoomoneyReceiver,
          yoomoneySecret,
          yoomoneyToken,
          sbpPhone: seller.sbpPhone,
          sbpRequisites: seller.sbpRequisites,
          cryptoUsdt: seller.cryptoUsdt,
          cryptoBtc: seller.cryptoBtc,
          cryptoTon: seller.cryptoTon,
        }),
      });
      const payload = (await response.json()) as { error?: string; seller?: SellerView };
      if (!response.ok) throw new Error(payload.error || "Не сохранилось");
      if (payload.seller) setSeller(payload.seller);
      setYookassaSecret("");
      setYoomoneySecret("");
      setYoomoneyToken("");
      setOk("Реквизиты записаны. Новые счета будут проверять оплату сами.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "не сохранилось");
    } finally {
      setBusy(false);
    }
  };

  const locked = seller.locked;

  return (
    <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
      <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
        <Wallet className="size-4 text-[#b48eff]" />
        Приём оплаты
      </div>
      <p className="text-[11px] leading-5 text-zinc-500">
        Реквизиты для российской карты, СБП и крипты. СБП идёт через ЮKassa: shopId + секрет live_…
        Кабинет:{" "}
        <a
          className="text-sky-300 underline-offset-2 hover:underline"
          href="https://yookassa.ru/my/shop-settings"
          target="_blank"
          rel="noreferrer"
        >
          yookassa.ru/my/shop-settings
        </a>
        . «Настройки» — меню, дальше Магазин / Интеграция. Включите СБП в способах оплаты.
        Секрет live_… не кладите в токен ЮMoney. HTTP-уведомления на этот ПК не доходят — проверка по API.
      </p>
      <p className="text-[11px] leading-5 text-zinc-500">
        Выдуманных реквизитов нет. Секреты в исходники не пишутся.
      </p>
      {locked && (
        <p className="text-[11px] text-amber-200/90">
          Реквизиты заданы в сборке. Сменить можно только ключом учёта.
        </p>
      )}
      <Input
        placeholder="shopId из shop-settings (цифры)"
        value={seller.yookassaShopId}
        onChange={(event) => setSeller({ ...seller, yookassaShopId: event.target.value })}
      />
      <Input
        type="password"
        placeholder={seller.yookassaSecretSet ? "секрет приёма карт задан" : "секретный ключ приёма карт"}
        value={yookassaSecret}
        onChange={(event) => setYookassaSecret(event.target.value)}
      />
      <Input
        placeholder="кошелёк для карты (если нужен)"
        value={seller.yoomoneyReceiver}
        onChange={(event) => setSeller({ ...seller, yoomoneyReceiver: event.target.value })}
      />
      <Input
        type="password"
        placeholder={seller.yoomoneySecretSet ? "секрет уведомлений задан" : "секрет HTTP-уведомлений"}
        value={yoomoneySecret}
        onChange={(event) => setYoomoneySecret(event.target.value)}
      />
      <Input
        type="password"
        placeholder={seller.yoomoneyTokenSet ? "токен истории задан" : "токен истории операций"}
        value={yoomoneyToken}
        onChange={(event) => setYoomoneyToken(event.target.value)}
      />
      <Input
        placeholder="СБП телефон"
        value={seller.sbpPhone}
        onChange={(event) => setSeller({ ...seller, sbpPhone: event.target.value })}
      />
      <Input
        placeholder="USDT TRC20"
        value={seller.cryptoUsdt}
        onChange={(event) => setSeller({ ...seller, cryptoUsdt: event.target.value })}
      />
      <Input
        placeholder="BTC"
        value={seller.cryptoBtc}
        onChange={(event) => setSeller({ ...seller, cryptoBtc: event.target.value })}
      />
      <Input
        placeholder="TON"
        value={seller.cryptoTon}
        onChange={(event) => setSeller({ ...seller, cryptoTon: event.target.value })}
      />
      {locked && (
        <Input
          type="password"
          placeholder="ключ учёта, если меняете сборку"
          value={adminKey}
          onChange={(event) => setAdminKey(event.target.value)}
        />
      )}
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        {busy ? "Сохраняю…" : "Сохранить реквизиты"}
      </Button>
      {ok && <p className="text-[11px] text-emerald-300/90">{ok}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
