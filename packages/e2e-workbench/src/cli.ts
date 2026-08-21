import { parseWorkbenchConfig, startWorkbench } from "./server";

void (async () => {
  const config = parseWorkbenchConfig(process.env);
  const running = await startWorkbench(config);
  console.log(
    JSON.stringify({
      status: "ready",
      port: running.port,
      mode: "isolated-staging-e2e",
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
    error instanceof Error ? error.message : "workbench_start_failed"
  );
  process.exitCode = 1;
});
