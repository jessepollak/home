import "server-only";

import holidayCalendar from "@/config/invest-sources/us-equity-holidays.json";

export type EquityCalendar = { holidays: readonly string[]; coversThrough: string };

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(seconds: number) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    localEpoch: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) / 1000,
  };
}

function nextDate(date: string): string {
  const tomorrow = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
  return tomorrow.toISOString().slice(0, 10);
}

function et20(date: string): number {
  const target = Date.parse(`${date}T20:00:00Z`) / 1000;
  const offset = partsAt(target).localEpoch - target;
  const adjusted = target - offset;
  return target - (partsAt(adjusted).localEpoch - adjusted);
}

function tradingDate(instant: number): string {
  const local = partsAt(instant);
  return local.hour >= 20 ? nextDate(local.date) : local.date;
}

function isTradingDate(date: string, calendar: EquityCalendar): boolean {
  if (date > calendar.coversThrough) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.includes(date);
}



export function isClosedAt(instant: number, calendar: EquityCalendar = holidayCalendar): boolean {
  return !isTradingDate(tradingDate(instant), calendar);
}

export function openMarketSeconds(from: number, to: number, calendar: EquityCalendar = holidayCalendar): number {
  if (to <= from) return 0;
  let cursor = from;
  let open = 0;
  while (cursor < to) {
    const date = tradingDate(cursor);
    const boundary = et20(date);
    const end = Math.min(to, boundary);
    if (end <= cursor) throw new RangeError("Invalid equity session boundary.");
    if (isTradingDate(date, calendar)) open += end - cursor;
    cursor = end;
  }
  return open;
}
