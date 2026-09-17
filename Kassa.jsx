import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { effectiveTenantId, formatCurrency, setPaymentMethodInNote } from "@/lib/constants";
import { useAuth } from "@/lib/AuthContext";
import { Check } from "lucide-react";
import StationDaySummary from "@/components/kitchen/StationDaySummary";
import BackToOverview from "@/components/dashboard/BackToOverview";
import StornoButton from "@/components/kitchen/StornoButton";
import KassaTableGrid from "@/components/kassa/KassaTableGrid";
import PaidReceiptsArchive from "@/components/kassa/PaidReceiptsArchive";
import { useUiLang } from "@/lib/UiLangContext";
import { ui } from "@/lib/uiI18n";

// Kassa pro Verkaufspunkt. Bei Take-Away (ohne Bar-Station) ist die Küche der
// einzige Verkaufspunkt und behält ihre eigene Kassa. Bei Betrieben mit
// aktiver Bar-Station läuft die GESAMTE Kassa-Abwicklung (Speisen UND
// Getränke) über diese eine Bar-Kassa – der Koch kassiert nicht selbst.
// Oben steht jeweils ein kombinierter Tagesabschluss über alle Bestellungen
// (Speisen + Getränke), nicht pro Station getrennt.
export default function Kassa({ category = "kueche" }) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const urlTenantId = searchParams.get("betrieb");
  const [resolvedTenantId, setResolvedTenantId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("offen");
  const { lang } = useUiLang();

  // Admin ohne ?betrieb=-Parameter: automatisch einen Betrieb vorwählen,
  // damit das Tisch-Grid statt der flachen Fallback-Liste erscheint.
  // Reihenfolge: user.data.tenant_id → erster vom Admin erstellter Tenant.
  useEffect(() => {
    const base = effectiveTenantId(user, urlTenantId);
    if (base) { setResolvedTenantId(base); return; }
    if (user?.data?.tenant_id) { setResolvedTenantId(user.data.tenant_id); return; }
    let cancelled = false;
   supabase.from('tenants').select('*').order('created_at', { ascending: false }).limit(20).then(({ data: list }) => { 
      if (cancelled || !list || !list.length) return;
      // Bevorzugt einen Betrieb mit konfigurierten Tischen (für das Grid),
      // sonst den neuesten Betrieb als Fallback.
      const withTables = list.find((t) => (t.reservation_config?.total_tables || 0) > 0);
      setResolvedTenantId((withTables || list[0]).id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user, urlTenantId]);

  const tenantId = resolvedTenantId;

  useEffect(() => {
    if (tenantId) {supabase.from('tenants').select('*').eq('id', tenantId).single().then(({ data }) => data && setTenant(data)).catch(() => {});
      supabase.from('tables').select('*').eq('tenant_id', tenantId).then(({ data }) => data && setStations(data)).catch(() => {});    }
    if (!tenantId) { setLoading(false); return; }
    supabase.from('orders').select('*, order_items(*)').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200).then(({ data }) => setOrders(data || []));
      setLoading(false);
    });
    const channel = supabase
  .channel('orders-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
    if (payload.eventType === 'INSERT') setOrders((prev) => [payload.new, ...prev]);
    else if (payload.eventType === 'UPDATE') setOrders((prev) => prev.map((o) => (o.id === payload.new.id ? payload.new : o)));
    else if (payload.eventType === 'DELETE') setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
  })
  .subscribe();

return () => { supabase.removeChannel(channel); };
  }, [tenantId, category]);

  const markPaid = async (order) => {
    await supabase
  .from('orders')
  .update({ 
    paid: true, 
    paid_at: new Date().toISOString(), 
    status: 'completed' 
  })
  .eq('id', order.id);
  };

  // Positionsgenau abkassieren: Splittet eine Bestellung in bezahlte und
  // verbleibende Positionen. Sind alle Artikel ausgewählt, wird die gesamte
  // Bestellung als bezahlt markiert. Bei Teil-Auswahl wird ein neuer bezahlter
  // Teil-Bon (Order) mit den gewählten Positionen erzeugt und die Ursprungs-
  // Bestellung auf die verbleibenden Artikel reduziert — so entstehen
  // separate Teil-Bons für jeden Gast und die offene Tisch-Liste zeigt nur
  // noch die noch nicht abkassierten Positionen.
  const payPartial = async (order, selectedItemIndices, method) => {
    const allItems = order.items || [];
    const paidItems = selectedItemIndices.map((i) => allItems[i]).filter(Boolean);
    const remainingItems = allItems.filter((_, i) => !selectedItemIndices.includes(i));
    const itemTotal = (it) =>
      (it.price + (it.extras || []).reduce((s, e) => s + e.price, 0)) * (it.quantity || 1);
    const paidTotal = paidItems.reduce((s, it) => s + itemTotal(it), 0);

    if (remainingItems.length === 0) {
      await supabase
  .from('orders')
  .update({
    paid: true,
    paid_at: new Date().toISOString(),
    status: 'completed',
    customer_note: setPaymentMethodInNote(order.customer_note, method)
  })
  .eq('id', order.id);
    } else {
      const remainingTotal = (order.total_amount || 0) - paidTotal;
     await supabase.from('orders').insert([{
  tenant_id: order.tenant_id,
  table_number: order.table_number,
  order_number: order.order_number,
  items: paidItems,
  total_amount: paidTotal,
  paid: true,
  paid_at: new Date().toISOString(),
  status: 'completed',
  customer_note: setPaymentMethodInNote(order.customer_note, method),
  area_status: { kueche: "erledigt", bar: "erledigt" }
}]);

await supabase.from('orders').update({
  items: remainingItems,
  total_amount: remainingTotal
}).eq('id', order.id);
    }
  };

// Geschützter Storno-Workflow: Bestellungen werden NICHT sofort gelöscht,
  // sondern als StornoRequest an den Admin-Prüfordner weitergeleitet.
  const requestStorno = async (order, reason) => {
    await supabase.from('storno_requests').insert([{
      tenant_id: order.tenant_id,
      order_id: order.id,
      order_number: order.order_number,
      reason: reason,
      requested_by: user?.id,
      requested_by_name: user?.full_name || user?.email || "",
      status: "angefragt"
    }]);

    await supabase.from('orders').update({ storno_requested: true }).eq('id', order.id);
  };
  // Tisch-Gesamtabrechnung mit Trinkgeld, Rabatt und Zahlungsart.
  // Tip und Rabatt werden proportional auf alle Bestellungen des Tisches
  // aufgeteilt, damit der Z-Bon die Beträge korrekt ausweist.
  const payTable = async (tableOrders, tipAmount, discount, method, givenAmount) => {
    const total = tableOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
    const discountAmount = discount?.type === "prozent"
      ? Math.round(total * (discount.value || 0)) / 100
      : discount?.type === "festbetrag"
      ? Math.min(discount.value || 0, total)
      : 0;
    for (let i = 0; i < tableOrders.length; i++) {
      const o = tableOrders[i];
      const proportion = total > 0 ? (o.total_amount || 0) / total : 0;
      const orderTip = Math.round((tipAmount || 0) * proportion * 100) / 100;
      const orderDiscount = Math.round(discountAmount * proportion * 100) / 100;
      await supabase
  .from('orders')
  .update({
    paid: true,
    paid_at: new Date().toISOString(),
    status: 'completed',
    customer_note: setPaymentMethodInNote(o.customer_note, method)
  })
  .eq('id', o.id);
    }
  };

 // Einzelne Position stornieren: entfernt den Artikel sofort aus der
  // Bestellung (verschwindet von Küche/Bar) und erzeugt einen
  // StornoRequest (status "freigegeben") für das Kassa-Journal.
  const stornoItem = async (order, itemIndex, reason) => {
    const allItems = order.items || [];
    const stornoItm = allItems[itemIndex];
    if (!stornoItm) return;
    const itemTotal = ((stornoItm.price || 0) + (stornoItm.extras || []).reduce((s, e) => s + (e.price || 0), 0)) * (stornoItm.quantity || 1);
    const remainingItems = allItems.filter((_, i) => i !== itemIndex);
    const remainingTotal = Math.max(0, (order.total_amount || 0) - itemTotal);

    await supabase.from('storno_requests').insert([{
      tenant_id: order.tenant_id,
      order_id: order.id,
      order_number: order.order_number,
      table_number: order.table_number,
      scope: "item",
      item_name: stornoItm.name,
      item_index: itemIndex,
      quantity: stornoItm.quantity || 1,
      amount: itemTotal,
      reason,
      requested_by: user?.id,
      requested_by_name: user?.full_name || user?.email || "",
      status: "freigegeben",
    }]);

    if (remainingItems.length === 0) {
      await supabase.from('orders').delete().eq('id', order.id);
    } else {
      await supabase.from('orders').update({ items: remainingItems, total_amount: remainingTotal }).eq('id', order.id);
    }
  };

  // Tisch umbuchen: alle offenen Bestellungen auf einen anderen Tisch übertragen.
  const transferTable = async (fromTable, toTable) => {
    const openOrders = orders.filter((o) => o.table_number === fromTable && !o.paid && !o.paid_online);
    for (const o of openOrders) {
      await supabase.from('orders').update({ table_number: toTable }).eq('id', o.id);
    }
  };

  // Tische zusammenlegen: alle offenen Bestellungen des Quell-Tisches auf
  // den Ziel-Tisch übertragen — so entsteht eine gemeinsame Rechnung.
  const mergeTables = async (sourceTable, targetTable) => {
    const sourceOrders = orders.filter((o) => o.table_number === sourceTable && !o.paid && !o.paid_online);
    for (const o of sourceOrders) {
      await supabase.from('orders').update({ table_number: targetTable }).eq('id', o.id);
    }
  };

  // Eine Bestellung erscheint in der Kassa, sobald sie zur Kassierung bereit
  // ist: Status "bereit" oder "wartet_auf_zahlung", ODER mindestens ein Bereich
  // (Küche/Bar) ist bereits "erledigt", ODER die Anomalie "completed aber nicht
  // bezahlt" (z. B. nach manuellem Status-Reset). Online-bezahlte Bestellungen
  // (paid_online) gelten als bezahlt und erscheinen nicht unter "Offen".
  const totalTables = tenant?.reservation_config?.total_tables || 0;
  const openOrders = orders.filter((o) => {
    if (o.paid || o.paid_online) return false;
    if (o.status === "bereit" || o.status === "wartet_auf_zahlung") return true;
    if (o.status === "completed") return true; // Anomalie: completed ohne Bezahlung
    if (o.area_status?.kueche === "erledigt" || o.area_status?.bar === "erledigt") return true;
    return false;
  });
  const paidOrders = orders.filter((o) => o.paid || o.paid_online);
  const counts = { offen: openOrders.length, bezahlt: paidOrders.length };
  const visible = filter === "bezahlt" ? paidOrders : openOrders;

  const isBar = category === "bar";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <BackToOverview />
      <h1 className="mb-6 font-display text-2xl font-bold text-stone-900">{isBar ? ui(lang, "kassaTitleBar") : ui(lang, "kassaTitleKitchen")}</h1>

      {/* Kombinierter Tagesabschluss über alle Bestellungen (Speisen + Getränke) */}
      <StationDaySummary
        title={isBar ? ui(lang, "kassaSummaryBar") : ui(lang, "kassaSummaryKitchen")}
        tenant={tenant}
        station={null}
        orders={orders}
        stations={stations}
      />

      {totalTables > 0 ? (
        <KassaTableGrid orders={orders} tenant={tenant} onMarkPaid={markPaid} onRequestStorno={requestStorno} onPayPartial={payPartial} onPayTable={payTable} onStornoItem={stornoItem} onTransferTable={transferTable} onMergeTables={mergeTables} />
      ) : (
        <>
          <div className="mb-4 flex w-fit gap-1 rounded-full bg-stone-100 p-1">
            {[
              { key: "offen", label: ui(lang, "kassaFilterOpen") },
              { key: "bezahlt", label: ui(lang, "kassaFilterPaid") },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                  filter === f.key ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {f.label} <span className="ml-1 text-xs text-stone-400">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-200" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-stone-400">
              {filter === "offen" ? ui(lang, "kassaEmptyOpen") : ui(lang, "kassaEmptyPaid")}
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map((order) => (
                <div key={order.id} className={`flex items-center gap-4 rounded-2xl border border-stone-200 border-l-4 bg-white p-4 ${filter === "offen" ? "border-l-emerald-500" : "border-l-stone-300"}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white">
                    {order.order_number ?? "#"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-900">{ui(lang, "kassaOrder")} {order.order_number ?? ""}</span>
                      {order.customer_name && <span className="text-xs text-stone-400">· {order.customer_name}</span>}
                    </div>
                    <p className="truncate text-xs text-stone-500">
                      {(order.items || []).map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display font-bold text-stone-900">{formatCurrency(order.total_amount)}</p>
                  </div>
                  {filter === "offen" && (
                    <span className="hidden rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:inline">{ui(lang, "kassaReadyForPickup")}</span>
                  )}
                  <StornoButton order={order} amount={order.total_amount} onStorno={(reason) => requestStorno(order, reason)} />
                  {filter === "offen" ? (
                    <button
                      onClick={() => markPaid(order)}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      <Check className="h-4 w-4" /> {ui(lang, "kassaPaidBtn")}
                    </button>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700">{ui(lang, "kassaPaidBadge")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <PaidReceiptsArchive orders={orders} />
    </div>
  );
}