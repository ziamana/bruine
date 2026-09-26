`src/text.ts` has three copies of the same "trim, lowercase, collapse spaces"
helper with three different names. Keep one, use it everywhere, and keep the
exported names working — the tests call all of them.
