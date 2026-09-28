export type CashoutFee = { amount: string; currency: string };

export type CashoutArrival =
  | { source: "declared" | "observed"; kind: "within"; seconds: number }
  | { source: "declared" | "observed"; kind: "business-days"; minDays: number; maxDays: number }
  | { source: "unknown" };

export type CashoutQuote = {
  fees: { provider: CashoutFee | null; network: CashoutFee | null; operator: CashoutFee | null };
  rate: { from: string; to: string; value: string } | null;
  receive: { amount: string; currency: string; approximate: boolean };
  arrival: CashoutArrival;
};

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const CODE = /^[A-Z]{3,8}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFee(value: unknown): CashoutFee | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.amount !== "string" || !DECIMAL.test(value.amount) ||
    typeof value.currency !== "string" || !CODE.test(value.currency)) return undefined;
  return { amount: value.amount, currency: value.currency };
}

function parseArrival(value: unknown): CashoutArrival | null {
  if (!isRecord(value)) return null;
  if (value.source === "unknown") return { source: "unknown" };
  if (value.source !== "declared" && value.source !== "observed") return null;
  if (value.kind === "within" && Number.isSafeInteger(value.seconds) && (value.seconds as number) > 0) {
    return { source: value.source, kind: "within", seconds: value.seconds as number };
  }
  if (value.kind === "business-days" && Number.isSafeInteger(value.minDays) && Number.isSafeInteger(value.maxDays) &&
    (value.minDays as number) >= 0 && (value.maxDays as number) >= (value.minDays as number) && (value.maxDays as number) > 0) {
    return { source: value.source, kind: "business-days", minDays: value.minDays as number, maxDays: value.maxDays as number };
  }
  return null;
}

export function parseCashoutQuote(value: unknown): CashoutQuote | null {
  if (!isRecord(value) || !isRecord(value.fees) || !isRecord(value.receive)) return null;
  const provider = parseFee(value.fees.provider);
  const network = parseFee(value.fees.network);
  const operator = parseFee(value.fees.operator);
  if (provider === undefined || network === undefined || operator === undefined) return null;
  let rate: CashoutQuote["rate"] = null;
  if (value.rate !== null) {
    if (!isRecord(value.rate) || typeof value.rate.from !== "string" || !CODE.test(value.rate.from) ||
      typeof value.rate.to !== "string" || !CODE.test(value.rate.to) ||
      typeof value.rate.value !== "string" || !DECIMAL.test(value.rate.value) || !/[1-9]/.test(value.rate.value)) return null;
    rate = { from: value.rate.from, to: value.rate.to, value: value.rate.value };
  }
  const { receive } = value;
  if (typeof receive.amount !== "string" || !DECIMAL.test(receive.amount) ||
    typeof receive.currency !== "string" || !/^[A-Z]{3}$/.test(receive.currency) ||
    typeof receive.approximate !== "boolean") return null;
  const arrival = parseArrival(value.arrival);
  if (!arrival) return null;
  return {
    fees: { provider, network, operator },
    rate,
    receive: { amount: receive.amount, currency: receive.currency, approximate: receive.approximate },
    arrival,
  };
}

export function cashoutQuoteFromLegacy(input: { approximateFiatAmount: string; currency: string; etaSeconds?: number | null }): CashoutQuote {
  return {
    fees: { provider: null, network: null, operator: null },
    rate: null,
    receive: { amount: input.approximateFiatAmount, currency: input.currency, approximate: true },
    arrival: typeof input.etaSeconds === "number" && input.etaSeconds > 0
      ? { source: "observed", kind: "within", seconds: input.etaSeconds }
      : { source: "unknown" },
  };
}

export function cashoutArrivalSeconds(arrival: CashoutArrival): number | null {
  return arrival.source !== "unknown" && arrival.kind === "within" ? arrival.seconds : null;
}

export function formatCashoutArrival(arrival: CashoutArrival): string {
  if (arrival.source === "unknown") return "Arrival time varies";
  if (arrival.kind === "business-days") {
    const { minDays, maxDays } = arrival;
    if (maxDays === minDays) return `${maxDays} business ${maxDays === 1 ? "day" : "days"}`;
    return `${minDays}–${maxDays} business days`;
  }
  const minutes = Math.ceil(arrival.seconds / 60);
  if (minutes < 60) return `Usually within ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Usually within ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.ceil(hours / 24);
  return `Usually within ${days} ${days === 1 ? "day" : "days"}`;
}
