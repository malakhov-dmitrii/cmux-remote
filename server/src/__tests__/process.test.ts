import { describe, expect, it } from "bun:test";
import { runProcess } from "../process";

describe("process pipe cleanup", () => {
  for (const [stream, command] of [
    ["stdout", "sleep 1.5 2>/dev/null &"],
    ["stderr", "sleep 1.5 >/dev/null &"],
  ] as const) {
    it(`bounds timeout when a descendant inherits ${stream}`, async () => {
      const started = performance.now();
      await expect(runProcess("/bin/sh", ["-c", command], { timeoutMs: 50 })).rejects.toMatchObject(
        {
          kind: "timeout",
        },
      );
      expect(performance.now() - started).toBeLessThan(1_000);
    });
  }

  it("rejects output overflow without waiting for inherited pipes", async () => {
    const started = performance.now();
    await expect(
      runProcess("/bin/sh", ["-c", "sleep 1.5 & printf 'output exceeds limit'"], {
        maxOutputBytes: 8,
        timeoutMs: 500,
      }),
    ).rejects.toMatchObject({ kind: "output" });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
