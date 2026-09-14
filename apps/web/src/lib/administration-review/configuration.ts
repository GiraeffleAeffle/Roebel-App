import "server-only";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import type { ReviewGatewayConfig } from "./gateway";

/** Deployment-owned file only. Parsing failures never include its contents. */
export function loadReviewConfig(): ReviewGatewayConfig {
  let fd: number | undefined;
  try {
    const path = process.env.ROEBEL_ADMIN_REVIEW_CONFIG_FILE;
    if (!path) throw Error();
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536) throw Error();
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch { throw Error("review_configuration_unavailable"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
