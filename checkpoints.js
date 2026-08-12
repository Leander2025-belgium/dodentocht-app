/**
 * Controleposten en persoonlijke referentie voor Dodentocht 2026.
 * Controleer deze afstanden nog eens met de officiële organisatie-info
 * als er vlak voor de tocht wijzigingen worden aangekondigd.
 */

const CHECKPOINTS = [
  { id: 0,  name: "Bornem (start)",     km: 0,    rest: 0,  supplies: [] },
  { id: 1,  name: "Weert",              km: 8.3,  rest: 5,  supplies: ["water"] },
  { id: 2,  name: "Friesland Campina",  km: 17,   rest: 10, supplies: ["water", "chocomelk", "suikerwafel"] },
  { id: 3,  name: "Kalfort",             km: 36.3, rest: 15, supplies: ["water", "cola", "banaan", "rijsttaartje"] },
  { id: 4,  name: "Lippelo",             km: 42.7, rest: 15, supplies: ["water", "soep met brood", "vanillewafel"] },
  { id: 5,  name: "Buggenhout",          km: 51.1, rest: 20, supplies: ["water", "cola", "koffie", "thee", "sandwich", "frangipane"] },
  { id: 6,  name: "Opwijk",              km: 58.3, rest: 20, supplies: ["water", "sportdrank", "koffie", "thee", "speculoos", "ei met brood"] },
  { id: 7,  name: "Lebbeke",             km: 64.4, rest: 15, supplies: ["water", "cola", "peperkoek", "broodje gebakken ei"] },
  { id: 8,  name: "Baasrode",            km: 72,   rest: 20, supplies: ["water", "sportdrank", "koffie", "thee", "drinkyoghurt", "speculoos"] },
  { id: 9,  name: "Sint-Amands",         km: 77,   rest: 15, supplies: ["water", "cola", "koffie", "thee", "watermeloen", "gezouten koekje"] },
  { id: 10, name: "Puurs",               km: 84.8, rest: 20, supplies: ["water", "sportdrank", "koffie", "thee", "granenreep", "sinaasappel"] },
  { id: 11, name: "Oppuurs",             km: 88.3, rest: 10, supplies: ["water", "cola", "koffie", "thee", "tomaat", "hardgekookt ei met brood", "peperkoek"] },
  { id: 12, name: "Branst",              km: 95.8, rest: 10, supplies: ["water", "sportdrank", "koffie", "thee", "komkommer", "tijm-rozemarijnkoekje"] },
  { id: 13, name: "Bornem (finish)",     km: 100,  rest: 0,  supplies: [] }
];

const LAST_YEAR_REFERENCE = [
  { km: 0,    label: "Start",             time: "21:17" },
  { km: 8.2,  label: "Weert",             time: "22:54" },
  { km: 17,   label: "Friesland Campina", time: "00:52" },
  { km: 35.4, label: "Kalfort",           time: "05:02" }
];

const DISTANCE_ALERTS = [
  { km: 35.4, message: "Je bent voorbij je afstand van vorig jaar." },
  { km: 50,   message: "50 km bereikt. Nieuw terrein." },
  { km: 75,   message: "75 km. Alleen naar de volgende post kijken." },
  { km: 90,   message: "Nog ongeveer 10 km." },
  { km: 95.8, message: "Branst bereikt. Nog ongeveer 4 km." }
];

const PACE_PLAN = {
  early: { untilKm: 35, targetKmh: 4.6 },
  note: "Rustige start. Geen inhaalacties. Vanaf 50 km mag het tempo geleidelijk zakken."
};
