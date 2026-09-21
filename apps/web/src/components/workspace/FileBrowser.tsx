"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CloudOff,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderPlus,
  RefreshCw,
  Upload,
} from "lucide-react";
import type { DirEntry } from "@netizen-labs/workspace";
import {
  breadcrumbs,
  buildFilesQuery,
  classifyFilesResponse,
  describeWorkspaceError,
  formatSize,
  hasTriedLoginHop,
  hopMarkerStore,
  loginRedirect,
  markLoginHop,
  parentPath,
  releaseLoginHop,
  workspaceLinkOut,
  type FileScopeParams,
} from "@/lib/workspace/client-api";
import { DocumentEditor } from "./DocumentEditor";
import { WorkspaceSessionGuard } from "./WorkspaceSessionGuard";

/**
 * Shown instead of the file list when the deployment has no workspace
 * configured (every /api/workspace route answers 503 then). This is the route
 * the `nextcloud` / `org-nextcloud` tiles used to be: the citizen still gets
 * to their documents, just in the other tab. Without it, this component's own
 * 401 branch sent the browser to an equally-unconfigured
 * /api/workspace/auth/login and the page 500'd.
 */
function LinkOutCard() {
  const href = workspaceLinkOut(process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL);
  return (
    <div className="bg-card border border-border rounded-xl p-6 text-center space-y-3">
      <CloudOff className="h-8 w-8 text-muted-foreground mx-auto" />
      <p className="text-sm text-muted-foreground">
        Die Dateiansicht in der App ist hier noch nicht aktiviert.
        {href
          ? " Deine Dateien erreichst du weiterhin direkt im Arbeitsbereich."
          : " Sobald der Arbeitsbereich eingerichtet ist, erscheinen deine Dateien an dieser Stelle."}
      </p>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Dateien öffnen <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

/**
 * Mount the wallet-aware gate only after hydration, as the workspace shell
 * does for Thirdweb consumers. No file/editor/action subtree exists until
 * the guard verifies the current wallet's server-side session.
 */
export function FileBrowser({ scope }: { scope: FileScopeParams }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <p className="text-sm text-muted-foreground">Identität wird geprüft …</p>;
  return (
    <WorkspaceSessionGuard unconfigured={<LinkOutCard />}>
      <WorkspaceFiles key={`${scope.scope}:${scope.accountId ?? ""}`} scope={scope} />
    </WorkspaceSessionGuard>
  );
}

function WorkspaceFiles({ scope }: { scope: FileScopeParams }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [authLoop, setAuthLoop] = useState(false);
  const [editor, setEditor] = useState<{ url: string; token: string } | null>(null);
  // Mirrors the listing response's own `canWrite` (an org member vs.
  // owner/admin) — server-decided, never inferred client-side. Defaults to
  // `false`, fail-closed: the toolbar that renders these buttons is NOT
  // gated by `loading` (only the entries list below it is), so a `true`
  // default would let a read-only member see clickable Ordner/Hochladen
  // buttons for one frame before the first `load()` response flips this to
  // its real value. `load()` sets the real value on every successful
  // listing; a writer sees the buttons appear a frame later, not vanish.
  const [canWrite, setCanWrite] = useState(false);
  const activeRef = useRef(true);
  const requestsRef = useRef(new Set<AbortController>());

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      for (const controller of requestsRef.current) controller.abort();
      requestsRef.current.clear();
    };
  }, []);

  function beginRequest() {
    const controller = new AbortController();
    requestsRef.current.add(controller);
    return { controller };
  }

  function finishRequest(controller: AbortController) {
    requestsRef.current.delete(controller);
  }

  function requestIsCurrent(request: { controller: AbortController }) {
    return activeRef.current && !request.controller.signal.aborted;
  }

  /**
   * Start the OIDC hop and record that we did. `errorResponse` maps a
   * Nextcloud 401 to a 401 so a stale session self-heals — but the same 401
   * comes back when user_oidc is rejecting the bearer token outright, and
   * re-authenticating cannot fix that. Unguarded, the pair loops, and each lap
   * writes another `workspace_sessions` row holding a live refresh token. The
   * marker is what makes the second consecutive 401 an error instead of a lap.
   */
  function startLoginHop() {
    if (!activeRef.current) return;
    markLoginHop(hopMarkerStore());
    window.location.href = loginRedirect(window.location.pathname);
  }

  /**
   * The deliberate, human-initiated escape from the guard. The marker lives in
   * sessionStorage, so it survives a reload — which is what stops the loop, but
   * would also make the dead end permanent for the whole tab if there were no
   * way out. Clearing it here costs exactly one more hop, chosen by a person
   * clicking a button, never by a redirect answering itself.
   */
  function retryLogin() {
    releaseLoginHop(hopMarkerStore());
    startLoginHop();
  }

  const load = useCallback(async () => {
    if (!activeRef.current) return;
    const request = beginRequest();
    setLoading(true);
    setError(null);
    const store = hopMarkerStore();
    try {
      const res = await fetch(
        `/api/workspace/files?${buildFilesQuery({ ...scope, path })}`,
        { signal: request.controller.signal },
      );
      if (!requestIsCurrent(request)) return;
      switch (classifyFilesResponse(res.status, hasTriedLoginHop(store))) {
        case "unconfigured":
          setUnconfigured(true);
          return;
        case "hop":
          // The one visible hop: not signed in to the workspace yet.
          startLoginHop();
          return;
        case "auth-error":
          setAuthLoop(true);
          return;
        case "ok":
          break;
        default:
          setError(describeWorkspaceError(res.status));
          return;
      }
      setAuthLoop(false);
      setUnconfigured(false);
      // The whole chain works, so a later 401 is a genuinely expired session
      // and has earned a fresh hop of its own.
      releaseLoginHop(store);
      const body = (await res.json()) as {
        entries: DirEntry[];
        canWrite: boolean;
      };
      if (!requestIsCurrent(request)) return;
      setEntries(body.entries);
      setCanWrite(body.canWrite);
    } catch (caught) {
      if (
        requestIsCurrent(request) &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setError("Die Dateien konnten gerade nicht geladen werden.");
      }
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request)) setLoading(false);
    }
  }, [scope.scope, scope.accountId, path]);

  useEffect(() => {
    void load();
  }, [load]);


  async function open(entry: DirEntry) {
    if (!activeRef.current) return;
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    const request = beginRequest();
    try {
      const res = await fetch(
        `/api/workspace/editor?${buildFilesQuery({ ...scope, path: entry.path })}`,
        { signal: request.controller.signal },
      );
      if (!requestIsCurrent(request)) return;
      // Same classification as load(): the session can expire mid-browse,
      // after the file list already rendered — a 403 (wrong org, or not a
      // verified citizen) must NOT take the hop branch.
      const openAction = classifyFilesResponse(
        res.status,
        hasTriedLoginHop(hopMarkerStore()),
      );
      if (openAction === "hop") {
        startLoginHop();
        return;
      }
      if (openAction === "auth-error") {
        setAuthLoop(true);
        return;
      }
      if (openAction === "unconfigured") {
        setUnconfigured(true);
        return;
      }
      if (res.status === 415) {
        window.location.href = `/api/workspace/files/download?${buildFilesQuery({
          ...scope,
          path: entry.path,
        })}`;
        return;
      }
      if (!res.ok) {
        setError(describeWorkspaceError(res.status));
        return;
      }
      const session = await res.json();
      if (!requestIsCurrent(request)) return;
      setEditor({ url: session.url, token: session.token });
    } catch (caught) {
      if (
        requestIsCurrent(request) &&
        !(caught instanceof Error && caught.name === "AbortError")
      ) {
        setError("Das Dokument konnte gerade nicht geöffnet werden.");
      }
    } finally {
      finishRequest(request.controller);
    }
  }

  async function upload(file: File) {
    if (!canWrite || !activeRef.current) return;
    setError(null);
    const target = path ? `${path}/${file.name}` : file.name;
    const request = beginRequest();
    try {
      const body = await file.arrayBuffer();
      if (!requestIsCurrent(request)) return;
      const res = await fetch(
        `/api/workspace/files/upload?${buildFilesQuery({ ...scope, path: target })}`,
        { method: "PUT", body, signal: request.controller.signal },
      );
      if (!requestIsCurrent(request)) return;
      // A failed write must surface, not vanish: with no error shown and
      // load() never called, the citizen's only lead is to try again.
      if (!res.ok) {
        setError(describeWorkspaceError(res.status));
        return;
      }
      await load();
    } catch (caught) {
      if (
        requestIsCurrent(request) &&
        !(caught instanceof Error && caught.name === "AbortError")
      ) {
        setError("Die Datei konnte gerade nicht hochgeladen werden.");
      }
    } finally {
      finishRequest(request.controller);
    }
  }

  async function createFolder() {
    if (!canWrite || !activeRef.current) return;
    const name = window.prompt("Name des neuen Ordners");
    if (!name || !activeRef.current) return;
    setError(null);
    const target = path ? `${path}/${name}` : name;
    const request = beginRequest();
    try {
      const res = await fetch(
        `/api/workspace/files/folder?${buildFilesQuery({ ...scope, path: target })}`,
        { method: "POST", signal: request.controller.signal },
      );
      if (!requestIsCurrent(request)) return;
      if (!res.ok) {
        setError(describeWorkspaceError(res.status));
        return;
      }
      await load();
    } catch (caught) {
      if (
        requestIsCurrent(request) &&
        !(caught instanceof Error && caught.name === "AbortError")
      ) {
        setError("Der Ordner konnte gerade nicht angelegt werden.");
      }
    } finally {
      finishRequest(request.controller);
    }
  }


  // A later files request may discover the integration is unavailable.
  if (unconfigured) return <LinkOutCard />;

  // A second consecutive 401. Re-authenticating did not help, so the cause is
  // upstream (user_oidc rejecting the bearer, a client/secret mismatch, clock
  // skew) rather than a stale session. Say so and stop, instead of hopping
  // again and minting another session row per lap.
  if (authLoop) {
    return (
      <div className="bg-card border border-destructive/30 rounded-xl p-6 text-center space-y-3">
        <p className="text-sm text-destructive">
          Die Anmeldung am Arbeitsbereich ist wiederholt fehlgeschlagen. Das
          liegt vermutlich an der Einrichtung, nicht an deinem Konto — bitte
          wende dich an die Verwaltung.
        </p>
        <button
          onClick={retryLogin}
          className="inline-flex items-center gap-1.5 border border-border rounded-lg px-4 py-2 text-sm hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" /> Erneut anmelden
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs(path).map((crumb, index, all) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <button
                onClick={() => setPath(crumb.path)}
                className={
                  index === all.length - 1
                    ? "text-foreground font-medium"
                    : "hover:text-foreground"
                }
              >
                {crumb.label}
              </button>
              {index < all.length - 1 && <span>/</span>}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {!canWrite && (
            <span className="text-xs text-muted-foreground">Nur Lesezugriff</span>
          )}
          {canWrite && (
            <>
              <button
                onClick={createFolder}
                className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-accent"
              >
                <FolderPlus className="h-4 w-4" /> Ordner
              </button>
              <label className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-accent cursor-pointer">
                <Upload className="h-4 w-4" /> Hochladen
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </label>
            </>
          )}
          <button
            onClick={() => void load()}
            aria-label="Aktualisieren"
            className="border border-border rounded-lg p-1.5 hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive border border-destructive/30 rounded-lg p-3">
          {error}
        </p>
      )}

      <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-muted/40" />
          ))}

        {!loading && path !== "" && (
          <button
            onClick={() => setPath(parentPath(path))}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">… eine Ebene höher</span>
          </button>
        )}

        {!loading && entries.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Dieser Ordner ist leer.
          </p>
        )}

        {!loading &&
          entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => void open(entry)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
            >
              {entry.isDirectory ? (
                <Folder className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="flex-1 truncate text-foreground">{entry.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatSize(entry.size)}
              </span>
            </button>
          ))}
      </div>

      {editor && (
        <DocumentEditor
          url={editor.url}
          token={editor.token}
          onClose={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
