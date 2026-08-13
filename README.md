# Dodentocht live-server

Deze Cloudflare Worker verzorgt het optionele privé live delen van de Dodentocht-app. Livegegevens worden opgeslagen in Cloudflare D1 en verdwijnen wanneer de wandelaar live delen stopt. Oude, vergeten sessies worden na 48 uur automatisch verwijderd.

## Eigenschappen

- alleen de ingestelde GitHub Pages-origin mag de API vanuit een browser aanspreken;
- livecodes bestaan uit 8 tot 16 tekens; nieuwe codes hebben 12 tekens;
- invoer, coördinaten en maximale aanvraaggrootte worden gevalideerd;
- antwoorden worden nooit door browsers of tussenservers gecachet;
- een kijker-heartbeat toont in de app of mama actief meekijkt;
- D1 bewaart de actuele sessie ook wanneer een Worker opnieuw start;
- bij iedere nieuwe live sessie worden achtergebleven sessies ouder dan 48 uur verwijderd.

## Eenmalig publiceren

Vereisten: Node.js 20+ en een gratis Cloudflare-account.

```bash
cd server
npm install
npx wrangler login
npx wrangler d1 create dodentocht-live
```

Cloudflare toont na het laatste commando een `database_id`. Vervang in `wrangler.jsonc` het bestaande `database_id` wanneer je een andere Cloudflare-database gebruikt.

Voer daarna uit:

```bash
npm run db:remote
npm run deploy
```

Wrangler toont een adres zoals:

```text
https://dodentocht-live-api.<jouw-subdomein>.workers.dev
```

Controleer de server:

```text
https://dodentocht-live-api.<jouw-subdomein>.workers.dev/health
```

Het antwoord moet `{"ok":true,"service":"dodentocht-live-api"}` zijn.

Vul ten slotte het adres in de `config.js` in de hoofdmap in:

```js
window.DODENTOCHT_CONFIG = Object.freeze({
  liveApiBase: "https://dodentocht-live-api.<jouw-subdomein>.workers.dev"
});
```

Publiceer die ene wijziging opnieuw naar GitHub Pages. Er horen nooit Cloudflare-tokens of andere geheime sleutels in `config.js`.

## Lokaal testen

```bash
cd server
npm install
npm run db:local
npm run dev
```

De Worker is dan normaal beschikbaar op `http://localhost:8787`. Gebruik voor een lokale front-endtest `http://localhost:8080`, omdat die origin al is toegestaan.

## API

- `POST /api/dodentocht/live/:code/start`
- `POST /api/dodentocht/live/:code/update`
- `POST /api/dodentocht/live/:code/stop`
- `GET /api/dodentocht/live/:code`
- `POST /api/dodentocht/live/:code/viewer-heartbeat`
- `GET /api/dodentocht/live/:code/presence`
- `GET /health`

De livecode is het geheim. Deel alleen de volledige kijklink met mensen die de positie mogen zien.
