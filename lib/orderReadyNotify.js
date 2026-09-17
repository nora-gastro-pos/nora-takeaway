export async function ensureNotifySW() {
  if ('serviceWorker' in navigator && 'Notification' in window) {
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {}
  }
}

export function getTrackedOrder() {
  try {
    const raw = sessionStorage.getItem('nora_tracked_order');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setTrackedOrder(id, orderNumber) {
  try {
    sessionStorage.setItem('nora_tracked_order', JSON.stringify({ id, orderNumber, notified: false }));
  } catch {}
}

export function markTrackedNotified() {
  try {
    const tr = getTrackedOrder();
    if (tr) {
      sessionStorage.setItem('nora_tracked_order', JSON.stringify({ ...tr, notified: true }));
    }
  } catch {}
}

export async function fireReadyNotification(orderNum) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') {
    new Notification(`Bestellung #${orderNum} ist bereit!`, {
      body: 'Dein Essen / Getränk kann abgeholt oder serviert werden.',
    });
    return true;
  }
  return false;
}