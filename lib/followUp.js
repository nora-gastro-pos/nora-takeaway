export const DEFAULT_DRINK_MINUTES = 10;
export const DEFAULT_DESSERT_MINUTES = 30;

export function getFollowUpTrack() {
  try {
    const raw = sessionStorage.getItem('nora_follow_up');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setFollowUpTrack(track) {
  try {
    sessionStorage.setItem('nora_follow_up', JSON.stringify(track));
  } catch {}
}

export function findDessertCategory(sections = []) {
  return sections.find((s) => /dessert|nachspeise|süß/i.test(s.key) || /dessert|nachspeise|süß/i.test(s.label));
}

export function getDrinkHighlights(items = []) {
  return items.filter((i) => i.category === 'Getränk' || i.drink_category).slice(0, 4);
}

export function getDessertHighlights(items = [], sections = []) {
  const dessertSec = findDessertCategory(sections);
  if (dessertSec) {
    return items.filter((i) => i.category === dessertSec.key).slice(0, 4);
  }
  return items.filter((i) => /dessert|nachspeise/i.test(i.category)).slice(0, 4);
}

export function getSnackItem(items = []) {
  return items.find((i) => /snack|knabber|chips|nüsse/i.test(i.category) || /snack|chips/i.test(i.name));
}

export function getRoundOrderDrinks(orderItems = []) {
  return orderItems.filter((i) => i.category === 'Getränk' || i.drink_category);
}