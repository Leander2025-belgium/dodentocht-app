const CHECKPOINTS = [
  { id: 0, name: "Bornem", location: "Start", km: 0, opens: "21:00", closes: "21:30", rest: 0, supplies: [] },
  { id: 1, name: "Weert", location: "Kerk", km: 8.3, opens: "21:45", closes: "23:20", rest: 5, supplies: ["Waterkraantjes"] },
  { id: 2, name: "Bornem", location: "Friesland Campina", km: 17, opens: "22:30", closes: "01:20", rest: 10, supplies: ["Waterkraantjes", "Chocomel", "Suikerwafels"] },
  { id: 3, name: "Kalfort", location: "De Schans", km: 36.3, opens: "00:10", closes: "05:40", rest: 15, supplies: ["Waterkraantjes", "Coca-Cola", "Duvel", "Banaan", "Rijsttaartje"] },
  { id: 4, name: "Lippelo", location: "Parking voetbal", km: 42.7, opens: "00:45", closes: "07:05", rest: 15, supplies: ["Waterkraantjes", "Soep & brood", "Vanillewafel"] },
  { id: 5, name: "Buggenhout", location: "Sporthal De Pit", km: 51.1, opens: "01:35", closes: "09:05", rest: 20, supplies: ["Koffie", "Thee", "Waterkraantjes", "Coca-Cola", "Sandwiches", "Frangipane"] },
  { id: 6, name: "Opwijk", location: "Sporthal", km: 58.3, opens: "02:20", closes: "10:45", rest: 20, supplies: ["Koffie", "Thee", "Waterkraantjes", "Sportdrank", "Speculoos", "Hardgekookt ei & brood"] },
  { id: 7, name: "Lebbeke", location: "Sporthal", km: 64.4, opens: "03:00", closes: "12:15", rest: 15, supplies: ["Waterkraantjes", "Coca-Cola", "Peperkoek", "Broodje met gebakken ei"] },
  { id: 8, name: "Baasrode", location: "Hangaar 43", km: 72, opens: "03:50", closes: "14:05", rest: 20, supplies: ["Koffie", "Thee", "Waterkraantjes", "Sportdrank", "Drinkyoghurt", "Speculoos", "Appel"] },
  { id: 9, name: "Sint-Amands", location: "De Nestel", km: 77, opens: "04:25", closes: "15:20", rest: 15, supplies: ["Koffie", "Thee", "Waterkraantjes", "Coca-Cola", "Watermeloen", "Gezouten koekje"] },
  { id: 10, name: "Puurs", location: "De Binder", km: 84.8, opens: "05:15", closes: "17:20", rest: 20, supplies: ["Koffie", "Thee", "Waterkraantjes", "Sportdrank", "Granenreep", "Sinaasappel"] },
  { id: 11, name: "Oppuurs", location: "De Mispel", km: 88.3, opens: "05:40", closes: "18:20", rest: 10, supplies: ["Koffie", "Thee", "Waterkraantjes", "Coca-Cola", "Tomaat", "Hardgekookt ei met brood", "Peperkoek"] },
  { id: 12, name: "Branst", location: "Gemeenschapshuis", km: 95.8, opens: "06:30", closes: "20:20", rest: 10, supplies: ["Koffie", "Thee", "Waterkraantjes", "Sportdrank", "Komkommer", "Tijm-rozemarijnkoekje"] },
  { id: 13, name: "Bornem", location: "Tent aankomst", km: 100, opens: "07:00", closes: "21:30", rest: 0, supplies: [] }
];

const LAST_YEAR_REFERENCE = [
  { km: 0, label: "Start", time: "21:17" },
  { km: 8.2, label: "Weert", time: "22:54" },
  { km: 17, label: "Friesland Campina", time: "00:52" },
  { km: 35.4, label: "Kalfort", time: "05:02" }
];

const DISTANCE_ALERTS = [
  { km: 35.4, message: "Je bent voorbij je afstand van vorig jaar." },
  { km: 50, message: "50 km bereikt. Nieuw terrein." },
  { km: 75, message: "75 km. Alleen naar de volgende post kijken." },
  { km: 90, message: "Nog ongeveer 10 km." },
  { km: 95.8, message: "Branst bereikt. Nog ongeveer 4 km." }
];

const PACE_PLAN = {
  early: { untilKm: 35, targetKmh: 4.6 },
  note: "Rustige start. Geen inhaalacties. Vanaf 50 km mag het tempo geleidelijk zakken."
};
