import { startRelay } from "./relay";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? "18081");
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("RELAY_PORT_invalid");
  return parsed;
}

async function main(): Promise<void> {
  const bindHost = process.env.RELAY_BIND_HOST ?? "0.0.0.0";
  if (bindHost !== "0.0.0.0" && bindHost !== "127.0.0.1")
    throw new Error("RELAY_BIND_HOST_invalid");
  const admissionStorePath = process.env.RELAY_ADMISSION_STORE;
  const admissionToken = process.env.RELAY_ADMISSION_TOKEN;
  if ((admissionStorePath === undefined) !== (admissionToken === undefined)) {
    throw new Error("RELAY_ADMISSION_CONFIG_incomplete");
  }
  const relay = await startRelay({
    admissionStorePath,
    admissionToken,
    allowedPubkeys: required("RELAY_ALLOWED_PUBKEYS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    bindHost,
    name: required("RELAY_NAME"),
    port: port(process.env.RELAY_PORT),
    storePath: required("RELAY_EVENT_STORE"),
    websocketPath: process.env.RELAY_WEBSOCKET_PATH ?? "/",
  });
  console.log(
    JSON.stringify({
      status: "ready",
      name: process.env.RELAY_NAME,
      port: relay.port,
    })
  );

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await relay.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "relay_start_failed");
  process.exitCode = 1;
});
