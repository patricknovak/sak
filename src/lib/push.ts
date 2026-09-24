import { supabase } from './supabase';

export const VAPID_PUBLIC = 'BEz86QWfjI0MlV7iV33KCnUSAahyR9UGXZ3O4MbbVil9vzmYXkoG6i_DhhWP8SYhjdwMcjVxCvGeU50IWMW2P20';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhones only allow web push once the site is added to the Home Screen
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const b64ToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function swReg() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('./')) ?? navigator.serviceWorker.register('./sw.js', { scope: './' });
}

export async function currentSubscription() {
  const reg = await swReg();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'On iPhone, add SaK to your Home Screen first, then turn this on from there.' : 'This browser can’t do push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
  const reg = await swReg();
  if (!reg) throw new Error('Couldn’t start the notification service.');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent });
  if (error) throw error;
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('push', { body: { test: true } });
  if (error) throw error;
  return data as { devices: number; sent: number; gone: number };
}
