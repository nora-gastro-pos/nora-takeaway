import React, { useState, useMemo, useEffect } from "react";
import { X, Check } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { formatCurrency } from "@/lib/constants";
import StornoButton from "@/components/kitchen/StornoButton";
import { useUiLang } from "@/lib/UiLangContext";
import { ui } from "@/lib/uiI18n";
import KassaSplitPay from "@/components/kassa/KassaSplitPay";
import TipAndChange from "@/components/kassa/TipAndChange";
import DiscountSelector from "@/components/kassa/DiscountSelector";
import ItemStornoModal from "@/components/kassa/ItemStornoModal";
import TableActionModal from "@/components/kassa/TableActionModal";
import { ArrowRightLeft } from "lucide-react";

// Tisch-Grid für die Kassa: ersetzt die flache Listenansicht durch Kacheln
// (analog /tische). Klick auf eine belegte Kachel öffnet ein Modal mit den
// offenen Positionen dieses Tisches und einem "Tisch kassieren"-Button.
const STATUS = {
  frei: { label: "Frei", card: "border-emerald-300 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  belegt: { label: "Belegt", card: "border-orange-300 bg-orange-50 text-orange-800", dot: "bg-orange-500" },
  bezahlt: { label: "Reinigung", card: "border-blue-300 bg-blue-50 text-blue-800", dot: "bg-blue-500" },
};

// Zahlungswunsch aus dem Bestell-Hinweis ("Zahlung: <method>") extrahieren.
const PAYMENT_WISH = {
  karte: { label: "Karte", emoji: "💳" },
  vorort: { label: "Bar", emoji: "💵" },
  mobile: { label: "Mobile / kontaktlos", emoji: "📱" },
  ueberweisung: { label: "Überweisung", emoji: "🏦" },
};

const paymentWishOf = (order) => {
  if (order?.paid_online) return { label: "Digital bezahlt", emoji: "📱", isDigital: true };
  const m = (order?.customer_note || "").match(/Zahlung:\s*([^|]+)/);
  if (!m) return null;
  const cfg = PAYMENT_WISH[m[1].trim()];
  return cfg ? { label: cfg.label, emoji: cfg.emoji } : { label: m[1].trim(), emoji: "💳" };
};

export default function KassaTableGrid({ orders, tenant, onMarkPaid, onRequestStorno, onPayPartial, onPayTable, onStornoItem, onTransferTable, onMergeTables }) {
  const { lang } = useUiLang();
  const [selectedTable, setSelectedTable] = useState(null);
  const [payMode, setPayMode] = useState("gesamt");
  const [tipAmount, setTipAmount] = useState(0);
  const [givenAmount, setGivenAmount] = useState(0);
  const [discount, setDiscount] = useState(null);
  const [payMethod, setPayMethod] = useState("Bar");
  const [showTableAction, setShowTableAction] = useState(false);
  const [showItemStorno, setShowItemStorno] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tisch-Anzahl: konfiguriert oder Fallback aus höchster Tischnummer der
  // aktiven Bestellungen, damit das Grid immer rendert — auch wenn der Betrieb
  // noch keine total_tables konfiguriert hat.
  const totalTables = useMemo(() => {
    const configured = tenant?.reservation_config?.total_tables || 0;
    if (configured > 0) return configured;
    const maxFromOrders = orders.reduce((m, o) => Math.max(m, o.table_number || 0), 0);
    return maxFromOrders > 0 ? maxFromOrders : 0;
  }, [tenant, orders]);
  const delayMs = (tenant?.table_release_delay_minutes ?? 5) * 60000;

  // Alle unbezahlten Bestellungen pro Tisch
  const unpaidByTable = useMemo(() => {
    const map = {};
    orders.filter((o) => !o.paid && !o.paid_online && o.table_number).forEach((o) => {
      if (!map[o.table_number]) map[o.table_number] = [];
      map[o.table_number].push(o);
    });
    return map;
  }, [orders]);

  // Alle Bestellungen pro Tisch für die Modal-Anzeige — inklusive
  // online-bezahlter (paid_online), die im Modal grün/ausgegraut als
  // "am Handy bezahlt" markiert werden. Für den Tisch-Status (belegt/frei)
  // bleibt unpaidByTable maßgeblich (ohne paid_online).
  const displayByTable = useMemo(() => {
    const map = {};
    orders.filter((o) => o.table_number && !o.paid).forEach((o) => {
      if (!map[o.table_number]) map[o.table_number] = [];
      map[o.table_number].push(o);
    });
    return map;
  }, [orders]);

  // Zuletzt bezahlte Bestellung pro Tisch → Reinigungs-Countdown
  const paidByTable = useMemo(() => {
    const map = {};
    orders.filter((o) => o.paid && o.paid_at && o.table_number).forEach((o) => {
      const ms = new Date(o.paid_at).getTime();
      if (!isNaN(ms) && (!map[o.table_number] || ms > map[o.table_number])) map[o.table_number] = ms;
    });
    return map;
  }, [orders]);

  const isCleaning = (n) => delayMs > 0 && paidByTable[n] && now - paidByTable[n] < delayMs;

  const tenantId = tenant?.id;
  const [serviceCalls, setServiceCalls] = useState([]);

 useEffect(() => {
    if (!tenantId) return;

    supabase
      .from('service_calls')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'offen')
      .then(({ data }) => setServiceCalls(data || []))
      .catch(() => {});

    const channel = supabase
      .channel('service-calls-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_calls', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            if (payload.new.status === 'offen') {
              setServiceCalls((prev) => [payload.new, ...prev]);
            }
          } else if (payload.eventType === 'UPDATE') {
            setServiceCalls((prev) =>
              payload.new.status === 'erledigt'
                ? prev.filter((c) => c.id !== payload.new.id)
                : prev.map((c) => (c.id === payload.new.id ? payload.new : c))
            );
          } else if (payload.eventType === 'DELETE') {
            setServiceCalls((prev) => prev.filter((c) => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const callsByTable = useMemo(() => {
    const map = {};
    serviceCalls.forEach((c) => { if (c.table_number) map[c.table_number] = c; });
    return map;
  }, [serviceCalls]);

const resolveCall = async (call) => {
    setServiceCalls((prev) => prev.filter((c) => c.id !== call.id));
    await supabase
      .from('service_calls')
      .update({
        status: "erledigt",
        resolved_at: new Date().toISOString(),
      })
      .eq('id', call.id);
  };

  const tables = useMemo(() => {
    const list = [];
    for (let n = 1; n <= totalTables; n++) {
      let status = "frei";
      let openAmount = 0;
      if (unpaidByTable[n]) {
        status = "belegt";
        openAmount = unpaidByTable[n].reduce((s, o) => s + (o.total_amount || 0), 0);
      } else if (isCleaning(n)) {
        status = "bezahlt";
      }
      list.push({ n, status, openAmount });
    }
    return list;
  }, [totalTables, unpaidByTable, paidByTable, now, delayMs]);

  // Split-Payment: Gruppiere die Bestellungen eines Tisches nach Gast-Namen.
  // Die Gast-Zuordnung kommt aus items[].customer_name (bei getrennter Rechnung
  // im Checkout gesetzt) oder fällt auf order.customer_name zurück. Jeder Gast
  // kann separat kassiert werden — der Kellner sieht pro Gast die Artikel und
  // die Summe und klickt "Gast kassieren", um genau diese Bestellung als bezahlt
  // zu markieren.
  const guestNameOf = (o) => {
    const fromItems = (o.items || []).map((i) => i.customer_name).find(Boolean);
    return fromItems || o.customer_name || "";
  };
  const selectedOrders = selectedTable ? (displayByTable[selectedTable] || []) : [];
  const openOrders = selectedOrders.filter((o) => !o.paid_online);
  const guestGroups = useMemo(() => {
    const map = {};
    openOrders.forEach((o) => {
      const name = guestNameOf(o);
      if (!map[name]) map[name] = { name, orders: [], total: 0, ready: true };
      map[name].orders.push(o);
      map[name].total += o.total_amount || 0;
      const isReady = o.status === "bereit" || o.status === "wartet_auf_zahlung" || o.status === "completed" || o.area_status?.kueche === "erledigt" || o.area_status?.bar === "erledigt";
      if (!isReady) map[name].ready = false;
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedOrders]);
  const hasMultipleGuests = guestGroups.length > 1;

  // Auto-Close: Sobald alle offenen Bestellungen eines Tisches bezahlt sind
  // (egal ob am Handy, bar oder per Karte), schließt sich das Modal automatisch
  // und der Tisch wechselt auf FREI.
  useEffect(() => {
    if (selectedTable === null) return;
    const remaining = unpaidByTable[selectedTable];
    if (!remaining || remaining.length === 0) {
      setSelectedTable(null);
      setPayMode("gesamt");
    }
  }, [selectedTable, unpaidByTable]);

  if (totalTables <= 0) return null;

  const selectedTotal = openOrders.reduce((s, o) => s + (o.total_amount || 0), 0);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {tables.map((t) => {
          const s = STATUS[t.status];
          const call = callsByTable[t.n];
          return (
            <button
              key={t.n}
              onClick={() => t.status === "belegt" && setSelectedTable(t.n)}
              disabled={t.status !== "belegt"}
              className={`rounded-2xl border-2 p-3 text-left transition ${s.card} ${call ? "ring-2 ring-amber-400 ring-offset-1" : ""} ${t.status === "belegt" ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold">Tisch {t.n}</span>
                <div className="flex items-center gap-1.5">
                  {call && (
                    <span className="text-base leading-none" title={call.call_type === "payment" ? "Zahlung gewünscht" : "Kellner gerufen"}>
                      {call.call_type === "payment" ? "💳" : "🔔"}
                    </span>
                  )}
                  <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                </div>
              </div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-80">{s.label}</div>
              {t.status === "belegt" && (
                <div className="mt-1 font-display text-base font-bold">{formatCurrency(t.openAmount)}</div>
              )}
              {t.status === "bezahlt" && (
                <div className="mt-1 text-xs">
                  Frei in {Math.max(0, Math.ceil((delayMs - (now - paidByTable[t.n])) / 60000))} Min.
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedTable(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-stone-900">Tisch {selectedTable} kassieren</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowTableAction(true)} className="flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                  <ArrowRightLeft className="h-3.5 w-3.5" /> {ui(lang, "kassaTableActions")}
                </button>
                <button onClick={() => setSelectedTable(null)} className="rounded-full p-1 text-stone-400 hover:bg-stone-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {(() => {
              const call = callsByTable[selectedTable];
              const wishes = selectedOrders.map(paymentWishOf).filter(Boolean);
              const wish = wishes.find((w) => w.isDigital) || wishes[0] || null;
              return (
                <>
                  {wish && (
                    <div className={`mb-3 flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 ${wish.isDigital ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-300 bg-stone-50 text-stone-800"}`}>
                      <span className="text-lg">{wish.emoji}</span>
                      <span className="text-sm font-bold">{wish.isDigital ? "Digital bezahlt" : `Zahlungswunsch: ${wish.label}`}</span>
                    </div>
                  )}
                  {call && (
                    <div className={`mb-3 flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 ${call.call_type === "payment" ? "border-emerald-400 bg-emerald-50 text-emerald-900" : "border-amber-400 bg-amber-50 text-amber-900"}`}>
                      <span className="text-lg">{call.call_type === "payment" ? "💳" : "🔔"}</span>
                      <span className="flex-1 text-sm font-bold">{call.call_type === "payment" ? "Bitte zahlen angefordert" : "Kellner am Tisch angefordert"}</span>
                      <button onClick={() => resolveCall(call)} className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-stone-700">
                        <Check className="h-3.5 w-3.5" /> Ruf quittieren
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Tabs: Gesamt zahlen vs. Positionen einzeln / getrennt */}
            <div className="mb-4 flex w-fit gap-1 rounded-full bg-stone-100 p-1">
              <button
                onClick={() => setPayMode("gesamt")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  payMode === "gesamt" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {ui(lang, "kassaTabGesamt")}
              </button>
              <button
                onClick={() => setPayMode("positionen")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  payMode === "positionen" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {ui(lang, "kassaTabPositionen")}
              </button>
            </div>

            {payMode === "positionen" ? (
              <KassaSplitPay
                selectedOrders={selectedOrders}
                onPayPartial={onPayPartial}
                onStornoItem={(order, itemIndex, itemName, itemPrice, quantity) => {
                  setShowItemStorno({ order, itemIndex, itemName, itemPrice, quantity });
                }}
                lang={lang}
              />
            ) : openOrders.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">Keine offenen Positionen.</p>
            ) : hasMultipleGuests ? (
              <>
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-stone-400">{ui(lang, "kassaGuestsOnTable")}</p>
                <div className="space-y-3">
                  {guestGroups.map((g) => (
                    <div key={g.name} className="rounded-xl border border-stone-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-stone-800">{g.name || ui(lang, "kassaNoGuestName")}</span>
                        <span className="font-display font-bold text-stone-900">{formatCurrency(g.total)}</span>
                      </div>
                      <div className="space-y-1">
                        {g.orders.flatMap((o) => (o.items || []).map((it, i) => (
                          <p key={`${o.id}-${i}`} className="text-xs text-stone-500">
                            {it.quantity}× {it.name}{it.customer_name && it.customer_name !== g.name ? ` (${it.customer_name})` : ""}
                          </p>
                        )))}
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        {g.orders.map((o) => (
                          <StornoButton key={`st-${o.id}`} order={o} amount={o.total_amount} onStorno={(reason) => onRequestStorno(o, reason)} />
                        ))}
                        {g.ready ? (
                          <button
                            onClick={() => { g.orders.forEach(onMarkPaid); }}
                            className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            <Check className="h-3.5 w-3.5" /> {ui(lang, "kassaGuestPayBtn")}
                          </button>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">In Zubereitung</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-stone-100 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-600">Gesamt offen</span>
                    <span className="font-display text-lg font-bold text-stone-900">{formatCurrency(selectedTotal)}</span>
                  </div>
                  <button
                    onClick={() => { guestGroups.filter((g) => g.ready).flatMap((g) => g.orders).forEach((o) => onMarkPaid(o)); setSelectedTable(null); }}
                    className="w-full rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    {ui(lang, "kassaAllGuestsPaid")} ({formatCurrency(selectedTotal)})
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  {openOrders.map((o) => (
                    <div key={o.id} className="rounded-xl border border-stone-200 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-500">Bestellung {o.order_number ?? ""}</span>
                        {o.status !== "bereit" && o.status !== "wartet_auf_zahlung" && o.status !== "completed" && !(o.area_status?.kueche === "erledigt" || o.area_status?.bar === "erledigt") && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">In Zubereitung</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        {(o.items || []).map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-display font-bold text-stone-900">{formatCurrency(o.total_amount)}</span>
                        <div className="flex items-center gap-2">
                          <StornoButton order={o} amount={o.total_amount} onStorno={(reason) => onRequestStorno(o, reason)} />
                          <button
                            onClick={() => onMarkPaid(o)}
                            className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            <Check className="h-3.5 w-3.5" /> Bezahlt
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
                  <DiscountSelector total={selectedTotal} discount={discount} setDiscount={setDiscount} lang={lang} />
                  <div className="flex w-fit gap-1 rounded-full bg-stone-100 p-1">
                    <button onClick={() => setPayMethod("Bar")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${payMethod === "Bar" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>💵 Bar</button>
                    <button onClick={() => setPayMethod("Karte")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${payMethod === "Karte" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>💳 Karte</button>
                  </div>
                  <TipAndChange total={selectedTotal - (discount?.type === "prozent" ? Math.round(selectedTotal * (discount.value || 0)) / 100 : discount?.type === "festbetrag" ? Math.min(discount.value || 0, selectedTotal) : 0)} tipAmount={tipAmount} setTipAmount={setTipAmount} givenAmount={givenAmount} setGivenAmount={setGivenAmount} payMethod={payMethod} lang={lang} />
                  {(() => {
                    const discAmt = discount?.type === "prozent" ? Math.round(selectedTotal * (discount.value || 0)) / 100 : discount?.type === "festbetrag" ? Math.min(discount.value || 0, selectedTotal) : 0;
                    const finalTotal = Math.max(0, selectedTotal - discAmt) + (tipAmount || 0);
                    return (
                      <>
                        <div className="flex items-center justify-between border-t border-stone-100 pt-2">
                          <span className="text-sm font-medium text-stone-600">Gesamt</span>
                          <span className="font-display text-lg font-bold text-stone-900">{formatCurrency(finalTotal)}</span>
                        </div>
                        <button onClick={() => { onPayTable(openOrders, tipAmount, discount, payMethod, givenAmount); setSelectedTable(null); setTipAmount(0); setGivenAmount(0); setDiscount(null); }} className="w-full rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                          {payMethod === "Bar" ? ui(lang, "kassaPayCashTotal") : ui(lang, "kassaPayCardTotal")} · {formatCurrency(finalTotal)}
                        </button>
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showTableAction && (
        <TableActionModal
          currentTable={selectedTable}
          totalTables={totalTables}
          occupiedTables={tables.filter((t) => t.status === "belegt" && t.n !== selectedTable).map((t) => t.n)}
          onClose={() => setShowTableAction(false)}
          onTransfer={async (target) => { await onTransferTable(selectedTable, target); setSelectedTable(null); }}
          onMerge={async (source) => { await onMergeTables(source, selectedTable); }}
          lang={lang}
        />
      )}
      {showItemStorno && (
        <ItemStornoModal
          itemName={showItemStorno.itemName}
          itemPrice={showItemStorno.itemPrice}
          quantity={showItemStorno.quantity}
          onClose={() => setShowItemStorno(null)}
          onStorno={async (reason) => { await onStornoItem(showItemStorno.order, showItemStorno.itemIndex, reason); }}
          lang={lang}
        />
      )}
    </>
  );
}