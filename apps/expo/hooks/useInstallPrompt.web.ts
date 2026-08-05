import { useCallback, useEffect, useRef, useState } from 'react';

// Duplicated from useInstallPrompt.ts on purpose: a relative import of
// './useInstallPrompt' would platform-resolve back to THIS file.
export type InstallPromptState = {
  canPrompt: boolean;
  isStandalone: boolean;
  isIosSafari: boolean;
  promptInstall: () => Promise<void>;
};

export function useInstallPrompt(): InstallPromptState {
  const deferred = useRef<any>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  const isIosSafari =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferred.current = e;
      setCanPrompt(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred.current) return;
    deferred.current.prompt();
    await deferred.current.userChoice;
    deferred.current = null;
    setCanPrompt(false);
  }, []);

  return { canPrompt, isStandalone, isIosSafari, promptInstall };
}
