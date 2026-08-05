// Native platforms: installation happens through app stores / APKs — the
// install card never renders. Web implementation: useInstallPrompt.web.ts.
export type InstallPromptState = {
  canPrompt: boolean;
  isStandalone: boolean;
  isIosSafari: boolean;
  promptInstall: () => Promise<void>;
};

export function useInstallPrompt(): InstallPromptState {
  return { canPrompt: false, isStandalone: false, isIosSafari: false, promptInstall: async () => {} };
}
