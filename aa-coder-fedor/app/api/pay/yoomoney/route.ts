import { getPayConfig } from "@/lib/commerce/pay-config";
import { verifyYoomoneyNotification } from "@/lib/commerce/yoomoney";
import { fulfillInvoice, invoiceById } from "@/lib/commerce/store";

function fieldsFrom(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(text);
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export async function POST(request: Request) {
  const cfg = getPayConfig();
  if (!cfg.yoomoneySecret) {
    return Response.json({ error: "Секрет уведомлений ЮMoney не задан" }, { status: 503 });
  }
  let fields: Record<string, string> = {};
  const ctype = request.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      fields = (await request.json()) as Record<string, string>;
    } else {
      fields = fieldsFrom(await request.text());
    }
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const checked = verifyYoomoneyNotification(fields, cfg.yoomoneySecret);
  if (!checked.ok) return Response.json({ error: "bad hash" }, { status: 403 });
  const invoice = invoiceById(checked.label);
  if (!invoice) return Response.json({ error: "unknown label" }, { status: 404 });
  const amount = Number(checked.amount);
  if (Number.isFinite(amount) && Math.abs(amount - invoice.amountRub) > Math.max(1, invoice.amountRub * 0.02)) {
    return Response.json({ error: "amount mismatch" }, { status: 409 });
  }
  try {
    const paid = fulfillInvoice(invoice.id, {
      provider: "yoomoney",
      ref: checked.operationId || `note:${invoice.id}`,
      note: `уведомление ЮMoney ${checked.operationId}`,
    });
    return Response.json({ ok: true, invoiceId: paid.id, status: paid.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "fulfill" }, { status: 400 });
  }
}
