import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { isKochPreviewActive } from "@/lib/kochPreview";
import { useAuth } from "@/lib/AuthContext";
import { useUiLang } from "@/lib/UiLangContext";
import { ui } from "@/lib/uiI18n";
import { formatCurrency, orderedSections, itemMatchesCategory } from "@/lib/constants";
import MenuItemForm from "@/components/dashboard/MenuItemForm";
import AllergenConfirmNote from "@/components/dashboard/AllergenConfirmNote";
import KochWunschBanner from "@/components/koch/KochWunschBanner";
import { Pencil, LogOut } from "lucide-react";

// Eingeschränkter Koch-Zugang: listet die Gerichte des Betriebs und erlaubt
// ausschließlich das Bearbeiten von Allergenen, Zutaten/Wareneinsatz,
// Garstufen-Auswahl und Zubereitungszeit (siehe MenuItemForm kochMode).
// Kein Anlegen/Löschen, keine Preise, Kategorien oder sonstigen Einstellungen.
export default function KochMenu() {
  const { user } = useAuth();
  const { lang } = useUiLang();
  const [searchParams] = useSearchParams();
  const tenantId = user?.tenant_id || searchParams.get("betrieb") || null;
  const [fallbackTenantId, setFallbackTenantId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  // Admin-Vorschau: ohne eigenen Betrieb auf den ersten verfügbaren Betrieb
  // zurückgreifen, damit die Koch-Ansicht auch im Testmodus Daten anzeigt.
  useEffect(() => {
    if (!tenantId && user?.role === "admin") {
      supabase.from('tenants').select('id').then(({ data: t }) => { if (t && t.length) setFallbackTenantId(t[0].id); }).catch(() => {});
    }
  }, [tenantId, user]);

  const effectiveTid = tenantId || fallbackTenantId;

  useEffect(() => {
    if (!effectiveTid) { setLoading(false); return; }
    supabase.from('menu_items').select('*').eq('tenant_id', effectiveTid).then(({ data: d }) => { setItems(d || []); setLoading(false); }).catch(() => setLoading(false));
  }, [effectiveTid]);

  if (!effectiveTid) return <div className="py-12 text-center text-sm text-stone-400">{ui(lang, "commonNoTenant")}</div>;

  const refresh = async () => {
    const { data: d } = await supabase.from('menu_items').select('*').eq('tenant_id', effectiveTid);
    setItems(d || []);
    setEditing(null);
  }; 

  return (
    <div className={`min-h-screen bg-stone-50 ${isKochPreviewActive() ? "pt-10" : ""}`}>
      <header className={`sticky z-20 border-b border-stone-200 bg-white ${isKochPreviewActive() ? "top-10" : "top-0"}`}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="font-display text-lg font-bold text-stone-900">{ui(lang, "menuManage")}</h1>
          <button
  onClick={async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }}
  className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-200"
          >
            <LogOut className="h-3.5 w-3.5" /> {ui(lang, "logout")}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <KochWunschBanner tenantId={effectiveTid} openDishName={editing?.name} />
        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200" />
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-stone-400">{ui(lang, "mmNoItemsFood")}</p>
        ) : (
          <div className="space-y-6">
            {orderedSections(null, items).map((section) => {
              const si = items.filter((it) => itemMatchesCategory(it, section.key));
              if (!si.length) return null;
              return (
                <div key={section.key}>
                  <h2 className="mb-2 font-display text-base font-bold text-stone-900">{section.label}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {si.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="min-w-0">
                          <h3 className="truncate font-medium text-stone-900">{item.name}</h3>
                          <p className="text-xs text-stone-400">{item.category} · {formatCurrency(item.price)}</p>
                          <AllergenConfirmNote item={item} />
                        </div>
                        <button onClick={() => setEditing(item)} className="ml-2 shrink-0 rounded-lg p-2 text-stone-400 hover:bg-stone-100">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing && <MenuItemForm item={editing} tenantId={tenantId} kochMode onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}