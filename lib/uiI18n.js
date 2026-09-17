const UI_STRINGS = {
  de: {
    staffOrderTitle: "Mitarbeiter-Bestellung",
    staffOrderTable: "Tisch",
    staffChangeTable: "Tisch wechseln",
    staffOrderSent: "Bestellung erfolgreich aufgegeben",
  },
  en: {
    staffOrderTitle: "Staff Order",
    staffOrderTable: "Table",
    staffChangeTable: "Change table",
    staffOrderSent: "Order placed successfully",
  },
  fr: {
    staffOrderTitle: "Commande du personnel",
    staffOrderTable: "Table",
    staffChangeTable: "Changer de table",
    staffOrderSent: "Commande passée avec succès",
  },
  it: {
    staffOrderTitle: "Ordine del personale",
    staffOrderTable: "Tavolo",
    staffChangeTable: "Cambia tavolo",
    staffOrderSent: "Ordine inviato con successo",
  },
};

export function ui(lang, key) {
  const dict = UI_STRINGS[lang] || UI_STRINGS.de;
  return dict[key] || UI_STRINGS.de[key] || key;
}