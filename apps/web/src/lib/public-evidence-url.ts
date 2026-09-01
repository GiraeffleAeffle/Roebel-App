const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL_ID = /^[0-9]{1,12}$/;

function exactQueryEntries(url: URL, expectedKeys: readonly string[]) {
  const entries = [...url.searchParams.entries()];
  return entries.length === expectedKeys.length &&
    entries.map(([key]) => key).sort().join(",") === [...expectedKeys].sort().join(",");
}

/**
 * Evidence destinations are normally query-free. Two public Röbel systems
 * require canonical identifiers in their query string, so admit only those
 * exact non-secret shapes instead of permitting arbitrary tracking/auth data.
 */
export function isAllowedPublicEvidenceUrl(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return false;
  }
  if (!url.search) return true;

  if (
    url.origin === "https://index.roebel.app" &&
    url.pathname === "/events" &&
    exactQueryEntries(url, ["ids"])
  ) {
    return HEX64.test(url.searchParams.get("ids") ?? "");
  }

  if (
    url.origin === "https://roebelmueritz.sitzung-mv.de" &&
    url.pathname === "/public/vo020" &&
    exactQueryEntries(url, ["TOLFDNR", "VOLFDNR", "refresh"])
  ) {
    return DECIMAL_ID.test(url.searchParams.get("TOLFDNR") ?? "") &&
      DECIMAL_ID.test(url.searchParams.get("VOLFDNR") ?? "") &&
      url.searchParams.get("refresh") === "false";
  }

  if (
    url.origin === "https://roebelmueritz.sitzung-mv.de" &&
    url.pathname === "/public/to020" &&
    exactQueryEntries(url, ["SILFDNR", "TOLFDNR"])
  ) {
    return DECIMAL_ID.test(url.searchParams.get("SILFDNR") ?? "") &&
      DECIMAL_ID.test(url.searchParams.get("TOLFDNR") ?? "");
  }

  return false;
}

export function publicEvidenceDestinationLabel(value: string): string {
  try {
    const url = new URL(value);
    return isAllowedPublicEvidenceUrl(url)
      ? url.hostname.replace(/^www\./, "")
      : "Öffentliche Quelle";
  } catch {
    return "Öffentliche Quelle";
  }
}
