"use client";

import { useEffect, useRef } from "react";

/**
 * Collabora in an iframe, which is what Collabora is designed for — so there is
 * no framing header to defeat and no Nextcloud chrome to hide.
 *
 * The access token is submitted as a form POST into the frame rather than being
 * put in the url: a token in a src would land in browser history, in the
 * Referer header, and in every access log between here and the editor.
 */
export function DocumentEditor({
  url,
  token,
  onClose,
}: {
  url: string;
  token: string;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.submit();
  }, [url, token]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="h-12 border-b border-border flex items-center justify-end px-4">
        <button
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Schließen
        </button>
      </div>
      <form
        ref={formRef}
        action={url}
        method="post"
        target="collabora-frame"
        className="hidden"
      >
        <input type="hidden" name="access_token" value={token} />
      </form>
      <iframe
        name="collabora-frame"
        title="Dokument bearbeiten"
        className="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
