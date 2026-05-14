# Pilot-onboarding

Internt arbeidsdokument for å rekruttere og onboarde de første 100 pilot-behandlerne på Nailed. Pitch-template og admin-flyt i ett sted.

---

## 1. Pitch-email til pilot-kandidater (kald outreach)

Send til behandlere du finner via Instagram, Finn, Google Maps eller venners venner. Personliggjør første setning — referer til en spesifikk behandling du har sett av dem, så det ikke leses som spam.

### Subject-forslag

- `[Navn], vil du være en av Norges første pilot-behandlere på Nailed?`
- `Pilot-tilbud: lås 149 kr/mnd som behandler på Nailed`
- `Booking-plattform for selvstendige behandlere — pilot-pris til deg`

### Mal (kopier og personliggjør)

> Hei [Fornavn],
>
> Så vippene du la for [kunde-navn / hashtag du fant] — virkelig fint arbeid. Tar du imot bookinger gjennom Instagram-DM eller har du en booking-side?
>
> Jeg startet Nailed for å gi selvstendige behandlere et booking-verktøy uten provisjon — du beholder hver krone fra hver booking. Vi tar én fast månedspris, og null annet.
>
> Vi er på utkikk etter **de første 100 pilot-behandlerne**. Som pilot får du:
>
> - **149 kr/mnd låst forever** (ordinær pris fra plass 101 er 299 kr/mnd)
> - **4 måneder gratis prøveperiode** — ingen kort kreves
> - Egen profil, kalender, kundeoversikt, statistikk, chat med kundene
> - Verifiserte anmeldelser fra ekte fullførte bookinger
> - Ingen provisjon, ingen bindingstid
>
> Vi går live nå i mai. Søknad tar ~3 minutter:
> **nailed.no/bli-salong**
>
> Sender du inn med en lenke til Instagram/portefølje godkjenner jeg som regel innen et døgn.
>
> Spør om du lurer på noe!
>
> [Ditt navn]
> Nailed.no

### Justeringer per kanal

- **Instagram DM:** kutt ned til 3-4 setninger, lim resten i en oppfølgings-melding hvis de svarer interessert.
- **E-post:** behold full versjon. Subject må fange — bruk navnet deres.
- **SMS:** «Hei [Navn], jeg jobber med en booking-side for selvstendige behandlere uten provisjon. Pilot-pris 149/mnd forever. Sjekk nailed.no/bli-salong. — [Ditt navn]»

---

## 2. Når en søknad kommer inn (admin-sjekkliste)

Du får automatisk e-post når noen sender søknad på `/bli-salong`. Reply-To er satt til søkeren, så du kan svare direkte fra innboksen din.

### Sjekk før du godkjenner

- **Instagram/portefølje** — finnes faktisk konto, har noen bilder, oppdatert siste 6 mnd?
- **Søknadstekst** — sannferdig og koherent? Spesifikk om hva de tilbyr?
- **By** — er det et område der vi vil ha tilstedeværelse?
- **Org.nr / yrkesgodkjenning** — ikke obligatorisk å oppgi ved søknad, men hvis tvilsomt: spør før godkjenning.

### Godkjenn

1. Åpne `/admin/ → Moderering`-fanen
2. Finn søknaden i listen
3. Klikk **Godkjenn**
4. (Behandleren får automatisk velkomst-e-post med 4 mnd trial og lenke til panelet)

### Marker som pilot (hvis blant de første 100)

1. `/admin/ → Salonger`-fanen
2. Finn raden, klikk stjerne-knappen
3. Status «Pilot» vises, pris låses til 149 kr/mnd

### Avvis

Bruk «Avvis»-knappen og skriv en kort begrunnelse — den havner i avslags-e-posten. Vanlige grunner:

- Manglende Instagram eller portefølje
- Ikke skjønnhetsbehandling
- Tom/utdatert konto
- Sannsynlig spam/test-søknad

---

## 3. Etter godkjenning — hva som skjer automatisk

Behandleren får velkomst-mail med:
- Bekreftelse på godkjenning
- 4 mnd gratis trial-info
- Lenke til `/salong-panel`
- Onboarding-sjekkliste (6 steg de bør gjøre)

På første login i panelet ser de et rosa onboarding-kort på Oversikt-fanen med disse 6 stegene:

1. Last opp bilder av salongen
2. Skriv en kort bio
3. Sett åpningstider
4. Legg til behandlinger med pris og varighet
5. Legg til team-medlemmer (om du er flere)
6. Marker hva du tilbyr (Wifi, parkering osv.)

Når 5/6 er fullført forsvinner kortet automatisk. Behandleren kan også klikke «Skjul denne hjelpen».

---

## 4. Hvis behandleren ikke følger opp

Sjekk `/admin/ → Salonger` 3-5 dager etter godkjenning. Hvis profilen er tom (ingen tjenester, ingen bilder):

- Send en oppfølgings-mail manuelt: «Hei, ser du har opprettet profilen men ikke fyllt den helt ut — trenger du hjelp?»
- Tilbud om 15 min videosamtale for å sette opp sammen
- Hvis ingen respons innen 2 uker: la trial gå ut. Hvis trial utløper uten faktura → cron sender automatisk faktura-grunnlag til admin (manuell fakturering inntil Fiken-integrasjonen er live).

---

## 5. Pilot-mål

- **Mål 1:** 10 aktive pilot-behandlere innen 30 dager
- **Mål 2:** 100 pilot-behandlere registrert innen 90 dager
- **Mål 3:** 25 fullførte bookinger gjennom plattformen i pilot-fasen

Når 100 pilot-plasser er fylt:

- Marker `is_pilot=0` som default for nye signups (kode-endring)
- Oppdater `/for-salonger`-marketing-siden fra «149 kr/mnd» til «299 kr/mnd»
- Behold pilot-prisen for de 100 første så lenge de er aktive

---

## 6. Kontakt-info som skal være på plass

- **Support e-post:** `hei@nailed.no` (sett i admin → Innstillinger)
- **Reply-to på utgående mailer:** samme adresse
- **Telefon:** ikke obligatorisk ennå, men nyttig hvis du har en pilot-mobilen
