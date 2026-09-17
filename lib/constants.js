// Gemeinsame Hilfsfunktionen und Defaults für Speisekarte, Kassa und Küche.

export const DEFAULT_PREP_MINUTES = 15;

const FOOD_COLUMN = "Speise";
const DRINK_COLUMN = "Getränk";

const DEFAULT_FEATURES = {
  welcome_popup: false,
  daily_tip: false,
  upsell: false,
  getraenke_empfehlung: false,
  mitarbeiter_login: false,
  prepayment: false,
  wait_gesture: false,
};

const STRESS_INFO = {
  ruhig: { level: "ruhig", dotColor: "#22c55e" },
  normal: { level: "normal", dotColor: "#eab308" },
  hoch: { level: "hoch", dotColor: "#f97316" },
  voll: { level: "voll", dotColor: "#ef4444" },
};

const STRESS_MULTIPLIER = {
  ruhig: 0.85,
  normal: 1,
  hoch: 1.25,
  voll: 1.5,
};

const toMinutes = (t) => {
  if (!t && t !== 0) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0);
};

const clockMinutes = (date = new Date()) => date.getHours() * 60 + date.getMinutes();

const isDrinkItem = (item) =>
  !!item && (item.category === DRINK_COLUMN || !!item.drink_category);

export const formatCurrency = (value) => {
  const n = Number(value);
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(n) ? n : 0
  );
};

export const todayString = (date = new Date()) => {
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const isTakeawayType = (type) =>
  type === "takeaway" || type === "takeaway_seating";

export const isRestaurantType = (type) =>
  type === "restaurant" || type === "gastro" || type === "bar" || type === "cafe";

export const usesTables = (type) => type !== "takeaway";

export const effectiveFeatures = (tenant) => ({
  ...DEFAULT_FEATURES,
  ...(tenant?.features || {}),
});

export const effectiveTenantId = (user, urlTenantId) =>
  urlTenantId || user?.tenant_id || user?.data?.tenant_id || null;

export const setPaymentMethodInNote = (note, method) => {
  const n = note || "";
  if (/Zahlung:\s*/i.test(n)) return n.replace(/Zahlung:\s*[^|]*/i, `Zahlung: ${method}`.trimEnd());
  return n ? `${n} | Zahlung: ${method}` : `Zahlung: ${method}`;
};

export const getDayWindows = (hoursData, day) => {
  if (!hoursData) return [];
  const key = String(day);
  const names = ["so", "mo", "di", "mi", "do", "fr", "sa"];
  const alt = names[Number(day)];
  let raw =
    hoursData[key] ??
    hoursData[day] ??
    (alt ? hoursData[alt] ?? hoursData[alt.toUpperCase()] ?? hoursData[alt[0].toUpperCase() + alt.slice(1)] : null);

  if (raw == null && Array.isArray(hoursData)) {
    raw = hoursData.filter((w) => String(w.day ?? w.weekday) === key);
  }

  const asWindow = (w) => {
    if (!w || typeof w !== "object") return null;
    if (w.geschlossen || w.closed) return null;
    const von = w.von || w.from || w.open || w.start;
    const bis = w.bis || w.to || w.close || w.end;
    if (!von || !bis) return null;
    return { von, bis };
  };

  if (Array.isArray(raw)) return raw.map(asWindow).filter(Boolean);
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.windows)) return raw.windows.map(asWindow).filter(Boolean);
    const one = asWindow(raw);
    return one ? [one] : [];
  }
  return [];
};

export const generateTimeSlots = (von, bis, stepMinutes = 15) => {
  const start = toMinutes(von);
  const end = toMinutes(bis);
  if (start == null || end == null || stepMinutes <= 0) return [];
  const slots = [];
  for (let t = start; t <= end; t += stepMinutes) {
    slots.push(
      `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
    );
  }
  return slots;
};

export const isOpenNow = (hoursData, now = new Date()) => {
  const windows = getDayWindows(hoursData, now.getDay());
  if (!windows.length) return false;
  const mins = clockMinutes(now);
  return windows.some((w) => {
    const a = toMinutes(w.von);
    const b = toMinutes(w.bis);
    return a != null && b != null && mins >= a && mins < b;
  });
};

export const isInKitchenBreak = (hoursData, now = new Date()) => {
  const windows = getDayWindows(hoursData, now.getDay());
  if (windows.length < 2) return false;
  const mins = clockMinutes(now);
  const sorted = [...windows].sort((a, b) => toMinutes(a.von) - toMinutes(b.von));
  for (let i = 0; i < sorted.length - 1; i++) {
    const end = toMinutes(sorted[i].bis);
    const next = toMinutes(sorted[i + 1].von);
    if (end != null && next != null && mins >= end && mins < next) return true;
  }
  return false;
};

export const stationOpenStatus = (station, tenant, now = new Date()) => {
  const hours =
    station?.hours_data ||
    station?.opening_hours ||
    (station?.category === "bar" || station?.type === "bar" ? tenant?.bar_hours_data : tenant?.kitchen_hours_data);
  if (!hours) return { open: true };
  return { open: isOpenNow(hours, now) };
};

export const roundUpToInterval = (minutes, interval = 10) => {
  const n = Number(minutes);
  const step = Number(interval) > 0 ? Number(interval) : 10;
  if (!Number.isFinite(n) || n <= 0) return step;
  return Math.ceil(n / step) * step;
};

export const stressStatusInfo = (level) => STRESS_INFO[level] || STRESS_INFO.normal;

export const stressLevelFromWaitMinutes = (minutes) => {
  const n = Number(minutes) || 0;
  if (n < 12) return "ruhig";
  if (n < 25) return "normal";
  if (n < 40) return "hoch";
  return "voll";
};

export const menuItemByNameMap = (items = []) => {
  const map = {};
  items.forEach((it) => {
    if (it?.name) map[it.name] = it;
  });
  return map;
};

export const stationWaitingPrepMinutes = (
  orders,
  menuByName,
  stationId,
  allStationIds,
  defaultPrep = DEFAULT_PREP_MINUTES
) => {
  const waiting = new Set(["neu", "wartet_auf_zahlung", "in_zubereitung"]);
  const fallback = defaultPrep ?? DEFAULT_PREP_MINUTES;
  let sum = 0;
  (orders || []).forEach((o) => {
    if (!waiting.has(o?.status) || o?.storno_requested) return;
    (o.items || []).forEach((it) => {
      if (stationId && it.station_id && it.station_id !== stationId) return;
      if (stationId && !it.station_id && allStationIds?.length) return;
      const mi = menuByName?.[it.name];
      const prep = mi?.prep_time != null ? mi.prep_time : fallback;
      sum += Number(prep) * (it.quantity || 1);
    });
  });
  return sum;
};

export const estimateWaitMinutes = (
  waitingPrepSum,
  kitchenCapacity,
  cartPrepMinutes = 0,
  stressLevel = "normal"
) => {
  const load = (Number(waitingPrepSum) || 0) + (Number(cartPrepMinutes) || 0);
  const capacity = Number(kitchenCapacity) > 0 ? Number(kitchenCapacity) : 4;
  const raw = load / capacity;
  const factor = STRESS_MULTIPLIER[stressLevel] ?? 1;
  return Math.max(0, Math.round(raw * factor));
};

export const computeHappyHour = (item, tenant, now = new Date()) => {
  const cfg = tenant?.happy_hour_config || tenant?.happy_hour;
  if (!item || !cfg || cfg.enabled === false) return { active: false };
  const days = cfg.days || cfg.weekdays;
  if (Array.isArray(days) && days.length && !days.map(String).includes(String(now.getDay()))) {
    return { active: false };
  }
  const windows = cfg.hours_data
    ? getDayWindows(cfg.hours_data, now.getDay())
    : [{ von: cfg.start || cfg.von, bis: cfg.end || cfg.bis }];
  const mins = clockMinutes(now);
  const inWindow = windows.some((w) => {
    const a = toMinutes(w?.von);
    const b = toMinutes(w?.bis);
    return a != null && b != null && mins >= a && mins < b;
  });
  if (!inWindow) return { active: false };
  const cats = cfg.categories || cfg.category_names;
  if (Array.isArray(cats) && cats.length) {
    const cat = item.drink_category || item.category;
    if (!cats.includes(cat) && !cats.includes(item.category)) return { active: false };
  }
  const percent = Number(cfg.discount_percent ?? cfg.rabatt ?? 0);
  const price = Number(item.price) || 0;
  return {
    active: true,
    originalPrice: price,
    discountedPrice: Math.round(price * (1 - percent / 100) * 100) / 100,
    percent,
  };
};

export const drinkSizeLabel = (item, tenant) => {
  if (!item) return "";
  if (item.size_label) return item.size_label;
  if (item.size) return String(item.size);
  if (item.volume) return String(item.volume);
  const map = tenant?.drink_size_labels || tenant?.drink_sizes || {};
  return map[item.drink_category] || map[item.category] || "";
};

export const categoryOrderHours = (cat) => {
  if (!cat) return null;
  const h = cat.order_hours || cat.hours || cat.opening_hours || cat.hours_data;
  if (!h) return null;
  if (typeof h === "object" && !Array.isArray(h) && Object.keys(h).length === 0) return null;
  return h;
};

export const categoryOpenNow = (cat, tenant, now = new Date()) => {
  const hours = categoryOrderHours(cat);
  if (hours) return isOpenNow(hours, now);
  if (tenant?.opening_hours_data) return isOpenNow(tenant.opening_hours_data, now);
  return true;
};

export const normalizeCategories = (tenant, items = []) => {
  const raw = tenant?.categories || tenant?.menu_categories || [];
  const list = (Array.isArray(raw) ? raw : []).map((c) =>
    typeof c === "string" ? { name: c } : { ...c, name: c.name || c.key }
  );
  const byName = Object.fromEntries(list.filter((c) => c.name).map((c) => [c.name, c]));
  (items || []).forEach((it) => {
    const drink = isDrinkItem(it);
    const name = drink ? it.drink_category || "alkoholfrei" : it.category;
    if (!name || byName[name]) return;
    const cat = { name, column: drink ? DRINK_COLUMN : FOOD_COLUMN };
    byName[name] = cat;
    list.push(cat);
  });
  return list.filter((c) => c.name);
};

export const itemMatchesCategory = (item, key) => {
  if (!item || !key) return false;
  if (isDrinkItem(item)) {
    const drinkKey = item.drink_category || "alkoholfrei";
    return key === drinkKey || (key === DRINK_COLUMN && !item.drink_category);
  }
  return item.category === key;
};

export const orderedSections = (tenant, items = [], lang = "de") => {
  const seen = new Set();
  const sections = [];

  normalizeCategories(tenant, items).forEach((c) => {
    const key = c.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const drink = c.column === DRINK_COLUMN || c.column === "drinks" || c.is_drink;
    sections.push({
      key,
      label: (c.labels && (c.labels[lang] || c.labels.de)) || c.label || key,
      column: drink ? DRINK_COLUMN : c.column || FOOD_COLUMN,
      sort_order: c.sort_order ?? sections.length,
    });
  });

  (items || []).forEach((it) => {
    const drink = isDrinkItem(it);
    const key = drink ? it.drink_category || "alkoholfrei" : it.category;
    if (!key || seen.has(key)) return;
    seen.add(key);
    sections.push({
      key,
      label: key,
      column: drink ? DRINK_COLUMN : FOOD_COLUMN,
      sort_order: 1000 + sections.length,
    });
  });

  return sections.sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label).localeCompare(String(b.label), "de")
  );
};
