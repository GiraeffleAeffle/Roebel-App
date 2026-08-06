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

/**
 * The rsync `--delete` excludes — pulled out as a pure list (rather than
 * inlined only in the spawnSync call) so the deploy-safety invariants here
 * are unit-testable without shelling out to a real rsync/ssh.
 */
export const RSYNC_DELETE_EXCLUDES = [
  // Secrets are not in the rendered bundle; the box's own .env supplies them.
  "--exclude=.env",
  // The allow-list is GENERATED STATE on the box (written by relay-sync from
  // on-chain membership), not bundle content. Without this exclude, every
  // deploy overwrites it with the empty rendered stub and revokes write
  // access for the whole town until the next sync pass.
  "--exclude=strfry-policy/members.txt",
  // The monetization opt-out list is also GENERATED / box-edited STATE — an
  // author's consent to be excluded from paid access, set via the admin
  // console, not bundle content. Without this exclude, every deploy wipes
  // it and silently re-monetizes every author who had opted out.
  "--exclude=strfry-policy/metering-excluded.txt",
  // Backup output and the status file an agent reads must survive a deploy.
  "--exclude=ops/status.json",
];

export function applyOverSsh(bundleDir: string, nodeId: string, opts: UpOptions): number {
  const remote = opts.remoteDir ?? `/opt/netizen/${nodeId}`;
  const sshCmd = opts.identity ? `ssh -i ${opts.identity}` : "ssh";

  // 1. ensure the remote dir, then sync the bundle into it
  const mk = spawnSync(sshCmd.split(" ")[0], [...(opts.identity ? ["-i", opts.identity] : []), opts.host, `mkdir -p ${remote}`], { stdio: "inherit" });
  if (mk.status !== 0) return mk.status ?? 1;

  const rsync = spawnSync(
    "rsync",
    [
      "-az", "--no-owner", "--no-group",
      "--delete",
      ...RSYNC_DELETE_EXCLUDES,
      "-e",
      sshCmd,
      `${bundleDir}/`,
      `${opts.host}:${remote}/`,
    ],
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
