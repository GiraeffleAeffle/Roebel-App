import { parseWorkbenchConfig, startWorkbench } from "./server";
import { parseGnosisProxyConfig, startGnosisProxy } from "./gnosis-proxy";

void (async () => {
  const role = process.env.ROEBEL_RUNTIME_ROLE ?? "workbench";
  const running =
    role === "workbench"
      ? await startWorkbench(parseWorkbenchConfig(process.env))
      : role === "gnosis-rpc-proxy"
        ? await startGnosisProxy(parseGnosisProxyConfig(process.env))
        : (() => {
            throw new Error("runtime_role_invalid");
          })();
  console.log(
    JSON.stringify({
      status: "ready",
      port: running.port,
      mode: role,
    })
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await running.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
})().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "runtime_start_failed"
  );
  process.exitCode = 1;
});
