"use client";

import { useCallback, useEffect, useState } from "react";
import { File as FileIcon, Folder, FolderPlus, RefreshCw, Upload } from "lucide-react";
import type { DirEntry } from "@netizen-labs/workspace";
import {
  breadcrumbs,
  buildFilesQuery,
  formatSize,
  parentPath,
  type FileScopeParams,
} from "@/lib/workspace/client-api";
import { DocumentEditor } from "./DocumentEditor";

/**
 * The native file list. Identical component for both scopes — personal is the
 * citizen's own Nextcloud home, org is the group folder the `groups` claim
 * grants. The server decides which; this only passes the scope along.
 */
export function FileBrowser({ scope }: { scope: FileScopeParams }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ url: string; token: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/workspace/files?${buildFilesQuery({ ...scope, path })}`);
    if (res.status === 401) {
      // The one visible hop: not signed in to the workspace yet.
      window.location.href = `/api/workspace/auth/login?returnTo=${encodeURIComponent(
        window.location.pathname,
      )}`;
      return;
    }
    if (!res.ok) {
      setError("Die Dateien konnten nicht geladen werden.");
      setLoading(false);
      return;
    }
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
    if (res.status === 415) {
      window.location.href = `/api/workspace/files/download?${buildFilesQuery({
        ...scope,
        path: entry.path,
      })}`;
      return;
    }
    if (!res.ok) {
      setError("Das Dokument konnte nicht geöffnet werden.");
      return;
    }
    const session = await res.json();
    setEditor({ url: session.url, token: session.token });
  }

  async function upload(file: File) {
    const target = path ? `${path}/${file.name}` : file.name;
    await fetch(`/api/workspace/files/upload?${buildFilesQuery({ ...scope, path: target })}`, {
      method: "PUT",
      body: await file.arrayBuffer(),
    });
    await load();
  }

  async function createFolder() {
    const name = window.prompt("Name des neuen Ordners");
    if (!name) return;
    const target = path ? `${path}/${name}` : name;
    await fetch(`/api/workspace/files/folder?${buildFilesQuery({ ...scope, path: target })}`, {
      method: "POST",
    });
    await load();
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
