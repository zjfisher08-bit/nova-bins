import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICES as P,
  DEFAULT_WORKER_RATES as R,
  calloutFeeCents,
  formatNzd,
  quote,
  validateItems,
  workerCalloutShareCents,
  workerPayForVisit,
} from "./pricing";

describe("customer prices (examples from the spec)", () => {
  it("one-off, 1 bin = $20", () => {
    expect(quote("one_off", { wheelieBins: ["rubbish"], caddy: false, deodoriser: false }, P).totalCents).toBe(2000);
  });

  it("one-off, 2 bins = $30", () => {
    expect(quote("one_off", { wheelieBins: ["rubbish", "recycling"], caddy: false, deodoriser: false }, P).totalCents).toBe(3000);
  });

  it("one-off, 3 bins + deodoriser = $55", () => {
    const q = quote("one_off", { wheelieBins: ["rubbish", "recycling", "green"], caddy: false, deodoriser: true }, P);
    expect(q.totalCents).toBe(5500);
    expect(q.visits).toBe(1);
  });

  it("subscription, rubbish + recycling = $90 upfront", () => {
    const q = quote("subscription", { wheelieBins: ["rubbish", "recycling"], caddy: false, deodoriser: false }, P);
    expect(q.visitCents).toBe(3000);
    expect(q.visits).toBe(3);
    expect(q.totalCents).toBe(9000);
  });

  it("subscription, rubbish + recycling + deodoriser = $120 upfront", () => {
    expect(
      quote("subscription", { wheelieBins: ["rubbish", "recycling"], caddy: false, deodoriser: true }, P).totalCents,
    ).toBe(12000);
  });

  it("caddy is $5 per clean and not counted as a wheelie bin", () => {
    expect(quote("one_off", { wheelieBins: ["rubbish"], caddy: true, deodoriser: false }, P).totalCents).toBe(2500);
    expect(quote("one_off", { wheelieBins: [], caddy: true, deodoriser: false }, P).totalCents).toBe(500);
    expect(quote("subscription", { wheelieBins: [], caddy: true, deodoriser: false }, P).totalCents).toBe(1500);
  });

  it("breakdown lines add up to the visit price", () => {
    const q = quote("one_off", { wheelieBins: ["rubbish", "green"], caddy: true, deodoriser: true }, P);
    expect(q.lines.reduce((s, l) => s + l.cents, 0)).toBe(q.visitCents);
    expect(q.visitCents).toBe(2000 + 1000 + 500 + 1000);
  });
});

describe("validation", () => {
  it("rejects nothing selected, duplicates and deodoriser with no wheelie bins", () => {
    expect(validateItems({ wheelieBins: [], caddy: false, deodoriser: false })).not.toBeNull();
    expect(validateItems({ wheelieBins: ["rubbish", "rubbish"], caddy: false, deodoriser: false })).not.toBeNull();
    expect(validateItems({ wheelieBins: [], caddy: true, deodoriser: true })).not.toBeNull();
    expect(() => quote("one_off", { wheelieBins: [], caddy: false, deodoriser: false }, P)).toThrow();
  });
});

describe("call-out fee", () => {
  it("is 50% of that visit's price", () => {
    expect(calloutFeeCents(2000, P)).toBe(1000);
    expect(calloutFeeCents(5500, P)).toBe(2750);
    // Subscription: 50% of one visit, not the whole $90.
    const q = quote("subscription", { wheelieBins: ["rubbish", "recycling"], caddy: false, deodoriser: false }, P);
    expect(calloutFeeCents(q.visitCents, P)).toBe(1500);
  });

  it("rounds to the nearest cent", () => {
    expect(calloutFeeCents(1001, P)).toBe(501);
  });
});

describe("worker pay", () => {
  it("$10 per bin for the first two bins", () => {
    expect(workerPayForVisit({ wheelieBins: ["rubbish"], caddy: false, deodoriser: false }, R)).toBe(1000);
    expect(workerPayForVisit({ wheelieBins: ["rubbish", "recycling"], caddy: false, deodoriser: false }, R)).toBe(2000);
  });

  it("$7 for each bin after the first two", () => {
    expect(workerPayForVisit({ wheelieBins: ["rubbish", "recycling", "green"], caddy: false, deodoriser: false }, R)).toBe(2700);
  });

  it("adds $3 caddy and $2 per deodorised bin", () => {
    expect(workerPayForVisit({ wheelieBins: ["rubbish", "recycling", "green"], caddy: true, deodoriser: true }, R)).toBe(
      2700 + 300 + 3 * 200,
    );
    expect(workerPayForVisit({ wheelieBins: [], caddy: true, deodoriser: false }, R)).toBe(300);
  });

  it("gets 50% of a call-out fee charged", () => {
    expect(workerCalloutShareCents(1500, R)).toBe(750);
    expect(workerCalloutShareCents(1375, R)).toBe(688);
  });
});

describe("formatting", () => {
  it("shows whole dollars without cents", () => {
    expect(formatNzd(2000)).toBe("$20");
    expect(formatNzd(2750)).toBe("$27.50");
  });
});
