import { getPayConfig, hasYookassa } from "@/lib/commerce/pay-config";
import { fulfillInvoice, invoiceById } from "@/lib/commerce/store";
import { getYookassaPayment } from "@/lib/commerce/yoomoney";

export async function POST(request: Request) {
  const cfg = getPayConfig();
  if (!hasYookassa(cfg)) {
    return Response.json({ error: "ЮKassa не настроена" }, { status: 503 });
  }
  let body: { event?: string; object?: { id?: string; metadata?: { invoiceId?: string } } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const paymentId = body.object?.id || "";
  if (!paymentId) return Response.json({ error: "no payment" }, { status: 400 });
  try {
    const pay = await getYookassaPayment(cfg, paymentId);
    if (!pay.paid && pay.status !== "succeeded") {
      return Response.json({ ok: true, ignored: pay.status });
    }
    const invoiceId = body.object?.metadata?.invoiceId || "";
    const invoice = invoiceId ? invoiceById(invoiceId) : null;
    if (!invoice) return Response.json({ error: "unknown invoice" }, { status: 404 });
    const paid = fulfillInvoice(invoice.id, {
      provider: "yookassa",
      ref: pay.id,
      note: `вебхук ЮKassa ${pay.id}`,
    });
    return Response.json({ ok: true, invoiceId: paid.id, status: paid.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "yookassa" }, { status: 400 });
  }
}
