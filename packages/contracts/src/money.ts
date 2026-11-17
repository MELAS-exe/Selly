import { z } from 'zod';

export const CurrencySchema = z.enum(['XOF', 'SAT']);
export const MoneySchema = z.object({
  amount: z.number().int().min(0),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const PlanIdSchema = z.enum(['starter', 'pro', 'business']);
export type PlanId = z.infer<typeof PlanIdSchema>;
