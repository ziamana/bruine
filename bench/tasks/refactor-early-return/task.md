`quoteFor` in `src/quote.ts` is one big if/else nest and nobody can read it any
more. Flatten it with early returns — same behaviour, the tests must stay
green.
