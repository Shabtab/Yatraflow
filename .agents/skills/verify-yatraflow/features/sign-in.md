# Sign in and create account

The auth page at `/auth` lets a visitor log in with an email and password, or switch to "Create account". Sign-up asks for a name, date of birth, email and a password of at least 8 characters. Log in uses the same page with a different tab.

## Sub-features

- `auth-login` shows the log-in form by default.
- `auth-signup` shows the create-account form when `mode=signup` is in the address.
- `auth-next` keeps the `next` target so a visitor returns to the page they wanted. It is not driven yet.
- `auth-submit` signs in with real credentials. It needs a disposable test account and is not drivable yet.

## How to get to it (user POV)

- Choose "Log in" in the top bar.
- Choose "Start planning free" in the top bar. It opens the create-account form.
- Open `/auth` or `/auth?mode=signup` directly.

## Driving it with verify.mjs

Preconditions:

- `start` ran and `doctor` passes.
- Signed out.

- **Log-in form.** Run `MSYS_NO_PATHCONV=1 node .agents/skills/verify-yatraflow/scripts/verify.mjs drive /auth sign-in --expect "Welcome back"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/auth`.
- **Top bar.** Run `... drive / sign-in-header --click "Log in" --expect "Welcome back"`. Exit code is `0`.
- **Sign-up form.** Run `... drive "/auth?mode=signup" sign-up --expect "Create your account"`. Exit code is `0`. The body shows "Your name" and "Date of birth".
- **Real sign-in.** Not drivable. It needs a test account, and the harness has no sign-in step yet.

## Gotchas

- A first sign-in seeds three sample trips into "My trips". A run that signs in therefore changes shared data. Use a disposable account and report the seeded trips in the evidence.
- Sessions are bound to the origin. A session signed in on another port or on production does not carry over to `localhost:5178`.
- Password reset is not self-serve. The page says so. Do not drive a reset flow.
