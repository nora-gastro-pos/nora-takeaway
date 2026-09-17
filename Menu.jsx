import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./lib/supabaseClient";
import { useSearchParams, Navigate } from "react-router-dom";
import { formatCurrency, usesTables, stressStatusInfo, stationOpenStatus, isOpenNow, isInKitchenBreak, stationWaitingPrepMinutes, estimateWaitMinutes, stressLevelFromWaitMinutes, menuItemByNameMap, roundUpToInterval, DEFAULT_PREP_MINUTES, computeHappyHour, drinkSizeLabel, orderedSections, itemMatchesCategory, isRestaurantType, isTakeawayType, effectiveFeatures, getDayWindows, generateTimeSlots, normalizeCategories, categoryOrderHours, categoryOpenNow } from "./lib/constants";
import { themeClass } from "./lib/theme";
import { useAuth } from "./lib/AuthContext";
import MenuHeader from "./components/menu/MenuHeader";
import MenuHero from "./components/menu/MenuHero";
import CategoryTabs from "./components/menu/CategoryTabs";
import ColumnTabs, { columnTabLabel } from "./components/menu/ColumnTabs";
import DishCard from "./components/menu/DishCard";
import CartPanel from "./components/menu/CartPanel";
import CheckoutModal from "./CheckoutModal";
import PreorderBanner from "./components/menu/PreorderBanner";
import PreorderToggle, { formatPickupLabel } from "./components/menu/PreorderToggle";
import MenuItemModal from "./components/menu/MenuItemModal";
import ViewOnlyOrderHint from "./components/menu/ViewOnlyOrderHint";
import EmptyMenuState from "./components/menu/EmptyMenuState";
import GuestFilter from "./components/menu/GuestFilter";
import { useToast } from "./components/ui/use-toast";
import { fireReadyNotification, ensureNotifySW, getTrackedOrder, setTrackedOrder, markTrackedNotified } from "./lib/orderReadyNotify";
import FollowUpModal from "./components/menu/FollowUpModal";
import SnackUpsellBanner from "./components/menu/SnackUpsellBanner";
import PaymentSuccessOverlay from "./components/menu/PaymentSuccessOverlay";
import { useLiveTranslations } from "./hooks/useLiveTranslations";
import { getFollowUpTrack, setFollowUpTrack, DEFAULT_DRINK_MINUTES, DEFAULT_DESSERT_MINUTES, findDessertCategory, getDessertHighlights, getDrinkHighlights, getSnackItem, getRoundOrderDrinks } from "./lib/followUp";
import { Search, X, ShoppingBag, BellRing, Receipt, ClipboardList, Eye } from "lucide-react";
import { getInitialLanguage, t } from "./lib/i18n";
import { roleHomeFor } from "./lib/roleHome";
import { ui } from "./lib/uiI18n";
import StaffTablePicker from "./components/menu/StaffTablePicker";
import StaffSetupGuide from "./components/menu/StaffSetupGuide";
import StaffCheckoutModal from "./components/menu/StaffCheckoutModal";
import MenuFooter from "./components/menu/MenuFooter";
import WelcomeOverlay from "./components/menu/WelcomeOverlay";
import DailyTipOverlay from "./components/menu/DailyTipOverlay";
import DemoQrOverlay from "./components/express-demo/DemoQrOverlay";

// Bestimmt, ob zwei Warenkorb-Zeilen als "gleich" gelten und daher zu einer
// Zeile mit addierter Menge zusammengefasst werden.
const cartLineKey = (c) =>
  JSON.stringify({
    name: c.name,
    variant: c.variant || "",
    special_request: c.special_request || "",
    cooking_level: c.cooking_level || "",
    price: c.price,
    extras: (c.extras || []).map((e) => `${e.name}:${e.price}`).sort().join("|"),
    customer_name: c.customer_name || "",
  });

export default function Menu({ staffMode = false }) {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get("betrieb");

  // Payment-Return: Nach Stripe-Checkout zurückgekehrt – Erfolg oder Abbruch anzeigen
  const [paymentSuccessOrder, setPaymentSuccessOrder] = useState(null);
  useEffect(() => {
    if (searchParams.get("payment_success") === "1") {
      const orderId = searchParams.get("order");
      if (orderId) {
        supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .single()
          .then(({ data }) => { if (data) setPaymentSuccessOrder(data); })
          .catch(() => {});
      }
      toast({ title: t(lang, "paymentSuccessTitle"), description: t(lang, "paymentSuccessDesc") });
    } else if (searchParams.get("payment_cancelled") === "1") {
      toast({ title: t(lang, "paymentCancelledTitle"), description: t(lang, "paymentCancelledDesc") });
    }
  }, []);

  const isPreview = searchParams.get("vorschau") === "1";
  const [staffTable, setStaffTable] = useState(null);
  const tableNumber = staffMode ? (staffTable != null ? String(staffTable) : "") : (searchParams.get("tisch") || "");
  const [tenant, setTenant] = useState(null);
  const [items, setItems] = useState([]);
  const [extras, setExtras] = useState([]);
  const [stations, setStations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeColumn, setActiveColumn] = useState(() => searchParams.get("spalte"));
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [excludedAllergens, setExcludedAllergens] = useState([]);
  const [onlyVeg, setOnlyVeg] = useState(false);
  const [onlyNonAlc, setOnlyNonAlc] = useState(false);
  const [lang, setLang] = useState(() => getInitialLanguage());
  const liveTranslations = useLiveTranslations(items, lang);
  const [orderMode, setOrderMode] = useState("now");
  const [preorderDate, setPreorderDate] = useState("");
  const [preorderTime, setPreorderTime] = useState("");
  const [preorderModalOpen, setPreorderModalOpen] = useState(false);
  const [waiterCooldown, setWaiterCooldown] = useState(false);
  const [paymentCooldown, setPaymentCooldown] = useState(false);
  const { user } = useAuth();
  const isStaff = user && ["kueche", "unternehmer", "admin"].includes(user.role);

  const trackedOrderRef = useRef(getTrackedOrder());
  const [trackedReady, setTrackedReady] = useState(false);

  const [followUp, setFollowUp] = useState(() => getFollowUpTrack());
  const followUpRef = useRef(followUp);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpMode, setFollowUpMode] = useState("dessert");
  const [followUpHighlights, setFollowUpHighlights] = useState([]);
  const [roundOrderDrinks, setRoundOrderDrinks] = useState([]);

  const [snackUpsell, setSnackUpsell] = useState(null);
  const snackShownRef = useRef(false);

  const [showWelcome, setShowWelcome] = useState(false);
  const [showDailyTip, setShowDailyTip] = useState(false);

  const updateFollowUp = (next) => {
    followUpRef.current = next;
    setFollowUp(next);
    setFollowUpTrack(next);
  };

  const openDrinkFollowUp = async () => {
    let cur = items;
    try {
      const { data } = await supabase.from('menu_items').select('*').eq('tenant_id', tenantId);
      if (data) {
        cur = data;
        setItems(cur);
      }
    } catch {}
    setFollowUpHighlights(getDrinkHighlights(cur));
    setFollowUpMode("drink");
    setFollowUpOpen(true);
    updateFollowUp({ ...followUpRef.current, drinkShown: true });
  };

  const openDessertFollowUp = async () => {
    let cur = items;
    try {
      const { data } = await supabase.from('menu_items').select('*').eq('tenant_id', tenantId);
      if (data) {
        cur = data;
        setItems(cur);
      }
    } catch {}
    setFollowUpHighlights(getDessertHighlights(cur, orderedSections(tenant, cur)));
    setFollowUpMode("dessert");
    setFollowUpOpen(true);
    updateFollowUp({ ...followUpRef.current, dessertShown: true });
  };

  useEffect(() => {
    if (tenantId) {
      ensureNotifySW();

      supabase.from('tenants').select('*').eq('id', tenantId).single().then(({ data }) => { if (data) setTenant(data); }).catch(() => {});

      supabase.from('menu_items').select('*').eq('tenant_id', tenantId).then(({ data }) => {
        if (data) setItems([...data].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      }).finally(() => setLoading(false));

      supabase.from('extras').select('*').eq('tenant_id', tenantId).then(({ data }) => setExtras(data || []));

      supabase.from('stations').select('*').eq('tenant_id', tenantId).then(({ data }) => setStations(data || []));

      supabase.from('orders').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100).then(({ data }) => {
        const orderList = data || [];
        setOrders(orderList);

        const tr = trackedOrderRef.current;
        if (tr) {
          const o = orderList.find((x) => x.id === tr.id);
          if (o && o.status === "bereit" && !o.paid) {
            setTrackedReady(true);
            if (!tr.notified) {
              trackedOrderRef.current = { ...tr, notified: true };
              fireReadyNotification(o.order_number || tr.orderNumber || "").then((ok) => { if (ok) markTrackedNotified(); });
            }
          }
        }

        const fu = followUpRef.current;
        if (fu) {
          const fo = orderList.find((x) => x.id === fu.id);
          if (fo) {
            let next = fu;
            if (fo.status === "in_zubereitung" && !fu.confirmedAt) {
              next = { ...next, confirmedAt: Date.parse(fo.updated_at || fo.created_at) || Date.now() };
            }
            if (next !== fu) updateFollowUp(next);
            if (fo.followup_requested && !fu.dessertShown) {
              openDessertFollowUp();
            }
          }
        }
      }).catch(() => {});

      const channel = supabase
        .channel('orders-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            setOrders((prev) => {
              if (payload.eventType === 'INSERT') return [payload.new, ...prev];
              if (payload.eventType === 'UPDATE') return prev.map((o) => (o.id === payload.new.id ? payload.new : o));
              if (payload.eventType === 'DELETE') return prev.filter((o) => o.id !== payload.old.id);
              return prev;
            });

            if (payload.eventType === 'UPDATE') {
              const updatedOrder = payload.new;
              const tr = trackedOrderRef.current;
              if (tr && updatedOrder.id === tr.id && updatedOrder.status === "bereit" && !updatedOrder.paid) {
                setTrackedReady(true);
                if (!tr.notified) {
                  trackedOrderRef.current = { ...tr, notified: true };
                  fireReadyNotification(updatedOrder.order_number || tr.orderNumber || "").then((ok) => { if (ok) markTrackedNotified(); });
                }
              }

              const fu = followUpRef.current;
              if (fu && updatedOrder.id === fu.id) {
                let next = fu;
                if (updatedOrder.status === "in_zubereitung" && !fu.confirmedAt) {
                  next = { ...next, confirmedAt: Date.now() };
                }
                if (next !== fu) updateFollowUp(next);
                if (updatedOrder.followup_requested && !fu.dessertShown) {
                  openDessertFollowUp();
                }
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenant?.id) return;
    const features = effectiveFeatures(tenant);
    if (!features.welcome_popup) return;
    const key = `welcome_shown:${tenant.id}`;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    const isTake = isTakeawayType(tenant.business_type);
    const text = isTake
      ? (tenant.welcome_config?.takeaway_text || "Herzlich willkommen! Schön, dass du heute unser Gast bist. Guten Appetit!")
      : (tenant.welcome_config?.restaurant_text || "Herzlich willkommen! Schön, dass du heute unser Gast bist. Guten Appetit!");
    if (!text) return;
    setShowWelcome(true);
    try { sessionStorage.setItem(key, "1"); } catch {}
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    const features = effectiveFeatures(tenant);
    if (!features.daily_tip) return;
    const tipKey = `daily_tip_shown:${tenant.id}`;
    try { if (sessionStorage.getItem(tipKey)) return; } catch {}
    const isTake = isTakeawayType(tenant.business_type);
    const tipText = isTake
      ? (tenant.daily_tip_config?.takeaway_text || "")
      : (tenant.daily_tip_config?.restaurant_text || "");
    if (!tipText) return;
    const timer = setTimeout(() => {
      setShowDailyTip(true);
      try { sessionStorage.setItem(tipKey, "1"); } catch {}
    }, 15000);
    return () => clearTimeout(timer);
  }, [tenant?.id]);

  const upsellActive = !!effectiveFeatures(tenant).upsell;
  const upsell = tenant?.upsell_config || {};
  const drinkEnabled = upsellActive && upsell.drink_enabled !== false;
  const drinkMinutes = upsell.drink_minutes || DEFAULT_DRINK_MINUTES;
  const dessertEnabled = upsellActive && upsell.dessert_enabled !== false;
  const dessertMinutes = upsell.dessert_minutes || DEFAULT_DESSERT_MINUTES;

  useEffect(() => {
    if (!followUp || followUp.muted) return;
    const now = Date.now();
    const timers = [];
    if (drinkEnabled && followUp.orderedAt && !followUp.drinkShown) {
      const remaining = followUp.orderedAt + drinkMinutes * 60000 - now;
      if (remaining <= 0) openDrinkFollowUp();
      else timers.push(setTimeout(openDrinkFollowUp, remaining));
    }
    if (dessertEnabled && followUp.confirmedAt && !followUp.dessertShown) {
      const remaining = followUp.confirmedAt + dessertMinutes * 60000 - now;
      if (remaining <= 0) openDessertFollowUp();
      else timers.push(setTimeout(openDessertFollowUp, remaining));
    }
    return () => timers.forEach(clearTimeout);
  }, [followUp?.orderedAt, followUp?.confirmedAt, followUp?.drinkShown, followUp?.dessertShown, followUp?.muted, drinkEnabled, drinkMinutes, dessertEnabled, dessertMinutes]);

  useEffect(() => {
    if (!upsellActive || !items.length) return;
    const drinks = cart.filter((c) => c.category === "Getränk" || c.drink_category);
    const food = cart.filter((c) => c.category && c.category !== "Getränk");
    const drinkCount = drinks.reduce((s, d) => s + d.quantity, 0);
    if (food.length > 0 || cart.length === 0) {
      snackShownRef.current = false;
      setSnackUpsell(null);
      return;
    }
    if (drinkCount >= 2 && !snackShownRef.current) {
      const snack = getSnackItem(items);
      if (snack) {
        setSnackUpsell(snack);
        snackShownRef.current = true;
      }
    }
  }, [cart, items, upsellActive]);

  const preorderConfig = tenant?.preorder_config;
  const preorderEnabled = preorderConfig?.enabled;
  const isPreorder = preorderEnabled && orderMode === "preorder" && !!preorderDate && !!preorderTime;
  const preorderFreeDrinkName = isPreorder && preorderConfig?.reward_type === "free_drink" ? preorderConfig.free_drink_name : null;
  const preorderTimeSlots = useMemo(() => {
    if (!preorderDate || !tenant?.opening_hours_data) return [];
    const day = String(new Date(preorderDate).getDay());
    const windows = getDayWindows(tenant.opening_hours_data, day);
    const slots = [];
    windows.forEach((w) => { if (w.von && w.bis) slots.push(...generateTimeSlots(w.von, w.bis, 15)); });
    return [...new Set(slots)].sort();
  }, [preorderDate, tenant?.opening_hours_data]);
  const preorderPickupLabel = isPreorder ? formatPickupLabel(preorderDate, preorderTime) : null;

  if (!tenantId && !staffMode) {
    const inviteToken = searchParams.get("token");
    if (inviteToken) {
      return <Navigate to={`/reset-password?token=${encodeURIComponent(inviteToken)}`} replace />;
    }
    if (user) {
      const dest = roleHomeFor(user.role);
      if (dest && dest !== "/") return <Navigate to={dest} replace />;
    }
    return <Navigate to="/start" replace />;
  }

  const hasTables = tenant ? usesTables(tenant.business_type) : true;
  const isTakeaway = tenant ? isTakeawayType(tenant.business_type) : false;
  const hasTableParam = !!tableNumber;
  const trialExpired = !staffMode && !!tenant?.trial_ends_at && new Date(tenant.trial_ends_at) < new Date() && tenant?.payment_status !== "aktiv";
  const viewOnly = (!staffMode && !hasTableParam && !isTakeaway) || trialExpired;
  const theme = tenant ? themeClass(tenant.business_type) : "theme-takeaway";
  const stressVisible = tenant ? tenant.stress_level_visible !== false : true;

  const cartPrepMinutes = cart
    .filter((c) => c.category && c.category !== "Getränk")
    .reduce((sum, c) => {
      const mi = items.find((i) => i.name === c.name);
      const prep = mi && mi.prep_time != null ? mi.prep_time : (tenant?.default_prep_minutes ?? DEFAULT_PREP_MINUTES);
      return sum + prep * (c.quantity || 1);
    }, 0);

  const computedWait = (() => {
    const menuByName = menuItemByNameMap(items);
    const allStationIds = stations.map((s) => s.id);
    const isDrink = (it) => {
      const mi = menuByName[it.name];
      if (mi) return mi.category === "Getränk" || !!mi.drink_category;
      return it.category === "Getränk" || !!it.drink_category;
    };
    const foodOrders = orders.map((o) => ({ ...o, items: (o.items || []).filter((it) => !isDrink(it)) }));
    const waitingPrepSum = stationWaitingPrepMinutes(foodOrders, menuByName, null, allStationIds, tenant?.default_prep_minutes);
    return estimateWaitMinutes(waitingPrepSum, tenant?.kitchen_capacity, cartPrepMinutes, tenant?.stress_level || "normal");
  })();

  const roundingInterval = tenant?.wait_rounding_minutes || 10;
  const hasFoodItems = cart.some((i) => i.category && i.category !== "Getränk");
  const waitDisplayEnabled = tenant?.wait_display_config?.enabled !== false;
  const waitDisplayCap = tenant?.wait_display_config?.max_minutes;
  const showWaitInfo = stressVisible && hasFoodItems && waitDisplayEnabled;
  const rawWaitMinutes = showWaitInfo ? roundUpToInterval(computedWait, roundingInterval) : null;
  const guestWaitMinutes = showWaitInfo && waitDisplayCap && waitDisplayCap > 0 ? Math.min(rawWaitMinutes, waitDisplayCap) : rawWaitMinutes;
  const effectiveStressLevel = stressLevelFromWaitMinutes(computedWait);
  const stressInfo = showWaitInfo && !isPreorder
    ? { dotColor: stressStatusInfo(effectiveStressLevel).dotColor, message: t(lang, "waitInfo", guestWaitMinutes) }
    : null;

  const happyHourFor = (it) => computeHappyHour(it, tenant);
  const drinkSizeFor = (it) => drinkSizeLabel(it, tenant);

  const drinkRecEnabled = !!effectiveFeatures(tenant).getraenke_empfehlung;
  const drinkMap = {};
  items.forEach((i) => { if (i.drink_category || i.category === "Getränk") drinkMap[i.id] = i; });
  const recommendedDrinksFor = (item) => drinkRecEnabled ? (item.recommended_drink_ids || []).map((id) => drinkMap[id]).filter(Boolean) : [];

  const closedStationCategories = {};
  stations.forEach((s) => {
    if (!stationOpenStatus(s, tenant).open) {
      closedStationCategories[s.id] = s.category;
    }
  });

  const catByName = {};
  normalizeCategories(tenant, items).forEach((c) => { catByName[c.name] = c; });
  const catNameFor = (it) => (it.category === "Getränk" ? (it.drink_category || "alkoholfrei") : it.category);
  const hasCustomCatHours = (it) => {
    const cat = catByName[catNameFor(it)];
    return !!(cat && categoryOrderHours(cat));
  };
  const categoryClosedFor = (it) => {
    const cat = catByName[catNameFor(it)];
    if (!cat || !categoryOrderHours(cat)) return false;
    return !categoryOpenNow(cat, tenant);
  };

  const kitchenCurrentlyClosed = !!tenant?.kitchen_hours_data && !isOpenNow(tenant.kitchen_hours_data);
  const barCurrentlyClosed = !!tenant?.bar_hours_data && !isOpenNow(tenant.bar_hours_data);
  const afternoonCategories = tenant?.afternoon_menu_categories || [];
  const hasAfternoonMenu = kitchenCurrentlyClosed && isInKitchenBreak(tenant.kitchen_hours_data) && afternoonCategories.length > 0;

  const addToCart = (item, config) => {
    const newLine = {
      cartId: Date.now() + Math.random(),
      name: item.name,
      category: item.category,
      drink_category: item.drink_category,
      price: config.variant ? config.variant.price : (happyHourFor(item)?.active ? happyHourFor(item).discountedPrice : item.price),
      variant: config.variant?.name || "",
      quantity: config.quantity,
      special_request: config.special_request || "",
      cooking_level: config.cooking_level || "",
      extras: config.extras || [],
      customer_name: config.customer_name || "",
    };

    setCart((prev) => {
      const k = cartLineKey(newLine);
      const idx = prev.findIndex((c) => cartLineKey(c) === k);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + newLine.quantity };
        return copy;
      }
      return [...prev, newLine];
    });

    (config.recommended_drinks || []).forEach((drink) => {
      const drinkLine = {
        cartId: Date.now() + Math.random(),
        name: drink.name,
        category: drink.category,
        drink_category: drink.drink_category,
        price: happyHourFor(drink)?.active ? happyHourFor(drink).discountedPrice : drink.price,
        quantity: 1,
        special_request: "",
        cooking_level: "",
        extras: [],
        customer_name: config.customer_name || "",
      };
      setCart((prev) => {
        const dk = cartLineKey(drinkLine);
        const di = prev.findIndex((c) => cartLineKey(c) === dk);
        if (di >= 0) {
          const copy = [...prev];
          copy[di] = { ...copy[di], quantity: copy[di].quantity + 1 };
          return copy;
        }
        return [...prev, drinkLine];
      });
    });
    setSelectedItem(null);
    toast({ title: t(lang, "addToCart"), description: item.name, duration: 4000 });
  };

  const quickAdd = (item) => {
    const hh = happyHourFor(item);
    const basePrice = hh?.active ? hh.discountedPrice : item.price;
    const newLine = {
      cartId: Date.now() + Math.random(),
      name: item.name,
      category: item.category,
      drink_category: item.drink_category,
      price: basePrice,
      quantity: 1,
      special_request: "",
      cooking_level: "",
      customer_name: "",
    };

    setCart((prev) => {
      const k = cartLineKey(newLine);
      const idx = prev.findIndex((c) => cartLineKey(c) === k);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, newLine];
    });
    toast({ title: t(lang, "addToCart"), description: item.name, duration: 4000 });
  };

  const updateQty = (cartId, delta) =>
    setCart((prev) => prev.map((c) => (c.cartId === cartId ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c)));

  const removeFromCart = (cartId) => setCart((prev) => prev.filter((c) => c.cartId !== cartId));

  const total = cart.reduce((s, i) => s + (i.price + (i.extras || []).reduce((es, e) => es + e.price, 0)) * i.quantity, 0);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);

  const callWaiter = async () => {
    if (!tenant?.id || waiterCooldown) return;
    if (!tableNumber) { toast({ title: t(lang, "noTableTitle"), description: t(lang, "noTableDesc") }); return; }
    await supabase.from('service_calls').insert([{
      tenant_id: tenant.id,
      table_number: parseInt(tableNumber) || 0,
      call_type: "waiter",
      status: "offen",
    }]);
    toast({ title: t(lang, "waiterCalledTitle"), description: t(lang, "waiterCalledDesc", tableNumber), duration: 5000 });
    setWaiterCooldown(true);
    setTimeout(() => setWaiterCooldown(false), 30000);
  };

  const requestPayment = async () => {
    if (!tenant?.id || paymentCooldown) return;
    if (!tableNumber) { toast({ title: t(lang, "noTableTitle"), description: t(lang, "noTableDesc") }); return; }
    await supabase.from('service_calls').insert([{
      tenant_id: tenant.id,
      table_number: parseInt(tableNumber) || 0,
      call_type: "payment",
      status: "offen",
    }]);
    toast({ title: t(lang, "paymentRequestedTitle"), description: t(lang, "paymentRequestedDesc", tableNumber), duration: 5000 });
    setPaymentCooldown(true);
    setTimeout(() => setPaymentCooldown(false), 30000);
  };

  const sendOrder = async (formData) => {
    const { data: existing } = await supabase
      .from('orders')
      .select('order_number, customer_name')
      .eq('tenant_id', tenant?.id)
      .order('created_at', { ascending: false })
      .limit(500);

    const maxNum = (existing || []).reduce((m, o) => {
      if (/^TEST -/.test(o.customer_name || "")) return m;
      const n = Number(o.order_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const orderNumber = maxNum + 1;

    const orderItems = cart.map(({ cartId, ...rest }) => {
      const menuItem = items.find((i) => i.name === rest.name);
      const itemGuestName = formData.billSplit === "split" && formData.guestName && !rest.customer_name
        ? formData.guestName
        : rest.customer_name;
      return { ...rest, station_id: menuItem?.station_id || null, customer_name: itemGuestName };
    });

    if (formData.freeDrinkName) {
      const drinkMenuItem = items.find((i) => i.name === formData.freeDrinkName);
      orderItems.push({
        name: formData.freeDrinkName,
        price: 0,
        quantity: 1,
        special_request: "Gratis-Beigabe (Vorbestellung)",
        cooking_level: "",
        station_id: drinkMenuItem?.station_id || null,
        extras: [],
        customer_name: "",
      });
    }
    const stationIds = [...new Set(orderItems.map((i) => i.station_id).filter(Boolean))];
    const station_status = {};
    stationIds.forEach((id) => { station_status[id] = "neu"; });

    const preorderLabel = formData.preorderTime
      ? `Vorbestellung für ${new Date(formData.preorderTime).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
      : null;
    const gestureConfig = tenant?.wait_gesture_config;
    const gestureEnabled = !!tenant?.features?.wait_gesture;
    const gestureThreshold = gestureConfig?.threshold_minutes || 0;
    const isRestaurant = tenant && isRestaurantType(tenant.business_type);
    const shouldGesture = isRestaurant && gestureEnabled && guestWaitMinutes != null && guestWaitMinutes > gestureThreshold;

    const requiresPrepayment = !!tenant?.features?.prepayment && (isTakeawayType(tenant?.business_type) || (hasTables && formData.paymentMode === "online"));
    if (requiresPrepayment && window.self !== window.top) {
      toast({ title: t(lang, "prepaymentIframeError") });
      return { error: "iframe" };
    }
    const orderData = {
      total_amount: formData.effectiveTotal ?? total,
      status: requiresPrepayment ? "wartet_auf_zahlung" : "neu",
      tenant_id: tenant?.id,
      order_number: orderNumber,
      items: orderItems,
      tip_amount: formData.tipAmount || 0,
      station_status: station_status,
      wait_gesture: shouldGesture,
      customer_name: formData.guestName || `${formData.firstName} ${formData.lastName}`.trim(),
      customer_note: [
        formData.note,
        preorderLabel,
        formData.billSplit === "split" && formData.guestName && `Rechnung getrennt: ${formData.guestName}`,
        formData.email && `Email: ${formData.email}`,
        formData.phone && `Tel: ${formData.phone}`,
        `Zahlung: ${formData.paymentMethod}`,
        excludedAllergens.length > 0 && `Allergie-Filter: ${excludedAllergens.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" | "),
    };
    if (hasTables) {
      orderData.table_number = parseInt(tableNumber) || 0;
    }

    const { data: created, error: createError } = await supabase.from('orders').insert([orderData]).select().single();
    if (createError) {
      toast({ title: "Fehler beim Absenden der Bestellung" });
      return { error: createError.message };
    }

    if (requiresPrepayment) {
      try {
        const response = await supabase.functions.invoke("createCheckoutSession", {
          body: {
            order_id: created.id,
            items: orderItems,
            total_amount: formData.effectiveTotal ?? total,
            tenant_id: tenant?.id,
            origin: window.location.origin,
          }
        });
        if (response?.data?.url) {
          window.location.href = response.data.url;
          return { orderNumber, redirecting: true };
        }
        throw new Error("No checkout URL received");
      } catch (err) {
        await supabase.from('orders').delete().eq('id', created.id);
        toast({ title: "Zahlung konnte nicht gestartet werden", description: "Bitte versuchen Sie es erneut." });
        return { error: "payment_failed" };
      }
    }

    if (isTakeawayType(tenant?.business_type)) {
      trackedOrderRef.current = { id: created.id, order_number: orderNumber, notified: false };
      setTrackedOrder(created.id, orderNumber);
    }

    if (isRestaurantType(tenant?.business_type)) {
      const hasFood = orderItems.some((i) => i.category && i.category !== "Getränk");
      const fu = followUpRef.current;
      if (!fu?.muted) {
        updateFollowUp({
          id: created.id,
          orderNumber,
          orderedAt: Date.now(),
          confirmedAt: hasFood ? null : (fu?.confirmedAt || null),
          drinkShown: false,
          dessertShown: hasFood ? false : (fu?.dessertShown || false),
          muted: false,
          lastOrderItems: orderItems,
        });
        setRoundOrderDrinks(getRoundOrderDrinks(orderItems));
      }
    }
    setTrackedReady(false);

    const orderedQuantities = {};
    cart.forEach((c) => {
      const menuItem = items.find((i) => i.name === c.name);
      if (menuItem) orderedQuantities[menuItem.id] = (orderedQuantities[menuItem.id] || 0) + c.quantity;
    });

    await Promise.all(
      Object.entries(orderedQuantities).map(async ([id, qty]) => {
        const menuItem = items.find((i) => i.id === id);
        if (menuItem && menuItem.stock_tracking_enabled && menuItem.stock_quantity != null) {
          const newStock = Math.max(0, (menuItem.stock_quantity || 0) - qty);
          const update = { stock_quantity: newStock };
          if (newStock === 0) update.status = "ausverkauft";
          await supabase.from('menu_items').update(update).eq('id', id);
        }
      })
    );

    setItems((prev) =>
      prev.map((i) => {
        if (orderedQuantities[i.id] && i.stock_tracking_enabled && i.stock_quantity != null) {
          const newStock = Math.max(0, (i.stock_quantity || 0) - orderedQuantities[i.id]);
          return { ...i, stock_quantity: newStock, status: newStock === 0 ? "ausverkauft" : i.status };
        }
        return i;
      })
    );

    const ref = hasTables ? `Tisch ${tableNumber} · Nr. ${orderNumber}` : `Bestellnummer #${orderNumber}`;
    setCart([]);
    toast({ title: t(lang, "orderSentToast"), description: ref });
    return { orderNumber, tableLabel: hasTables ? `Tisch ${tableNumber}` : null, waitMinutes: guestWaitMinutes };
  };

  const sendStaffOrder = async (formData) => {
    const { data: existing } = await supabase
      .from('orders')
      .select('order_number, customer_name')
      .eq('tenant_id', tenant?.id)
      .order('created_at', { ascending: false })
      .limit(500);

    const maxNum = (existing || []).reduce((m, o) => {
      if (/^TEST -/.test(o.customer_name || "")) return m;
      const n = Number(o.order_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const orderNumber = maxNum + 1;

    const orderItems = cart.map(({ cartId, ...rest }) => {
      const menuItem = items.find((i) => i.name === rest.name);
      return { ...rest, station_id: menuItem?.station_id || null };
    });
    const stationIds = [...new Set(orderItems.map((i) => i.station_id).filter(Boolean))];
    const station_status = {};
    stationIds.forEach((id) => { station_status[id] = "neu"; });

    const mitarbeiterLogin = effectiveFeatures(tenant).mitarbeiter_login;
    const orderData = {
      total_amount: total,
      status: "neu",
      tenant_id: tenant?.id,
      order_number: orderNumber,
      items: orderItems,
      station_status,
      table_number: parseInt(tableNumber) || 0,
      customer_name: formData.guestName || "",
      customer_note: formData.note || "",
      entered_by_staff: true,
      staff_member_name: mitarbeiterLogin ? (user?.full_name || "") : "",
    };
    await supabase.from('orders').insert([orderData]);

    const orderedQuantities = {};
    cart.forEach((c) => {
      const menuItem = items.find((i) => i.name === c.name);
      if (menuItem) orderedQuantities[menuItem.id] = (orderedQuantities[menuItem.id] || 0) + c.quantity;
    });

    await Promise.all(
      Object.entries(orderedQuantities).map(async ([id, qty]) => {
        const menuItem = items.find((i) => i.id === id);
        if (menuItem && menuItem.stock_tracking_enabled && menuItem.stock_quantity != null) {
          const newStock = Math.max(0, (menuItem.stock_quantity || 0) - qty);
          const update = { stock_quantity: newStock };
          if (newStock === 0) update.status = "ausverkauft";
          await supabase.from('menu_items').update(update).eq('id', id);
        }
      })
    );

    setItems((prev) =>
      prev.map((i) => {
        if (orderedQuantities[i.id] && i.stock_tracking_enabled && i.stock_quantity != null) {
          const newStock = Math.max(0, i.stock_quantity - orderedQuantities[i.id]);
          return { ...i, stock_quantity: newStock, status: newStock === 0 ? "ausverkauft" : i.status };
        }
        return i;
      })
    );

    setCart([]);
    toast({ title: ui(lang, "staffOrderSent"), description: `Tisch ${tableNumber} · Nr. ${orderNumber}` });
    return { orderNumber, tableLabel: `Tisch ${tableNumber}` };
  };

  const filteredItems = items.filter((i) => {
    if (i.hidden) return false;
    if (tenant?.draft_publish_enabled && !isPreview && i.publish_status !== "veroeffentlicht") return false;
    if (searchQuery && !i.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (onlyVeg && !i.is_vegetarian) return false;
    if (onlyNonAlc && i.drink_category && i.drink_category !== "alkoholfrei") return false;
    if (excludedAllergens.length && (i.allergens || []).some((a) => excludedAllergens.includes(a))) return false;
    return true;
  });

  const searching = searchQuery.trim().length > 0;
  const allSections = orderedSections(tenant, items, lang);
  const availableColumns = [...new Set(allSections.map((s) => s.column))];
  const showColumnTabs = availableColumns.length > 1;
  const currentColumn = availableColumns.includes(activeColumn) ? activeColumn : availableColumns[0] || null;

  const isDrinksColumn = currentColumn === "Getränk";
  const isFoodColumn = currentColumn === "Speise";

  const activeCatLabel = activeCategory && activeCategory !== "all"
    ? allSections.find((s) => s.key === activeCategory)?.label || null
    : null;
  const sectionHeading = activeCatLabel
    ? activeCatLabel
    : isDrinksColumn
      ? t(lang, "drinksMenu")
      : isFoodColumn
        ? t(lang, "menu")
        : columnTabLabel(currentColumn, lang);
  const countNoun = isDrinksColumn ? t(lang, "drinks") : isFoodColumn ? t(lang, "dishes") : t(lang, "articles");

  const sections = orderedSections(tenant, filteredItems, lang)
    .filter((s) => searching || s.column === currentColumn)
    .map((s) => ({ ...s, dishes: filteredItems.filter((i) => itemMatchesCategory(i, s.key)) }));
  const visibleCount = sections.reduce((n, s) => n + s.dishes.length, 0);

  const availableCategories = orderedSections(tenant, items, lang)
    .filter((s) => searching || s.column === currentColumn)
    .map((s) => ({ key: s.key, label: s.label }));

  const changeColumn = (col) => {
    setActiveColumn(col);
    setActiveCategory("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToSection = (category) => {
    setActiveCategory(category);
    const ALCOHOLIC_DRINK_CATEGORIES = ["Wein", "Cocktail", "Bier"];
    if (ALCOHOLIC_DRINK_CATEGORIES.includes(category)) {
      setOnlyNonAlc(false);
    } else if (category === "alkoholfrei") {
      setOnlyNonAlc(true);
    }
    if (category === "all") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.getElementById(`section-${category}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const openFollowUpDrinks = () => {
    setFollowUpOpen(false);
    changeColumn("Getränk");
    setActiveCategory("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openFollowUpDessert = () => {
    setFollowUpOpen(false);
    const sec = findDessertCategory(allSections);
    if (sec) {
      if (sec.column !== currentColumn) changeColumn(sec.column);
      scrollToSection(sec.key);
    } else {
      changeColumn("Speise");
      setActiveCategory("all");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleFollowUpMute = () => {
    updateFollowUp({ ...followUpRef.current, muted: true });
    setFollowUpOpen(false);
    toast({ title: t(lang, "remindersMutedTitle"), description: t(lang, "remindersMutedDesc") });
  };

  const handleRoundOrder = () => {
    roundOrderDrinks.forEach((d) => {
      const newLine = {
        cartId: Date.now() + Math.random(),
        name: d.name,
        category: "Getränk",
        drink_category: d.drink_category,
        price: d.price,
        quantity: d.quantity,
        special_request: "",
        cooking_level: "",
        customer_name: "",
      };
      setCart((prev) => {
        const k = cartLineKey(newLine);
        const idx = prev.findIndex((c) => cartLineKey(c) === k);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + newLine.quantity };
          return copy;
        }
        return [...prev, newLine];
      });
    });
    setFollowUpOpen(false);
    toast({ title: t(lang, "roundAddedTitle"), description: t(lang, "roundAddedDesc", roundOrderDrinks.reduce((s, d) => s + d.quantity, 0)) });
  };

  const handleSnackAdd = () => {
    if (!snackUpsell) return;
    quickAdd(snackUpsell);
    setSnackUpsell(null);
  };

  if (staffMode && !staffTable) {
    return (
      <div className={`${theme} min-h-screen bg-[var(--t-bg)] t-body text-[var(--t-text)]`}>
        <MenuHeader tenant={tenant} lang={lang} onLangChange={setLang} user={user} tenantId={tenantId || tenant?.id} cart={cart} tableNumber={tableNumber} staffMode={staffMode} />
        <StaffSetupGuide lang={lang} />
        {loading || !tenant ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-black/10 border-t-[var(--t-primary)]" />
          </div>
        ) : (
          <StaffTablePicker tenant={tenant} onPick={(n) => setStaffTable(n)} lang={lang} />
        )}
      </div>
    );
  }

  return (
    <div className={`${theme} min-h-screen max-w-[100vw] overflow-x-clip bg-[var(--t-bg)] t-body text-[var(--t-text)]`}>
      <MenuHeader tenant={tenant} lang={lang} onLangChange={setLang} user={user} tenantId={tenantId || tenant?.id} cart={cart} tableNumber={tableNumber} staffMode={staffMode} />

      {isPreview && (
        <div className="border-b border-amber-300 bg-amber-100">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 text-sm font-bold text-amber-900">
            <Eye className="h-4 w-4 shrink-0" />
            VORSCHAU-MODUS (Unveröffentlichte Entwurfsdaten)
          </div>
        </div>
      )}

      {staffMode && (
        <div className="border-b border-black/5 bg-[var(--t-surface)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
            <span className="t-heading text-sm font-bold text-[var(--t-text)]">
              {ui(lang, "staffOrderTitle")} · {ui(lang, "staffOrderTable")} {tableNumber || "—"}
            </span>
            <button
              onClick={() => setStaffTable(null)}
              className="rounded-full border border-black/10 bg-[var(--t-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--t-text)] transition hover:border-[var(--t-primary)]"
            >
              {ui(lang, "staffChangeTable")}
            </button>
          </div>
        </div>
      )}

      <MenuHero tenant={tenant} tableNumber={tableNumber} hasTables={hasTables} lang={lang} />
      {trialExpired && (
        <div className="border-b border-red-200 bg-red-50">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-sm text-red-800">
            <ClipboardList className="h-5 w-5 shrink-0 text-red-600" />
            <p className="font-medium">
              {lang === "de"
                ? "Die digitale Bestellung ist derzeit leider nicht verfügbar. Bitte bestellen Sie bei unserem Personal."
                : lang === "fr"
                  ? "La commande numérique est actuellement indisponible. Veuillez commander auprès de notre personnel."
                  : lang === "it"
                    ? "L'ordinazione digitale non è attualmente disponibile. Si prega di ordinare presso il nostro personale."
                    : "Digital ordering is currently unavailable. Please order with our staff."}
            </p>
          </div>
        </div>
      )}
      {viewOnly ? (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-sm text-amber-800">
            <ClipboardList className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="font-medium">
              {lang === "de"
                ? "Digitale Schaukasten-Karte: Zum Bestellen und Genießen freuen wir uns auf Ihren Besuch bei uns im Restaurant! Nehmen Sie einfach an einem Tisch Platz und scannen Sie den Code vor Ort."
                : lang === "fr"
                  ? "Carte vitrine numérique : Pour commander et profiter, nous vous attendons au restaurant ! Installez-vous à une table et scannez le code sur place."
                  : lang === "it"
                    ? "Menù vetrina digitale: Per ordinare e godervi il pasto, vi aspettiamo al ristorante! Accomodatevi a un tavolo e scansionate il codice sul posto."
                    : "Digital display menu: To order and enjoy, come visit us at the restaurant! Just take a seat at a table and scan the code there."}
            </p>
          </div>
        </div>
      ) : (
        !staffMode && (
          <>
            <PreorderBanner
              tenant={tenant}
              preorderDate={preorderDate}
              preorderTime={preorderTime}
              expanded={preorderModalOpen}
              onToggle={() => setPreorderModalOpen(true)}
            />
            <PreorderToggle
              preorderEnabled={preorderEnabled}
              open={preorderModalOpen}
              onClose={() => setPreorderModalOpen(false)}
              setOrderMode={setOrderMode}
              preorderDate={preorderDate}
              setPreorderDate={setPreorderDate}
              preorderTime={preorderTime}
              setPreorderTime={setPreorderTime}
              freeDrinkName={preorderFreeDrinkName}
              minLeadHours={preorderConfig?.min_lead_hours}
              openingHoursData={tenant?.opening_hours_data}
              lang={lang}
            />
          </>
        )
      )}

      <div className="sticky top-0 z-40 border-b border-black/5 bg-[var(--t-surface)]/95 shadow-sm backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3">
          {showColumnTabs && (
            <div className="mb-2 border-b border-black/5 pb-2">
              <ColumnTabs columns={availableColumns} active={currentColumn} onChange={changeColumn} lang={lang} />
            </div>
          )}
          <CategoryTabs categories={availableCategories} active={activeCategory} onChange={scrollToSection} lang={lang} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 pb-20 min-[980px]:pb-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="t-heading text-xl font-bold text-[var(--t-text)]">{sectionHeading}</h2>
            <p className="text-sm text-[var(--t-muted)]">{visibleCount} {countNoun}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!staffMode && hasTables && hasTableParam && tenant?.features?.service_call !== false && (
              <>
                <button
                  onClick={callWaiter}
                  disabled={waiterCooldown}
                  title={waiterCooldown ? "Kellner ist bereits benachrichtigt" : "Kellner rufen"}
                  className={`flex flex-col items-center gap-0.5 rounded-[var(--t-radius-pill)] border px-3 py-1.5 transition ${
                    waiterCooldown
                      ? "border-amber-300 bg-amber-50 text-amber-600 opacity-70"
                      : "border-black/10 bg-[var(--t-surface)] text-[var(--t-muted)] hover:border-[var(--t-primary)] hover:text-[var(--t-primary)]"
                  }`}
                >
                  <BellRing className="h-4 w-4" />
                  <span className="text-[10px] font-medium leading-none">
                    {waiterCooldown ? t(lang, "notified") : t(lang, "waiter")}
                  </span>
                </button>
                <button
                  onClick={requestPayment}
                  disabled={paymentCooldown}
                  title={paymentCooldown ? "Zahlung bereits angefordert" : "Zahlung wünschen"}
                  className={`flex flex-col items-center gap-0.5 rounded-[var(--t-radius-pill)] border px-3 py-1.5 transition ${
                    paymentCooldown
                      ? "border-amber-300 bg-amber-50 text-amber-600 opacity-70"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  <Receipt className="h-4 w-4" />
                  <span className="text-[10px] font-medium leading-none">
                    {paymentCooldown ? t(lang, "notified") : t(lang, "pay")}
                  </span>
                </button>
              </>
            )}
            <GuestFilter
              mode={isDrinksColumn ? "drinks" : "food"}
              excluded={excludedAllergens}
              onToggleAllergen={(key) =>
                setExcludedAllergens((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
              }
              onlyVeg={onlyVeg}
              onToggleVeg={() => setOnlyVeg((v) => !v)}
              onlyNonAlc={onlyNonAlc}
              onToggleNonAlc={() => setOnlyNonAlc((v) => !v)}
              onReset={() => {
                setExcludedAllergens([]);
                setOnlyVeg(false);
                setOnlyNonAlc(false);
              }}
              lang={lang}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--t-muted)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t(lang, "searchPlaceholder")}
                className="w-28 rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--t-primary)] min-[420px]:w-48"
              />
            </div>
            <span className="hidden whitespace-nowrap text-sm text-[var(--t-muted)] sm:inline">
              {visibleCount} {countNoun}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-6 min-[980px]:flex-row">
          <div className="w-full min-[980px]:flex-1">
            {loading ? (
              <div className="grid gap-4 min-[720px]:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-32 animate-pulse rounded-[var(--t-radius-card)] bg-black/5" />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <EmptyMenuState
                tenantId={tenant?.id}
                isStaff={isStaff}
                searchActive={items.length > 0}
                onImported={() =>
                  supabase
                    .from('menu_items')
                    .select('*')
                    .eq('tenant_id', tenant?.id)
                    .then(({ data }) => setItems(data || []))
                }
              />
            ) : (
              <div className="space-y-10">
                {sections.map((section) => (
                  <div key={section.key} id={`section-${section.key}`} className={showColumnTabs ? "scroll-mt-32" : "scroll-mt-20"}>
                    <div className="mb-4 border-b border-black/5 pb-2">
                      <h3 className="t-heading text-xl font-bold text-[var(--t-text)]">{section.label}</h3>
                    </div>
                    <div className="grid gap-4 min-[720px]:grid-cols-2">
                      {section.dishes.map((item) => (
                        <DishCard
                          key={item.id}
                          item={item}
                          viewOnly={viewOnly}
                          onClick={() => setSelectedItem(item)}
                          onQuickAdd={() => quickAdd(item)}
                          stationClosed={closedStationCategories[item.station_id] || null}
                          kitchenClosed={kitchenCurrentlyClosed && item.category !== "Getränk" && !hasCustomCatHours(item) && (!hasAfternoonMenu || !(item.available_during_break === true || (item.available_during_break === null && afternoonCategories.includes(item.category))))}
                          barClosed={barCurrentlyClosed && (item.category === "Getränk" || !!item.drink_category) && !hasCustomCatHours(item)}
                          categoryClosed={categoryClosedFor(item)}
                          lang={lang}
                          happyHour={happyHourFor(item)}
                          drinkSize={drinkSizeFor(item)}
                          recommendedDrinks={recommendedDrinksFor(item)}
                          onDrinkClick={(drink) => setSelectedItem(drink)}
                          liveTranslation={liveTranslations[item.id]}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!viewOnly && (
            <div className="hidden w-80 shrink-0 min-[980px]:block min-[1190px]:w-72">
              <div className="sticky top-32">
                <CartPanel
                  cart={cart}
                  total={total}
                  itemCount={itemCount}
                  onUpdateQty={updateQty}
                  onRemove={removeFromCart}
                  onCheckout={() => setCheckoutOpen(true)}
                  preorderLabel={preorderPickupLabel}
                  freeDrinkName={preorderFreeDrinkName}
                  onPreorderChange={() => setPreorderModalOpen(true)}
                  stressInfo={stressInfo}
                  lang={lang}
                  tenant={tenant}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {itemCount > 0 && !viewOnly && (
        <div className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-4 min-[980px]:hidden">
          <button
            onClick={() => setCartOpen(true)}
            className="flex w-full items-center justify-between rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] px-6 py-4 text-white shadow-2xl"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" /> {itemCount} {t(lang, "articles")}
            </span>
            <span className="font-bold">{formatCurrency(total)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 min-[980px]:hidden" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-[var(--t-radius-card)] bg-[var(--t-bg)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setCartOpen(false)}
              className="mb-3 ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-[var(--t-muted)]"
            >
              <X className="h-4 w-4" />
            </button>
            <CartPanel
              cart={cart}
              total={total}
              itemCount={itemCount}
              onUpdateQty={updateQty}
              onRemove={removeFromCart}
              onCheckout={() => {
                setCartOpen(false);
                setCheckoutOpen(true);
              }}
              preorderLabel={preorderPickupLabel}
              freeDrinkName={preorderFreeDrinkName}
              onPreorderChange={() => {
                setCartOpen(false);
                setOrderMode("preorder");
                document.getElementById("preorder-toggle")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              stressInfo={stressInfo}
              lang={lang}
              tenant={tenant}
            />
          </div>
        </div>
      )}

      {selectedItem && viewOnly && <ViewOnlyOrderHint item={selectedItem} onClose={() => setSelectedItem(null)} lang={lang} />}
      {selectedItem && !viewOnly && <MenuItemModal item={selectedItem} availableExtras={extras.filter((e) => selectedItem.available_extra_ids?.includes(e.id))} onAdd={addToCart} onClose={() => setSelectedItem(null)} lang={lang} happyHour={happyHourFor(selectedItem)} drinkSize={drinkSizeFor(selectedItem)} recommendedDrinks={recommendedDrinksFor(selectedItem)} liveTranslation={liveTranslations[selectedItem.id]} />}
      {checkoutOpen && staffMode && (
        <StaffCheckoutModal
          cart={cart}
          total={total}
          tableNumber={tableNumber}
          staffName={effectiveFeatures(tenant).mitarbeiter_login ? (user?.full_name || "") : ""}
          onClose={() => setCheckoutOpen(false)}
          onSubmit={sendStaffOrder}
          lang={lang}
        />
      )}
      {checkoutOpen && !staffMode && (
        <CheckoutModal
          cart={cart}
          total={total}
          tenant={tenant}
          hasTables={hasTables}
          tableNumber={tableNumber}
          onClose={() => setCheckoutOpen(false)}
          onSubmit={sendOrder}
          orderReady={trackedReady}
          stressInfo={stressInfo}
          lang={lang}
          orderMode={orderMode}
          setOrderMode={setOrderMode}
          preorderDate={preorderDate}
          setPreorderDate={setPreorderDate}
          preorderTime={preorderTime}
          setPreorderTime={setPreorderTime}
          isPreorder={isPreorder}
          freeDrinkName={preorderFreeDrinkName}
          timeSlots={preorderTimeSlots}
        />
      )}

      {followUpOpen && !staffMode && !viewOnly && isRestaurantType(tenant?.business_type) && (
        <FollowUpModal
          lang={lang}
          mode={followUpMode}
          highlights={followUpHighlights}
          onHighlight={(item) => { setSelectedItem(item); setFollowUpOpen(false); }}
          onBrowseAll={followUpMode === "drink" ? openFollowUpDrinks : openFollowUpDessert}
          onClose={() => setFollowUpOpen(false)}
          roundOrderDrinks={followUpMode === "drink" ? roundOrderDrinks : []}
          onRoundOrder={handleRoundOrder}
          onMute={handleFollowUpMute}
        />
      )}

      {snackUpsell && !viewOnly && !staffMode && (
        <SnackUpsellBanner
          item={snackUpsell}
          onAdd={handleSnackAdd}
          onDismiss={() => setSnackUpsell(null)}
          lang={lang}
        />
      )}

      {paymentSuccessOrder && (
        <PaymentSuccessOverlay
          order={paymentSuccessOrder}
          tenant={tenant}
          onClose={() => setPaymentSuccessOrder(null)}
        />
      )}

      {showWelcome && tenant && (() => {
        const isTake = isTakeawayType(tenant.business_type);
        const text = isTake
          ? (tenant.welcome_config?.takeaway_text || "Herzlich willkommen! Schön, dass du heute unser Gast bist. Guten Appetit!")
          : (tenant.welcome_config?.restaurant_text || "Herzlich willkommen! Schön, dass du heute unser Gast bist. Guten Appetit!");
        return <WelcomeOverlay text={text} onClose={() => setShowWelcome(false)} />;
      })()}

      {showDailyTip && tenant && (() => {
        const isTake = isTakeawayType(tenant.business_type);
        const tipText = isTake
          ? (tenant.daily_tip_config?.takeaway_text || "")
          : (tenant.daily_tip_config?.restaurant_text || "");
        return <DailyTipOverlay text={tipText} onClose={() => setShowDailyTip(false)} />;
      })()}

      {searchParams.get("demo") === "1" && tenantId && (
        <DemoQrOverlay tenantId={tenantId} tenantName={tenant?.name} />
      )}

      <MenuFooter tenantId={tenantId || tenant?.id} lang={lang} />
    </div>
  );
}