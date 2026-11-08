/**
 * Prices and worker pay. All money is in cents (NZD) to avoid rounding errors.
 * The numbers come from the `settings` table; this file only does the maths,
 * so it can be unit-tested and reused on the server (never trust browser totals).
 */

export const WHEELIE_BIN_TYPES = ["rubbish", "recycling", "green"] as const;
export type WheelieBin = (typeof WHEELIE_BIN_TYPES)[number];

export type BookingType = "one_off" | "subscription";

/** What gets cleaned at each visit. */
export interface VisitItems {
  wheelieBins: WheelieBin[];
  caddy: boolean;
  /** Deodoriser on every wheelie bin. */
  deodoriser: boolean;
}

/** Price settings (cents), matching columns in the `settings` table. */
export interface PriceSettings {
  oneOffFirstBinCents: number;
  oneOffExtraBinCents: number;
  subscriptionBinCents: number;
  caddyCents: number;
  deodoriserCents: number;
  calloutPercent: number;
  subscriptionCleans: number;
}

/** Worker pay settings (cents), matching columns in the `settings` table. */
export interface WorkerRateSettings {
  /** Paid for each of the first `workerBinTierSize` wheelie bins in a visit. */
  workerBinCents: number;
  /** Paid for each wheelie bin after that. */
  workerExtraBinCents: number;
  workerBinTierSize: number;
  workerCaddyCents: number;
  workerDeodoriserCents: number;
  workerCalloutPercent: number;
}

export const DEFAULT_PRICES: PriceSettings = {
  oneOffFirstBinCents: 2000,
  oneOffExtraBinCents: 1000,
  subscriptionBinCents: 1500,
  caddyCents: 500,
  deodoriserCents: 500,
  calloutPercent: 50,
  subscriptionCleans: 3,
};

export const DEFAULT_WORKER_RATES: WorkerRateSettings = {
  workerBinCents: 1000,
  workerExtraBinCents: 700,
  workerBinTierSize: 2,
  workerCaddyCents: 300,
  workerDeodoriserCents: 200,
  workerCalloutPercent: 50,
};

/** Check the items make sense: no duplicate bins, and at least one thing to clean. */
export function validateItems(items: VisitItems): string | null {
  const unique = new Set(items.wheelieBins);
  if (unique.size !== items.wheelieBins.length) return "Each bin type can only be chosen once.";
  if (items.wheelieBins.some((b) => !WHEELIE_BIN_TYPES.includes(b))) return "Unknown bin type.";
  if (items.wheelieBins.length === 0 && !items.caddy) return "Choose at least one bin.";
  if (items.deodoriser && items.wheelieBins.length === 0) return "Deodoriser is for wheelie bins only.";
  return null;
}

/** One line of a price breakdown, e.g. { label: "2nd wheelie bin", cents: 1000 }. */
export interface PriceLine {
  label: string;
  cents: number;
}

export interface Quote {
  type: BookingType;
  visits: number;
  /** Price of one visit (used for call-out fees). */
  visitCents: number;
  /** What the customer pays now. */
  totalCents: number;
  /** Breakdown of a single visit. */
  lines: PriceLine[];
}

const ORDINALS = ["1st", "2nd", "3rd"];
const BIN_LABEL: Record<WheelieBin, string> = { rubbish: "Rubbish", recycling: "Recycling", green: "Green waste" };

/** Work out the price of a booking. Throws if the items are invalid. */
export function quote(type: BookingType, items: VisitItems, p: PriceSettings): Quote {
  const problem = validateItems(items);
  if (problem) throw new Error(problem);

  const lines: PriceLine[] = items.wheelieBins.map((bin, i) => {
    let cents: number;
    if (type === "subscription") cents = p.subscriptionBinCents;
    else cents = i === 0 ? p.oneOffFirstBinCents : p.oneOffExtraBinCents;
    const label = type === "one_off" ? `${BIN_LABEL[bin]} bin (${ORDINALS[i] ?? `${i + 1}th`})` : `${BIN_LABEL[bin]} bin`;
    return { label, cents };
  });
  if (items.caddy) lines.push({ label: "Food scraps caddy", cents: p.caddyCents });
  if (items.deodoriser) {
    const n = items.wheelieBins.length;
    lines.push({ label: `Deodoriser × ${n}`, cents: p.deodoriserCents * n });
  }

  const visitCents = lines.reduce((sum, l) => sum + l.cents, 0);
  const visits = type === "subscription" ? p.subscriptionCleans : 1;
  return { type, visits, visitCents, totalCents: visitCents * visits, lines };
}

/** Call-out fee for a visit, rounded to the nearest cent. */
export function calloutFeeCents(visitCents: number, p: Pick<PriceSettings, "calloutPercent">): number {
  return Math.round((visitCents * p.calloutPercent) / 100);
}

/** What the worker earns for completing one visit. */
export function workerPayForVisit(items: VisitItems, r: WorkerRateSettings): number {
  const bins = items.wheelieBins.length;
  const firstTier = Math.min(bins, r.workerBinTierSize);
  const extra = bins - firstTier;
  return (
    firstTier * r.workerBinCents +
    extra * r.workerExtraBinCents +
    (items.caddy ? r.workerCaddyCents : 0) +
    (items.deodoriser ? bins * r.workerDeodoriserCents : 0)
  );
}

/** Worker's share of a call-out fee that was actually charged. */
export function workerCalloutShareCents(feeCents: number, r: Pick<WorkerRateSettings, "workerCalloutPercent">): number {
  return Math.round((feeCents * r.workerCalloutPercent) / 100);
}

/** Format cents as "$12.50" (or "$12" for whole dollars). */
export function formatNzd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
