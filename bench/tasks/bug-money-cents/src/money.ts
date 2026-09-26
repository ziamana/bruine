/** A price in cents, with a tax rate like 0.2 for 20%. */
export interface Invoice {
  cents: number;
  taxRate: number;
}

/** The invoice total in cents, tax included. */
export function totalWithTax(invoice: Invoice): number {
  return invoice.cents + invoice.cents * invoice.taxRate;
}
