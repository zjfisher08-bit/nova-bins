import { describe, expect, it } from "vitest";
import {
  addDays,
  bookingCleanDates,
  daysBetween,
  firstCleanDate,
  isRecyclingDay,
  isoWeekday,
  nextEligibleDate,
  nzToday,
  recyclingAnchorFromAnswer,
  subscriptionDates,
  upcomingCollectionDate,
  weekStart,
  type CollectionInfo,
} from "./scheduling";

// Reference calendar (November 2026):
// Sun 8 · Mon 9 · Tue 10 · Wed 11 · Thu 12 · Fri 13 · ... · Wed 18 · Wed 25 · Wed 2 Dec

describe("date helpers", () => {
  it("knows the weekday", () => {
    expect(isoWeekday("2026-11-08")).toBe(7); // Sunday
    expect(isoWeekday("2026-11-09")).toBe(1); // Monday
    expect(isoWeekday("2026-11-13")).toBe(5); // Friday
    expect(isoWeekday("1969-12-29")).toBe(1); // before 1970 still works
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-12-25", "2027-01-08")).toBe(14);
  });

  it("rejects bad dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("8/11/2026", 1)).toThrow();
  });

  it("uses the New Zealand date, not UTC", () => {
    // 12:00 UTC on 8 Nov is 1am on 9 Nov in NZ (NZDT, UTC+13).
    expect(nzToday(new Date("2026-11-08T12:00:00Z"))).toBe("2026-11-09");
    expect(nzToday(new Date("2026-11-08T10:59:00Z"))).toBe("2026-11-08");
    // Winter (NZST, UTC+12): 12:00 UTC is midnight NZ.
    expect(nzToday(new Date("2026-07-01T11:59:00Z"))).toBe("2026-07-01");
    expect(nzToday(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-02");
  });

  it("finds the Monday that starts a payout week", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the previous week
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-13")).toBe("2026-11-09");
  });
});

describe("recycling weeks", () => {
  it("asks about the upcoming collection day (today counts)", () => {
    expect(upcomingCollectionDate("2026-11-08", 4)).toBe("2026-11-12");
    expect(upcomingCollectionDate("2026-11-12", 4)).toBe("2026-11-12");
    expect(upcomingCollectionDate("2026-11-13", 4)).toBe("2026-11-19");
  });

  it("stores the right recycling date from the customer's answer", () => {
    expect(recyclingAnchorFromAnswer("2026-11-08", 4, true)).toBe("2026-11-12");
    expect(recyclingAnchorFromAnswer("2026-11-08", 4, false)).toBe("2026-11-19");
  });

  it("repeats every 2 weeks in both directions", () => {
    const anchor = "2026-11-12";
    expect(isRecyclingDay("2026-11-12", anchor)).toBe(true);
    expect(isRecyclingDay("2026-11-19", anchor)).toBe(false);
    expect(isRecyclingDay("2026-11-26", anchor)).toBe(true);
    expect(isRecyclingDay("2026-10-29", anchor)).toBe(true);
    expect(isRecyclingDay("2026-11-05", anchor)).toBe(false);
    expect(isRecyclingDay("2027-01-07", anchor)).toBe(true); // across the new year
  });
});

describe("first clean date", () => {
  const wednesday = (needsRecyclingWeek: boolean): CollectionInfo => ({
    collectionDay: 3,
    recyclingAnchor: "2026-11-11", // recycling on Wed 11, 25 Nov, 9 Dec...
    needsRecyclingWeek,
  });

  it("allows a collection day exactly lead-days away", () => {
    expect(firstCleanDate("2026-11-09", wednesday(false), 2)).toBe("2026-11-11");
  });

  it("skips to next week when lead time isn't met", () => {
    expect(firstCleanDate("2026-11-10", wednesday(false), 2)).toBe("2026-11-18");
  });

  it("skips non-recycling weeks when a recycling bin is booked", () => {
    // 18 Nov is not a recycling week, so the first clean is 25 Nov.
    expect(firstCleanDate("2026-11-10", wednesday(true), 2)).toBe("2026-11-25");
    // On a recycling week with enough lead time it's used straight away.
    expect(firstCleanDate("2026-11-09", wednesday(true), 2)).toBe("2026-11-11");
  });

  it("does not need a recycling week without a recycling bin", () => {
    expect(firstCleanDate("2026-11-15", wednesday(false), 2)).toBe("2026-11-18");
  });

  it("booking on collection day itself goes to next week (lead 2)", () => {
    expect(firstCleanDate("2026-11-11", wednesday(false), 2)).toBe("2026-11-18");
  });

  it("lead 0 allows same-day", () => {
    expect(firstCleanDate("2026-11-11", wednesday(false), 0)).toBe("2026-11-11");
  });

  it("a long lead time is respected", () => {
    expect(firstCleanDate("2026-11-09", wednesday(true), 10)).toBe("2026-11-25");
  });

  it("rejects a negative lead time", () => {
    expect(() => firstCleanDate("2026-11-09", wednesday(false), -1)).toThrow();
  });
});

describe("subscriptions", () => {
  it("schedules 3 cleans 4 weeks apart, across the new year", () => {
    expect(subscriptionDates("2026-12-17")).toEqual(["2026-12-17", "2027-01-14", "2027-02-11"]);
  });

  it("keeps every clean on a recycling week when the first one is", () => {
    const info: CollectionInfo = { collectionDay: 1, recyclingAnchor: "2026-11-16", needsRecyclingWeek: true };
    const dates = bookingCleanDates("2026-11-09", info, { type: "subscription", leadDays: 2 });
    expect(dates).toEqual(["2026-11-16", "2026-12-14", "2027-01-11"]);
    for (const d of dates) {
      expect(isoWeekday(d)).toBe(1);
      expect(isRecyclingDay(d, info.recyclingAnchor)).toBe(true);
    }
  });

  it("without recycling, may start (and stay) on a non-recycling week", () => {
    const info: CollectionInfo = { collectionDay: 1, recyclingAnchor: "2026-11-16", needsRecyclingWeek: false };
    const dates = bookingCleanDates("2026-11-04", info, { type: "subscription", leadDays: 2 });
    expect(dates).toEqual(["2026-11-09", "2026-12-07", "2027-01-04"]);
    for (const d of dates) expect(isRecyclingDay(d, info.recyclingAnchor)).toBe(false);
  });

  it("one-off bookings get a single date", () => {
    const info: CollectionInfo = { collectionDay: 5, recyclingAnchor: "2026-11-13", needsRecyclingWeek: false };
    expect(bookingCleanDates("2026-11-08", info, { type: "one_off", leadDays: 2 })).toEqual(["2026-11-13"]);
  });
});

describe("reschedule", () => {
  const info = (needsRecyclingWeek: boolean): CollectionInfo => ({
    collectionDay: 3,
    recyclingAnchor: "2026-11-18",
    needsRecyclingWeek,
  });

  it("problem reported on the day moves to the next collection day", () => {
    expect(nextEligibleDate("2026-11-18", "2026-11-18", info(false))).toBe("2026-11-25");
  });

  it("with recycling it moves two weeks", () => {
    expect(nextEligibleDate("2026-11-18", "2026-11-18", info(true))).toBe("2026-12-02");
  });

  it("a decision made days later never picks a past date", () => {
    // Job was Wed 18 Nov, admin decides on Thu 26 Nov.
    expect(nextEligibleDate("2026-11-18", "2026-11-26", info(false))).toBe("2026-12-02");
  });

  it("deciding on a collection day doesn't pick today", () => {
    expect(nextEligibleDate("2026-11-18", "2026-11-25", info(false))).toBe("2026-12-02");
  });

  it("rescheduling a future job (e.g. admin moves it ahead) picks the one after it", () => {
    expect(nextEligibleDate("2026-12-02", "2026-11-20", info(true))).toBe("2026-12-16");
  });
});
