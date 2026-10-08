# Mau-Mau Flip – Vermittler (Online-Spiel)

Der Vermittler (Relay) verbindet Mitspieler über das Internet. Er reicht nur Nachrichten zwischen dem Gastgeber-Handy und den Gästen durch; das Spiel selbst (Regeln, Karten, Entscheidungen) läuft auf dem Handy des Gastgebers. Gebaut als **Cloudflare Worker mit Durable Objects** – ein Raum ist ein Objekt – und im Gratistarif nutzbar.

Entwurf und Protokoll: [`docs/online/ENTWURF.md`](../docs/online/ENTWURF.md).

## Bereitstellen

### Mit dem Deploy-Knopf (ein Klick)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ShakieVan/Mau-Mau-Flip/tree/main/relay)

Ihr braucht ein GitHub- und ein Cloudflare-Konto (selbst anlegen). Cloudflare kopiert diesen Ordner in ein neues Repository in eurem GitHub-Konto, legt den Worker `mau-mau-flip-relay` samt Durable-Object-Klasse `Room` (SQLite) an und stellt ihn bereit. Ein Build-Befehl ist nicht nötig. Danach steht die Adresse da, z. B. `https://mau-mau-flip-relay.<name>.workers.dev` – sie kommt in der App unter **Einstellungen → Online** hinein.

### Mit dem Cloudflare-Dashboard (Repository importieren)

Wer lieber ein eigenes Repository verbindet: im Cloudflare-Dashboard **Workers & Pages → Erstellen → Repository importieren**, ein Repository mit diesem Ordner wählen und als **Stammverzeichnis** `relay` eintragen. Build-Befehl leer lassen, Bereitstellungsbefehl `npx wrangler deploy`.

### Von Hand (mit Node.js)

```sh
cd relay
npm install
npx wrangler login
npm run deploy
```

## Aktualisieren – nicht nötig

Der Gastgeber nimmt nur Browser-Gäste mit **genau seiner Spielversion** an. Der Vermittler holt sich deshalb den Browser-Client jeder App-Version **selbst** aus dem Quell-Repository: `/c/<version>/<datei>` kommt von `https://raw.githubusercontent.com/ShakieVan/Mau-Mau-Flip/v<version>/webclient/<datei>` (Ersatzweg jsDelivr, wenn GitHub drosselt). Ein Tag ändert sich nie, also merken sich Cloudflare und der Browser jede Datei ein Jahr lang. Die Startseite leitet Gäste zur Version des Gastgebers weiter.

Nach einem App-Update müsst ihr am Vermittler also **nichts** tun. Neu bereitstellen (Deploy-Knopf erneut oder `npm run deploy`) muss man nur, wenn sich der Vermittler selbst ändert – das steht dann in den Release-Notizen.

- **Eigene Abwandlung des Spiels (Fork):** in `wrangler.jsonc` unter `vars` `CLIENT_REPO` auf euer Repository stellen (Form `Besitzer/Repo`) und dort für jede Version einen Tag `v<version>` mit dem Ordner `webclient/` anlegen.
- Gibt es zu einer Version keinen Tag (z. B. ein selbst gebauter Testbau des Gastgebers), zeigt `/c/<version>/` eine zweisprachige Erklärung; App-Gäste können trotzdem beitreten.

## Was der Vermittler tut

| Pfad | Bedeutung |
|---|---|
| `/` | Startseite: Raumcode eingeben bzw. `/?r=KATZE-42` öffnen → weiter zum Browser-Client |
| `/c/<version>/` | Browser-Client („Lite“) für Gäste, abgeholt vom Tag `v<version>` des Quell-Repos (`CLIENT_REPO`) |
| `/info` | `{game, relay, proto, source: {repo, url, dir, tag}}`; mit `?room=CODE` zusätzlich `room: {open, host, version}` |
| `/ws` | WebSocket für Gastgeber (`role=host`) und Gäste (`role=guest&room=CODE`) |

`/ws`, `/info` und `/c/*` laufen über den Worker und zählen gegen die Tageslimits; die Startseite und `404.html` sind statische Assets und kostenlos.

### Grenzen

| | |
|---|---|
| Gäste je Raum | 16 Verbindungen |
| Nachricht Gast → Gastgeber | 8 KB, 20 je Sekunde (Spitze 40); Dauerverstoß über 10 s trennt den Gast |
| Abwesenheit des Gastgebers | 10 Minuten, dann wird der Raum gelöscht |
| Lebensdauer eines Raums | 24 Stunden |

Ein Spielabend (6 Spieler, 3 Stunden) braucht grob 600 Anfragen für Verbindungen und Nachrichten, dazu je Browser-Gast beim ersten Aufruf bis etwa 170 für die Dateien des Clients (danach aus dem Browser-Speicher) – zusammen höchstens etwa 1 600 der 100 000 täglichen Gratis-Anfragen. Werden die Tageslimits überschritten, pausiert der Vermittler bis 0 Uhr UTC; es entstehen keine Kosten.

### Schließcodes für Gäste

| Code | Bedeutung |
|---|---|
| 4404 | Raum unbekannt |
| 4503 | Gastgeber gerade weg – nach 10 s erneut versuchen |
| 4409 | Raum voll |
| 4429 | zu viele Nachrichten |
| 1001 | Raum beendet |

## Datenschutz

Der Vermittler speichert je Raum nur eine Zeile (Raumcode, Prüfsumme des Gastgeber-Schlüssels, Spielversion, Zeitpunkte) und löscht sie, wenn der Raum endet. Spielnachrichten werden weder gespeichert noch protokolliert; die Protokollierung (`observability`) ist abgeschaltet. IP-Adressen gibt der Vermittler nicht an den Gastgeber weiter. Bis zur geplanten Ende-zu-Ende-Verschlüsselung schützt vor Fremden in der Lobby nur der Gastgeber, der jeden Gast sieht und entfernen kann.

## Entwicklung und Tests

- `src/core.js` – die ganze Raumlogik als reines ES-Modul (Umgebung eingespritzt), `src/client.js` – Abruf des Browser-Clients von GitHub (fetch und Cache eingespritzt), `src/words.js` – Wortliste der Raumcodes, `src/worker.js` – Klebstoff für Cloudflare.
- `test/vectors.json` – gemeinsame Testvektoren für `core.js` und den GDScript-Nachbau der App (`game/scripts/net/net_relay_double.gd`).
- Tests ohne Node in Chrome headless: `powershell -File tools/build.ps1 -Target Relay` (prüft auch `public/` und `wrangler.jsonc`) oder als Teil von `-Target Test`. Von Hand: `tools/webtest/serve.ps1 -Wurzel relay`, dann `http://localhost:8123/test/core_test.html` öffnen.
- `exports` in `wrangler.jsonc` ist der aktuelle Weg, Durable-Object-Klassen anzulegen. Lehnt `wrangler` das ab, `exports` durch `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]` ersetzen.

Lizenz: [CC BY-NC 4.0](../LICENSE) wie das ganze Projekt.
