import json
import os
import shlex
import subprocess
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
TOOLS_DIR = Path(os.getenv("OPENCLAW_TOOLS_DIR", "/root/.openclaw/workspace/tools"))
GROWTH_CONFIG = Path(os.getenv("OPENCLAW_GROWTH_CONFIG", TOOLS_DIR / "growth_config.json"))
REQUEST_TIMEOUT = int(os.getenv("OPENCLAW_TIMEOUT_SECONDS", "30"))
HISTORICAL_DAY_COMMAND = os.getenv("HISTORICAL_DAY_COMMAND", "python3 sk_live_json.py {date}")
FORECAST_FILE = Path(os.getenv("TODAY_FORECAST_FILE", TOOLS_DIR / "today_forecast.json"))
WEEKLY_FORECAST_FILE = Path(os.getenv("WEEKLY_FORECAST_FILE", TOOLS_DIR / "weekly_forecast.json"))
LEARNING_PARAMS_FILE = Path(os.getenv("LEARNING_PARAMS_FILE", TOOLS_DIR / "learning_params.json"))
PREDICTION_LOG_FILE = Path(os.getenv("PREDICTION_LOG_FILE", TOOLS_DIR / "prediction_log.json"))
TEAM_FILE = Path(os.getenv("TEAM_FILE", TOOLS_DIR / "mitarbeiter.json"))
EVENTS_FILE = Path(os.getenv("EVENTS_FILE", TOOLS_DIR / "hamburg_events.json"))
HOLIDAYS_FILE = Path(os.getenv("HOLIDAYS_FILE", TOOLS_DIR / "ferien.json"))
PRODUCT_CACHE_FILE = Path(os.getenv("PRODUCT_CACHE_FILE", TOOLS_DIR / "sumup_product_cache.json"))

app = Flask(__name__)

telegram_offsets: dict[str, int] = {}


def ok(data: Any) -> tuple[Any, int]:
    return jsonify({"ok": True, "data": data, "updated_at": datetime.now().isoformat()}), 200


def unavailable(message: str, status: int = 503) -> tuple[Any, int]:
    return (
        jsonify(
            {
                "ok": False,
                "error": "Daten nicht verfuegbar",
                "detail": message,
                "updated_at": datetime.now().isoformat(),
            }
        ),
        status,
    )


def run_tool(args: list[str]) -> Any:
    completed = subprocess.run(
        args,
        cwd=TOOLS_DIR,
        text=True,
        capture_output=True,
        timeout=REQUEST_TIMEOUT,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"Exit {completed.returncode}"
        raise RuntimeError(detail)
    output = completed.stdout.strip()
    if not output:
        raise RuntimeError("Leere Antwort vom Script")
    return json.loads(output)


def run_command_template(template: str, **values: str) -> Any:
    args = shlex.split(template.format(**values))
    return run_tool(args)


def valid_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def read_json_file(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(str(path))
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_optional_json(path: Path, fallback: Any) -> Any:
    try:
        return read_json_file(path)
    except Exception:
        return fallback


def selected_date(default_offset_days: int = 0) -> str:
    value = request.args.get("date", "").strip()
    if value:
        return value
    return (date.today() + timedelta(days=default_offset_days)).isoformat()


def selected_month() -> str:
    value = request.args.get("month", "").strip()
    if value:
        return value
    start = request.args.get("start", "").strip()
    if start and valid_iso_date(start):
        return start[:7]
    return date.today().strftime("%Y-%m")


def month_start(value: str) -> str:
    if len(value) == 7:
        return f"{value}-01"
    return value


@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/api/health")
def health() -> tuple[Any, int]:
    return ok(
        {
            "status": "online",
            "tools_dir": str(TOOLS_DIR),
            "tools_dir_exists": TOOLS_DIR.exists(),
            "growth_config": str(GROWTH_CONFIG),
            "server_time": datetime.now().isoformat(),
        }
    )


@app.get("/api/heute")
@app.get("/api/today")
def heute() -> tuple[Any, int]:
    selected_date = request.args.get("date", "").strip()
    try:
        if selected_date:
            if not valid_iso_date(selected_date):
                return unavailable("Ungueltiges Datum. Erwartet: YYYY-MM-DD", status=400)
            return ok(run_command_template(HISTORICAL_DAY_COMMAND, date=selected_date))
        return ok(run_tool(["python3", "sk_live_json.py"]))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/monat")
@app.get("/api/monthly")
def monat() -> tuple[Any, int]:
    start = request.args.get("start", f"{selected_month()}-01")
    try:
        if not valid_iso_date(start):
            return unavailable("Ungueltiges Startdatum. Erwartet: YYYY-MM-DD", status=400)
        return ok(run_tool(["python3", "check_sk_summary.py", "monat", start, "--json"]))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/zettle")
@app.get("/api/forecast")
def zettle() -> tuple[Any, int]:
    forecast_date = selected_date(default_offset_days=1)
    try:
        if valid_iso_date(forecast_date):
            return ok(run_tool(["python3", "zettle_vergleich.py", "--date", forecast_date, "--json"]))
        return unavailable("Ungueltiges Datum. Erwartet: YYYY-MM-DD", status=400)
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/wachstum")
@app.get("/api/growth")
def wachstum() -> tuple[Any, int]:
    try:
        return ok(read_json_file(GROWTH_CONFIG))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/gebuehren")
def gebuehren() -> tuple[Any, int]:
    try:
        revenue = float(request.args.get("revenue", os.getenv("STRANDKIND_MONTH_REVENUE", "13229")))
        sumup_rate = float(os.getenv("SUMUP_EFFECTIVE_RATE", "0.0086"))
        zettle_rate = float(os.getenv("ZETTLE_FLAT_RATE", "0.0139"))
        sumup_fee = revenue * sumup_rate
        zettle_fee = revenue * zettle_rate
        return ok(
            {
                "revenue": revenue,
                "sumup": {"rate": sumup_rate, "fee": round(sumup_fee, 2), "label": "0.86% effektiv"},
                "zettle": {"rate": zettle_rate, "fee": round(zettle_fee, 2), "label": "1.39% flach"},
                "savings": round(zettle_fee - sumup_fee, 2),
                "source": "SumUp-Rechnung April 2026 / konfigurierbare Rate",
            }
        )
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/ferien")
@app.get("/api/holidays")
def ferien() -> tuple[Any, int]:
    try:
        if HOLIDAYS_FILE.exists():
            return ok(read_json_file(HOLIDAYS_FILE))
        return ok(run_tool(["python3", "ferien_abruf.py", "--json"]))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/wetter")
@app.get("/api/weather")
def wetter() -> tuple[Any, int]:
    location = request.args.get("location", "Hamburg")
    try:
        url = f"https://wttr.in/{location}?format=j1"
        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return ok(response.json())
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/evening")
def evening() -> tuple[Any, int]:
    day = selected_date()
    try:
        forecast = read_optional_json(FORECAST_FILE, {})
        actual = run_command_template(HISTORICAL_DAY_COMMAND, date=day)
        forecast_value = forecast.get("forecast") or 0
        revenue = actual.get("umsatz") or actual.get("revenue") or actual.get("total") or actual.get("gesamt") or 0
        deviation = revenue - forecast_value if forecast_value else None
        deviation_pct = (deviation / forecast_value * 100) if forecast_value else None
        return ok(
            {
                "date": day,
                "forecast": forecast,
                "actual": actual,
                "deviation": deviation,
                "deviation_pct": deviation_pct,
            }
        )
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/waren")
def waren() -> tuple[Any, int]:
    month = selected_month()
    try:
        return ok(run_tool(["python3", "warenanalyse.py", "--month", month, "--json"]))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/wochenprognose")
def wochenprognose() -> tuple[Any, int]:
    try:
        if WEEKLY_FORECAST_FILE.exists():
            return ok(read_json_file(WEEKLY_FORECAST_FILE))
        return ok(run_tool(["python3", "wochen_prognose.py", "--json"]))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/learning")
def learning() -> tuple[Any, int]:
    try:
        return ok(
            {
                "params": read_optional_json(LEARNING_PARAMS_FILE, {}),
                "log": read_optional_json(PREDICTION_LOG_FILE, []),
            }
        )
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/learning/params")
def learning_params() -> tuple[Any, int]:
    try:
        return ok(read_json_file(LEARNING_PARAMS_FILE))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/learning/log")
def learning_log() -> tuple[Any, int]:
    try:
        return ok(read_json_file(PREDICTION_LOG_FILE))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/team")
def team() -> tuple[Any, int]:
    try:
        if TEAM_FILE.exists():
            return ok(read_json_file(TEAM_FILE))
        return ok(
            [
                {"name": "Joohee Chang-Franz", "role": "Inhaberin", "birthday": "1975-07-16", "connecteam_id": "14865471"},
                {"name": "Lani Franz", "role": "Aushilfe", "birthday": "2006-10-03", "connecteam_id": "14896660"},
                {"name": "Johanna Stinnes", "role": "Aushilfe", "birthday": "2002-11-28", "connecteam_id": "14896879"},
                {"name": "Hannah Maxima Niederheide", "role": "Aushilfe", "birthday": "2009-08-20", "connecteam_id": "14896880"},
                {"name": "Laura Katariina Makkonen", "role": "Aushilfe", "birthday": "2006-12-18", "connecteam_id": "14896956"},
                {"name": "Emmi-Renee Riechmann", "role": "Aushilfe", "birthday": "2005-09-26", "connecteam_id": "14896976"},
                {"name": "Jochen Franz", "role": "Inhaber", "birthday": "1973-09-25", "connecteam_id": None},
            ]
        )
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/events")
def events() -> tuple[Any, int]:
    try:
        return ok(read_json_file(EVENTS_FILE))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/products")
def products() -> tuple[Any, int]:
    try:
        return ok(read_json_file(PRODUCT_CACHE_FILE))
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/lieferanten")
def lieferanten() -> tuple[Any, int]:
    return ok(
        [
            {"name": "Quijote", "product": "Inhouse-Kaffee", "location": "Hamburg", "status": "Laeuft", "next": "18kg Hausmischung pruefen"},
            {"name": "THE BARN", "product": "Specialty Coffee", "location": "Berlin", "status": "Bald faellig", "next": "Tuetenverkauf + Aktionen"},
            {"name": "Hof Reitbrook", "product": "Kuhmilch", "location": "Hamburg", "status": "Laeuft", "next": "4 Kannen / Woche"},
            {"name": "Metro", "product": "Hafermilch, Sirupe, Diverses", "location": "Grosshandel", "status": "Pruefen", "next": "35-40 Tetrapacks / Woche"},
        ]
    )


@app.get("/api/trash")
def trash() -> tuple[Any, int]:
    return ok({"tomorrow": "Pruefen", "next": "SRH iCal noch nicht konfiguriert"})


@app.get("/api/emails")
def emails() -> tuple[Any, int]:
    return ok({"unread": None, "messages": [], "status": "IMAP noch nicht konfiguriert"})


def send_max_message(text: str) -> dict[str, Any]:
    message_api = os.getenv("OPENCLAW_MESSAGE_API")
    if message_api:
        response = requests.post(message_api, json={"message": text}, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return {"mode": "max_api", "response": response.json() if response.content else None}

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        raise RuntimeError("OPENCLAW_MESSAGE_API oder TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID setzen")

    response = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return {"mode": "telegram", "response": response.json()}


@app.post("/api/chat/send")
def chat_send() -> tuple[Any, int]:
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("message", "")).strip()
    if not text:
        return unavailable("Leere Nachricht", status=400)
    try:
        result = send_max_message(text)
        return ok({"sent": True, **result})
    except Exception as exc:
        return unavailable(str(exc))


@app.get("/api/chat/poll")
def chat_poll() -> tuple[Any, int]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return ok({"messages": [], "mode": "not_configured"})

    key = str(chat_id)
    params: dict[str, Any] = {"timeout": 1, "allowed_updates": json.dumps(["message"])}
    if key in telegram_offsets:
        params["offset"] = telegram_offsets[key]

    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", params=params, timeout=5)
        response.raise_for_status()
        updates = response.json().get("result", [])
        messages = []
        for update in updates:
            telegram_offsets[key] = max(telegram_offsets.get(key, 0), update["update_id"] + 1)
            message = update.get("message") or {}
            if str(message.get("chat", {}).get("id")) != key:
                continue
            if message.get("from", {}).get("is_bot"):
                messages.append(
                    {
                        "id": update["update_id"],
                        "text": message.get("text", ""),
                        "time": message.get("date", int(time.time())),
                    }
                )
        return ok({"messages": messages, "mode": "telegram"})
    except Exception as exc:
        return unavailable(str(exc))


if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8080")), debug=False)
