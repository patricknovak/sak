// Installing the app on a phone's Home Screen (24 October 2026, Patrick: Safari's address bar and toolbar take a fifth
// of the screen). Opened from the Home Screen the app runs full screen, and on an iPhone it is the only way phone alerts
// work. Chrome on Android offers its own install prompt, kept here until the member taps Install; Safari has none, so the
// site shows the steps instead.
import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from './push';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}

export type InstallPlatform = 'ios' | 'android' | 'other';
export const installPlatform = (): InstallPlatform => (isIOS() ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'other');

export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return {
    platform: installPlatform(),
    standalone: isStandalone(),
    canPrompt: !!deferred,
    // Chrome's own install sheet; true when the member installed
    prompt: async () => {
      if (!deferred) return false;
      const e = deferred;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferred = null;
      listeners.forEach((f) => f());
      return outcome === 'accepted';
    },
  };
}

// the Home page's prompt waits a week after "Not now" and a month after it's closed
const HIDE = 'sp-install-hide-until';
export const installHidden = () => { try { return Number(localStorage.getItem(HIDE) ?? 0) > Date.now(); } catch { return true; } };
export const hideInstall = (days: number) => { try { localStorage.setItem(HIDE, String(Date.now() + days * 86400000)); } catch { /* nothing to remember with */ } };
