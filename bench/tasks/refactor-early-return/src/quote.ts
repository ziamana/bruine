export interface Customer {
  country: string;
  member: boolean;
  coupon?: string;
}

export interface Quote {
  total: number;
  currency: "EUR" | "USD";
  discount: number;
}

const RATES: Record<string, number> = { FR: 1, US: 1.1 };

/** The price we show a customer. */
export function quoteFor(customer: Customer, net: number): Quote {
  if (customer.member) {
    if (customer.coupon === "WELCOME") {
      if (net > 100) {
        return { total: net * 0.9, currency: "EUR", discount: 10 };
      } else {
        return { total: net * 0.95, currency: "EUR", discount: 5 };
      }
    } else {
      if (net > 100) {
        return { total: net * 0.95, currency: "EUR", discount: 5 };
      } else {
        return { total: net, currency: "EUR", discount: 0 };
      }
    }
  } else {
    if (RATES[customer.country] === undefined) {
      return { total: net, currency: "EUR", discount: 0 };
    } else {
      if (net > 100) {
        return { total: net * RATES[customer.country]!, currency: "USD", discount: 0 };
      } else {
        return { total: net * RATES[customer.country]!, currency: "USD", discount: 0 };
      }
    }
  }
}
