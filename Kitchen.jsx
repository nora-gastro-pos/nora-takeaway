import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { effectiveTenantId, formatCurrency } from "@/lib/constants";
import { useUiLang } from "@/lib/UiLangContext";
import { ui } from "@/lib/uiI18n";
import { useToast } from "@/components/ui/use-toast";
import { Calculator, Users, Check, Wallet, Printer, Sparkles } from "lucide-react";
import ReceiptPrint from "@/components/kasse/ReceiptPrint";

const CLEANING_KEY = (tenantId) => `kasse_cleaning_${tenantId}`;
const loadCleaning = (tenantId) => {
  try { return JSON.parse(localStorage.getItem(CLEANING_KEY(tenantId)) || "[]"); } catch { return []; }
};

export default function Kitchen() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { lang } = useUiLang();
  const { toast } = useToast();
  const tenantId = effectiveTenantId(user, searchParams.get("betrieb"));
  const [tenant, setTenant] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
  const [printData, setPrintData] = useState(null);
  const [cleaning, setCleaning] = useState(() => loadCleaning(tenantId));
  const [now, setNow] = useState(Date.now());

  // Persistiere Reinigungs-Tabelle
  useEffect(() => {
    try { localStorage.setItem(CLEANING_KEY(tenantId), JSON.stringify(cleaning)); } catch {}
  }, [cleaning, tenantId]);

  // Countdown-Tick + automatische Freigabe abgelaufener Tische
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setCleaning((prev) => (prev.some((c) => c.until <= n) ? prev.filter((c) => c.until > n) : prev));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!tenantId) return;

    supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => data && setTenant(data))
      .catch(() => {});

    supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setOrders(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const channel = supabase
      .channel('kitchen-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') setOrders((prev) => [payload.new, ...prev]);
        else if (payload.eventType === 'UPDATE') setOrders((prev) => prev.map((o) => (o.id === payload.new.id ? payload.new : o)));
        else if (payload.eventType === 'DELETE') setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  // Nur offene (unbezahlte) Bestellungen bilden die aktive Tischübersicht.
  const openOrders = useMemo(() => orders.filter((o) => !o.paid), [orders]);

  // Gruppierung: Tisch (oder Abhol) → Besteller → Bestellungen
  const groups = useMemo(() => {
    const map = {};
    openOrders.forEach((o) => {
      const key = o.table_number ? `t-${o.table_number}` : `a-${o.order_number}`;
      if (!map[key]) {
        map[key] = {
          key,
          isTable: !!o.table_number,
          sort: o.table_number || 9999999,
          bestellers: {},
        };
      }
      const g = map[key];
      const name = (o.customer_name || "").trim() || ui(lang, "cashierUnknown");
      if (!g.bestellers[name]) g.bestellers[name] = { name, orders: [], sum: 0 };
      g.bestellers[name].orders.push(o);
      g.bestellers[name].sum += o.total_amount || 0;
    });
    const list = Object.values(map).sort((a, b) => a.sort - b.sort);
    list.forEach((g) => {
      g.label = g.isTable
        ? `${ui(lang, "table")} ${g.sort === 9999999 ? "—" : g.sort}`
        : `${ui(lang, "cashierTakeaway")} #${g.key.replace("a-", "")}`;
      g.total = Object.values(g.bestellers).reduce((s, b) => s + b.sum, 0);
    });
    return list;
  }, [openOrders, lang]);

  // Wenn ein Tisch erneut belegt wird (neue offene Bestellung), Reinigung abbrechen
  useEffect(() => {
    const openKeys = new Set(groups.map((g) => g.key));
    setCleaning((prev) => {
      const next = prev.filter((c) => !openKeys.has(c.key));
      return next.length === prev.length ? prev : next;
    });
  }, [groups]);

  const dayTotal = orders.reduce((s, o) => s + (o.total_amount || 0), 0);

  const toggleOrder = (id) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allOrderIdsOf = (g) => Object.values(g.bestellers).flatMap((b) => b.orders.map((o) => o.id));

  const selectAllTable = (g) => {
    const allIds = allOrderIdsOf(g);
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      const allSelected = allIds.length > 0 && allIds.every((id) => next.has(id));
      if (allSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelected = (ids) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const selectedTotal = openOrders.filter((o) => selectedOrderIds.has(o.id)).reduce((s, o) => s + (o.total_amount || 0), 0);

  // Vom Gast gewählte Zahlungsart steht in customer_note als „Zahlung: …".
  const paymentMethodOf = (o) => {
    const m = (o.customer_note || "").match(/Zahlung:\s*([^|]+)/);
    return m ? m[1].trim() : null;
  };
  const methodsOf = (b) => {
    const set = new Set();
    b.orders.forEach((o) => { const m = paymentMethodOf(o); if (m) set.add(m); });
    return [...set];
  };

  const payOrders = async (orderIds) => {
  const paidAt = new Date().toISOString();
  await supabase
    .from('orders')
    .update({ paid: true, paid_at: paidAt, status: 'completed' })
    .in('id', orderIds);
};
  };

  const payOrders = async (orderIds) => {
    const paidAt = new Date().toISOString();
    await supabase
      .from('orders')
      .update({ paid: true, paid_at: paidAt, status: 'completed' })
      .in('id', orderIds);
  };
  
  const handlePayTable = async (g) => {
    const ids = allOrderIdsOf(g);
    await payOrders(ids);
    clearSelected(ids);
    startCleaning(g);
    toast({ title: `${g.label} ${ui(lang, "cashierFree")}` });
  };

  const handlePaySelected = async () => {
    const ids = [...selectedOrderIds];
    if (ids.length === 0) return;
    await payOrders(ids);
    groups.forEach((g) => {
      if (!g.isTable) return;
      const tableIds = allOrderIdsOf(g);
      const remaining = tableIds.filter((id) => !ids.includes(id));
      if (remaining.length === 0 && tableIds.length > 0) startCleaning(g);
    });
    clearSelected(ids);
    toast({ title: `${ids.length} ${ui(lang, "cashierPaid")}` });
  };

  const handlePrintReceipt = async (g) => {
    const ids = Object.values(g.bestellers).flatMap((b) => b.orders.map((o) => o.id));
    setPrintData({ group: g, tenant, ids });
    await payOrders(ids);
    startCleaning(g);
    toast({ title: `${g.label} ${ui(lang, "cashierFree")}` });
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Calculator className="h-6 w-6 text-stone-700" />
        <h1 className="font-display text-2xl font-bold text-stone-900">
          {ui(lang, "kasse")}{tenant && <span className="text-stone-400"> · {tenant.name}</span>}
        </h1>
        <span className="ml-auto rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          {ui(lang, "cashierDayTotal")}: {formatCurrency(dayTotal)}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-stone-200" />)}
        </div>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center text-stone-400">{ui(lang, "cashierEmpty")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {groups.map((g) => {
            const bestellers = Object.values(g.bestellers);
            return (
              <div key={g.key} className="flex flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-stone-900">{g.label}</h2>
                  <span className="rounded-full bg-stone-900 px-3 py-1 text-sm font-semibold text-white">{formatCurrency(g.total)}</span>
                </div>

                {g.isTable && (() => {
                  const tableIds = allOrderIdsOf(g);
                  const allSelected = tableIds.length > 0 && tableIds.every((id) => selectedOrderIds.has(id));
                  return (
                    <div className="mb-3 flex items-center rounded-lg bg-stone-50 px-3 py-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => selectAllTable(g)}
                          className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        {ui(lang, "cashierSelectAll")}
                      </label>
                    </div>
                  );
                })()}

                <div className="flex-1 space-y-3">
                  {bestellers.map((b) => (
                    <div key={b.name} className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-800">
                          <Users className="h-3.5 w-3.5 text-stone-500" /> {b.name}
                        </span>
                        <span className="text-sm font-semibold text-stone-700">{formatCurrency(b.sum)}</span>
                      </div>
                      {methodsOf(b).length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {methodsOf(b).map((m) => (
                            <span key={m} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">💳 {m}</span>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        {b.orders.map((o) => {
                          const orderSum = (o.items || []).reduce((s, it) => s + (it.price + (it.extras || []).reduce((e, e2) => e + e2.price, 0)) * it.quantity, 0);
                          const isSelected = selectedOrderIds.has(o.id);
                          return (
                            <div key={o.id} className={`rounded-lg border p-2 transition ${isSelected ? "border-emerald-400 bg-emerald-50" : "border-stone-200 bg-white"}`}>
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleOrder(o.id)}
                                  className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-xs font-semibold text-stone-700">
                                  {o.order_number ? `#${o.order_number}` : ui(lang, "cashierRound")} · {formatCurrency(orderSum)}
                                </span>
                              </label>
                              <ul className="mt-1 ml-6 space-y-0.5">
                                {(o.items || []).map((it, i) => (
                                  <li key={i} className="flex justify-between text-xs text-stone-600">
                                    <span>{it.quantity}× {it.name}</span>
                                    <span>{formatCurrency((it.price + (it.extras || []).reduce((s, e) => s + e.price, 0)) * it.quantity)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {g.isTable && (
                  <button
                    onClick={() => handlePayTable(g)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-stone-900 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700"
                  >
                    <Wallet className="h-4 w-4" /> {ui(lang, "cashierTablePay")} · {formatCurrency(g.total)}
                  </button>
                )}
                {!g.isTable && (
                  <button
                    onClick={() => handlePayTable(g)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <Check className="h-4 w-4" /> {ui(lang, "cashierPay")}
                  </button>
                )}
                <button
                  onClick={() => handlePrintReceipt(g)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-stone-300 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                >
                  <Printer className="h-3.5 w-3.5" /> Beleg drucken
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedOrderIds.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl bg-stone-900 px-5 py-3 shadow-xl">
            <span className="text-sm font-semibold text-white">
              {selectedOrderIds.size} {ui(lang, "cashierSelected")} · {formatCurrency(selectedTotal)}
            </span>
            <button
              onClick={handlePaySelected}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-400"
            >
              {ui(lang, "cashierPaySelected")}
            </button>
          </div>
        </div>
      )}

      {cleaning.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-stone-500">
            <Sparkles className="h-4 w-4 text-amber-500" /> {ui(lang, "cashierCleaning")}
          </h2>
          <div className="grid gap-3 lg:grid-cols-4">
            {cleaning.map((c) => {
              const mins = Math.max(0, Math.ceil((c.until - now) / 60000));
              return (
                <div key={c.key} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="font-display text-lg font-bold text-stone-800">{c.label}</div>
                  <div className="text-sm font-medium text-amber-700">{ui(lang, "cashierFreeIn", mins)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {printData && <ReceiptPrint data={printData} onClose={() => setPrintData(null)} />}
    </div>
  );
}