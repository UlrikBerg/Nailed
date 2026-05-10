# Deploy til Hostinger Cloud

Steg-for-steg for å få nailed kjørende på en Hostinger Cloud-plan (Node.js + MySQL).

## 1. Opprett MySQL-database

1. hPanel → **Databaser** → **Administrer** under MySQL Databases
2. **Opprett en ny database**
   - Database: `nailed` (eller hva som er ledig)
   - Bruker: `nailed_admin` (eller annet)
   - Passord: bruk **Generer** og lagre passordet et trygt sted
3. Hostinger viser nå:
   - **Database name** (ofte med prefiks som `u123456_nailed`)
   - **Username** (ofte med prefiks som `u123456_admin`)
   - **Host** — vanligvis `localhost` *fra Node-appen sin side*; for ekstern tilgang får du en IP eller `mysql.hostinger.com`-host
4. Behold disse verdiene — du legger dem inn som env vars i steg 4.

## 2. Opprett Node.js-app

1. hPanel → **Avansert** → **Node.js**
2. **Opprett ny applikasjon** (eller hvis Hostinger allerede har auto-detektert appen, klikk på den):
   - **Application root**: `public_html` (eller den mappen Git deployer til)
   - **Application URL**: hovedurl (skyblue-cod-…hostingersite.com eller eget domene)
   - **Application startup file**: `server.js`
   - **Node.js version**: 20.x eller nyere
   - **Application mode**: `production`
3. **Opprett**.

> **Hvorfor 503 akkurat nå:** Hostinger har sannsynligvis allerede auto-detektert `package.json` og prøver å kjøre `node server.js`, men appen krasjer fordi `JWT_SECRET` ikke er satt i env. Edge-proxyen returnerer 503. Etter å ha satt env vars i steg 4 og restartet, fungerer det.

## 3. Installer dependencies

I Node.js-appens detaljside:

1. Åpne **Run NPM Install** (eller bruk den innebygde terminalen i hPanel og kjør `npm install`).
2. Vent til alle pakker er lastet ned (~30 sek for vår dependency-liste).

## 4. Sett miljøvariabler

Fortsatt i Node.js-appen → **Environment Variables** (eller `.env`-rediger):

```
NODE_ENV=production
PORT=3000

PUBLIC_BASE_URL=https://nailed.no   # eller https://skyblue-cod-739202.hostingersite.com inntil du har eget domene

DB_HOST=localhost
DB_PORT=3306
DB_USER=u123456_admin               # fra steg 1
DB_PASSWORD=<passord fra steg 1>
DB_NAME=u123456_nailed              # fra steg 1

# Generer denne lokalt: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<128 tegn random hex>
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_DAYS=30

CORS_ORIGINS=https://nailed.no,https://skyblue-cod-739202.hostingersite.com,nailed-app://

# Google OAuth — fyll inn etter docs/GOOGLE_OAUTH_SETUP.md
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://nailed.no/api/v1/auth/google/callback

# Vipps — la stå tomt inntil godkjenning kommer
VIPPS_ENV=
VIPPS_CLIENT_ID=
VIPPS_CLIENT_SECRET=
VIPPS_MSN=
VIPPS_SUBSCRIPTION_KEY=
VIPPS_REDIRECT_URI=https://nailed.no/api/v1/auth/vipps/callback

# Storage — start med local, bytt til r2 når Cloudflare er satt opp (docs/R2_SETUP.md)
STORAGE_BACKEND=local
LOCAL_UPLOAD_DIR=./uploads

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=

# Bootstrap-admin: emails som blir admin ved første login (kun engangstilfelle)
BOOTSTRAP_ADMIN_EMAILS=ulriktheodor99@gmail.com
```

Hostinger lagrer disse og injiserer dem som env vars når Node-appen starter.

## 5. Kjør database-migrasjon

I hPanel-terminalen (eller via SSH):

```bash
cd ~/public_html       # eller appens app root
npm run db:setup
```

Skal printe:
```
Applying schema to u123456_admin@localhost:3306/u123456_nailed ...
Schema applied.
```

## 6. Start / restart Node-appen

I Node.js-app-detaljen, klikk **Restart Application**.

Sjekk loggen (**View Logs** eller `~/.npm/_logs/`):

```
nailed server — env=production port=3000
  storage:  local
  database: u123456_admin@localhost:3306/u123456_nailed
  jwt:      configured
  google:   disabled
  vipps:    disabled

Listening on http://localhost:3000
```

Hvis det står "NOT SET" på noe, gå tilbake til steg 4.

## 7. Test fra utsiden

```bash
curl https://skyblue-cod-739202.hostingersite.com/api/v1/health
```

Forventet svar:
```json
{
  "ok": true,
  "env": "production",
  "storage": "local",
  "providers": { "google": false, "vipps": false },
  "ready": { "jwt": true, "db": true },
  "issues": []
}
```

Når `issues: []` og `ready.jwt: true, db: true` — du er live.

## Vanlige problemer

### 503 fra Hostinger på alle paths
Node-appen krasjer ved oppstart. Sjekk loggen i hPanel. Vanligste årsak:
- `JWT_SECRET` ikke satt → fra commit `7aeb8c2` og senere er dette håndtert (server booter, returnerer 503 bare på beskyttede ruter). Hvis du fortsatt ser 503 på `/`, oppdater til siste commit.

### `/api/v1/health` virker, men beskyttede ruter returnerer 503 `jwt_not_configured`
`JWT_SECRET` mangler. Steg 4 + restart.

### `/api/v1/salons` returnerer 500
DB-tilkobling feiler. Sjekk env-vars og at `npm run db:setup` har kjørt uten feil.

### Google login svarer 503 `provider_disabled`
`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` ikke satt. Følg `docs/GOOGLE_OAUTH_SETUP.md`.

### Bilder vises ikke
- Hvis `STORAGE_BACKEND=local`: `./uploads/`-mappen må finnes (`mkdir uploads` i app-roten). Hostinger overskriver ikke filer ved deploy hvis de er gitignored — må enten committe `uploads/.gitkeep` eller manuelt opprette.
- Bytt til `STORAGE_BACKEND=r2` når Cloudflare er satt opp (se `docs/R2_SETUP.md`).

### Hvordan se Node-loggen i hPanel
hPanel → Node.js-app → ⋯-menyen → **View Logs**, eller terminalen:
```bash
tail -f ~/.npm/_logs/*.log
# evt.
tail -f ~/passenger.log
```

## Auto-deploy fra GitHub

I hPanel → **Avansert** → **Git** kan du koble til repo-et og auto-deploye ved push. Anbefalt:

1. Koble repo: `https://github.com/UlrikBerg/Nailed.git`
2. Branch: `main`
3. Deploy path: app root (samme som Node.js application root)
4. Aktiver "Auto-deploy on push".

Etter hver `git push origin main` deployer Hostinger automatisk og kjører ditt definerte deploy-script (om noe). Du må fortsatt selv klikke **Restart Application** i Node.js-fanen for at endringer skal bli plukket opp — eller bruke et `.htaccess restart`-trigger.
