import { describe, expect, it } from "vitest";

import { formatClock, formatDateTime, formatTurnLatency } from "@/lib/format";

describe("formatClock", () => {
  it("formats message times with stable two-digit minutes and seconds", () => {
    expect(formatClock(new Date(2026, 6, 14, 9, 4, 7))).toBe("04:07");
  });

  it("returns a stable placeholder for invalid dates", () => {
    expect(formatClock("not-a-date")).toBe("--:--");
  });
});

describe("formatDateTime", () => {
  it("formats local date-time values as yyyy-MM-dd HH:mm:ss", () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "2026-01-02 03:04:05",
    );
  });

  it.each([null, undefined])("returns a dash for missing value %s", (value) => {
    expect(formatDateTime(value)).toBe("-");
  });

  it("returns an invalid non-empty input unchanged", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatTurnLatency", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatTurnLatency(119_999, "en-US")).toBe("2m 0s");
  });
});
