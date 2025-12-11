// BNAPP V3.5 – לוגיקה ראשית
// קובץ זה מניח טעינה של:
// - hebcal.min.js ליום עברי וחגים
// - Chart.js לסטטיסטיקות
// - firebase-config.js שמייצא firebaseApp, db

import {
  ref,
  onValue,
  set,
  push,
  update,
  remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

import { db } from "./firebase-config.js";

const state = {
  currentUser: "binyamin",
  currentDate: new Date(),
  settings: {
    city: null,
    cityLat: null,
    cityLon: null,
    cityTz: null
  },
  cache: {
    events: {}, // key: dateKey -> {id: event}
    tasks: {},
    shopping: {},
    holidays: {}, // dateKey -> holiday info
    holidaysLoadedYear: null,
    shabbat: {}
  },
  ui: {
    darkMode: false,
    notificationsGranted: false
  }
};

const el = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function dateKeyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatHebrewDate(date) {
  try {
    const hd = new Hebcal.HDate(date);
    return hd.renderGematriya ? hd.renderGematriya() : hd.toString("h");
  } catch (e) {
    return "";
  }
}

function getHebrewMonthYearLabel(date) {
  try {
    const hd = new Hebcal.HDate(date);
    const parts = hd.toString("h").split(" ");
    if (parts.length >= 2) {
      return parts.slice(1).join(" ");
    }
    return hd.toString("h");
  } catch (e) {
    return "";
  }
}

function getCity() {
  return state.settings.city || "ירושלים";
}

// --- Open-Meteo helpers (מזג אוויר בלי API KEY) ---
async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    name
  )}&count=1&language=he&format=json`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.results || !data.results.length) throw new Error("עיר לא נמצאה");
  const r = data.results[0];
  state.settings.cityLat = r.latitude;
  state.settings.cityLon = r.longitude;
  state.settings.cityTz = r.timezone;
  // לאחסן בריל-טיים
  try {
    const settingsRef = ref(db, "settings");
    update(settingsRef, {
      cityLat: state.settings.cityLat,
      cityLon: state.settings.cityLon,
      cityTz: state.settings.cityTz
    });
  } catch (e) {
    console.warn("Failed saving city coords", e);
  }
}

async function ensureCityCoords() {
  if (state.settings.cityLat && state.settings.cityLon && state.settings.cityTz) return;
  const city = getCity();
  await geocodeCity(city);
}

function mapOpenMeteoWeather(code) {
  // קודים לפי Open-Meteo
  if (code === 0) return { label: "שמים בהירים", emoji: "☀️" };
  if ([1, 2, 3].includes(code)) return { label: "מעונן חלקית", emoji: "🌤️" };
  if ([45, 48].includes(code)) return { label: "ערפל", emoji: "🌫️" };
  if ([51, 53, 55].includes(code)) return { label: "טיפטוף", emoji: "🌦️" };
  if ([61, 63, 65].includes(code)) return { label: "גשם", emoji: "🌧️" };
  if ([71, 73, 75, 77].includes(code)) return { label: "שלג", emoji: "❄️" };
  if ([80, 81, 82].includes(code)) return { label: "ממטרים", emoji: "🌧️" };
  if ([95, 96, 99].includes(code)) return { label: "סופות רעמים", emoji: "⛈️" };
  return { label: "מזג אוויר", emoji: "🌦️" };
}

function hebrewHolidayForDate(date) {
  try {
    const events = Hebcal.holidays(date, { il: true });
    if (!events || !events.length) return null;
    const e = events[0];
    return e.render ? e.render("he") : e.desc || null;
  } catch (e) {
    return null;
  }
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isShabbat(date) {
  return date.getDay() === 6;
}

function isFriday(date) {
  return date.getDay() === 5;
}

function dayName(date) {
  const names = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
  return names[date.getDay()];
}

// --- זמני שבת – cache לפי יום שישי ---
async function ensureShabbatForWeek(fridayDate) {
  const fridayKey = dateKeyFromDate(fridayDate);
  if (state.cache.shabbat[fridayKey]) return state.cache.shabbat[fridayKey];

  if (!state.settings.cityLat || !state.settings.cityLon || !state.settings.cityTz) {
    return null;
  }

  const y = fridayDate.getFullYear();
  const m = String(fridayDate.getMonth() + 1).padStart(2, "0");
  const d = String(fridayDate.getDate()).padStart(2, "0");
  const url = `https://www.hebcal.com/shabbat?cfg=json&latitude=${
    state.settings.cityLat
  }&longitude=${state.settings.cityLon}&tzid=${encodeURIComponent(
    state.settings.cityTz
  )}&start=${y}-${m}-${d}&end=${y}-${m}-${d}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const itemCandles = (data.items || []).find((it) => it.category === "candles");
    const itemHavdalah = (data.items || []).find((it) => it.category === "havdalah");
    const result = {
      candle: itemCandles ? new Date(itemCandles.date) : null,
      havdalah: itemHavdalah ? new Date(itemHavdalah.date) : null
    };
    state.cache.shabbat[fridayKey] = result;
    return result;
  } catch (e) {
    console.error("Failed loading shabbat times", e);
    return null;
  }
}

function formatTimeHM(date) {
  if (!date) return "";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function ensureYearHolidays(year) {
  if (state.cache.holidaysLoadedYear === year) return;
  state.cache.holidaysLoadedYear = year;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dateKeyFromDate(d);
    const name = hebrewHolidayForDate(new Date(d));
    if (name) {
      state.cache.holidays[key] = { name };
    }
  }
}

// ---------- דיבור + הומור של ג'יחרי ----------

let gihariVoice = null;

function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  gihariVoice =
    voices.find(
      (v) =>
        v.lang === "he-IL" &&
        (v.name.includes("Google") ||
          v.name.toLowerCase().includes("wavenet") ||
          v.name.toLowerCase().includes("enhanced"))
    ) ||
    voices.find((v) => v.lang === "he-IL") ||
    voices[0] ||
    null;
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function gihariSpeak(text) {
  if (!("speechSynthesis" in window)) return;
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "he-IL";
  utter.rate = 1.03;
  utter.pitch = 1.0;
  if (gihariVoice) utter.voice = gihariVoice;
  speechSynthesis.speak(utter);
}

// מצב D – הכל: רגוע, צחוקים, עקיצות, חכם – רנדומלי בכל תשובה
function wrapGihariHumor(html) {
  const plain = html.replace(/<[^>]+>/g, "").trim();

  const chill = [
    "סגור אחי, עליי. 😎",
    "לגמרי, מטפל בזה בשקט. 🧘‍♂️",
    "קיבלתי, ממשיך לעבוד ברקע. 😉"
  ];
  const jokes = [
    "אם זה לא יעבוד, תקלל אותי בצדק. 😂",
    "אני עובד פה שעות, ואתה רק נותן הוראות. 🤖",
    "שנייה, בודק… אל תספר לאף אחד שאני יותר מסודר ממך. 🤫"
  ];
  const roast = [
    "וואלה בלי העזרה שלי היית הולך לאיבוד ביומן. 🔥",
    "אתה יודע שאתה מבקש ממני לעשות דברים שאתה לא תזכור בכלל שביקשת. 😏",
    "הפעם אני מסדר, בפעם הבאה תביא גם בורקס. 😜"
  ];
  const smart = [
    "לוגיסטית זו הייתה בקשה חכמה, אני מאשר. 📊",
    "התאמתי את זה ככה שיישב יפה בין העומס שלך. 🧠",
    "שיקללתי דחיפות, עומס ומשך – ויצא מושלם. 💡"
  ];

  const families = [chill, jokes, roast, smart];
  const fam = families[Math.floor(Math.random() * families.length)];
  const line = fam[Math.floor(Math.random() * fam.length)];

  return `${line}<br>${html}`;
}

function renderCalendar() {
  const grid = el("calendarGrid");
  grid.innerHTML = "";

  const currentMonthDate = state.currentDate;
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  ensureYearHolidays(year);

  const firstDayOfMonth = new Date(year, month, 1);
  // תיקון הסטייה – תחילת שבוע באותו מקום כמו בגרסה שעבדה לך
  const startDay = (firstDayOfMonth.getDay() + 1) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let gregLabel = firstDayOfMonth.toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric"
  });
  el("gregMonthLabel").textContent = gregLabel;
  el("hebrewMonthLabel").textContent = getHebrewMonthYearLabel(firstDayOfMonth) || "";

  const prevMonthDays = new Date(year, month, 0).getDate();

  const today = new Date();

  const totalCells = 42;
  for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";

    let dayNum;
    let cellDate;
    let outside = false;

    if (cellIndex < startDay) {
      dayNum = prevMonthDays - startDay + cellIndex + 1;
      cellDate = new Date(year, month - 1, dayNum);
      outside = true;
    } else if (cellIndex >= startDay + daysInMonth) {
      dayNum = cellIndex - startDay - daysInMonth + 1;
      cellDate = new Date(year, month + 1, dayNum);
      outside = true;
    } else {
      dayNum = cellIndex - startDay + 1;
      cellDate = new Date(year, month, dayNum);
    }

    const dateKey = dateKeyFromDate(cellDate);
    const heb = formatHebrewDate(cellDate);
    const holiday = state.cache.holidays[dateKey];
    const events = state.cache.events[dateKey] || {};

    const header = document.createElement("div");
    header.className = "day-header";

    const dayNumEl = document.createElement("div");
    dayNumEl.className = "day-num";
    dayNumEl.textContent = dayNum;

    const hebEl = document.createElement("div");
    hebEl.className = "day-hebrew";
    hebEl.textContent = heb;

    header.appendChild(dayNumEl);
    header.appendChild(hebEl);
    cell.appendChild(header);

    if (holiday) {
      const holidayEl = document.createElement("div");
      holidayEl.className = "day-holiday";
      holidayEl.textContent = holiday.name;
      cell.appendChild(holidayEl);
    }

    // ערב שבת ושבת – עם זמני הדלקה/צאת שבת
    let shabbatLabel = null;
    let fridayForTimes = null;
    if (isFriday(cellDate)) {
      shabbatLabel = "ערב שבת";
      fridayForTimes = new Date(cellDate);
    } else if (isShabbat(cellDate)) {
      shabbatLabel = "שבת";
      fridayForTimes = new Date(cellDate);
      fridayForTimes.setDate(fridayForTimes.getDate() - 1);
    }

    if (shabbatLabel && fridayForTimes) {
      const shabbatWrap = document.createElement("div");
      shabbatWrap.className = "day-shabbat-block";

      const line1 = document.createElement("div");
      line1.className = "day-shabbat-title";
      line1.textContent = shabbatLabel;
      shabbatWrap.appendChild(line1);

      const line2 = document.createElement("div");
      line2.className = "day-shabbat-time";
      line2.textContent = "טוען זמני שבת...";
      shabbatWrap.appendChild(line2);

      cell.appendChild(shabbatWrap);

      ensureShabbatForWeek(fridayForTimes).then((info) => {
        if (!info) {
          line2.textContent = "";
          return;
        }
        if (isFriday(cellDate) && info.candle) {
          line2.textContent = "כניסת שבת: " + formatTimeHM(info.candle);
        } else if (isShabbat(cellDate) && info.havdalah) {
          line2.textContent = "צאת שבת: " + formatTimeHM(info.havdalah);
        } else {
          line2.textContent = "";
        }
      });
    }

    const pointsRow = document.createElement("div");
    pointsRow.className = "day-points";

    let eventCount = 0;
    Object.values(events).forEach((ev) => {
      const dot = document.createElement("div");
      dot.className = "event-dot";
      if (ev.type === "task") dot.classList.add("task");
      if (ev.owner) dot.classList.add(`owner-${ev.owner}`);
      pointsRow.appendChild(dot);
      eventCount++;
    });

    if (eventCount > 0) {
      cell.appendChild(pointsRow);
    }

    if (eventCount >= 2) {
      cell.classList.add("day-border-glow");
    }

    if (outside) {
      cell.classList.add("outside");
    }

    if (isSameDay(cellDate, today)) {
      cell.classList.add("day-cell-today");
    }

    cell.addEventListener("click", () => openDayModal(cellDate));

    grid.appendChild(cell);
  }
}

function renderTasks(filter = "undated") {
  const list = el("tasksList");
  list.innerHTML = "";
  const allTasks = [];

  Object.entries(state.cache.events).forEach(([dateKey, items]) => {
    Object.entries(items).forEach(([id, ev]) => {
      if (ev.type !== "task") return;
      allTasks.push({ id, dateKey, ...ev });
    });
  });

  allTasks.sort((a, b) => {
    if (!a.dateKey && b.dateKey) return -1;
    if (a.dateKey && !b.dateKey) return 1;
    if (a.dateKey && b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    return 0;
  });

  const filtered = allTasks.filter((task) => {
    const hasDate = !!task.dateKey && task.dateKey !== "undated";
    const isRecurring = task.recurring && task.recurring !== "none";
    if (filter === "undated") return !hasDate;
    if (filter === "dated") return hasDate && !isRecurring;
    if (filter === "recurring") return isRecurring;
    return true;
  });

  filtered.forEach((task) => {
    const item = document.createElement("div");
    item.className = "task-item";

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.textContent =
      task.owner === "shared" ? "משותף" : task.owner === "binyamin" ? "בנימין" : "ננה";
    ownerBadge.classList.add(`badge-owner-${task.owner}`);

    header.appendChild(title);
    header.appendChild(ownerBadge);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const parts = [];
    if (task.dateKey && task.dateKey !== "undated") {
      const d = parseDateKey(task.dateKey);
      parts.push(
        d.toLocaleDateString("he-IL", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit"
        })
      );
    } else {
      parts.push("ללא תאריך");
    }
    if (task.duration) parts.push(`${task.duration} דק'`);
    if (task.urgency) {
      const map = {
        today: "היום",
        week: "השבוע",
        month: "החודש",
        none: "לא דחוף"
      };
      parts.push(`דחיפות: ${map[task.urgency] || task.urgency}`);
    }
    meta.textContent = parts.join(" • ");

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const doneBtn = document.createElement("button");
    doneBtn.className = "ghost-pill small";
    doneBtn.textContent = "✔ בוצע";
    doneBtn.addEventListener("click", () => markTaskDone(task));

    const postponeBtn = document.createElement("button");
    postponeBtn.className = "ghost-pill small";
    postponeBtn.textContent = "דחיה";
    postponeBtn.addEventListener("click", () => postponeTask(task));

    actions.appendChild(doneBtn);
    actions.appendChild(postponeBtn);

    const urgencyBadge = document.createElement("span");
    urgencyBadge.className = "badge";
    if (task.urgency) {
      urgencyBadge.classList.add(`badge-urgency-${task.urgency}`);
      const map = {
        today: "היום",
        week: "השבוע",
        month: "החודש",
        none: "לא דחוף"
      };
      urgencyBadge.textContent = map[task.urgency] || task.urgency];
    }

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(actions);
    if (task.urgency) item.appendChild(urgencyBadge);

    list.appendChild(item);
  });
}

function markTaskDone(task) {
  const refPath = ref(db, `events/${task.dateKey}/${task.id}`);
  remove(refPath);
}

function postponeTask(task) {
  const baseDate = task.dateKey && task.dateKey !== "undated" ? parseDateKey(task.dateKey) : new Date();
  const newDate = new Date(baseDate);

  if (task.urgency === "today") {
    newDate.setDate(newDate.getDate() + 1);
  } else if (task.urgency === "week") {
    newDate.setDate(newDate.getDate() + 3);
  } else if (task.urgency === "month") {
    newDate.setDate(newDate.getDate() + 7);
  } else {
    newDate.setDate(newDate.getDate() + 1);
  }

  const newKey = dateKeyFromDate(newDate);
  const fromRef = ref(db, `events/${task.dateKey}/${task.id}`);
  const newRef = ref(db, `events/${newKey}/${task.id}`);

  set(newRef, {
    ...task,
    dateKey: newKey
  });
  remove(fromRef);
}


function openDayModal(date) {
  const modal = el("dayModal");
  modal.classList.remove("hidden");

  const dayNumber = date.getDate();
  el("dayModalGreg").textContent = String(dayNumber);
  el("dayModalHeb").textContent = dayName(date);

  const dateKey = dateKeyFromDate(date);
  renderDayEvents(dateKey);
  renderAutoBlocks(date);

  const weatherCard = el("dayWeatherContainer");
  if (!hasEventsOnDate(dateKey)) {
    fetchWeatherForDate(date, true);
  } else {
    weatherCard.classList.add("hidden");
  }

  el("btnAddFromDay").onclick = () => {
    openEditModal({ dateKey });
  };

  el("btnToggleDayWeather").onclick = () => {
    fetchWeatherForDate(date, false);
  };

  qsa("[data-close-modal]", modal).forEach((btn) => {
    btn.onclick = () => modal.classList.add("hidden");
  });
  qs(".modal-backdrop", modal).onclick = () => modal.classList.add("hidden");
}
function hasEventsOnDate(dateKey) {
  const events = state.cache.events[dateKey] || {};
  return Object.keys(events).length > 0;
}

function renderDayEvents(dateKey) {
  const container = el("dayEventsContainer");
  container.innerHTML = "";
  const events = state.cache.events[dateKey] || {};

  const list = Object.entries(events)
    .map(([id, ev]) => ({ id, ...ev }))
    .sort((a, b) => {
      if (!a.startTime && b.startTime) return 1;
      if (a.startTime && !b.startTime) return -1;
      if (!a.startTime && !b.startTime) return 0;
      return a.startTime.localeCompare(b.startTime);
    });

  list.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "card";
    if (ev.owner) card.classList.add(`owner-${ev.owner}`);

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = ev.title;

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.classList.add(`badge-owner-${ev.owner}`);
    ownerBadge.textContent =
      ev.owner === "shared" ? "משותף" : ev.owner === "binyamin" ? "בנימין" : "ננה";

    header.appendChild(title);
    header.appendChild(ownerBadge);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const parts = [];
    if (ev.startTime) {
      parts.push(`${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ""}`);
    }
    if (ev.duration) parts.push(`${ev.duration} דק'`);
    if (ev.type === "task") parts.push("משימה");
    else parts.push("אירוע");
    meta.textContent = parts.join(" • ");

    const desc = document.createElement("div");
    desc.className = "task-meta";
    desc.textContent = ev.description || "";

    const wazeBtn = document.createElement("button");
    wazeBtn.className = "ghost-pill small";
    wazeBtn.textContent = "Waze";
    if (ev.address) {
      wazeBtn.onclick = () => {
        const url = `https://waze.com/ul?q=${encodeURIComponent(ev.address)}`;
        window.open(url, "_blank");
      };
    } else {
      wazeBtn.disabled = true;
    }

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "ghost-pill small";
    editBtn.textContent = "עריכה";
    editBtn.onclick = () => openEditModal({ dateKey, id: ev.id || ev._id });

    const delBtn = document.createElement("button");
    delBtn.className = "ghost-pill small";
    delBtn.textContent = "מחיקה";
    delBtn.onclick = () => {
      const refPath = ref(db, `events/${dateKey}/${ev.id || ev._id}`);
      remove(refPath);
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    actions.appendChild(wazeBtn);

    card.appendChild(header);
    card.appendChild(meta);
    if (ev.description) card.appendChild(desc);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

function renderAutoBlocks(date) {
  const container = el("dayAutoBlocks");
  container.innerHTML = "";

  const blocks = [];

  const day = date.getDay();
  const dateKey = dateKeyFromDate(date);

  blocks.push({
    label: "שינה",
    range: "00:00–08:00",
    type: "sleep"
  });

  if (day >= 0 && day <= 4) {
    blocks.push({
      label: "עבודה",
      range: "08:00–17:00",
      type: "work"
    });
    blocks.push({
      label: "אוכל + מקלחת",
      range: "17:00–18:30",
      type: "meal"
    });
  }

  const autoHolidayRef = ref(db, `days/${dateKey}/holiday`);
  onValue(
    autoHolidayRef,
    (snap) => {
      const isHolidayMarked = !!snap.val();
      container.innerHTML = "";
      const finalBlocks = [...blocks];

      if (isHolidayMarked) {
        finalBlocks.length = 0;
        finalBlocks.push({
          label: "יום חופש",
          range: "ללא עבודה, אוכל/מקלחת אוטומטיים",
          type: "holiday"
        });
      }

      finalBlocks.forEach((b) => {
        const row = document.createElement("div");
        row.className = "auto-block";
        if (b.type === "holiday") row.classList.add("auto-holiday");

        const label = document.createElement("div");
        label.className = "auto-block-label";
        label.textContent = b.label;

        const range = document.createElement("div");
        range.className = "auto-block-range";
        range.textContent = b.range;

        row.appendChild(label);
        row.appendChild(range);
        container.appendChild(row);
      });
    },
    { onlyOnce: true }
  );
}

function openEditModal({ dateKey, id } = {}) {
  const modal = el("editModal");
  modal.classList.remove("hidden");
  const form = el("editForm");
  form.reset();

  const dateInput = form.elements["date"];
  if (dateKey) {
    dateInput.value = dateKey;
  } else {
    dateInput.value = dateKeyFromDate(state.currentDate);
  }

  form.dataset.editDateKey = dateKey || "";
  form.dataset.editId = id || "";

  qsa("[data-close-modal]", modal).forEach((btn) => {
    btn.onclick = () => modal.classList.add("hidden");
  });
  qs(".modal-backdrop", modal).onclick = () => modal.classList.add("hidden");
}

function handleEditFormSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  const eventObj = {
    type: data.type,
    owner: data.owner,
    title: data.title,
    description: data.description || "",
    dateKey: data.date || "undated",
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    duration: data.duration ? Number(data.duration) : null,
    address: data.address || "",
    reminderMinutes: data.reminderMinutes ? Number(data.reminderMinutes) : null,
    recurring: data.recurring || "none",
    urgency: data.urgency || "none"
  };

  const dateKey = eventObj.dateKey || "undated";
  const existingId = form.dataset.editId || null;

  if (existingId) {
    const refPath = ref(db, `events/${dateKey}/${existingId}`);
    update(refPath, eventObj);
  } else {
    const refPath = ref(db, `events/${dateKey}`);
    const newRef = push(refPath);
    set(newRef, { ...eventObj, _id: newRef.key });
  }

  scheduleLocalReminder(eventObj);

  el("editModal").classList.add("hidden");
}

function openWazeFromForm() {
  const form = el("editForm");
  const address = form.elements["address"].value;
  if (!address) return;
  const url = `https://waze.com/ul?q=${encodeURIComponent(address)}`;
  window.open(url, "_blank");
}

async function fetchWeatherForDate(date, autoShowIfEmpty) {
  const card = el("dayWeatherContainer");
  const city = getCity();
  if (!city) {
    card.classList.add("hidden");
    return;
  }

  try {
    await ensureCityCoords();
  } catch (e) {
    console.error("City geocode failed", e);
    el("dayWeatherTemp").textContent = "שגיאה בזיהוי עיר";
    el("dayWeatherDesc").textContent = "";
    el("dayWeatherExtra").textContent = "";
    card.classList.remove("hidden");
    return;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const dayStr = `${y}-${m}-${d}`;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${
    state.settings.cityLat
  }&longitude=${
    state.settings.cityLon
  }&hourly=temperature_2m,precipitation_probability,weather_code&timezone=${encodeURIComponent(
    state.settings.cityTz || "auto"
  )}&start_date=${dayStr}&end_date=${dayStr}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.hourly || !data.hourly.temperature_2m || !data.hourly.temperature_2m.length) {
      if (autoShowIfEmpty) card.classList.add("hidden");
      return;
    }
    // לקחת את השעה 12:00
    const idx = data.hourly.time.findIndex((t) => t.endsWith("12:00"));
    const i = idx >= 0 ? idx : 0;
    const temp = Math.round(data.hourly.temperature_2m[i]);
    const code = data.hourly.weather_code[i];
    const rain = data.hourly.precipitation_probability[i];

    const mapped = mapOpenMeteoWeather(code);

    el("dayWeatherTemp").textContent = `${temp}°C`;
    el("dayWeatherDesc").textContent = `${mapped.emoji} ${mapped.label}`;
    el("dayWeatherExtra").textContent = rain != null ? `סיכוי למשקעים: ${rain}%` : "";
    card.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    if (!autoShowIfEmpty) {
      el("dayWeatherTemp").textContent = "שגיאה בטעינת מזג האוויר";
      el("dayWeatherDesc").textContent = "";
      el("dayWeatherExtra").textContent = "";
      card.classList.remove("hidden");
    }
  }
}

// לא משתמשים בזה יותר – אבל משאיר אם משהו יקרא
function pickWeatherEmoji(data) {
  const id = data.weather[0]?.id || 800;
  if (id >= 200 && id < 300) return "⛈️";
  if (id >= 300 && id < 600) return "🌧️";
  if (id >= 600 && id < 700) return "❄️";
  if (id >= 700 && id < 800) return "🌫️";
  if (id === 800) return "☀️";
  if (id > 800) return "⛅";
  return "🌤️";
}

function initBottomNav() {
  const btns = qsa(".bottom-nav .nav-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const targetId = btn.dataset.target;
      qsa(".screen").forEach((s) => s.classList.remove("active"));
      el(targetId).classList.add("active");
    });
  });
}

function initTasksFilters() {
  const btns = qsa("#tasksSection .segmented-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;
      renderTasks(filter);
    });
  });
}

function initShopping() {
  const listTabs = qsa("#shoppingSection .segmented-btn");
  listTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      listTabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderShoppingList();
    });
  });

  el("btnAddShopping").onclick = addShoppingItem;
}

function addShoppingItem() {
  const input = el("shoppingInput");
  const text = input.value.trim();
  if (!text) return;

  const listKey = getCurrentShoppingListKey();
  const refPath = ref(db, `shopping/${listKey}`);
  const newRef = push(refPath);
  set(newRef, {
    text,
    completed: false
  });

  input.value = "";
}

function getCurrentShoppingListKey() {
  const active = qs("#shoppingSection .segmented-btn.active");
  return active ? active.dataset.list || "default" : "default";
}

function renderShoppingList() {
  const ul = el("shoppingList");
  ul.innerHTML = "";

  const listKey = getCurrentShoppingListKey();
  const itemsObj = state.cache.shopping[listKey] || {};
  const entries = Object.entries(itemsObj);

  entries.forEach(([id, item]) => {
    const li = document.createElement("li");
    li.className = "shopping-item";
    if (item.completed) li.classList.add("completed");

    const label = document.createElement("span");
    label.textContent = item.text;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "ghost-pill small";
    toggleBtn.textContent = item.completed ? "בטל ✔" : "✔";
    toggleBtn.onclick = () => {
      const refPath = ref(db, `shopping/${listKey}/${id}`);
      update(refPath, { completed: !item.completed });
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost-pill small";
    deleteBtn.textContent = "🗑";
    deleteBtn.onclick = () => {
      const refPath = ref(db, `shopping/${listKey}/${id}`);
      remove(refPath);
    };

    li.appendChild(label);
    li.appendChild(toggleBtn);
    li.appendChild(deleteBtn);

    ul.appendChild(li);
  });
}

function initFirebaseListeners() {
  const eventsRef = ref(db, "events");
  onValue(eventsRef, (snap) => {
    const val = snap.val() || {};
    state.cache.events = val;
    renderCalendar();
    renderTasks();
    updateStats();
  });

  const shoppingRef = ref(db, "shopping");
  onValue(shoppingRef, (snap) => {
    state.cache.shopping = snap.val() || {};
    renderShoppingList();
  });

  const settingsRef = ref(db, "settings");
  onValue(settingsRef, (snap) => {
    const settings = snap.val() || {};
    state.settings.city = settings.city || null;
    state.settings.cityLat = settings.cityLat || null;
    state.settings.cityLon = settings.cityLon || null;
    state.settings.cityTz = settings.cityTz || null;

    el("cityLabel").textContent = state.settings.city || "לא נבחרה";
    el("settingsCityInput").value = state.settings.city || "";
  });
}

async function saveCitySettings() {
  const city = el("settingsCityInput").value.trim();
  state.settings.city = city || null;
  el("cityLabel").textContent = city || "לא נבחרה";
  const settingsRef = ref(db, "settings");
  // לשמור גם קואורדינטות
  try {
    if (state.settings.city) {
      await geocodeCity(state.settings.city);
    }
    update(settingsRef, {
      city: state.settings.city,
      cityLat: state.settings.cityLat || null,
      cityLon: state.settings.cityLon || null,
      cityTz: state.settings.cityTz || null
    });
  } catch (e) {
    console.error("Failed to save city settings", e);
    update(settingsRef, { city: state.settings.city });
  }
}

function toggleHolidayForToday() {
  const today = new Date();
  const key = dateKeyFromDate(today);
  const holidayRef = ref(db, `days/${key}/holiday`);

  onValue(
    holidayRef,
    (snap) => {
      const current = snap.val();
      if (current) {
        remove(holidayRef);
      } else {
        set(holidayRef, true);
      }
    },
    { onlyOnce: true }
  );
}

// --- מצב לילה עם שמירה ב-localStorage ---
function applyTheme(dark) {
  state.ui.darkMode = !!dark;
  document.body.classList.toggle("dark", state.ui.darkMode);
  try {
    localStorage.setItem("bnappDarkMode", state.ui.darkMode ? "1" : "0");
  } catch (e) {}
}

function toggleTheme() {
  applyTheme(!state.ui.darkMode);
}

function initTheme() {
  let dark = false;
  try {
    const saved = localStorage.getItem("bnappDarkMode");
    if (saved === "1") {
      dark = true;
    } else if (saved === "0") {
      dark = false;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      dark = true;
    }
  } catch (e) {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      dark = true;
    }
  }
  applyTheme(dark);
}

function requestNotifications() {
  if (!("Notification" in window)) return;
  Notification.requestPermission().then((perm) => {
    state.ui.notificationsGranted = perm === "granted";
  });
}

function scheduleLocalReminder(ev) {
  if (!state.ui.notificationsGranted) return;
  if (!ev.dateKey || !ev.reminderMinutes || !ev.title) return;

  const [h, m] = (ev.startTime || "09:00").split(":").map(Number);
  const d = parseDateKey(ev.dateKey);
  d.setHours(h, m, 0, 0);
  const reminderTime = new Date(d.getTime() - ev.reminderMinutes * 60000);
  const delay = reminderTime.getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    if (Notification.permission === "granted") {
      new Notification("תזכורת BNAPP", {
        body: ev.title,
        tag: `bnapp-${ev.dateKey}-${ev.title}`
      });
    }
  }, Math.min(delay, 2147483647));
}

function initGihari() {
  el("btnGihari").onclick = () => openGihariModal();
  el("btnGihariSuggestNow").onclick = () => gihariSuggestNow();
  el("btnGihariPlaceTasks").onclick = () => gihariPlaceUndatedTasks();
}

function openGihariModal() {
  const modal = el("gihariModal");
  modal.classList.remove("hidden");

  qsa("[data-close-modal]", modal).forEach((btn) => {
    btn.onclick = () => modal.classList.add("hidden");
  });
  qs(".modal-backdrop", modal).onclick = () => modal.classList.add("hidden");

  const summaryEl = el("gihariSummary");

  const { dailyLoadMinutes, freeSlots } = computeLoadAndFreeSlots(new Date());
  const loadLabel =
    dailyLoadMinutes < 180 ? "יום קל" : dailyLoadMinutes < 360 ? "יום בינוני" : "יום עמוס";

  summaryEl.innerHTML = `
    <p>ג'יחרי בדק את היום שלך.</p>
    <p>עומס משימות/אירועים היום: <strong>${Math.round(
      dailyLoadMinutes / 60
    )} שעות</strong> (${loadLabel}).</p>
    <p>מספר חלונות זמן פנויים משמעותיים (30+ דק'): <strong>${freeSlots.length}</strong>.</p>
  `;

  el("gihariLog").innerHTML = "";

  // קול – רמה 1: פקודות פשוטות
  const micBtn = el("gihariMicBtn");
  if (micBtn) {
    micBtn.onclick = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert("הדפדפן לא תומך בזיהוי דיבור");
        return;
      }
      const rec = new SR();
      rec.lang = "he-IL";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.start();

      micBtn.disabled = true;
      micBtn.textContent = "מקשיב...";

      rec.onresult = (e) => {
        micBtn.disabled = false;
        micBtn.textContent = "🎤 דבר";
        const text = (e.results[0][0].transcript || "").trim();
        handleGihariVoiceCommand(text);
      };
      rec.onerror = () => {
        micBtn.disabled = false;
        micBtn.textContent = "🎤 דבר";
      };
      rec.onend = () => {
        micBtn.disabled = false;
        micBtn.textContent = "🎤 דבר";
      };
    };
  }
}

function computeLoadAndFreeSlots(date) {
  const dateKey = dateKeyFromDate(date);
  const events = state.cache.events[dateKey] || {};
  const busySegments = [];

  Object.values(events).forEach((ev) => {
    // לא מחשיבים אירועים של משתמש אחר בלבד
    if (ev.owner && ev.owner !== state.currentUser && ev.owner !== "shared") return;
    if (!ev.startTime || !ev.endTime) return;
    const [sh, sm] = ev.startTime.split(":").map(Number);
    const [eh, em] = ev.endTime.split(":").map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    busySegments.push([startMinutes, endMinutes]);
  });

  busySegments.sort((a, b) => a[0] - b[0]);

  let merged = [];
  busySegments.forEach((seg) => {
    if (!merged.length) merged.push(seg);
    else {
      const last = merged[merged.length - 1];
      if (seg[0] <= last[1]) {
        last[1] = Math.max(last[1], seg[1]);
      } else {
        merged.push(seg);
      }
    }
  });

  let totalBusy = 0;
  merged.forEach((seg) => {
    totalBusy += seg[1] - seg[0];
  });

  const freeSlots = [];
  const dayStart = 8 * 60;
  const dayEnd = 22 * 60;

  let cursor = dayStart;
  merged.forEach((seg) => {
    if (seg[0] - cursor >= 30) {
      freeSlots.push([cursor, seg[0]]);
    }
    cursor = Math.max(cursor, seg[1]);
  });
  if (dayEnd - cursor >= 30) {
    freeSlots.push([cursor, dayEnd]);
  }

  return { dailyLoadMinutes: totalBusy, freeSlots };
}

function gihariSuggestNow() {
  const now = new Date();
  const dateKey = dateKeyFromDate(now);
  const tasksUndone = [];

  Object.entries(state.cache.events).forEach(([dk, items]) => {
    Object.entries(items).forEach(([id, ev]) => {
      if (ev.type !== "task") return;
      if (ev.dateKey && ev.dateKey !== dateKey) return;
      tasksUndone.push({ id, dateKey: dk, ...ev });
    });
  });

  if (!tasksUndone.length) {
    appendGihariLog("אין משימות להיום. תהנה מהזמן הפנוי שלך 🙌");
    return;
  }

  const urgencyScore = { today: 3, week: 2, month: 1, none: 0 };

  tasksUndone.sort((a, b) => {
    const ua = urgencyScore[a.urgency] || 0;
    const ub = urgencyScore[b.urgency] || 0;
    if (ua !== ub) return ub - ua;
    const da = a.duration || 30;
    const db = b.duration || 30;
    return db - da;
  });

  const top = tasksUndone[0];
  appendGihariLog(
    `מומלץ לעבוד עכשיו על "<strong>${top.title}</strong>" (דחיפות: ${
      top.urgency || "לא דחוף"
    }, משך משוער: ${top.duration || 30} דק').`
  );
}

function gihariPlaceUndatedTasks() {
  const undatedTasks = [];

  Object.entries(state.cache.events).forEach(([dateKey, items]) => {
    Object.entries(items).forEach(([id, ev]) => {
      if (ev.type !== "task") return;
      if (ev.dateKey && ev.dateKey !== "undated") return;
      undatedTasks.push({ id, dateKey, ...ev });
    });
  });

  if (!undatedTasks.length) {
    appendGihariLog("אין משימות ללא תאריך לשיבוץ. 😌");
    return;
  }

  const today = new Date();
  const maxDaysAhead = 14;

  undatedTasks.forEach((task) => {
    const daysToSearch =
      task.urgency === "today"
        ? 0
        : task.urgency === "week"
        ? 7
        : task.urgency === "month"
        ? 14
        : maxDaysAhead;

    let placed = false;
    for (let offset = 0; offset <= daysToSearch; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const { freeSlots } = computeLoadAndFreeSlots(d);
      const duration = task.duration || 30;

      const suitableSlot = freeSlots.find(
        ([start, end]) => end - start >= duration && start >= 8 * 60 && end <= 22 * 60
      );
      if (suitableSlot) {
        const startMinutes = suitableSlot[0];
        const startH = String(Math.floor(startMinutes / 60)).padStart(2, "0");
        const startM = String(startMinutes % 60).padStart(2, "0");
        const endMinutes = startMinutes + duration;
        const endH = String(Math.floor(endMinutes / 60)).padStart(2, "0");
        const endM = String(endMinutes % 60).padStart(2, "0");

        const dk = dateKeyFromDate(d);
        const refPath = ref(db, `events/${dk}`);
        const newRef = push(refPath);
        set(newRef, {
          ...task,
          dateKey: dk,
          startTime: `${startH}:${startM}`,
          endTime: `${endH}:${endM}`,
          _id: newRef.key
        });

        if (task.dateKey && task.dateKey !== "undated") {
          const oldRef = ref(db, `events/${task.dateKey}/${task.id}`);
          remove(oldRef);
        }

        appendGihariLog(
          `המשימה "<strong>${task.title}</strong>" שובצה ל־${d.toLocaleDateString(
            "he-IL"
          )} בשעה ${startH}:${startM}.`
        );

        placed = true;
        break;
      }
    }

    if (!placed) {
      appendGihariLog(
        `לא נמצא חלון זמן מתאים למשימה "<strong>${task.title}</strong>" בשבוע–שבועיים הקרובים.`
      );
    }
  });
}

function appendGihariLog(html) {
  const enhanced = wrapGihariHumor(html);
  const log = el("gihariLog");
  const msg = document.createElement("div");
  msg.className = "gihari-msg";
  msg.innerHTML = enhanced;
  log.appendChild(msg);

  // ג'יחרי מדבר – מקריא רק טקסט בלי אימוג'ים ובלי תגיות HTML
  let plain = enhanced.replace(/<[^>]+>/g, "");
  plain = plain.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  gihariSpeak(plain);
}

// לוג לפקודות של ג'יחרי – "שיזכור הכל"
function logGihariCommand(text) {
  try {
    const logRef = ref(db, "gihariLogs");
    const newRef = push(logRef);
    set(newRef, {
      text,
      ts: Date.now()
    });
  } catch (e) {
    console.warn("failed to log gihari command", e);
  }
}

let workFreeChart, tasksChart;

function updateStats() {
  const today = new Date();
  const { dailyLoadMinutes } = computeLoadAndFreeSlots(today);
  const workHours = dailyLoadMinutes / 60;
  const freeHours = Math.max(0, 14 - workHours);

  const ctx1 = el("workFreeChart").getContext("2d");
  if (!workFreeChart) {
    workFreeChart = new Chart(ctx1, {
      type: "doughnut",
      data: {
        labels: ["עבודה/משימות", "זמן פנוי"],
        datasets: [
          {
            data: [workHours, freeHours]
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            position: "bottom"
          }
        }
      }
    });
  } else {
    workFreeChart.data.datasets[0].data = [workHours, freeHours];
    workFreeChart.update();
  }

  const last30Days = [];
  const todayCopy = new Date(today);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayCopy);
    d.setDate(d.getDate() - i);
    const { dailyLoadMinutes: dlm } = computeLoadAndFreeSlots(d);
    last30Days.push({
      label: d.getDate(),
      loadHours: dlm / 60
    });
  }

  const ctx2 = el("tasksChart").getContext("2d");
  if (!tasksChart) {
    tasksChart = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: last30Days.map((d) => d.label),
        datasets: [
          {
            label: "עומס יומי (שעות)",
            data: last30Days.map((d) => d.loadHours)
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  } else {
    tasksChart.data.labels = last30Days.map((d) => d.label);
    tasksChart.data.datasets[0].data = last30Days.map((d) => d.loadHours);
    tasksChart.update();
  }
}

// --- עזרה לפענוח פקודות זמן פשוטות לג'יחרי ---
function parseCommandTargetDate(text) {
  const base = new Date();
  const d = new Date(base);

  if (text.includes("מחר")) {
    d.setDate(d.getDate() + 1);
  } else if (text.includes("בעוד שבוע")) {
    d.setDate(d.getDate() + 7);
  } else if (text.includes("בעוד יומיים")) {
    d.setDate(d.getDate() + 2);
  }
  // אם לא מצאנו – נשאר היום
  return d;
}

function parseCommandHour(text) {
  // בשעה 17 / בשעה 5
  const mNum = text.match(/בשעה\s*([0-9]{1,2})/);
  let h = null;
  if (mNum) {
    h = parseInt(mNum[1], 10);
  } else if (text.includes("חמש")) {
    h = 5;
  }
  if (h == null) return null;

  if ((text.includes("אחר הצהריים") || text.includes("בערב")) && h < 12) {
    h += 12;
  }
  return h;
}

function createEventFromGihari(text) {
  const targetDate = parseCommandTargetDate(text);
  const hour = parseCommandHour(text) ?? 17;
  const startH = String(hour).padStart(2, "0");
  const startM = "00";
  const endHour = Math.min(hour + 2, 23);
  const endH = String(endHour).padStart(2, "0");

  let title = "אירוע";
  let address = "";

  const addIdx = text.indexOf("תוסיף לי");
  if (addIdx >= 0) {
    let after = text.slice(addIdx + "תוסיף לי".length).trim();
    const beIdx = after.indexOf(" ב");
    if (beIdx >= 0) {
      title = after.slice(0, beIdx).trim();
      address = after.slice(beIdx + 1).trim();
    } else {
      title = after.trim();
    }
  }

  const dk = dateKeyFromDate(targetDate);
  const refPath = ref(db, `events/${dk}`);
  const newRef = push(refPath);
  set(newRef, {
    type: "event",
    owner: state.currentUser,
    title,
    description: "",
    dateKey: dk,
    startTime: `${startH}:${startM}`,
    endTime: `${endH}:${startM}`,
    duration: (endHour - hour) * 60,
    address,
    urgency: "none",
    recurring: "none",
    _id: newRef.key
  });

  appendGihariLog(
    `קבעתי לך אירוע "<strong>${title}</strong>" ב־${dk} בשעה ${startH}:${startM}.`
  );
}

function initApp() {
  initTheme();
  initBottomNav();
  initTasksFilters();
  initShopping();
  initFirebaseListeners();
  initGihari();

  el("btnPrevMonth").onclick = () => {
    state.currentDate.setMonth(state.currentDate.getMonth() - 1);
    renderCalendar();
  };
  el("btnNextMonth").onclick = () => {
    state.currentDate.setMonth(state.currentDate.getMonth() + 1);
    renderCalendar();
  };
  el("btnToday").onclick = () => {
    state.currentDate = new Date();
    renderCalendar();
  };
  el("btnFabAdd").onclick = () => openEditModal({});
  el("btnAddTask").onclick = () => openEditModal({});
  el("btnCity").onclick = () => {
    qs('[data-target="settingsSection"]').click();
  };
  el("btnSaveCity").onclick = saveCitySettings;
  el("btnToggleHoliday").onclick = toggleHolidayForToday;
  el("btnThemeToggle").onclick = toggleTheme;
  el("btnRequestNotifications").onclick = requestNotifications;
  el("btnOpenWaze").onclick = openWazeFromForm;

  el("editForm").addEventListener("submit", handleEditFormSubmit);

  renderCalendar();
  renderTasks();
  renderShoppingList();
}

document.addEventListener("DOMContentLoaded", initApp);

// --- Gihari advanced voice handler (override) ---
function handleGihariVoiceCommand(text) {
  if (!text) return;
  text = text.replace(/[.,]/g, " ").trim();

  logGihariCommand(text);

  // פתיחת אירוע/משימה בתאריך (רק פותח חלון עריכה)
  if (text.includes("תפתח") || text.includes("תיצור") || text.includes("תכניס")) {
    let targetDate = new Date(state.currentDate);
    if (text.includes("למחר")) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (text.includes("לשבוע הבא")) {
      targetDate.setDate(targetDate.getDate() + 7);
    } else {
      const m = text.match(/ל([0-9]{1,2})[\.\/-]([0-9]{1,2})[\.\/-]([0-9]{2,4})/);
      if (m) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
        targetDate = new Date(y, mo, d);
      }
    }
    const dk = dateKeyFromDate(targetDate);
    openEditModal({ dateKey: dk });
    appendGihariLog("פתחתי חלונית אירוע/משימה לתאריך " + dk);
    return;
  }

  // יצירת אירוע אמיתי – לדוגמה: "בעוד שבוע ביום שני בשעה חמש אחר הצהריים תוסיף לי הופעה של פאר טסי בקיסריה"
  if (text.includes("תוסיף לי")) {
    createEventFromGihari(text);
    return;
  }

  // "מתי יש לי זמן ..." עם משך מסוים
  if (text.includes("מתי יש לי זמן")) {
    let hours = 1;
    const hMatch = text.match(/([א-ת0-9]+)\s*שעה/);
    if (hMatch) {
      const word = hMatch[1];
      const map = { "חצי": 0.5, "שעה": 1, "שעתיים": 2, "שתיים": 2, "שלוש": 3, "ארבע": 4 };
      if (map[word] != null) hours = map[word];
      else if (!isNaN(parseFloat(word))) hours = parseFloat(word);
    }
    const duration = Math.round(hours * 60);
    const today = new Date();
    const suggestions = [];
    for (let offset = 0; offset <= 14; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const { freeSlots } = computeLoadAndFreeSlots(d);
      for (const [start, end] of freeSlots) {
        if (end - start >= duration && start >= 8 * 60 && end <= 23 * 60) {
          suggestions.push({ date: new Date(d), start });
          if (suggestions.length >= 3) break;
        }
      }
      if (suggestions.length >= 3) break;
    }
    if (!suggestions.length) {
      appendGihariLog("לא מצאתי חלונות זמן מתאימים בשבועיים הקרובים.");
      return;
    }
    let msg = "מצאתי אפשרויות זמן עבורך:\n";
    suggestions.forEach((opt, idx) => {
      const dk = dateKeyFromDate(opt.date);
      const h = String(Math.floor(opt.start / 60)).padStart(2, "0");
      const m = String(opt.start % 60).padStart(2, "0");
      msg += `${idx + 1}. ${dk} בשעה ${h}:${m}\n";
    });
    appendGihariLog(msg);
    return;
  }

  // "אני צריך להתאמן שלוש פעמים השבוע ... כל אימון שלוש שעות"
  if (text.includes("להתאמן") && text.includes("פעמים") && text.includes("שבוע")) {
    let times = 3;
    const timesMatch = text.match(/([א-ת0-9]+)\s*פעמים/);
    if (timesMatch) {
      const word = timesMatch[1];
      const map = { "פעמיים": 2, "שתיים": 2, "שלוש": 3, "ארבע": 4 };
      if (map[word] != null) times = map[word];
      else if (!isNaN(parseInt(word, 10))) times = parseInt(word, 10);
    }

    let hours = 1;
    const hMatch2 = text.match(/([א-ת0-9]+)\s*שעות?/);
    if (hMatch2) {
      const word = hMatch2[1];
      const map = { "חצי": 0.5, "שעה": 1, "שעתיים": 2, "שתיים": 2, "שלוש": 3 };
      if (map[word] != null) hours = map[word];
      else if (!isNaN(parseFloat(word))) hours = parseFloat(word);
    }
    const duration = Math.round(hours * 60);

    const today = new Date();
    let created = 0;
    outer: for (let offset = 0; offset <= 7; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const { freeSlots } = computeLoadAndFreeSlots(d);
      for (const [start, end] of freeSlots) {
        if (end - start >= duration && start >= 8 * 60 && end <= 23 * 60) {
          const dk = dateKeyFromDate(d);
          const refPath = ref(db, `events/${dk}`);
          const newRef = push(refPath);
          const startH = String(Math.floor(start / 60)).padStart(2, "0");
          const startM = String(start % 60).padStart(2, "0");
          const endMinutes = start + duration;
          const endH = String(Math.floor(endMinutes / 60)).padStart(2, "0");
          const endM = String(endMinutes % 60).padStart(2, "0");
          set(newRef, {
            type: "task",
            title: "אימון",
            owner: state.currentUser,
            dateKey: dk,
            startTime: `${startH}:${startM}`,
            endTime: `${endH}:${endM}`,
            duration,
            urgency: "week",
            _id: newRef.key
          });
          created++;
          if (created >= times) break outer;
        }
      }
    }
    if (created === 0) {
      appendGihariLog("לא הצלחתי למצוא זמן פנוי לאימונים השבוע.");
    } else {
      appendGihariLog(`קבעתי ${created} אימונים בשבוע הקרוב.`);
      loadMonthEvents();
    }
    return;
  }

  // ברירת מחדל – לא הבין
  appendGihariLog(
    "שמעתי מה אמרת, אבל לא לגמרי בטוח מה לעשות עם זה. נסה להגיד למשל: 'תוסיף לי משימה למחר בשמונה בבוקר'."
  );
}

// Stub – כדי שלא יהיה Error כשג'יחרי קורא לה
function loadMonthEvents() {
  renderCalendar();
}
