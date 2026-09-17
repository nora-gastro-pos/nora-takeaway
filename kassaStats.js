// Einheitliche Filter- und Berechnungslogik für die Kassa-Seite.
// Wird sowohl vom Tagesabschluss (StationDaySummary) als auch vom
// Bons-Archiv (PaidReceiptsArchive) verwendet, damit beide Ansichten
// exakt dieselben Datenbank-Einträge auswerten.

// created_date/paid_at kommen ohne Zeitzonen-Info vom Server (UTC).
// Ohne Kennung würde der Browser den Wert als Ortszeit fehlinterpretieren.
const parseDate = (iso) => {
  if (!iso) return null;
  const s = String(iso);
  if (/[zZ]$/.test(s) || /[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  return new Date(s + "Z");
};

const localDayStr = (iso) => {
  const d = parseDate(iso);
  if (!d || isNaN(d)) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
};

// Einheitliche "bezahlt"-Definition:
// paid === true ODER paid_online === true ODER status === 'completed'
export const isPaidOrder = (o) =>
  o?.paid === true || o?.paid_online === true || o?.status === "completed";

// Einheitlicher Ausschluss: Stornos und Entwürfe
export const isExcludedOrder = (o) =>
  o?.status === "draft" || o?.storno_requested === true;

// Datumsschlüssel für bezahlte Bestellungen: paid_at || updated_date || created_date
export const orderDayKey = (o) =>
  localDayStr(o?.paid_at || o?.updated_date || o?.created_date);

// Heutiger Tagesschlüssel
export const todayKey = () => localDayStr(new Date().toISOString());

// Einheitliche Liste: bezahlte, nicht ausgeschlossene Bestellungen eines Tages
export const getPaidOrdersOfDay = (orders, dateStr) =>
  orders.filter(
    (o) => isPaidOrder(o) && !isExcludedOrder(o) && orderDayKey(o) === dateStr
  );

// Einheitliche Summe über total_amount (übereinstimmend mit Bons-Archiv)
export const sumOrderTotals = (orders) =>
  orders.reduce((s, o) => s + (o.total_amount || 0), 0);

// Einheitliche Zahlungsart-Erkennung
export const paymentMethodOf = (o) => {
  if (o?.paid_online) return "Digital";
  const m = (o?.customer_note || "").match(/Zahlung:\s*([^|]+)/);
  return m ? m[1].trim() : "Bar";
};

// Trinkgeld-Summe über alle bezahlten Tages-Bestellungen
export const sumOrderTips = (orders) =>
  orders.reduce((s, o) => s + (o.tip_amount || 0), 0);

// MwSt-Aufschlüsselung (Österreich/Deutschland Standard: 10% Speisen / 20% Getränke)
export const calculateTaxBreakdown = (orders) => {
  let net10 = 0;
  let vat10 = 0;
  let net20 = 0;
  let vat20 = 0;

  orders.forEach((o) => {
    const items = o.items || [];
    items.forEach((item) => {
      const price = (item.price || 0) * (item.quantity || 1);
      const taxRate = item.tax_rate || 20; // Default 20%
      if (taxRate === 10) {
        const net = price / 1.1;
        net10 += net;
        vat10 += price - net;
      } else {
        const net = price / 1.2;
        net20 += net;
        vat20 += price - net;
      }
    });
  });

  return {
    net10: Math.round(net10 * 100) / 100,
    vat10: Math.round(vat10 * 100) / 100,
    net20: Math.round(net20 * 100) / 100,
    vat20: Math.round(vat20 * 100) / 100,
  };
};

// Vollständige Z-Bon Zusammenfassung
export const generateZBonStats = (orders, dateStr) => {
  const dayOrders = getPaidOrdersOfDay(orders, dateStr);
  const totalGross = sumOrderTotals(dayOrders);
  const totalTips = sumOrderTips(dayOrders);
  
  const cash = dayOrders
    .filter((o) => paymentMethodOf(o) === "Bar")
    .reduce((s, o) => s + (o.total_amount || 0), 0);
    
  const card = dayOrders
    .filter((o) => paymentMethodOf(o) === "Karte")
    .reduce((s, o) => s + (o.total_amount || 0), 0);

  const digital = dayOrders
    .filter((o) => paymentMethodOf(o) === "Digital")
    .reduce((s, o) => s + (o.total_amount || 0), 0);

  const taxes = calculateTaxBreakdown(dayOrders);

  return {
    date: dateStr,
    orderCount: dayOrders.length,
    totalGross: Math.round(totalGross * 100) / 100,
    totalTips: Math.round(totalTips * 100) / 100,
    cash: Math.round(cash * 100) / 100,
    card: Math.round(card * 100) / 100,
    digital: Math.round(digital * 100) / 100,
    taxes,
  };
};