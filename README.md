# Dodentocht 2026 Companion

Een persoonlijke, onofficiële wandelcompanion voor de 57e 100 km Dodentocht op vrijdag 14 augustus 2026. De app combineert route, GPS-voortgang, controleposten, tijdsmarge, pauzes en lichaamschecks in één mobiele PWA.

**Open de app:** https://leander2025-belgium.github.io/dodentocht-app/

> Deze app vervangt de officiële controlebadge, bewegwijzering, veiligheidsinstructies of medische hulp niet. Volg tijdens het evenement altijd de aanwijzingen van de organisatie.

## Wat de app kan

- GPS-voortgang langs de meegeleverde GPX-route
- bescherming tegen GPS-sprongen en vervoer boven 12 km/u
- actuele snelheid, ook op iPhone wanneer `coords.speed` ontbreekt
- kaart met afgelegde route, volgende post en route-afwijking
- officiële controlepostafstanden, openingsuren en bevoorrading voor 2026
- persoonlijke ETA, tijdsmarge, pauzes en mijlpalen
- drink-, eet- en voetcheckherinneringen
- handmatige correctie en export van tochtdata
- offline app-shell, route en voortgang
- optioneel privé live delen via een eigen HTTPS-backend

Alle persoonlijke tochtdata blijven standaard lokaal in de browser. Alleen wanneer live delen is geconfigureerd én bewust gestart, verstuurt de app een live snapshot naar de ingestelde server.

## Installeren op iPhone

1. Open de app in Safari.
2. Tik op **Deel**.
3. Kies **Zet op beginscherm**.
4. Open de nieuwe Dodentocht-app minstens één keer met internet, zodat de offlinebestanden worden opgeslagen.

OpenStreetMap-kaarttegels worden bewust niet massaal offline opgeslagen. De GPX-route en je voortgang blijven offline beschikbaar; de straatkaart kan zonder internet leeg zijn.

## Lokaal testen

De app is statisch en heeft geen buildstap nodig. Start wel een lokale webserver; rechtstreeks openen via `file://` ondersteunt service workers en GPS niet correct.

```bash
python -m http.server 8080
```

Open daarna `http://localhost:8080`.

Controleer vóór gebruik buiten:

1. locatie-toestemming;
2. route en kaart;
3. start, pauze en handmatige correctie;
4. herladen van de app met behoud van voortgang;
5. offline herladen nadat de app één keer online geopend is.

## Optioneel live delen

Live delen staat veilig uit zolang geen server is ingesteld. Vul in `config.js` alleen het HTTPS-adres in:

```js
window.DODENTOCHT_CONFIG = Object.freeze({
  liveApiBase: "https://jouw-server.example.com"
});
```

`live-server-example.js` toont de vereiste Express-routes. Voor productie zijn daarnaast HTTPS, CORS-beperking, rate limiting, invoervalidatie, verloop van sessies en persistente opslag nodig.

## Techniek

- vanilla HTML, CSS en JavaScript
- Leaflet 1.9.4 met OpenStreetMap
- IndexedDB voor het GPX-bestand
- `localStorage` voor instellingen en voortgang
- service worker voor versiebeheer en offline fallback
- GitHub Pages voor hosting

## Gegevens en bronnen

- evenement: 57e 100 km Dodentocht, 14 augustus 2026 om 21.00 uur
- controleposten: officiële Dodentocht-informatie voor 2026
- route: `route.gpx` in deze repository; last-minute parcourswijzigingen blijven mogelijk

Controleer kort voor de start altijd de meest recente officiële informatie op https://www.dodentocht.be/.
