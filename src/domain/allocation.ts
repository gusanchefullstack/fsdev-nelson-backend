import '../lib/temporal.js';

interface Window {
  id: string;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
}

/** The single bucket whose window contains the date, or null when it falls outside the item (FR-028). */
export function findBucket<T extends Window>(buckets: T[], date: Temporal.PlainDate): T | null {
  return (
    buckets.find(
      (b) => Temporal.PlainDate.compare(b.startDate, date) <= 0 && Temporal.PlainDate.compare(date, b.endDate) <= 0,
    ) ?? null
  );
}
