import { getPayConfig, hasYookassa, hasYoomoneyWallet } from "./pay-config";
import { findCryptoPayment } from "./crypto-pay";
import { fulfillInvoice, invoiceById, listUsedPayRefs } from "./store";
import type { HubInvoice } from "./types";
import { getYookassaPayment, yoomoneyOperationsByLabel } from "./yoomoney";

export type VerifyResult = {
  ok: boolean;
  paid: boolean;
  invoice: HubInvoice | null;
  message: string;
};

function rubNear(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1, expected * 0.02);
}

export async function verifyInvoice(invoiceId: string): Promise<VerifyResult> {
  const invoice = invoiceById(invoiceId);
  if (!invoice) return { ok: false, paid: false, invoice: null, message: "Счёт не найден" };
  if (invoice.status === "paid") {
    return { ok: true, paid: true, invoice, message: "Счёт уже оплачен" };
  }
  if (invoice.status === "cancelled") {
    return { ok: false, paid: false, invoice, message: "Счёт отменён" };
  }
  if (invoice.status === "waiting_credentials") {
    return {
      ok: false,
      paid: false,
      invoice,
      message: "Реквизиты ещё не заданы. Вставьте карту/СБП и кошельки в Настройки → Приём оплаты.",
    };
  }

  const cfg = getPayConfig();
  const used = listUsedPayRefs();

  if ((invoice.provider === "yookassa" || invoice.providerPaymentId) && hasYookassa(cfg) && invoice.providerPaymentId) {
    try {
      const pay = await getYookassaPayment(cfg, invoice.providerPaymentId);
      if (pay.paid || pay.status === "succeeded") {
        const next = fulfillInvoice(invoice.id, {
          provider: "yookassa",
          ref: pay.id,
          note: `ЮKassa ${pay.id}`,
        });
        return { ok: true, paid: true, invoice: next, message: "Оплата ЮKassa найдена. Тариф включён." };
      }
      return {
        ok: true,
        paid: false,
        invoice,
        message: `ЮKassa: статус ${pay.status || "pending"}. Если уже перевели — подождите минуту и проверьте снова.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "ЮKassa не ответила";
      if (!hasYoomoneyWallet(cfg) && invoice.method !== "crypto") {
        return { ok: false, paid: false, invoice, message };
      }
    }
  }

  if ((invoice.method === "yoomoney" || invoice.method === "sbp" || invoice.provider === "yoomoney") && cfg.yoomoneyToken) {
    try {
      const ops = await yoomoneyOperationsByLabel(cfg, invoice.id);
      const hit = ops.find(
        (op) =>
          (op.status === "success" || op.status === "successed") &&
          (!op.label || op.label === invoice.id) &&
          rubNear(op.amount, invoice.amountRub) &&
          !used.includes(`yoomoney:${op.operationId}`),
      );
      if (hit) {
        const next = fulfillInvoice(invoice.id, {
          provider: "yoomoney",
          ref: hit.operationId,
          note: `ЮMoney ${hit.operationId}`,
        });
        return { ok: true, paid: true, invoice: next, message: "Оплата ЮMoney найдена. Тариф включён." };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "История ЮMoney недоступна";
      if (invoice.method !== "crypto") {
        return {
          ok: false,
          paid: false,
          invoice,
          message: `${message}. Если токена истории нет — кодер ждёт HTTP-уведомление или повторную проверку позже.`,
        };
      }
    }
  }

  if (invoice.method === "crypto" && invoice.cryptoAsset && invoice.payAddress) {
    try {
      const hit = await findCryptoPayment({
        asset: invoice.cryptoAsset,
        address: invoice.payAddress,
        exactCrypto: invoice.exactPay,
        exactUsd: invoice.amountUsd,
        createdAt: invoice.createdAt,
        usedTxIds: used,
      });
      if (hit) {
        const next = fulfillInvoice(invoice.id, {
          provider: "crypto",
          ref: `${invoice.cryptoAsset}:${hit.txId}`,
          note: `${invoice.cryptoAsset} ${hit.txId}`,
        });
        return { ok: true, paid: true, invoice: next, message: "Перевод найден в сети. Тариф включён." };
      }
      return {
        ok: true,
        paid: false,
        invoice,
        message: "Пока нет подходящего перевода. Проверьте сумму с копейками и сеть, затем нажмите ещё раз.",
      };
    } catch (error) {
      return {
        ok: false,
        paid: false,
        invoice,
        message: error instanceof Error ? error.message : "Обозреватель сети не ответил",
      };
    }
  }

  if (invoice.method === "sbp" && !cfg.yoomoneyToken && !hasYookassa(cfg)) {
    return {
      ok: true,
      paid: false,
      invoice,
      message: "СБП по телефону сам не проверяется. Нужны реквизиты карты/СБП или код активации.",
    };
  }

  return {
    ok: true,
    paid: false,
    invoice,
    message: "Платёж ещё не виден. Откройте ссылку оплаты, переведите и нажмите «Проверить оплату» снова.",
  };
}
