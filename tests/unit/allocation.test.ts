import { describe, expect, it } from 'vitest';
import { findBucket } from '../../src/domain/allocation.js';
import { generateBuckets } from '../../src/domain/buckets.js';
import { localDateOf } from '../../src/lib/temporal.js';

const d = (s: string) => Temporal.PlainDate.from(s);
const rent = generateBuckets({
  startDate: d('2027-01-01'),
  endDate: d('2027-12-31'),
  estimatedExecutionDate: d('2027-01-20'),
  frequency: 'MONTHLY',
}).map((b) => ({ id: `b${b.sequence}`, startDate: b.startDate, endDate: b.endDate }));

describe('findBucket (FR-028)', () => {
  it('picks the bucket containing the date, including both boundaries', () => {
    expect(findBucket(rent, d('2027-03-18'))?.id).toBe('b2');
    expect(findBucket(rent, d('2027-03-05'))?.id).toBe('b2');
    expect(findBucket(rent, d('2027-04-04'))?.id).toBe('b2');
    expect(findBucket(rent, d('2027-04-05'))?.id).toBe('b3');
    expect(findBucket(rent, d('2027-01-01'))?.id).toBe('b0');
    expect(findBucket(rent, d('2027-12-31'))?.id).toBe('b11');
  });

  it('every day of the item maps to exactly one bucket', () => {
    for (let day = d('2027-01-01'); Temporal.PlainDate.compare(day, d('2027-12-31')) <= 0; day = day.add({ days: 1 })) {
      expect(rent.filter((b) => findBucket([b], day)).length).toBe(1);
    }
  });

  it('returns null outside the item range', () => {
    expect(findBucket(rent, d('2026-12-31'))).toBeNull();
    expect(findBucket(rent, d('2028-01-10'))).toBeNull();
  });
});

describe('localDateOf (FR-031)', () => {
  it('uses the recording time zone near midnight', () => {
    const instant = Temporal.Instant.from('2027-03-19T03:30:00Z');
    expect(localDateOf(instant, 'America/Bogota').toString()).toBe('2027-03-18');
    expect(localDateOf(instant, 'America/Los_Angeles').toString()).toBe('2027-03-18');
    expect(localDateOf(instant, 'Europe/Madrid').toString()).toBe('2027-03-19');
  });
});
