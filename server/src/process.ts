export interface ProcessOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string | undefined>;
}
export class ProcessError extends Error {
  constructor(
    public readonly kind: "start" | "timeout" | "exit" | "output",
    message: string,
  ) {
    super(message);
  }
}
export async function runProcess(
  binary: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    proc = Bun.spawn([binary, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: options.env ?? process.env,
    });
  } catch {
    throw new ProcessError(
      "start",
      `Cannot start ${binary}. Check its configured executable path.`,
    );
  }
  const readers = [proc.stdout.getReader(), proc.stderr.getReader()] as const;
  let failure: ProcessError | undefined;
  let cancellation: Promise<PromiseSettledResult<void>[]> | undefined;
  const abort = (error: ProcessError) => {
    if (failure) return;
    failure = error;
    proc.kill("SIGKILL");
    // Descendants can keep inherited pipes open after the direct child exits.
    cancellation = Promise.allSettled(readers.map((reader) => reader.cancel()));
  };
  const timer = setTimeout(() => {
    abort(new ProcessError("timeout", "Command timed out."));
  }, options.timeoutMs ?? 4_000);
  const read = async (reader: (typeof readers)[number]) => {
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        bytes += chunk.value.byteLength;
        if (bytes > (options.maxOutputBytes ?? 4_194_304)) {
          const error = new ProcessError("output", "Command output exceeded the allowed size.");
          abort(error);
          throw error;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
    } catch (error) {
      abort(
        error instanceof ProcessError
          ? error
          : new ProcessError("output", "Command output could not be read."),
      );
      throw failure;
    }
  };
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(readers[0]),
      read(readers[1]),
      proc.exited,
    ]);
    if (failure) throw failure;
    if (code !== 0)
      throw new ProcessError(
        "exit",
        stderr.trim().slice(0, 600) || `Command exited with code ${code}.`,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
    await cancellation;
    for (const reader of readers) reader.releaseLock();
    await proc.exited;
  }
}
