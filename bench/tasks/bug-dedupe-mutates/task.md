`dedupe()` changes the list I pass in — after the call, my list has lost its
order and my caller's copy is not what it was. Fix it without changing the
signature, and keep the tests passing.
