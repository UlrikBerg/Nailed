# Vipps Login — integration notes

The Vipps Login adapter (`backend/providers/vipps.js`) is **stubbed**. It activates automatically
when all required env vars are set in `.env`. Until then, the login page shows the Vipps button
greyed out with the text "Kommer snart — venter på godkjenning", and any direct API call to
`/api/v1/auth/vipps/start` returns 503.

## What we're waiting for

You need to be approved for the **Login API** by Vipps (which is separate from Vipps eCom /
"Logg inn med Vipps" payments).

Application portal: https://portal.vippsmobilepay.com/

In the application, request access to:
- **Login API** (sometimes listed as "Logg inn med Vipps" / "Vipps Login")
- Scopes: `openid name email phoneNumber address birthDate`

Vipps will provision:
- **Merchant Serial Number (MSN)** — your merchant ID
- **Client ID** — for OIDC
- **Client Secret** — for OIDC
- **Subscription Key (Ocp-Apim-Subscription-Key)** — for Vipps API access
- A **test environment** at `apitest.vipps.no` with separate test credentials

## When credentials arrive

1. Add the **production redirect URI** in the Vipps merchant portal:
   `https://nailed.no/api/v1/auth/vipps/callback`
2. Add a **test redirect URI** as well (for staging/local testing):
   `http://localhost:3000/api/v1/auth/vipps/callback`
3. Set the env vars in `.env`:
   ```
   VIPPS_ENV=test                 # or 'production'
   VIPPS_CLIENT_ID=<from Vipps>
   VIPPS_CLIENT_SECRET=<from Vipps>
   VIPPS_MSN=<merchant serial number>
   VIPPS_SUBSCRIPTION_KEY=<Ocp-Apim-Subscription-Key>
   VIPPS_REDIRECT_URI=http://localhost:3000/api/v1/auth/vipps/callback
   ```
4. Restart the server. `/login.html` will detect Vipps is enabled and the button becomes active.
5. Test login end-to-end with a Vipps test user.
6. When happy, switch `VIPPS_ENV=production` and update `VIPPS_REDIRECT_URI` to the prod URL.

## What our code already handles

- **OIDC + PKCE flow:** identical to the Google flow, via the shared provider abstraction
  (`backend/providers/index.js`).
- **Profile data:** `name`, `email`, `phone_number`, `birthdate`, and `address` are pulled from
  Vipps `userinfo` and persisted on the user record (`users.phone`, `users.birth_year`, etc.) on
  first login.
- **Identity linking:** if a user has previously logged in with Google, their first Vipps login
  with the same email links the Vipps identity to the existing account (no duplicate user).

## Why we're using Google as primary right now

CLAUDE.md says "etterhvert skal det kun benyttes vipps logg inn api, og ingenting annet" — so
Google is a temporary backup. The auth layer is provider-agnostic, so switching the primary
later is one frontend change in `login.html` and one product decision (do we drop Google entirely,
or keep it as a "secondary" option indefinitely? Vipps Login adoption is high in Norway but not
universal).

When you're ready to deprecate Google:
1. Remove the Google button from `login.html`.
2. Optionally remove `GOOGLE_*` env vars from production (the provider auto-disables when
   credentials are missing).
3. Existing users keep their accounts — their `auth_identities` row links to a working provider.
