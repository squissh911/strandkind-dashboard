# Strandkind Dashboard - Max UI

Kleine lokale Web-App fuer Max. Das Backend ruft die bestehenden Python-Skripte unter `/root/.openclaw/workspace/tools/` per `subprocess` auf und stellt JSON-Endpunkte fuer das Dashboard bereit.

## Start

```bash
cd /root/.openclaw/workspace/dashboard
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Oder aus dem ZIP:

```bash
unzip openclaw-dashboard.zip
cd dashboard
chmod +x install.sh
sudo ./install.sh
```

Danach im Browser oeffnen:

```text
http://SERVER-IP:8080
```

## Konfiguration

Optional per Environment:

```bash
export OPENCLAW_TOOLS_DIR=/root/.openclaw/workspace/tools
export OPENCLAW_GROWTH_CONFIG=/root/.openclaw/workspace/tools/growth_config.json
export PORT=8080
```

Historische Tagesdaten:

```bash
# Standard: python3 check_sk_live.py {date} --json
export HISTORICAL_DAY_COMMAND='python3 check_sk_live.py {date} --json'
```

Im Dashboard kann ein Tag oder Monat ausgewaehlt werden. Das Backend ruft dann:

- `GET /api/heute?date=YYYY-MM-DD`
- `GET /api/monat?start=YYYY-MM-01`

Chat ueber direkte Max API:

```bash
export OPENCLAW_MESSAGE_API=http://localhost:PORT/message
```

Oder ueber Telegram:

```bash
export TELEGRAM_BOT_TOKEN=123:abc
export TELEGRAM_CHAT_ID=123456789
```

## Endpunkte

- `GET /api/today` / `GET /api/heute`
- `GET /api/monthly` / `GET /api/monat`
- `GET /api/forecast` / `GET /api/zettle`
- `GET /api/evening`
- `GET /api/growth` / `GET /api/wachstum`
- `GET /api/gebuehren`
- `GET /api/holidays` / `GET /api/ferien`
- `GET /api/weather` / `GET /api/wetter`
- `GET /api/waren`
- `GET /api/wochenprognose`
- `GET /api/learning`
- `GET /api/learning/params`
- `GET /api/learning/log`
- `GET /api/team`
- `GET /api/events`
- `GET /api/trash`
- `GET /api/emails`
- `GET /api/products`
- `GET /api/lieferanten`
- `POST /api/chat/send`
- `GET /api/chat/poll`

Fehler werden als JSON mit `ok: false` zurueckgegeben; das Frontend zeigt dann `Daten nicht verfuegbar`.

## Tabs

Die Single-Page-App hat 11 Views:

Start, Morgenbriefing, Abendbriefing, Monat, Warenanalyse, Kalender, Chat, Learning Engine, Wochenprognose, Lieferanten und Team.

Neue Datenquellen:

- Warenanalyse: `python3 warenanalyse.py --month YYYY-MM --json`
- Wochenprognose: `weekly_forecast.json` oder `python3 wochen_prognose.py --json`
- Learning: `learning_params.json` + `prediction_log.json`
- Team: `mitarbeiter.json`
- Morgen/Abend-Prognose: `today_forecast.json`

## Offline Chart.js

Die App referenziert ausschliesslich `static/vendor/chart.umd.min.js`. Fuer vollstaendig offline Betrieb bitte die echte Chart.js-Datei dort ablegen.

Wenn Chart.js noch nicht abgelegt ist, zeichnet `script.js` einfache Canvas-Fallbacks. Empfohlen fuer den Server:

```bash
npm install chart.js@4.4.9 --prefix /tmp/strandkind-chartjs
cp /tmp/strandkind-chartjs/node_modules/chart.js/dist/chart.umd.js static/vendor/chart.umd.min.js
```

In diesem ZIP ist Chart.js bereits lokal enthalten.

## Systemd optional

```bash
sudo cp systemd/openclaw-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-dashboard
```
