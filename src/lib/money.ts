import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const moneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 1250.00');

export const toDecimal = (value: string | number | Decimal): Decimal => new Decimal(value);

export const toMoneyString = (value: Decimal | string | number): string =>
  new Decimal(value).toFixed(2);

export const sumMoney = (values: (Decimal | string)[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.add(new Decimal(v)), new Decimal(0));
