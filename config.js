// Vul alleen een HTTPS-adres in wanneer de optionele live-server actief is.
// Leeg laten schakelt live delen veilig uit; alle andere appfuncties blijven werken.
window.DODENTOCHT_CONFIG = Object.freeze({
  liveApiBase: "https://dodentocht-live-api.muddy-tree.workers.dev"
});
