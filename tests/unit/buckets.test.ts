import { describe, expect, it } from 'vitest';
import { generateBuckets, unplannedAnchor, type ScheduleInput } from '../../src/domain/buckets.js';

const d = (s: string) => Temporal.PlainDate.from(s);

function windows(input: Partial<ScheduleInput> & Pick<ScheduleInput, 'frequency'>) {
  return generateBuckets({
    startDate: d('2027-01-01'),
    endDate: d('2027-12-31'),
    estimatedExecutionDate: d('2027-01-20'),
    ...input,
  }).map((b) => [b.startDate.toString(), b.endDate.toString(), b.estimatedExecutionDate.toString()]);
}

function expectContiguous(input: ScheduleInput) {
  const buckets = generateBuckets(input);
  expect(buckets[0]!.startDate.equals(input.startDate)).toBe(true);
  expect(buckets.at(-1)!.endDate.equals(input.endDate)).toBe(true);
  buckets.forEach((b, i) => {
    expect(b.sequence).toBe(i);
    expect(Temporal.PlainDate.compare(b.startDate, b.endDate)).toBeLessThanOrEqual(0);
    const exec = b.estimatedExecutionDate;
    expect(Temporal.PlainDate.compare(b.startDate, exec)).toBeLessThanOrEqual(0);
    expect(Temporal.PlainDate.compare(exec, b.endDate)).toBeLessThanOrEqual(0);
    const next = buckets[i + 1];
    if (next) expect(next.startDate.equals(b.endDate.add({ days: 1 }))).toBe(true);
  });
}

describe('generateBuckets (FR-023, FR-024)', () => {
  it('monthly Rent on the 20th gives 12 buckets from the 5th to the 4th', () => {
    const w = windows({ frequency: 'MONTHLY' });
    expect(w).toHaveLength(12);
    expect(w[0]).toEqual(['2027-01-01', '2027-02-04', '2027-01-20']);
    expect(w[1]).toEqual(['2027-02-05', '2027-03-04', '2027-02-20']);
    expect(w[2]).toEqual(['2027-03-05', '2027-04-04', '2027-03-20']);
    expect(w[11]).toEqual(['2027-12-05', '2027-12-31', '2027-12-20']);
  });

  it('one-time items get a single bucket covering the item range', () => {
    expect(
      windows({ frequency: 'ONE_TIME', startDate: d('2027-03-01'), endDate: d('2027-06-30'), estimatedExecutionDate: d('2027-04-10') }),
    ).toEqual([['2027-03-01', '2027-06-30', '2027-04-10']]);
  });

  it('daily items get one-day buckets (half window 0)', () => {
    const w = windows({ frequency: 'DAILY', endDate: d('2027-01-05'), estimatedExecutionDate: d('2027-01-01') });
    expect(w).toEqual([
      ['2027-01-01', '2027-01-01', '2027-01-01'],
      ['2027-01-02', '2027-01-02', '2027-01-02'],
      ['2027-01-03', '2027-01-03', '2027-01-03'],
      ['2027-01-04', '2027-01-04', '2027-01-04'],
      ['2027-01-05', '2027-01-05', '2027-01-05'],
    ]);
  });

  it('weekly items use a 3-day half window', () => {
    const w = windows({ frequency: 'WEEKLY', endDate: d('2027-01-31'), estimatedExecutionDate: d('2027-01-04') });
    expect(w).toEqual([
      ['2027-01-01', '2027-01-07', '2027-01-04'],
      ['2027-01-08', '2027-01-14', '2027-01-11'],
      ['2027-01-15', '2027-01-21', '2027-01-18'],
      ['2027-01-22', '2027-01-31', '2027-01-25'],
    ]);
  });

  it('biweekly items use a 7-day half window', () => {
    const w = windows({ frequency: 'BIWEEKLY', endDate: d('2027-02-28'), estimatedExecutionDate: d('2027-01-08') });
    expect(w.map((x) => x[0])).toEqual(['2027-01-01', '2027-01-15', '2027-01-29', '2027-02-12']);
    expect(w.at(-1)![1]).toBe('2027-02-28');
  });

  it('quarterly items use a 45-day half window', () => {
    const w = windows({ frequency: 'QUARTERLY', estimatedExecutionDate: d('2027-03-10') });
    expect(w.map((x) => x[2])).toEqual(['2027-03-10', '2027-06-10', '2027-09-10', '2027-12-10']);
    expect(w.map((x) => x[0])).toEqual(['2027-01-01', '2027-04-26', '2027-07-27', '2027-10-26']);
  });

  it('annual items use a 182-day half window', () => {
    const w = windows({ frequency: 'ANNUALLY', endDate: d('2029-12-31'), estimatedExecutionDate: d('2027-06-15') });
    expect(w.map((x) => x[0])).toEqual(['2027-01-01', '2027-12-16', '2028-12-15']);
  });

  it('custom every 21 days uses a 10-day half window', () => {
    const w = windows({
      frequency: 'CUSTOM',
      customInterval: 21,
      customUnit: 'DAYS',
      endDate: d('2027-03-31'),
      estimatedExecutionDate: d('2027-01-10'),
    });
    expect(w.map((x) => x[2])).toEqual(['2027-01-10', '2027-01-31', '2027-02-21', '2027-03-14']);
    expect(w.map((x) => x[0])).toEqual(['2027-01-01', '2027-01-21', '2027-02-11', '2027-03-04']);
  });

  it('custom every 3 months matches quarterly', () => {
    const custom = windows({ frequency: 'CUSTOM', customInterval: 3, customUnit: 'MONTHS', estimatedExecutionDate: d('2027-03-10') });
    expect(custom).toEqual(windows({ frequency: 'QUARTERLY', estimatedExecutionDate: d('2027-03-10') }));
  });

  it('executions on the 31st move to month end without drifting', () => {
    const w = windows({ frequency: 'MONTHLY', endDate: d('2027-04-30'), estimatedExecutionDate: d('2027-01-31') });
    expect(w.map((x) => x[2])).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    expect(w.map((x) => x[0])).toEqual(['2027-01-01', '2027-02-13', '2027-03-16', '2027-04-15']);
  });

  it('a frequency longer than the item gives one bucket', () => {
    expect(
      windows({ frequency: 'QUARTERLY', startDate: d('2027-02-01'), endDate: d('2027-03-31'), estimatedExecutionDate: d('2027-02-15') }),
    ).toEqual([['2027-02-01', '2027-03-31', '2027-02-15']]);
  });

  it('partial-duration items (Netflix Mar 15 – Sep 15) stay inside their range', () => {
    const w = windows({
      frequency: 'MONTHLY',
      startDate: d('2027-03-15'),
      endDate: d('2027-09-15'),
      estimatedExecutionDate: d('2027-03-20'),
    });
    expect(w).toHaveLength(6);
    expect(w[0]![0]).toBe('2027-03-15');
    expect(w.at(-1)![1]).toBe('2027-09-15');
  });

  it.each([
    ['MONTHLY', '2027-01-20'],
    ['WEEKLY', '2027-01-03'],
    ['BIWEEKLY', '2027-01-14'],
    ['QUARTERLY', '2027-02-28'],
    ['DAILY', '2027-01-01'],
    ['ANNUALLY', '2027-12-31'],
    ['ONE_TIME', '2027-07-01'],
  ] as const)('%s buckets are contiguous and cover the item exactly', (frequency, exec) => {
    expectContiguous({ startDate: d('2027-01-01'), endDate: d('2027-12-31'), estimatedExecutionDate: d(exec), frequency });
  });

  it('custom schedules are contiguous too', () => {
    expectContiguous({
      startDate: d('2027-01-01'),
      endDate: d('2027-12-31'),
      estimatedExecutionDate: d('2027-01-29'),
      frequency: 'CUSTOM',
      customInterval: 2,
      customUnit: 'MONTHS',
    });
  });
});

describe('unplannedAnchor (FR-033)', () => {
  it('uses the first 15th on or after the budget start', () => {
    expect(unplannedAnchor(d('2027-01-01'), d('2027-12-31')).toString()).toBe('2027-01-15');
    expect(unplannedAnchor(d('2027-01-15'), d('2027-12-31')).toString()).toBe('2027-01-15');
    expect(unplannedAnchor(d('2027-01-20'), d('2027-12-31')).toString()).toBe('2027-02-15');
  });

  it('falls back to the budget start when no 15th fits', () => {
    expect(unplannedAnchor(d('2027-01-20'), d('2027-02-10')).toString()).toBe('2027-01-20');
  });

  it('gives roughly calendar-month buckets for a Jan–Dec budget', () => {
    const buckets = generateBuckets({
      startDate: d('2027-01-01'),
      endDate: d('2027-12-31'),
      estimatedExecutionDate: unplannedAnchor(d('2027-01-01'), d('2027-12-31')),
      frequency: 'MONTHLY',
    });
    expect(buckets).toHaveLength(12);
    expect(buckets[1]!.startDate.toString()).toBe('2027-01-31');
  });
});
