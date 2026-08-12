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


## Dodentocht branding

Deze versie gebruikt:
- bijna zwarte / grafiet achtergrond
- rood-oranje als hoofdaccent
- amber/goud richting het laatste kwart
- goud vanaf 95 km
- groen uitsluitend voor successtatussen / bereikte posten
- blauwe live locatie op de kaart voor duidelijke GPS-herkenning


## V3 Dodentocht-stijl

Extra branding:
- 100 KM / DODENTOCHT 2026 / 57e editie / Bornem
- race chips en fase-indicator
- mijlpaalkaart voor 25 / 50 / 75 / 100 km
- automatische mijlpaalmeldingen
- warmere rood-oranje-goud gradients
- laatste kwart en finishzone krijgen extra goudaccenten
- extra donkere nachtweergave tussen 00:00 en 06:00
- checkpointkaarten voelen meer als event/race cards
