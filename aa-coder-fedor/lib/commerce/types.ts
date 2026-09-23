import type { CryptoAsset, PayMethod, PlanId } from "./plans";

export type HubUser = {
  id: string;
  email: string;
  name: string;
  token: string;
  planId: PlanId;
  createdAt: number;
  weekStartedAt: number;
  usedInWeek: number;
  freeWindowStartedAt: number;
  usedInFreeWindow: number;
  extraTokens: number;
  deviceLabel?: string;
  lifetimeTokens?: number;
  lastSeenAt?: number;
  lastTokenReportAt?: number;
  seal?: string;
};

export type UserSort = "name" | "lastSeen" | "tokens";

export type TokenReport = {
  type: "token-report";
  userId?: string;
  email?: string;
  deviceId?: string;
  deviceLabel?: string;
  lifetimeTokens: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
  lastSeenAt: number;
  t: number;
};

export type PayProvider = "yookassa" | "yoomoney" | "crypto" | "sbp";

export type HubInvoice = {
  id: string;
  userId: string;
  kind: "plan" | "extra";
  planId?: PlanId;
  period?: "month" | "year";
  method: PayMethod;
  cryptoAsset?: CryptoAsset;
  amountRub: number;
  amountUsd: number;
  extraTokens?: number;
  status: "waiting_credentials" | "pending" | "paid" | "cancelled";
  createdAt: number;
  note: string;
  payUrl?: string;
  provider?: PayProvider;
  providerPaymentId?: string;
  exactPay?: string;
  payAddress?: string;
  txId?: string;
  checkedAt?: number;
  checkNote?: string;
};

export type HubState = {
  users: HubUser[];
  invoices: HubInvoice[];
  usedLicenses?: string[];
  usedPayRefs?: string[];
  updatedAt: number;
};

export type QuotaView = {
  planId: PlanId;
  planName: string;
  tokensLeft: number;
  tokensCap: number;
  extraTokens: number;
  resetAt: number;
  windowKind: "week" | "free2h";
  fallbackFreeLeft: number;
  blocked: boolean;
  openPay: boolean;
};
