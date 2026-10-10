import { z } from 'zod';
import { isValidTimeZone } from '../time';

export const BILLING_KEY = 'billing';

const currencyCode = z.string().trim().regex(/^[A-Z]{3}$/, 'use a 3-letter currency code such as BDT');

export const billingSettingsSchema = z.object({
  businessName: z.string().trim().max(200).default(''),
  businessAddress: z.string().trim().max(1000).default(''),
  businessEmail: z.string().trim().max(200).default(''),
  businessPhone: z.string().trim().max(50).default(''),
  /** Shown on invoices: bank account, bKash/Nagad number, etc. */
  paymentDetails: z.string().trim().max(2000).default(''),
  invoiceFooter: z.string().trim().max(1000).default(''),
  invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9-]{0,12}$/, 'letters, digits and "-" only').default('AMS-'),
  paymentTermsDays: z.number().int().min(0).max(365).default(15),
  /** Billing months, daily charts and invoice dates use this zone. */
  timeZone: z.string().refine(isValidTimeZone, 'unknown time zone').default('Asia/Dhaka'),
  defaultCurrency: currencyCode.default('BDT'),
  /** Units of each currency per 1 USD. AI costs are in USD and converted with these. */
  fxRates: z
    .record(currencyCode, z.number().positive().max(1_000_000))
    .refine((r) => r.USD === 1, 'USD must be 1')
    .default({ USD: 1, BDT: 122 }),
});

export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export const BILLING_DEFAULTS: BillingSettings = billingSettingsSchema.parse({});
