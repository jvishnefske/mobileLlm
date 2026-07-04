// Frictionless add-to-home-screen:
//  - Android/Chrome: capture `beforeinstallprompt` and offer a one-tap button.
//  - iOS/Safari: no API exists, so show precise Share → Add to Home Screen steps.
// The banner hides itself when already installed or previously dismissed.

import * as storage from './storage';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'install-banner-dismissed';

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac, but has touch.
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function setupInstallBanner(): void {
  const banner = document.getElementById('install-banner')!;
  const content = document.getElementById('install-content')!;
  const dismiss = document.getElementById('install-dismiss')!;

  if (isStandalone() || storage.getItem(DISMISS_KEY)) return;

  dismiss.addEventListener('click', () => {
    banner.hidden = true;
    storage.setItem(DISMISS_KEY, "1");
  });

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    content.innerHTML = '';
    const label = document.createElement('div');
    label.textContent = '📱 Install this app for offline use — one tap:';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Add to Home Screen';
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice.outcome === 'accepted') banner.hidden = true;
    });
    content.append(label, btn);
    banner.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    banner.hidden = true;
  });

  if (isIos()) {
    content.innerHTML = '';
    const label = document.createElement('div');
    label.textContent = '📱 Install this app for offline use:';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Add to Home Screen';
    const hint = document.createElement('div');
    hint.className = 'install-hint';
    hint.innerHTML = 'Opens the share menu — pick <strong>“Add to Home Screen”</strong>.';
    btn.addEventListener('click', async () => {
      // iOS has no install API, but the share sheet opened by
      // navigator.share() contains the "Add to Home Screen" action.
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Pocket Agent', url: location.href });
        } catch {
          /* user closed the sheet */
        }
      } else {
        hint.innerHTML =
          'In Safari: tap <strong>Share</strong> (the square with an ↑ arrow ' +
          'in the toolbar), then <strong>“Add to Home Screen”</strong>.';
      }
    });
    content.append(label, btn, hint);
    banner.hidden = false;
  }
}
