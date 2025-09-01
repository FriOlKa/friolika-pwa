
# FriOlKa | Der Reise‑Agent (V14)

Kostenlose, schlanke PWA für Empfehlungen rund um Kultur, Strände, Wanderungen (kinderwagentauglich), Bade- und Stellplätze – mit Offline-Cache, Geolocation-Fallback und Google-Deep‑Links (keine API-Kosten).

## Features
- **Geolocation robust**: Permission-Hinweise, manueller Fallback (Lat/Lon), Watch-Updates.
- **Sofort Ergebnisse**: Cache‑first (LocalStorage, 18 h, Zellen ~0,25°), danach Hintergrund‑Refresh.
- **Overpass (OSM)**: Endpoint-Rotation + Timeout (20 s), kombinierte Abfrage (beach/water/hike/restaurant/camping/parking/playground/shop/service/culture).
- **Deep‑Links nach Google Maps**: 1‑Tap Suchen ohne API‑Key (Bewertungen/Öffnungszeiten direkt in Google). Keine Places‑API.
- **Map (Leaflet)**: Lazy init (nur im Karten‑Tab). Offline‑SW für Grunddateien.
- **Import/Export**: CSV/GPX, manuelles Hinzufügen, Clipboard‑Parse von Lat/Lon.
- **Diagnose & Tools**: Netztest (Overpass/OSM), Reset (Service Worker + Cache), kompakte Ansicht.

## Ordnerstruktur
```
.
├─ index.html
├─ styles.css
├─ app.js
├─ sw.js
├─ manifest.webmanifest
├─ icons/
│  ├─ icon-192.png
│  ├─ icon-512.png
│  └─ apple-icon-180.png
└─ .github/workflows/pages.yml
```

## Lokale Entwicklung
1. Repository klonen oder Dateien in leeres Repo legen.
2. In den Ordner wechseln und lokalen Server starten:
   ```bash
   npx serve -l 5173 .
   # oder
   python3 -m http.server 5173
   ```
3. Browser öffnen: `http://localhost:5173` (Geolocation erfordert **HTTPS oder localhost**).

## GitHub Pages Deployment (empfohlen)
1. Repo auf GitHub anlegen und pushen.
2. **GitHub Actions** sind enthalten (`.github/workflows/pages.yml`). Bei Push auf `main` wird das Artefakt gebaut und auf **Pages** veröffentlicht.
3. In den Repo‑Einstellungen **Pages** aktivieren (Branch: `gh-pages` bzw. über den Workflow als „GitHub Pages“ Deployment).

> Hinweis: Wenn du nur die einfache Variante möchtest, kannst du Pages auch direkt vom `main`‑Branch (Root) serven. Dann ist der Workflow optional.

## Datenschutz & Lizenzen
- OpenStreetMap/Overpass: Community‑Datenbank (Nutzungsbedingungen, Rate‑Limits beachten).
- Google‑Deep‑Links: Öffnen nur die Google‑App/Site – kein Scraping, kein API‑Key im Client.
- Open‑Meteo: Kostenfrei; siehe deren Nutzungsbedingungen.

## Troubleshooting
- **Standortabfrage kommt nicht**: Browser‑Berechtigungen prüfen (Adressleiste -> Schloss). iOS PWA: System‑Einstellungen -> Safari -> Standort.
- **Leere Ergebnisse**: Prüfe Diagnose. Overpass kann drosseln (HTTP 429/Timeout). Der Cache zeigt weiterhin bekannte Spots; Chips liefern via Google sofort Ergebnisse.
- **Hartnäckiger Cache**: Button **Reset** klicken.

Viel Spaß und gute Reise!
