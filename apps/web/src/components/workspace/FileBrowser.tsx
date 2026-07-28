"use client";

import { useCallback, useEffect, useState } from "react";
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
 * The native file list. Identical component for both scopes — personal is the
 * citizen's own Nextcloud home, org is the group folder the `groups` claim
 * grants. The server decides which; this only passes the scope along.
 *
 * `WorkspaceSessionGuard` is rendered from HERE rather than from a layout, and
 * that placement is the point: the guard enforces "the workspace session is
 * keyed to `sub`", and it was mounted only in the citizen shell's layout. The
 * org surface (/dashboard/arbeitsbereich) mounts this component under a
 * different layout that never had it, so switching wallets in the org shell
 * left WebDAV using the previous wallet's session and wrote every provenance
 * row with the previous `actor_sub`. Co-locating the guard with the only thing
 * that consumes the session makes that invariant structural: a third surface
 * that mounts FileBrowser cannot forget it.
 */
export function FileBrowser({ scope }: { scope: FileScopeParams }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [authLoop, setAuthLoop] = useState(false);
  const [editor, setEditor] = useState<{ url: string; token: string } | null>(null);

  /**
   * Start the OIDC hop and record that we did. `errorResponse` maps a
   * Nextcloud 401 to a 401 so a stale session self-heals — but the same 401
   * comes back when user_oidc is rejecting the bearer token outright, and
   * re-authenticating cannot fix that. Unguarded, the pair loops, and each lap
   * writes another `workspace_sessions` row holding a live refresh token. The
   * marker is what makes the second consecutive 401 an error instead of a lap.
   */
  function startLoginHop() {
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
    setLoading(true);
    setError(null);
    const store = hopMarkerStore();
    const res = await fetch(`/api/workspace/files?${buildFilesQuery({ ...scope, path })}`);
    switch (classifyFilesResponse(res.status, hasTriedLoginHop(store))) {
      case "unconfigured":
        setUnconfigured(true);
        setLoading(false);
        return;
      case "hop":
        // The one visible hop: not signed in to the workspace yet.
        startLoginHop();
        return;
      case "auth-error":
        setAuthLoop(true);
        setLoading(false);
        return;
      case "ok":
        break;
      default:
        setError(describeWorkspaceError(res.status));
        setLoading(false);
        return;
    }
    setAuthLoop(false);
    setUnconfigured(false);
    // The whole chain works, so a later 401 is a genuinely expired session and
    // has earned a fresh hop of its own.
    releaseLoginHop(store);
    setEntries((await res.json()).entries as DirEntry[]);
    setLoading(false);
  }, [scope, path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(entry: DirEntry) {
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    const res = await fetch(
      `/api/workspace/editor?${buildFilesQuery({ ...scope, path: entry.path })}`,
    );
    // Same classification as load(): the session can expire mid-browse, after
    // the file list already rendered — a 403 (wrong org, or not a verified
    // citizen) must NOT take the hop branch, since that is an access decision
    // the server already made, not an invitation to re-authenticate. And the
    // hop is one-shot here for the same reason it is in load().
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
    setEditor({ url: session.url, token: session.token });
  }

  async function upload(file: File) {
    setError(null);
    const target = path ? `${path}/${file.name}` : file.name;
    const res = await fetch(
      `/api/workspace/files/upload?${buildFilesQuery({ ...scope, path: target })}`,
      { method: "PUT", body: await file.arrayBuffer() },
    );
    // A failed write must surface, not vanish: with no error shown and load()
    // never called, "the file didn't appear" is indistinguishable from
    // "the list is just stale" — the citizen's only lead is to try again.
    if (!res.ok) {
      setError(describeWorkspaceError(res.status));
      return;
    }
    await load();
  }

  async function createFolder() {
    const name = window.prompt("Name des neuen Ordners");
    if (!name) return;
    setError(null);
    const target = path ? `${path}/${name}` : name;
    const res = await fetch(
      `/api/workspace/files/folder?${buildFilesQuery({ ...scope, path: target })}`,
      { method: "POST" },
    );
    if (!res.ok) {
      setError(describeWorkspaceError(res.status));
      return;
    }
    await load();
  }

  // No workspace configured: no session to guard, no list to render, and above
  // all no OIDC hop to start. Just the route that has always worked.
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
      <WorkspaceSessionGuard />
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
