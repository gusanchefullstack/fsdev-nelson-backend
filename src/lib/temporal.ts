import 'temporal-polyfill/global';

// Postgres `date` columns arrive as Date at UTC midnight
export function toPlainDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from(date.toISOString().slice(0, 10));
}

export function fromPlainDate(date: Temporal.PlainDate | string): Date {
  return new Date(`${date.toString()}T00:00:00.000Z`);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIn(timeZone: string): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(timeZone);
}

export function localDateOf(instant: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

export const isoDateSchemaPattern = /^\d{4}-\d{2}-\d{2}$/;
