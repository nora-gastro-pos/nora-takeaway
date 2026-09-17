import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUiLang } from "@/lib/UiLangContext";
import { ui } from "@/lib/uiI18n";
import BackToOverview from "@/components/dashboard/BackToOverview";
import { Check, RotateCcw } from "lucide-react";

// Admin-Übersicht der Koch-Wünsche (gemeldete fehlende Einstellungen aus /koch).
export default function KochWuensche() {
  const { lang } = useUiLang();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

const load = async () => {
    const { data } = await supabase
      .from('koch_wuensche')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setItems(data || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const toggleStatus = async (item) => {
  const next = item.status === "neu" ? "erledigt" : "neu";
    await supabase
      .from('koch_wuensche')
      .update({ status: next })
      .eq('id', item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
  };

  return (
    <div>
      <BackToOverview />
      <h1 className="font-display text-2xl font-bold text-stone-900">{ui(lang, "kochWuenscheTitle")}</h1>
      <p className="mb-6 text-sm text-stone-500">{ui(lang, "kochWuenscheSub")}</p>
      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-stone-200" />
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-400">{ui(lang, "kochWuenscheEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="p-3">{ui(lang, "kochWuenscheColDate")}</th>
                <th className="p-3">{ui(lang, "kochWuenscheColTenant")}</th>
                <th className="p-3">{ui(lang, "kochWuenscheColKoch")}</th>
                <th className="p-3">{ui(lang, "kochWuenscheColDish")}</th>
                <th className="p-3">{ui(lang, "kochWuenscheColText")}</th>
                <th className="p-3">{ui(lang, "kochWuenscheColStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-stone-100 align-top">
                 <td className="whitespace-nowrap p-3 text-xs text-stone-500">
  {new Date(it.created_at || it.created_date).toLocaleString(lang, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
</td>
                  <td className="p-3 font-medium text-stone-800">{it.tenant_name || "—"}</td>
                  <td className="p-3 text-stone-600">{it.koch_name || "—"}</td>
                  <td className="p-3 text-stone-500">{it.dish_name || "—"}</td>
                  <td className="p-3 text-stone-700">{it.text}</td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleStatus(it)}
                      title={ui(lang, it.status === "erledigt" ? "kochWuenscheMarkOpen" : "kochWuenscheMarkDone")}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        it.status === "erledigt" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      }`}
                    >
                      {it.status === "erledigt" ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                      {ui(lang, it.status === "erledigt" ? "kochWuenscheStatusErledigt" : "kochWuenscheStatusNeu")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}