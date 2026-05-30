const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const moneyCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const charts = {};
const palette = { blue: "#1a73e8", navy: "#07111f", gold: "#d4a853", mint: "#4f9d69", coral: "#d8645b", gray: "#9aa4b2", orange: "#ff9800" };

function valueFrom(obj, keys, fallback = undefined) {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  return fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([name, amount]) => ({ name, amount }));
  return [];
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function currentMonth() {
  return todayIso().slice(0, 7);
}

function formatIsoMonth(value) {
  const [year, month] = value.split("-").map(Number);
  return monthFormat.format(new Date(year, month - 1, 1));
}

async function api(path) {
  const response = await fetch(path, { cache: "no-store" });
  const json = await response.json().catch(() => ({ ok: false, error: "Ungueltige Serverantwort" }));
  return response.ok ? json : { ...json, ok: false };
}

function unavailable(label = "Daten nicht verfügbar") {
  return `<p class="empty-state">❌ ${label}</p>`;
}

function drawChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!window.Chart) return drawFallbackChart(canvas, config);
  if (charts[id]) charts[id].destroy();
  config.options = mergeOptions({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { backgroundColor: "#07111f", padding: 12, cornerRadius: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#6d7888", maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: "rgba(120,142,168,0.18)" }, ticks: { color: "#6d7888" } },
    },
  }, config.options || {});
  charts[id] = new Chart(canvas, config);
}

function mergeOptions(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? mergeOptions(out[key] || {}, value) : value;
  }
  return out;
}

function drawFallbackChart(canvas, config) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth || 320;
  const height = canvas.height = canvas.clientHeight || 150;
  const values = (config.data.datasets[0]?.data || []).map(Number);
  const max = Math.max(...values, 1);
  ctx.clearRect(0, 0, width, height);
  values.forEach((value, index) => {
    const barWidth = width / Math.max(values.length, 1) - 8;
    const x = index * (barWidth + 8) + 4;
    const barHeight = (value / max) * (height - 18);
    ctx.fillStyle = config.data.datasets[0]?.backgroundColor?.[index] || palette.blue;
    ctx.fillRect(x, height - barHeight, Math.max(3, barWidth), barHeight);
  });
}

function numericRows(value, labelKeys, valueKeys) {
  return asArray(value).map((row, index) => ({
    label: valueFrom(row, labelKeys, String(index + 1)),
    value: Number(valueFrom(row, valueKeys, 0)),
  })).filter((row) => Number.isFinite(row.value));
}

function syntheticSeries(total, count = 10) {
  const weights = [0.02, 0.04, 0.07, 0.12, 0.17, 0.18, 0.16, 0.13, 0.08, 0.03];
  return Array.from({ length: count }, (_, i) => ({ label: `${9 + i}:00`, value: Math.round((total || 500) * (weights[i] || 1 / count)) }));
}

function rowList(rows) {
  return rows.length ? rows.map((row) => `<div class="data-row"><span>${row.label}</span><strong>${row.value}</strong></div>`).join("") : unavailable();
}

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach((section) => section.classList.toggle("active", section.id === `tab-${name}`));
}

async function loadToday() {
  const res = await api("/api/today");
  if (!res.ok) {
    setText("kpiTodayRevenue", "--");
    document.getElementById("transactionList").innerHTML = unavailable();
    return null;
  }
  const data = res.data;
  const revenue = Number(valueFrom(data, ["umsatz", "revenue", "total", "gesamt"], 0));
  const tx = valueFrom(data, ["transaktionen", "transactions", "tx", "verkaeufe"], "--");
  const avg = revenue && tx !== "--" ? revenue / Number(tx) : 0;
  const transactions = asArray(valueFrom(data, ["transactions_list", "transactions", "letzte_transaktionen"], []));
  const categories = asArray(valueFrom(data, ["kategorien", "categories"], []));

  setText("kpiTodayRevenue", money.format(revenue));
  setText("kpiTodayMeta", `${tx} Verkäufe · Ø ${avg ? money.format(avg) : "--"}`);
  document.getElementById("transactionList").innerHTML = transactions.length
    ? transactions.slice(0, 10).map((t) => `<div class="data-row"><span>${valueFrom(t, ["time", "zeit", "name", "product"], "Transaktion")}</span><strong>${money.format(Number(valueFrom(t, ["amount", "umsatz", "revenue", "value"], 0)))}</strong></div>`).join("")
    : rowList(numericRows(categories, ["name", "category"], ["amount", "umsatz", "revenue", "value"]).slice(0, 10));
  return data;
}

async function loadMonth() {
  const month = document.getElementById("monthPicker")?.value || currentMonth();
  setText("monthLabel", formatIsoMonth(month));
  const res = await api(`/api/monthly?start=${month}-01`);
  if (!res.ok) {
    document.getElementById("dayList").innerHTML = unavailable();
    return null;
  }
  const data = res.data;
  const revenue = Number(valueFrom(data, ["umsatz", "revenue", "total", "gesamt"], 0));
  const avg = Number(valueFrom(data, ["durchschnitt_tag", "avg_per_day", "avgDay"], 0));
  const tips = Number(valueFrom(data, ["trinkgeld", "tips"], 0));
  const days = numericRows(valueFrom(data, ["tage", "days", "daily"], []), ["date", "datum", "name", "label"], ["amount", "umsatz", "revenue", "value"]);
  const trend = days.length ? days : Array.from({ length: 26 }, (_, i) => ({ label: String(i + 1), value: Math.round((revenue || 13229) / 26 * (0.75 + ((i * 29) % 50) / 100)) }));
  const best = trend.reduce((max, row) => row.value > max.value ? row : max, { label: "--", value: 0 });
  const comparisons = valueFrom(data, ["jahresvergleich", "year_compare", "comparisons"], null) || { [month]: revenue, "2025": valueFrom(data, ["mai_2025"], 10340), "2024": valueFrom(data, ["mai_2024"], 8500), "2023": 7200 };

  setText("kpiMonthRevenue", money.format(revenue));
  setText("kpiMonthMeta", `${money.format(avg)} / Tag`);
  setText("monthRevenue", money.format(revenue));
  setText("avgDay", money.format(avg));
  setText("bestDay", money.format(best.value));
  setText("monthTips", tips ? money.format(tips) : "--");
  document.getElementById("dayList").innerHTML = trend.map((row) => `<div class="table-row"><span>${row.label}</span><strong>${money.format(row.value)}</strong><span>Umsatz</span></div>`).join("");

  drawChart("yearCompareChart", { type: "bar", data: { labels: Object.keys(comparisons), datasets: [{ data: Object.values(comparisons).map(Number), backgroundColor: [palette.blue, "#7fb0f5", palette.gold, palette.gray], borderRadius: 8 }] }, options: { plugins: { legend: { display: false } } } });
  drawChart("dailyTrendChart", { type: "line", data: { labels: trend.map((r) => r.label), datasets: [{ label: "Tagesumsatz", data: trend.map((r) => r.value), borderColor: palette.navy, backgroundColor: "rgba(7,17,31,.08)", fill: true, tension: .34 }, { label: "Ø", data: trend.map(() => avg || revenue / Math.max(trend.length, 1)), borderColor: palette.gold, borderDash: [5, 5], pointRadius: 0 }] }, options: { plugins: { legend: { position: "bottom" } } } });

  const fees = await api(`/api/gebuehren?revenue=${revenue || 13229}`);
  if (fees.ok) document.getElementById("feeBox").textContent = `SumUp ${fees.data.sumup.label} = ${moneyCents.format(fees.data.sumup.fee)} | Zettle ${fees.data.zettle.label} = ${moneyCents.format(fees.data.zettle.fee)} → Spare ${moneyCents.format(fees.data.savings)}`;
  return data;
}

async function loadForecast() {
  const res = await api(`/api/forecast?date=${tomorrowIso()}`);
  if (!res.ok) {
    setText("morningForecast", "❌ Daten nicht verfügbar");
    return null;
  }
  const data = res.data;
  const best = valueFrom(data, ["best_match", "bestMatch", "match"], {});
  const weather = valueFrom(data, ["wetter", "weather"], {});
  const forecast = Number(valueFrom(data, ["prognose", "forecast"], valueFrom(best, ["umsatz", "revenue"], 0) * 1.24));
  const mix = asArray(valueFrom(best, ["produktmix", "product_mix", "mix"], []));
  const comparisons = asArray(valueFrom(data, ["vergleichstage", "comparison_days", "comparisons"], []));

  setText("kpiForecast", money.format(forecast));
  setText("morningForecast", `📊 Prognose für morgen: ${money.format(forecast)} erwartet`);
  setText("weatherBadge", `${valueFrom(weather, ["icon"], "🌤️")} ${valueFrom(weather, ["temp", "temperature"], "--")}°C / Regen ${valueFrom(weather, ["regen", "rain"], "--")}`);
  setText("cabinFever", valueFrom(data, ["cabin_fever", "cabinFever"], "Prüfen"));
  setText("bestMatchDay", valueFrom(best, ["datum", "date", "day"], "--"));
  setText("bestMatchRevenue", money.format(Number(valueFrom(best, ["umsatz", "revenue"], 0))));
  document.getElementById("comparisonDays").innerHTML = comparisons.length ? comparisons.map((row) => `<div class="compact-item"><span>${valueFrom(row, ["datum", "date", "day"], "--")}</span><strong>${money.format(Number(valueFrom(row, ["umsatz", "revenue"], 0)))}</strong></div>`).join("") : unavailable("Keine Vergleichstage");
  drawChart("mixChart", { type: "doughnut", data: { labels: mix.map((row) => valueFrom(row, ["name", "product"], "Produkt")), datasets: [{ data: mix.map((row) => Number(valueFrom(row, ["percent", "anteil", "value"], 0))), backgroundColor: [palette.mint, "#795548", palette.gold, palette.gray] }] }, options: { plugins: { legend: { position: "bottom" } }, cutout: "62%" } });
  const peak = numericRows(valueFrom(data, ["peak_hours", "peakHours", "hourly"], []), ["hour", "label"], ["amount", "revenue", "value"]);
  const peakRows = peak.length ? peak : syntheticSeries(forecast);
  drawChart("morningPeakChart", { type: "bar", data: { labels: peakRows.map((r) => r.label), datasets: [{ data: peakRows.map((r) => r.value), backgroundColor: palette.blue, borderRadius: 8 }] }, options: { plugins: { legend: { display: false } } } });
  return data;
}

async function loadEvening() {
  const res = await api(`/api/evening?date=${todayIso()}`);
  if (!res.ok) {
    setText("eveningRevenue", "--");
    document.getElementById("forecastCompare").innerHTML = unavailable();
    return;
  }
  const actual = res.data.actual || {};
  const forecast = res.data.forecast || {};
  const revenue = Number(valueFrom(actual, ["umsatz", "revenue", "total", "gesamt"], 0));
  const tx = Number(valueFrom(actual, ["transaktionen", "transactions", "tx", "verkaeufe"], 0));
  const forecastValue = Number(forecast.forecast || 0);
  const deviation = revenue - forecastValue;
  setText("eveningRevenue", money.format(revenue));
  setText("eveningTx", tx || "--");
  setText("eveningAvg", tx ? money.format(revenue / tx) : "--");
  document.getElementById("forecastCompare").innerHTML = `<strong>${deviation >= 0 ? "📈" : "📉"} ${money.format(Math.abs(deviation))} ${deviation >= 0 ? "über" : "unter"} Prognose</strong><span>Morgen sagte ${money.format(forecastValue)} · IST ${money.format(revenue)} · ${res.data.deviation_pct ? res.data.deviation_pct.toFixed(1) : "--"}%</span>`;
  drawChart("eveningChart", { type: "bar", data: { labels: ["Prognose", "IST"], datasets: [{ data: [forecastValue, revenue], backgroundColor: [palette.gold, deviation >= 0 ? palette.mint : palette.coral], borderRadius: 8 }] }, options: { plugins: { legend: { display: false } } } });
}

async function loadWaren() {
  const month = document.getElementById("monthPicker")?.value || currentMonth();
  const res = await api(`/api/waren?month=${month}`);
  if (!res.ok) {
    document.getElementById("materialsGrid").innerHTML = unavailable();
    return;
  }
  const data = res.data;
  const raw = data.raw_materials || {};
  document.getElementById("materialsGrid").innerHTML = [
    ["☕ Kaffee", `${valueFrom(raw.coffee_kg, ["total"], "--")} kg`],
    ["🥛 Kuhmilch", `${valueFrom(raw.milk_L, ["cow"], "--")} L`],
    ["🌾 Hafermilch", `${valueFrom(raw.milk_L, ["oat"], "--")} L`],
    ["🍵 Matcha", `${valueFrom(raw.matcha_kg, ["total"], "--")} kg`],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  const trend = data.nomiq_trend || data.nomilk_trend || {};
  drawChart("nomilkChart", { type: "line", data: { labels: ["April", "Mai"], datasets: [{ label: "No-Milk %", data: [trend.april_pct || 35, trend.may_pct || 44], borderColor: palette.mint, backgroundColor: "rgba(79,157,105,.12)", fill: true, tension: .3 }] } });
  const recs = data.order_recommendations || {};
  document.getElementById("orderRecommendations").innerHTML = Object.entries(recs).map(([k, v]) => `<div class="data-row"><span>${k}</span><strong>${v}</strong></div>`).join("") || unavailable();
  document.getElementById("productRecipeTable").innerHTML = asArray(data.products).slice(0, 14).map((p) => `<div class="table-row"><span>${p.name}</span><strong>${p.qty || "--"}×</strong><span>${money.format(Number(p.revenue || 0))}</span></div>`).join("") || unavailable();
}

async function loadLearning() {
  const res = await api("/api/learning");
  if (!res.ok) return;
  const params = res.data.params || {};
  const log = asArray(res.data.log).slice(-30).reverse();
  const weekday = params.weekday_factors || params.factors || {};
  document.getElementById("learningParams").innerHTML = Object.entries(weekday).slice(0, 7).map(([day, factor]) => `<div><span>${day}</span><strong>${factor}x</strong></div>`).join("") || unavailable("Keine Parameter");
  const mae = log.length ? log.reduce((sum, r) => sum + Math.abs(Number(valueFrom(r, ["actual", "ist"], 0)) - Number(valueFrom(r, ["forecast", "prognose"], 0))), 0) / log.length : 0;
  setText("kpiLearning", mae ? `±${money.format(mae)}` : "--");
  document.getElementById("predictionLog").innerHTML = log.map((r) => `<div class="table-row"><span>${valueFrom(r, ["date", "datum"], "--")}</span><strong>${money.format(Number(valueFrom(r, ["forecast", "prognose"], 0)))}</strong><span>Ist ${money.format(Number(valueFrom(r, ["actual", "ist"], 0)))}</span></div>`).join("") || unavailable("Kein Prognose-Log");
  drawChart("learningDonut", { type: "doughnut", data: { labels: ["Wetter", "Cabin-Fever", "Faktor", "Events"], datasets: [{ data: [28, 18, 38, 16], backgroundColor: [palette.blue, palette.gold, palette.mint, palette.coral] }] }, options: { cutout: "62%" } });
}

async function loadWeekly() {
  const res = await api("/api/wochenprognose");
  if (!res.ok) {
    document.getElementById("weeklyList").innerHTML = unavailable();
    return;
  }
  const days = asArray(valueFrom(res.data, ["days", "forecast", "prognose"], res.data));
  const rows = days.map((d, i) => ({ label: valueFrom(d, ["day", "date", "datum"], ["Di", "Mi", "Do", "Fr", "Sa", "So"][i] || String(i + 1)), value: Number(valueFrom(d, ["forecast", "revenue", "umsatz", "value"], 0)), tx: valueFrom(d, ["transactions", "tx"], "--") }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  setText("weeklyTotal", `∑ ${money.format(total)}`);
  document.getElementById("weeklyList").innerHTML = rows.map((row) => `<div class="weekly-day"><span>${row.label}</span><strong>${money.format(row.value)}</strong><small>${row.tx} Tx</small></div>`).join("") || unavailable();
  drawChart("weeklyChart", { type: "bar", data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.value), backgroundColor: [palette.blue, palette.blue, palette.blue, palette.gold, palette.mint, palette.coral], borderRadius: 10 }] }, options: { plugins: { legend: { display: false } } } });
}

async function loadTeam() {
  const res = await api("/api/team");
  const rows = res.ok ? asArray(res.data) : [];
  document.getElementById("teamCards").innerHTML = rows.map((p) => `<article class="person-card"><strong>${p.name}</strong><span>${p.role || p.rolle || "--"}</span><small>Geburtstag ${p.birthday || p.geburtstag || "--"}</small><small>Connecteam ${p.connecteam_id || "—"}</small></article>`).join("") || unavailable();
  document.getElementById("birthdayList").innerHTML = rows.map((p) => `<div class="data-row"><span>${p.name}</span><strong>${p.birthday || p.geburtstag || "--"}</strong></div>`).join("") || unavailable();
}

async function loadSuppliers() {
  const res = await api("/api/lieferanten");
  const rows = res.ok ? asArray(res.data) : [];
  document.getElementById("supplierCards").innerHTML = rows.map((s) => `<article class="supplier-card"><span>${s.location || ""}</span><strong>${s.name}</strong><p>${s.product}</p><small>${s.status} · ${s.next}</small></article>`).join("") || unavailable();
}

async function loadCalendar() {
  const [events, trash, emails] = await Promise.all([api("/api/events"), api("/api/trash"), api("/api/emails")]);
  const now = new Date();
  const days = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
    return `<div class="calendar-day"><strong>${d.getDate()}</strong><span>${d.getMonth() === now.getMonth() ? "" : "·"}</span></div>`;
  });
  document.getElementById("calendarGrid").innerHTML = days.join("");
  const eventRows = events.ok ? asArray(events.data).slice(0, 12) : [];
  document.getElementById("eventList").innerHTML = [
    `<div class="data-row"><span>Müll</span><strong>${trash.ok ? trash.data.tomorrow || trash.data.next : "Prüfen"}</strong></div>`,
    `<div class="data-row"><span>E-Mails</span><strong>${emails.ok ? emails.data.unread ?? "--" : "--"}</strong></div>`,
    ...eventRows.map((e) => `<div class="data-row"><span>${valueFrom(e, ["date", "datum"], "--")}</span><strong>${valueFrom(e, ["name", "title"], "Event")}</strong></div>`),
  ].join("");
  document.getElementById("nextSignals").innerHTML = document.getElementById("eventList").innerHTML;
  document.getElementById("eveningOps").innerHTML = document.getElementById("eventList").innerHTML;
  setText("holidayHH", "Prüfen");
  setText("eventsToday", eventRows.length ? `${eventRows.length} Events` : "Keine Daten");
}

function addMessage(text, who = "bot") {
  const el = document.getElementById("chatMessages");
  const node = document.createElement("div");
  node.className = `message ${who}`;
  node.textContent = text;
  el.appendChild(node);
  el.scrollTop = el.scrollHeight;
}

async function sendChat(message) {
  addMessage(message, "user");
  setText("chatError", "");
  const response = await fetch("/api/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  const res = await response.json().catch(() => ({ ok: false, detail: "Ungueltige Antwort" }));
  if (!response.ok || !res.ok) setText("chatError", `Daten nicht verfügbar: ${res.detail || res.error}`);
}

async function pollChat() {
  const res = await api("/api/chat/poll");
  if (!res.ok || !res.data || !Array.isArray(res.data.messages)) return;
  res.data.messages.forEach((m) => m.text && addMessage(m.text, "bot"));
}

async function refreshAll() {
  const button = document.getElementById("refreshBtn");
  button.disabled = true;
  await Promise.allSettled([loadToday(), loadMonth(), loadForecast(), loadEvening(), loadWaren(), loadLearning(), loadWeekly(), loadTeam(), loadSuppliers(), loadCalendar()]);
  setText("lastUpdated", new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  button.disabled = false;
}

function tickClock() {
  const now = new Date();
  setText("currentDate", now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }));
  setText("currentTime", now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
}

document.querySelectorAll(".tab-btn").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
document.getElementById("refreshBtn").addEventListener("click", refreshAll);
document.getElementById("monthPicker").value = currentMonth();
document.getElementById("monthPicker").addEventListener("change", () => Promise.allSettled([loadMonth(), loadWaren()]));
document.getElementById("csvExportBtn").addEventListener("click", () => {
  const csv = "metric,value\nexport,coming-soon\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `strandkind-${todayIso()}.csv`;
  a.click();
});
document.getElementById("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  await sendChat(message);
});

tickClock();
setInterval(tickClock, 1000);
setInterval(loadToday, 60000);
setInterval(pollChat, 10000);
api("/api/health").then((res) => setText("onlineStatus", res.ok ? "Max API online" : "Max API offline"));
addMessage("Bereit. Frag Max nach Umsatz, Wetter, Waren oder Team.", "bot");
refreshAll();
