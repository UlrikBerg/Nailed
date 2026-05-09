# Google OAuth setup (5 min)

This activates the "Fortsett med Google" button on `/login.html`.

## 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/
2. Top bar → "Select a project" → "New Project"
3. Name: `nailed` (or whatever you prefer). Click **Create**.

## 2. Configure the OAuth consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - **App name:** nailed
   - **User support email:** your email
   - **App logo:** optional (use `assets/logo-mark.svg`)
   - **Authorized domains:** `nailed.no` (and any staging domain)
   - **Developer contact information:** your email
4. **Save and continue.**
5. **Scopes:** click *Add or remove scopes*, then check:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
   Save.
6. **Test users** (only needed while the app is in "Testing" mode): add your own Gmail so you can log in before publishing.
7. Save and continue → Back to Dashboard.

## 3. Create OAuth client credentials

1. Left menu → **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `nailed web`
5. **Authorized redirect URIs:** add **all** URIs you'll log in from:
   - Local dev: `http://localhost:3000/api/v1/auth/google/callback`
   - Staging:  `https://staging.nailed.no/api/v1/auth/google/callback`  *(if applicable)*
   - Production: `https://nailed.no/api/v1/auth/google/callback`
6. **Create.**
7. Copy **Client ID** and **Client Secret** — you'll need them in the next step.

## 4. Put credentials into `.env`

Edit `.env` (create from `.env.example` if it doesn't exist) and set:

```
GOOGLE_CLIENT_ID=<paste here>
GOOGLE_CLIENT_SECRET=<paste here>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
```

For production, override `GOOGLE_REDIRECT_URI` in the Hostinger env panel to the production URL.

## 5. Restart the server

```bash
npm run dev
```

Open `/login.html` — the "Fortsett med Google" button is now active. Sign in with the test user
you added in step 2.6 (or with any account once the app is published).

## 6. Publish the app (when ready for real users)

When you're ready to let the public sign in:

1. **APIs & Services** → **OAuth consent screen** → **Publish app**.
2. For most cases (no sensitive scopes) Google does not require a verification process for `openid email profile` — it just becomes available to everyone immediately.

## Troubleshooting

- **`redirect_uri_mismatch`:** the URI in `.env` does not match an Authorized redirect URI in step 3.5. They must match exactly (scheme, host, port, path).
- **`This app isn't verified`:** normal during testing. Click **Advanced** → **Go to nailed (unsafe)** to continue. After publishing, the warning is gone for the basic scopes.
- **Getting bumped to `/login.html?error=...`:** check the server log. Most common: missing env vars, wrong client secret.

## Bootstrap admin

Set `BOOTSTRAP_ADMIN_EMAILS` in `.env` (comma-separated) so that the listed emails are auto-promoted to `role=admin` the first time they log in. Use this once for yourself, then remove. Example:

```
BOOTSTRAP_ADMIN_EMAILS=ulriktheodor99@gmail.com
```
