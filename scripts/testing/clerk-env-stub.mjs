/**
 * Satisfies `proxy.ts`'s boot-time check so a unit verification script can
 * import the real path predicates instead of reimplementing them.
 *
 * Imported for its side effect, and ordered *before* `../proxy` at the call
 * site: these scripts transpile to CJS, where imports are evaluated in source
 * order, so an assignment written inline after the import list would run too
 * late. A dynamic import would fix the ordering but needs top-level await,
 * which the CJS output format rejects.
 *
 * Stubbed rather than read from `.env` on purpose. This is the unit tier; every
 * script in `verify:unit` has to pass on a checkout with no credentials, and
 * the chain is joined by `&&` — one script that throws at import time takes
 * every later script with it. `proxy.ts` only checks that these are non-empty,
 * so the values are arbitrary.
 */
process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ||= "/sign-in";
process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ||= "/sign-up";
