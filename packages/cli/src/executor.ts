import { spawnSync } from "node:child_process";

/**
 * The `netizen up` executor — thin, operator-run. It syncs a rendered bundle to the
 * target box and runs `bootstrap.sh` there over ssh. Deliberately not part of the
 * pure/tested core: it shells out to rsync + ssh against a real host, using the
 * operator's key and the box's own .env (secrets never pass through here).
 */

export interface UpOptions {
  host: string; // user@ip
  remoteDir?: string; // default /opt/netizen/<id>
  identity?: string; // -i keyfile
}

export function applyOverSsh(bundleDir: string, nodeId: string, opts: UpOptions): number {
  const remote = opts.remoteDir ?? `/opt/netizen/${nodeId}`;
  const sshCmd = opts.identity ? `ssh -i ${opts.identity}` : "ssh";

  // 1. ensure the remote dir, then sync the bundle into it
  const mk = spawnSync(sshCmd.split(" ")[0], [...(opts.identity ? ["-i", opts.identity] : []), opts.host, `mkdir -p ${remote}`], { stdio: "inherit" });
  if (mk.status !== 0) return mk.status ?? 1;

  const rsync = spawnSync(
    "rsync",
    ["-az", "--delete", "-e", sshCmd, `${bundleDir}/`, `${opts.host}:${remote}/`],
    { stdio: "inherit" },
  );
  if (rsync.status !== 0) return rsync.status ?? 1;

  // 2. run the idempotent bootstrap on the box
  const run = spawnSync(
    sshCmd.split(" ")[0],
    [...(opts.identity ? ["-i", opts.identity] : []), opts.host, `cd ${remote} && sudo bash bootstrap.sh`],
    { stdio: "inherit" },
  );
  return run.status ?? 1;
}
