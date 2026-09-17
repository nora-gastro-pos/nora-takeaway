import React, { useState } from "react";
import { formatCurrency, todayString } from "@/lib/constants";
import { computeVatBreakdown } from "@/lib/vat";
import VatSummary from "@/components/menu/VatSummary";
import { X, CreditCard, Smartphone, Banknote, Landmark, CheckCircle2, ArrowLeft, Users, User, Wallet } from "lucide-react";
import { t } from "@/lib/i18n";
import OrderReadyPermission from "@/components/menu/OrderReadyPermission";
import { getGuestName, setGuestName as storeGuestName, getActivePaymentMethod, setActivePaymentMethod } from "@/lib/guestSession";

export default function CheckoutModal({ cart, total, tenant, hasTables, tableNumber, onClose, onSubmit, orderReady = false, stressInfo, lang = "de", orderMode, setOrderMode, preorderDate, setPreorderDate, preorderTime, setPreorderTime, isPreorder, freeDrinkName, timeSlots }) {
  const isTakeawayType = tenant && ["takeaway", "takeaway_seating"].includes(tenant.business_type);
  // Take-Away über allgemeinen Speisekarten-QR-Code: Bestellung nur mit
  // Angabe von Name und Telefonnummer möglich (Schutz vor Scherzbestellungen).
  const requiresContact = !!isTakeawayType;
  const PAYMENT_METHODS = [
    { value: "karte", label: t(lang, "payCard"), icon: CreditCard },
    { value: "mobile", label: t(lang, "payMobile"), icon: Smartphone },
    { value: "vorort", label: t(lang, "payOnSite"), icon: Banknote },
    ...(tenant?.bank_iban ? [{ value: "ueberweisung", label: t(lang, "payTransfer"), icon: Landmark }] : []),
  ].filter((m) => tenant?.payment_methods?.[m.value] !== false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("karte");
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const prepaymentEnabled = !!tenant?.features?.prepayment;
  const prepaymentRequired = prepaymentEnabled && isTakeawayType;
  const prepaymentOptional = prepaymentEnabled && !isTakeawayType && hasTables;
  // Bezahl-Gabelung: bei Pre-Payment-fähigen Restaurant-Betrieben wählt der
  // Gast am Ende des Checkouts zwischen "Sofort digital" und "Später an der
  // Kasse". Die Wahl wird pro Tisch in der Session gespeichert, damit alle
  // Nachbestellungen automatisch dieselbe Bezahlart verwenden.
  const savedPayMethod = getActivePaymentMethod(tenant?.id, tableNumber);
  const [paymentMode, setPaymentMode] = useState(savedPayMethod || "online");
  const [tipMode, setTipMode] = useState("none");
  const [tipCustom, setTipCustom] = useState("");

  // Schritt-Flow: 'payment' → 'split' → 'details'
  const storedName = getGuestName(tenant?.id, tableNumber);
  const [step, setStep] = useState(() => {
    if (hasTables && !isTakeawayType) return "split";
    return "details";
  });
  const [billMode, setBillMode] = useState(storedName ? "split" : "total");
  const [splitName, setSplitName] = useState(storedName || "");
  const [editingName, setEditingName] = useState(false);
  const [activeGuestName, setActiveGuestName] = useState(storedName || "");
  const contactMissing = requiresContact && (!firstName.trim() || !phone.trim());

  const preorderConfig = tenant?.preorder_config;
  const preorderEnabled = preorderConfig?.enabled;
  const gestureConfig = tenant?.wait_gesture_config;
  const gestureEnabled = !!tenant?.features?.wait_gesture;
  const gestureThreshold = gestureConfig?.threshold_minutes || 0;
  const gestureText = gestureConfig?.gesture_text || "";
  const hasFoodItems = cart.some((i) => i.category && i.category !== "Getränk");
  const discountPercent = isPreorder && hasFoodItems && preorderConfig.reward_type === "discount" ? preorderConfig.discount_percent || 0 : 0;
  const serviceFee = tenant?.service_fee || 0;
  const discountAmount = Math.round(total * (discountPercent / 100) * 100) / 100;
  const tipValue = tipMode === "custom" ? Math.max(0, parseFloat(tipCustom) || 0) : tipMode === "none" ? 0 : Math.round(total * (parseInt(tipMode) / 100) * 100) / 100;
  const effectiveTotal = Math.max(0, total - discountAmount) + serviceFee + tipValue;

  const handleSubmit = async (overridePaymentMode) => {
    setSubmitting(true);
    try {
      const finalGuestName = billMode === "split" ? splitName.trim() : "";
      if (finalGuestName) storeGuestName(tenant?.id, tableNumber, finalGuestName);
      const resolvedPaymentMode = overridePaymentMode || paymentMode;
      const result = await onSubmit({
        firstName,
        lastName,
        email,
        phone,
        note,
        paymentMethod,
        effectiveTotal,
        tipAmount: tipValue,
        preorderTime: isPreorder ? `${preorderDate}T${preorderTime}` : null,
        freeDrinkName: freeDrinkName,
        newsletterOptIn,
        fullName: `${firstName} ${lastName}`.trim(),
        paymentMode: prepaymentRequired ? "online" : (prepaymentOptional ? resolvedPaymentMode : "later"),
        guestName: finalGuestName,
        billSplit: billMode,
      });
      if (result && !result.error) setOrderRef(result);
    } finally {
      setSubmitting(false);
    }
  };

  if (orderRef) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
        onClick={onClose}
      >
        <div
          className={`w-full max-w-md rounded-t-[var(--t-radius-card)] p-8 text-center shadow-2xl sm:rounded-[var(--t-radius-card)] ${orderReady ? "border-2 border-emerald-200 bg-emerald-50" : "bg-[var(--t-surface)]"}`}
          onClick={(e) => e.stopPropagation()}
        >
          {orderReady ? (
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
          ) : (
            <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-500" />
          )}
          <h2 className="t-heading text-xl font-bold text-[var(--t-text)]">{orderReady ? t(lang, "orderReady") : t(lang, "orderSent")}</h2>
          <p className="mt-3 text-sm text-[var(--t-muted)]">{t(lang, "yourOrderNumber")}</p>
          <p className={`t-heading text-5xl font-bold ${orderReady ? "text-emerald-600" : "text-[var(--t-primary)]"}`}>#{orderRef.orderNumber}</p>
          {orderRef.tableLabel && (
            <p className="mt-2 text-sm font-medium text-[var(--t-text)]">{orderRef.tableLabel}</p>
          )}
          {!orderReady && orderRef.waitMinutes != null && stressInfo && (
            <p className="mt-2 flex items-center justify-center gap-2 text-sm font-medium text-[var(--t-text)]">
              <span className={`h-2.5 w-2.5 rounded-full ${stressInfo.dotColor}`} />
              {t(lang, "waitInfo", orderRef.waitMinutes)}
            </p>
          )}
          {!orderReady && orderRef.waitMinutes != null && gestureEnabled && gestureText && orderRef.waitMinutes > gestureThreshold && (
            <p className="mt-2 rounded-[var(--t-radius-card)] bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
              🎁 {t(lang, "waitGesture", gestureText)}
            </p>
          )}
          {orderReady ? (
            <div className="mt-4 rounded-[var(--t-radius-card)] border-2 border-emerald-300 bg-emerald-100/70 px-5 py-4 text-center">
              <p className="text-sm font-semibold text-emerald-700">{t(lang, "orderReadyHint")}</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--t-muted)]">{t(lang, "kitchenReceived")}</p>
              {isTakeawayType && <OrderReadyPermission lang={lang} />}
            </>
          )}
          <button
            onClick={onClose}
            className="mt-6 w-full rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] py-3.5 font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {t(lang, "anotherOrder")}
          </button>
          <button
            onClick={onClose}
            className="mt-3 w-full rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] py-3 text-sm font-medium text-[var(--t-text)] transition hover:bg-black/5"
          >
            {t(lang, "noFurtherOrders")}
          </button>
        </div>
      </div>
    );
  }

  // (Die Bezahl-Wahl erfolgt nun nach dem Klick auf "Bestellung abschicken"
  //  im Schritt "payChoice" – siehe unten. Der frühere Pre-Submit-Payment-
  //  Schritt vor den Details wurde zugunsten dieses Post-Submit-Flows entfernt.)

  // === Step 2: Rechnung teilen ===
  if (step === "split") {
    const showStoredName = activeGuestName && !editingName;
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
        <div className="w-full max-w-md rounded-t-[var(--t-radius-card)] bg-[var(--t-surface)] p-6 shadow-2xl sm:rounded-[var(--t-radius-card)]" onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="t-heading text-lg font-bold text-[var(--t-text)]">{t(lang, "splitStepTitle")}</h2>
            <button onClick={onClose} className="rounded-full p-2 text-[var(--t-muted)] hover:bg-black/5"><X className="h-5 w-5" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setBillMode("total")}
              className={`flex flex-col items-center gap-2 rounded-[var(--t-radius-card)] border-2 p-5 transition ${billMode === "total" ? "border-[var(--t-primary)] t-primary-tint" : "border-black/10 hover:bg-black/5"}`}>
              <Users className="h-6 w-6 text-[var(--t-primary)]" />
              <span className="text-sm font-semibold text-[var(--t-text)]">{t(lang, "billTotal")}</span>
            </button>
            <button onClick={() => setBillMode("split")}
              className={`flex flex-col items-center gap-2 rounded-[var(--t-radius-card)] border-2 p-5 transition ${billMode === "split" ? "border-[var(--t-primary)] t-primary-tint" : "border-black/10 hover:bg-black/5"}`}>
              <User className="h-6 w-6 text-[var(--t-primary)]" />
              <span className="text-sm font-semibold text-[var(--t-text)]">{t(lang, "billSplit")}</span>
            </button>
          </div>
          {billMode === "split" && showStoredName && (
            <div className="mt-4 rounded-[var(--t-radius-card)] border border-[var(--t-primary)]/30 t-primary-tint p-4">
              <p className="text-sm font-medium text-[var(--t-text)]">{t(lang, "orderForName", activeGuestName)}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setStep("details")} className="flex-1 rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] py-3 font-semibold text-white shadow-md transition hover:opacity-90">
                  {t(lang, "stepContinue")}
                </button>
                <button onClick={() => setEditingName(true)} className="rounded-[var(--t-radius-pill)] border border-black/10 px-4 py-3 text-sm font-medium text-[var(--t-text)] transition hover:bg-black/5">
                  {t(lang, "changeName")}
                </button>
              </div>
            </div>
          )}
          {billMode === "split" && !showStoredName && (
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-[var(--t-text)]">{t(lang, "splitNameLabel")}</label>
              <input value={splitName} onChange={(e) => setSplitName(e.target.value)} placeholder={t(lang, "splitNamePlaceholder")}
                className="w-full rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]" />
              <button onClick={() => { if (splitName.trim()) { setActiveGuestName(splitName.trim()); setEditingName(false); setStep("details"); } }}
                disabled={!splitName.trim()}
                className="mt-3 w-full rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] py-3.5 font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-50">
                {t(lang, "stepContinue")}
              </button>
              {!splitName.trim() && (
                <p className="mt-2 text-center text-xs font-medium text-amber-600">{t(lang, "splitNameRequired")}</p>
              )}
            </div>
          )}
          {billMode === "total" && (
            <button onClick={() => setStep("details")} className="mt-4 w-full rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] py-3.5 font-semibold text-white shadow-md transition hover:opacity-90">
              {t(lang, "stepContinue")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // === Bezahl-Gabelung (nach Klick auf "Bestellung abschicken") ===
  if (step === "payChoice") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
        <div className="w-full max-w-md rounded-t-[var(--t-radius-card)] bg-[var(--t-surface)] p-6 shadow-2xl sm:rounded-[var(--t-radius-card)]" onClick={(e) => e.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="t-heading text-lg font-bold text-[var(--t-text)]">{t(lang, "payChoiceTitle")}</h2>
            <button onClick={() => setStep("details")} className="rounded-full p-2 text-[var(--t-muted)] hover:bg-black/5"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-3">
            <button onClick={() => { setActivePaymentMethod(tenant?.id, tableNumber, "online"); handleSubmit("online"); }}
              className="flex w-full items-center gap-3 rounded-[var(--t-radius-card)] border-2 border-emerald-300 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100">
              <Smartphone className="h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-700">{t(lang, "payChoiceDigital")}</p>
                <p className="text-xs text-emerald-600">{t(lang, "payChoiceDigitalDesc")}</p>
              </div>
            </button>
            <button onClick={() => { setActivePaymentMethod(tenant?.id, tableNumber, "later"); handleSubmit("later"); }}
              className="flex w-full items-center gap-3 rounded-[var(--t-radius-card)] border-2 border-black/10 p-4 text-left transition hover:bg-black/5">
              <Wallet className="h-6 w-6 shrink-0 text-[var(--t-primary)]" />
              <div>
                <p className="font-semibold text-[var(--t-text)]">{t(lang, "payChoiceKasse")}</p>
                <p className="text-xs text-[var(--t-muted)]">{t(lang, "payChoiceKasseDesc")}</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Step 3: Details ===
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[var(--t-radius-card)] bg-[var(--t-surface)] p-6 shadow-2xl sm:rounded-[var(--t-radius-card)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-heading text-lg font-bold text-[var(--t-text)]">{t(lang, "completeOrder")}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--t-muted)] hover:bg-black/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {hasTables && !isTakeawayType && (
          <button onClick={() => setStep("split")} className="mb-3 flex items-center gap-1 text-sm text-[var(--t-muted)] hover:text-[var(--t-primary)]">
            <ArrowLeft className="h-4 w-4" /> {t(lang, "stepBack")}
          </button>
        )}

        {activeGuestName && (
          <div className="mb-4 flex items-center justify-between rounded-[var(--t-radius-card)] border border-[var(--t-primary)]/30 t-primary-tint p-3">
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)]">
              <User className="h-4 w-4 text-[var(--t-primary)]" />
              {t(lang, "orderForName", activeGuestName)}
            </span>
            <button onClick={() => { setEditingName(true); setStep("split"); }} className="text-xs font-semibold text-[var(--t-primary)] hover:underline">
              {t(lang, "changeName")}
            </button>
          </div>
        )}

        <p className="mb-4 text-sm text-[var(--t-muted)]">
          {hasTables ? t(lang, "tableInfo", tableNumber) : t(lang, "takeawayInfo")}
        </p>

        {(!hasTables || isTakeawayType) && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t(lang, "firstName")}
                className="rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t(lang, "lastName")}
                className="rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]"
              />
            </div>
            <p className="mt-2 text-xs text-[var(--t-muted)]">{t(lang, "nameHint")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(lang, "email")}
                className="rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t(lang, "phone")}
                className="rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]"
              />
            </div>
          </>
        )}

        {preorderEnabled && (
          <div className="mt-4 rounded-[var(--t-radius-card)] border border-black/10 p-4">
            <label className="mb-2 block text-sm font-medium text-[var(--t-text)]">{t(lang, "pickupTime")}</label>
            <div className="flex gap-2">
              <button
                onClick={() => setOrderMode("now")}
                className={`flex-1 rounded-[var(--t-radius-pill)] border py-2 text-sm font-medium transition ${orderMode === "now" ? "border-[var(--t-primary)] t-primary-tint text-[var(--t-text)]" : "border-black/10 text-[var(--t-muted)]"}`}
              >
                {t(lang, "immediately")}
              </button>
              <button
                onClick={() => setOrderMode("preorder")}
                className={`flex-1 rounded-[var(--t-radius-pill)] border py-2 text-sm font-medium transition ${orderMode === "preorder" ? "border-[var(--t-primary)] t-primary-tint text-[var(--t-text)]" : "border-black/10 text-[var(--t-muted)]"}`}
              >
                {t(lang, "preorder")}
              </button>
            </div>
            {orderMode === "preorder" && (
              <>
                <p className="mt-2 block rounded-[var(--t-radius-pill)] t-primary-tint px-2.5 py-1 text-xs font-medium text-[var(--t-primary)]">
                  {preorderConfig.reward_type === "discount"
                    ? t(lang, "preorderDiscount", preorderConfig.discount_percent)
                    : t(lang, "preorderDrink", preorderConfig.free_drink_name)}
                </p>
                <input
                  type="date"
                  value={preorderDate}
                  min={todayString()}
                  onChange={(e) => { setPreorderDate(e.target.value); setPreorderTime(""); }}
                  className="mt-2 w-full rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-3 text-sm outline-none focus:border-[var(--t-primary)]"
                />
                {preorderDate && (
                  <div className="mt-2">
                    {timeSlots.length > 0 ? (
                      <div className="grid grid-cols-4 gap-1.5">
                        {timeSlots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setPreorderTime(slot)}
                            className={`rounded-[var(--t-radius-pill)] border py-2 text-xs font-medium transition ${preorderTime === slot ? "border-[var(--t-primary)] t-primary-tint text-[var(--t-primary)]" : "border-black/10 text-[var(--t-muted)] hover:bg-black/5"}`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--t-muted)]">An diesem Tag sind keine Öffnungszeiten hinterlegt.</p>
                    )}
                  </div>
                )}
              </>
            )}
            {isPreorder && (
              <p className="mt-2 text-sm font-medium text-emerald-600">
                {preorderConfig.reward_type === "discount"
                  ? t(lang, "discountApplied", discountPercent)
                  : t(lang, "freeDrinkApplied", preorderConfig.free_drink_name)}
              </p>
            )}
          </div>
        )}

        {prepaymentRequired && (
          <div className="mt-4 rounded-[var(--t-radius-card)] border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-700">{t(lang, "prepaymentRequired")}</p>
            <p className="mt-1 text-xs text-emerald-600">{t(lang, "prepaymentOnlineNote")}</p>
          </div>
        )}
        {/* Zahlungswunsch für die Abrechnung vor Ort (wird an Küche/Personal übermittelt) */}
        <label className="mb-2 mt-4 block text-sm font-medium text-[var(--t-text)]">{t(lang, "paymentWish")}</label>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                onClick={() => setPaymentMethod(m.value)}
                className={`flex flex-col items-center gap-1.5 rounded-[var(--t-radius-card)] border p-4 transition ${
                  paymentMethod === m.value
                    ? "border-[var(--t-primary)] t-primary-tint"
                    : "border-black/10 hover:bg-black/5"
                }`}
              >
                <Icon className="h-6 w-6 text-[var(--t-primary)]" />
                <span className="text-xs font-medium text-[var(--t-text)]">{m.label}</span>
              </button>
            );
          })}
        </div>

        {paymentMethod === "ueberweisung" && tenant?.bank_iban && (
          <div className="mt-3 rounded-[var(--t-radius-card)] border border-black/10 bg-[var(--t-surface)] p-4">
            <p className="text-sm font-medium text-[var(--t-text)]">{t(lang, "bankDetailsHint")}</p>
            <p className="mt-2 break-all rounded-[var(--t-radius-pill)] bg-black/[0.03] px-3 py-2 text-sm text-[var(--t-text)]">{tenant.bank_iban}</p>
          </div>
        )}

        {/* Trinkgeld-Sektion – vor der Zusammenfassung, damit der Gast vor
            dem eigentlichen Bezahlschritt (Stripe/Mobile Pay) ein Trinkgeld
            wählen kann. Das Trinkgeld wird als tip_amount an die Order-Entity
            weitergereicht und in der Kassa/Tagesabschluss verbucht. */}
        <div className="mt-4 rounded-[var(--t-radius-card)] border border-black/10 p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--t-text)]">{t(lang, "tipTitle")}</h3>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => setTipMode("none")}
              className={`rounded-[var(--t-radius-pill)] border py-2 text-xs font-medium transition ${tipMode === "none" ? "border-[var(--t-primary)] t-primary-tint text-[var(--t-primary)]" : "border-black/10 text-[var(--t-muted)] hover:bg-black/5"}`}
            >
              {t(lang, "tipNone")}
            </button>
            {["5", "10", "15"].map((p) => (
              <button
                key={p}
                onClick={() => setTipMode(p)}
                className={`rounded-[var(--t-radius-pill)] border py-2 text-xs font-medium transition ${tipMode === p ? "border-[var(--t-primary)] t-primary-tint text-[var(--t-primary)]" : "border-black/10 text-[var(--t-muted)] hover:bg-black/5"}`}
              >
                +{p}%
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={tipCustom}
              onChange={(e) => { setTipCustom(e.target.value); setTipMode("custom"); }}
              placeholder={t(lang, "tipCustom")}
              className="flex-1 rounded-[var(--t-radius-pill)] border border-black/10 bg-[var(--t-surface)] p-2.5 text-sm outline-none focus:border-[var(--t-primary)]"
            />
            <span className="text-sm font-medium text-[var(--t-muted)]">€</span>
          </div>
          {tipValue > 0 && (
            <p className="mt-2 text-xs font-medium text-emerald-600">
              +{formatCurrency(tipValue)} {t(lang, "tipTitle")}
            </p>
          )}
        </div>

        <div className="mt-4 rounded-[var(--t-radius-card)] bg-black/[0.02] p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--t-text)]">{t(lang, "summary")}</h3>
          <div className="space-y-1">
            {cart.map((item) => (
              <div key={item.cartId} className="flex justify-between text-sm">
                <span className="text-[var(--t-muted)]">
                  {item.quantity}× {item.name}
                </span>
                <span className="text-[var(--t-text)]">{formatCurrency(item.price * item.quantity)}</span>
              </div>
            ))}
            {freeDrinkName && (
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600">🎁 1× {freeDrinkName} (Gratis)</span>
                <span className="text-emerald-600">{formatCurrency(0)}</span>
              </div>
            )}
          </div>
          {discountAmount > 0 && (
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-[var(--t-muted)]">{t(lang, "preorderDiscountLabel", discountPercent)}</span>
              <span className="font-medium text-emerald-600">−{formatCurrency(discountAmount)}</span>
            </div>
          )}
          {serviceFee > 0 && (
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-[var(--t-muted)]">{t(lang, "service")}</span>
              <span className="font-medium text-[var(--t-text)]">{formatCurrency(serviceFee)}</span>
            </div>
          )}
          {tipValue > 0 && (
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-[var(--t-muted)]">{t(lang, "tipTitle")}</span>
              <span className="font-medium text-[var(--t-text)]">{formatCurrency(tipValue)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-black/10 pt-2 font-bold">
            <span className="text-[var(--t-text)]">{t(lang, "total")}</span>
            <span className="t-heading text-[var(--t-primary)]">{formatCurrency(effectiveTotal)}</span>
          </div>
          <VatSummary breakdown={computeVatBreakdown(cart, tenant, effectiveTotal)} />
        </div>

        {prepaymentOptional && savedPayMethod && (
          <div className="mt-4 rounded-[var(--t-radius-card)] border border-[var(--t-primary)]/30 t-primary-tint p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)]">
                <Wallet className="h-4 w-4 text-[var(--t-primary)]" />
                {t(lang, "payChoiceSavedNote")}: {savedPayMethod === "online" ? t(lang, "payChoiceSavedDigital") : t(lang, "payChoiceSavedKasse")}
              </span>
              <button onClick={() => { setActivePaymentMethod(tenant?.id, tableNumber, ""); setStep("payChoice"); }} className="text-xs font-semibold text-[var(--t-primary)] hover:underline">
                {t(lang, "payChoiceChange")}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            if (prepaymentOptional && !savedPayMethod) {
              setStep("payChoice");
            } else {
              handleSubmit();
            }
          }}
          disabled={submitting || contactMissing}
          className="mt-5 w-full rounded-[var(--t-radius-pill)] bg-[var(--t-primary)] py-4 font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting
            ? (prepaymentRequired || (prepaymentOptional && paymentMode === "online") ? t(lang, "prepaymentRedirecting") : t(lang, "sending"))
            : t(lang, "sendOrder", formatCurrency(effectiveTotal))}
        </button>
        {contactMissing && (
          <p className="mt-2 text-center text-xs font-medium text-amber-600">
            {lang === "de"
              ? "Bitte Name und Telefonnummer angeben, um zu bestellen."
              : lang === "fr"
                ? "Veuillez indiquer votre nom et numéro de téléphone pour commander."
                : lang === "it"
                  ? "Inserisci nome e numero di telefono per ordinare."
                  : "Please provide your name and phone number to order."}
          </p>
        )}
      </div>
    </div>
  );
}