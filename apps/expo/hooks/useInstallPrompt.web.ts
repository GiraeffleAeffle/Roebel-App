import { useCallback, useEffect, useState } from 'react';

// Duplicated from useInstallPrompt.ts on purpose: a relative import of
// './useInstallPrompt' would platform-resolve back to THIS file.
export type InstallPromptState = {
  canPrompt: boolean;
  isStandalone: boolean;
  isIosSafari: boolean;
  promptInstall: () => Promise<void>;
};

// beforeinstallprompt is a one-shot event Chrome fires at page load — module
// scope captures it at boot; a mount-scoped listener would miss it whenever
// the user reaches Settings after it fired.
let deferredEvent: any = null;
const subscribers = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredEvent = e;
    subscribers.forEach((notify) => notify());
  });
}

export function useInstallPrompt(): InstallPromptState {
  const [canPrompt, setCanPrompt] = useState(() => deferredEvent !== null);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  const isIosSafari =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const notify = () => setCanPrompt(deferredEvent !== null);
    subscribers.add(notify);
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    deferredEvent.prompt();
    await deferredEvent.userChoice;
    deferredEvent = null;
    subscribers.forEach((notify) => notify());
  }, []);

  return { canPrompt, isStandalone, isIosSafari, promptInstall };
}
