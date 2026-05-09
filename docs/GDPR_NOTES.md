# GDPR & norsk lov — notater for Fase 3

Dette er ikke ferdige juridiske tekster. Det er en sjekkliste for hva som må på plass før nailed
kan gå live i Norge med ekte brukere.

## Lovgrunnlag

### GDPR / personvernforordningen
- **Behandlingsgrunnlag** for kundedata: avtale (booking) og samtykke (markedsføring).
- **Behandlingsgrunnlag** for salongdata: avtale (du som behandler bruker plattformen).
- **Datakategorier:** navn, e-post, telefon, adresse, fødselsår (fra Vipps), bookinghistorikk,
  IP-logg på sesjoner.
- **Lagringstid:**
  - Booking-historikk: 5 år (bokføringsloven §13).
  - Audit-log: 5 år.
  - Slettede brukere (suspendert + scrub'et): personlige felter null-stilles ved DELETE /me, men
    `users.id` og bookings beholdes anonymisert i 5 år.
  - Sesjon-tokens: utløper etter `JWT_REFRESH_TTL_DAYS` (default 30 dager) eller ved logout.

### Bokføringsloven
- Booking-bekreftelser med pris og selgerinfo må kunne reproduseres i 5 år.

### Markedsføringsloven (mfl.)
- Ingen markedsføringsutsendelser uten samtykke (cookie-banner / nyhetsbrev-opt-in).
- Influencer-markedsføring (om relevant): merkeplikt §2 b.

### Ekomloven (cookies)
- Krever **samtykke før** ikke-strengt-nødvendige cookies/storage settes.
- LocalStorage-tokens for innlogging er "strengt nødvendig" → ingen samtykke kreves.
- Andre sporings-cookies (analytics, ads) → cookie-banner må implementeres.

## Hva som må på plass før Fase 3 lansering

### Tekster
- [ ] **Personvernerklæring** (`/personvern`) — hva vi samler, hvorfor, hvor lenge, dine
      rettigheter, klage til Datatilsynet.
- [ ] **Vilkår** (`/vilkar`) — bruksvilkår for kunder og salonger separat.
- [ ] **Cookie-erklæring** (`/cookies`) — hvilke informasjonskapsler/storage vi bruker.
- [ ] **Salongavtale** — egen vilkårstekst for behandlere; må signeres ved godkjent søknad.

### Funksjonalitet
- [ ] **Cookie-banner** med samtykke for ikke-nødvendige cookies (analytics m.m.).
- [ ] **Dataeksport** — `GET /api/v1/me/export` returnerer alle persondata som JSON
      (utvid eksisterende `/me`-endepunkt).
- [ ] **Full sletting** — i dag scrubber `DELETE /me` personfelter men beholder `users.id` for
      booking-koblinger. For "rett til sletting" trenger vi en admin-jobb som etter 5 år sletter
      bookinger og brukere endelig.
- [ ] **Innsynsforespørsel** — admin-flagget knapp som genererer komplett brukerprofil.
- [ ] **Behandlingsprotokoll (artikkel 30)** — internt dokument; ikke offentlig.

### Avtaler / DPA
- [ ] **Vipps:** databehandleravtale signeres ved Vipps Login-godkjenning.
- [ ] **Google:** Google er databehandler for OIDC. Bruk standardavtalen i Google Cloud Console
      → Privacy & Terms.
- [ ] **Hostinger:** databehandleravtale via deres hPanel (de har EU-servere som du kan velge).
- [ ] **Cloudflare R2** (Fase 2): DPA finnes i Cloudflare Dashboard → Manage Account → Configurations.

### Sikkerhet
- [x] HTTPS i produksjon (Hostinger Cloud terminerer TLS).
- [x] Refresh-tokens lagres som SHA-256 hash, ikke i klartekst.
- [x] Sesjoner kan revokeres per enhet i kunde-panelet.
- [x] Admin-handlinger logges i `audit_log`.
- [ ] Brute-force-beskyttelse på `/auth/refresh` (rate limiting).
- [ ] Backup av MySQL — Hostinger har automatisk daglig backup på Cloud-planene; verifiser at det
      er aktivert.

### Datatilsynet — meldeplikt?
- [ ] Avhengig av risikovurdering. Vurder DPIA (vurdering av personvernkonsekvenser) hvis vi
      utvider til helserelaterte behandlinger.

## Plassering i kodebasen (når Fase 3 starter)

- Tekstsider: `/personvern.html`, `/vilkar.html`, `/cookies.html` — bruk samme stil-grunnlag som
  `index.html`.
- Cookie-banner: legg i `assets/cookies.js`, `<script src>` på alle sider.
- Eksport/sletting: utvid `backend/routes/me.js`.
- Admin-innsyn: ny rute i `backend/routes/admin.js`.
