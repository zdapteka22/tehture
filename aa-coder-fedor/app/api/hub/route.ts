import {
  activateLicense,
  createInvoice,
  hubStatus,
  latestUpdate,
  invoicesForUser,
  listPlans,
  applyTokenReport,
  checkTokens,
  listUsers,
  markInvoicePaid,
  publicUser,
  registerUser,
  userByToken,
} from "@/lib/commerce/store";
import { dailyDue, pendingAskIds } from "@/lib/commerce/token-sync";
import type { UserSort } from "@/lib/commerce/types";
import { publicPayView, savePayConfig, sellerPayView } from "@/lib/commerce/pay-config";
import { verifyInvoice } from "@/lib/commerce/verify-pay";
import type { CryptoAsset, PayMethod, PlanId } from "@/lib/commerce/plans";

function bearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-fedor-account") || "";
}

function adminKeyOf(request: Request, bodyKey?: string): string {
  return (request.headers.get("x-fedor-admin") || bodyKey || "").trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "status";
  if (view === "plans") return Response.json(listPlans());
  if (view === "update") return Response.json(latestUpdate());
  if (view === "pay-config") {
    return Response.json({ ok: true, public: publicPayView(), seller: sellerPayView() });
  }
  if (view === "me") {
    const user = userByToken(bearer(request));
    if (!user) return Response.json({ error: "Нужен вход" }, { status: 401 });
    return Response.json({
      ok: true,
      user: publicUser(user),
      invoices: invoicesForUser(user.token),
    });
  }
  if (view === "admin") {
    try {
      const sort = (url.searchParams.get("sort") || "name") as UserSort;
      return Response.json(listUsers(adminKeyOf(request), sort));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "admin" }, { status: 403 });
    }
  }
  if (view === "asks") {
    const user = userByToken(bearer(request));
    if (!user) return Response.json({ error: "Нужен вход" }, { status: 401 });
    const pending = pendingAskIds().includes(user.id);
    return Response.json({
      ok: true,
      ask: pending,
      dailyDue: dailyDue(user.lastTokenReportAt),
      lifetimeTokens: user.lifetimeTokens || 0,
    });
  }
  return Response.json(hubStatus());
}

export async function POST(request: Request) {
  let body: {
    action?: string;
    email?: string;
    name?: string;
    deviceLabel?: string;
    token?: string;
    method?: PayMethod;
    kind?: "plan" | "extra";
    planId?: PlanId;
    cryptoAsset?: CryptoAsset;
    invoiceId?: string;
    adminKey?: string;
    sort?: UserSort;
    lifetimeTokens?: number;
    usedInWeek?: number;
    usedInFreeWindow?: number;
    lastSeenAt?: number;
    period?: "month" | "year";
    license?: string;
    yookassaShopId?: string;
    yookassaSecret?: string;
    yoomoneyReceiver?: string;
    yoomoneySecret?: string;
    yoomoneyToken?: string;
    sbpPhone?: string;
    sbpRequisites?: string;
    cryptoUsdt?: string;
    cryptoBtc?: string;
    cryptoTon?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action || "status";
  try {
    if (action === "register") {
      const user = registerUser({
        email: body.email || "",
        name: body.name,
        deviceLabel: body.deviceLabel,
      });
      return Response.json({ ok: true, token: user.token, user: publicUser(user) });
    }
    if (action === "me") {
      const user = userByToken(body.token || bearer(request));
      if (!user) return Response.json({ error: "Нужен вход" }, { status: 401 });
      return Response.json({
        ok: true,
        user: publicUser(user),
        invoices: invoicesForUser(user.token),
      });
    }
    if (action === "pay") {
      const invoice = await createInvoice({
        token: body.token || bearer(request),
        method: body.method || "yoomoney",
        kind: body.kind || "plan",
        planId: body.planId,
        period: body.period,
        cryptoAsset: body.cryptoAsset,
      });
      return Response.json({ ok: true, invoice });
    }
    if (action === "check") {
      const result = await verifyInvoice(body.invoiceId || "");
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "pay-config") {
      const cfg = savePayConfig(
        {
          yookassaShopId: body.yookassaShopId,
          yookassaSecret: body.yookassaSecret,
          yoomoneyReceiver: body.yoomoneyReceiver,
          yoomoneySecret: body.yoomoneySecret,
          yoomoneyToken: body.yoomoneyToken,
          sbpPhone: body.sbpPhone,
          sbpRequisites: body.sbpRequisites,
          cryptoUsdt: body.cryptoUsdt,
          cryptoBtc: body.cryptoBtc,
          cryptoTon: body.cryptoTon,
        },
        adminKeyOf(request, body.adminKey),
      );
      return Response.json({ ok: true, public: publicPayView(cfg), seller: sellerPayView(cfg) });
    }
    if (action === "activate") {
      const result = activateLicense(body.token || bearer(request), body.license || "");
      return Response.json({
        ok: true,
        user: publicUser(result.user),
        planId: result.user.planId,
      });
    }
    if (action === "mark-paid") {
      const invoice = markInvoicePaid(body.invoiceId || "", adminKeyOf(request, body.adminKey));
      return Response.json({ ok: true, invoice });
    }
    if (action === "admin") {
      return Response.json(listUsers(adminKeyOf(request, body.adminKey), body.sort || "name"));
    }
    if (action === "check-tokens") {
      return Response.json(checkTokens(adminKeyOf(request, body.adminKey), body.sort || "tokens"));
    }
    if (action === "report-tokens") {
      const user = userByToken(body.token || bearer(request));
      if (!user) return Response.json({ error: "Нужен вход" }, { status: 401 });
      const updated = applyTokenReport({
        type: "token-report",
        userId: user.id,
        email: user.email,
        lifetimeTokens: Number(body.lifetimeTokens ?? user.lifetimeTokens ?? 0),
        usedInWeek: body.usedInWeek ?? user.usedInWeek,
        usedInFreeWindow: body.usedInFreeWindow ?? user.usedInFreeWindow,
        lastSeenAt: body.lastSeenAt || Date.now(),
        t: Date.now(),
      });
      return Response.json({ ok: true, user: updated ? publicUser(updated) : publicUser(user) });
    }
    return Response.json(hubStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "hub error" }, { status: 400 });
  }
}
