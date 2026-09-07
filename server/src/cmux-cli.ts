import { isRecord, RemoteError } from "../../shared/protocol";
import { ProcessError, type ProcessOptions, runProcess } from "./process";
import type { Executor } from "./rpc";

export function createCmuxExecutor(
  binary = process.env.CMUX_BIN_PATH ?? "/Applications/cmux.app/Contents/Resources/bin/cmux",
  options: ProcessOptions = {},
): Executor {
  return async (method, params) => {
    try {
      // Text occupies one JSON argv entry. No shell handles terminal input.
      const stdout = await runProcess(binary, ["rpc", method, JSON.stringify(params)], options);
      let result: unknown;
      try {
        result = JSON.parse(stdout);
      } catch {
        throw new RemoteError("invalid_response", "cmux returned invalid JSON.");
      }
      if (!isRecord(result) || result.ok === false || Object.hasOwn(result, "error")) {
        throw new RemoteError("invalid_response", "cmux returned an unsuccessful response.");
      }
      return result;
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError(
        error instanceof ProcessError && error.kind === "start"
          ? "upstream_unavailable"
          : "upstream_error",
        "The cmux request did not complete.",
        "not_sent",
        error instanceof Error ? error.message : undefined,
      );
    }
  };
}
export const executeCmux = createCmuxExecutor();
