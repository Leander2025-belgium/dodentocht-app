# Dodentocht 2026 — Apple redesign

Vervang in je GitHub-repository deze bestanden:

- index.html
- style.css
- app.js
- route.js
- map.js
- checkpoints.js
- sw.js
- manifest.webmanifest

Laat je bestaande `route.gpx` staan.
Laat ook `icon-192.png` / `icon-512.png` staan als je die al hebt.

## Belangrijk

De kaart gebruikt Leaflet + OpenStreetMap als online kaartlaag.
De GPX-route zelf wordt lokaal opgeslagen en blijft beschikbaar.
De code doet bewust GEEN bulk-download van OpenStreetMap-tegels.

## Test

1. Open de app via HTTPS/GitHub Pages.
2. Geef locatie-toestemming.
3. Open Kaart.
4. Tik op de locatiepijl om follow-mode te activeren.
5. Test de app ook buiten zodat GPS nauwkeuriger is.
6. Gebruik Manuele correctie om tijdelijk verschillende kilometerstanden te testen.

## Extra

Voor echte volledig offline straatkaarten moet je later een provider/self-hosted tile-oplossing gebruiken die offline gebruik toestaat.
