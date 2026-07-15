const LOW_INFORMATION_TITLE_PREVIEWS = new Set([
  "hi",
  "hello",
  "hey",
  "hello nano",
  "hello nanobot",
  "hi nano",
  "hi nanobot",
  "你好",
  "您好",
  "嗨",
  "哈喽",
  "哈啰",
  "在吗",
]);

function isLowInformationTitlePreview(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.!?。！？~～\s]+$/g, "").trim();
  return (
    normalized.startsWith("/") ||
    LOW_INFORMATION_TITLE_PREVIEWS.has(normalized)
  );
}

/** Truncate the first user message into a chat title. */
export function deriveTitle(preview: string | undefined, fallback: string): string {
  if (!preview) return fallback;
  const oneLine = preview.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  if (isLowInformationTitlePreview(oneLine)) return fallback;
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

type DateValue = Date | string | number | null | undefined;

/** Loose ISO-or-epoch parser; returns ``null`` for missing/invalid input. */
function parseDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatClock(value: DateValue): string {
  const date = parseDate(value);
  return date ? `${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}` : "--:--";
}

export function formatDateTime(value: DateValue): string {
  if (value === null || value === undefined || value === "") return "-";
  const date = parseDate(value);
  if (!date) return typeof value === "string" ? value : "-";
  return [
    `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`,
    `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`,
  ].join(" ");
}

const RELATIVE_THRESHOLDS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.345, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function activeLocale(locale?: string): string {
  if (locale) return locale;
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "zh-CN";
}

function relativeTimeFormatter(locale: string): Intl.RelativeTimeFormat {
  const existing = relativeTimeFormatters.get(locale);
  if (existing) return existing;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  relativeTimeFormatters.set(locale, formatter);
  return formatter;
}

function dateTimeFormatter(locale: string): Intl.DateTimeFormat {
  const existing = dateTimeFormatters.get(locale);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  dateTimeFormatters.set(locale, formatter);
  return formatter;
}

export function relativeTime(
  value: string | number | null | undefined,
  locale?: string,
): string {
  const date = parseDate(value);
  if (!date) return "";
  let delta = (date.getTime() - Date.now()) / 1000;
  const formatter = relativeTimeFormatter(activeLocale(locale));
  for (const [step, unit] of RELATIVE_THRESHOLDS) {
    if (Math.abs(delta) < step) {
      return formatter.format(Math.round(delta), unit);
    }
    delta /= step;
  }
  return formatter.format(Math.round(delta), "year");
}

export function fmtDateTime(
  value: string | number | null | undefined,
  locale?: string,
): string {
  const date = parseDate(value);
  return date ? dateTimeFormatter(activeLocale(locale)).format(date) : "";
}

/** Human-readable turn duration (wall-clock), locale-aware via ``Intl`` (seconds/minutes). */
export function formatTurnLatency(ms: number, locale?: string): string {
  const loc = activeLocale(locale);
  const msClamped = Math.max(0, ms);
  const secTotal = msClamped / 1000;
  if (secTotal < 60) {
    return new Intl.NumberFormat(loc, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      maximumFractionDigits: secTotal < 10 ? 1 : 0,
      minimumFractionDigits: 0,
    }).format(secTotal);
  }
  const roundedTotalSeconds = Math.round(secTotal);
  const wholeMin = Math.floor(roundedTotalSeconds / 60);
  const remSec = roundedTotalSeconds % 60;
  const minStr = new Intl.NumberFormat(loc, {
    style: "unit",
    unit: "minute",
    unitDisplay: "narrow",
  }).format(wholeMin);
  const secStr = new Intl.NumberFormat(loc, {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
    maximumFractionDigits: 0,
  }).format(remSec);
  return `${minStr}\u00a0${secStr}`;
}
