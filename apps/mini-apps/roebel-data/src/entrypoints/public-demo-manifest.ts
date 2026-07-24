/**
 * Metadata for the sealed, browser-only preview.
 *
 * This intentionally does not import the normal Netizen manifest: that module
 * describes host capabilities which the public preview does not receive.
 */
export const manifest = {
  name: "Röbel Data · Stadtstack-Demo",
  description:
    "Öffentliche, synthetische Stadtstack-Demo zur Marienfelder Straße. Keine amtliche Entscheidung.",
  primaryColor: "#00498B",
} as const;
