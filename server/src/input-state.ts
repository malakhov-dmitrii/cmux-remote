import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isUuid, RemoteError } from "../../shared/protocol";

export const defaultStateDirectory = (env: Record<string, string | undefined> = process.env) =>
  env.CMUX_REMOTE_STATE_DIR ??
  join(homedir(), "Library", "Application Support", "cmux-remote", "input-state");
export class InputState {
  constructor(readonly directory = defaultStateDirectory()) {}
  async prepare(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid())
      )
        throw new Error("State directory must be owned by this user with permissions 0700.");
    } catch {
      throw new RemoteError(
        "storage_error",
        "Private input recovery storage is unavailable. Check its directory and permissions.",
      );
    }
  }
  private file(workspace: string, surface: string): string {
    if (!isUuid(workspace) || !isUuid(surface))
      throw new RemoteError("invalid_request", "Stable UUIDs are required for input recovery.");
    return join(this.directory, `${workspace.toLowerCase()}.${surface.toLowerCase()}.pending`);
  }
  async pending(workspace: string, surface: string): Promise<boolean> {
    await this.prepare();
    try {
      await lstat(this.file(workspace, surface));
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw new RemoteError("storage_error", "Input recovery state could not be read.");
    }
  }
  private async syncDirectory() {
    const directory = await open(this.directory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async begin(workspace: string, surface: string): Promise<void> {
    await this.prepare();
    try {
      const file = await open(
        this.file(workspace, surface),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      await this.syncDirectory();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new RemoteError(
          "recovery_required",
          "Confirm Ctrl+C recovery before sending more input.",
          "unknown",
        );
      throw new RemoteError(
        "storage_error",
        "Input recovery state could not be saved. No input was sent.",
      );
    }
  }
  async acknowledge(workspace: string, surface: string): Promise<void> {
    try {
      await unlink(this.file(workspace, surface));
      await this.syncDirectory();
    } catch {
      throw new RemoteError(
        "storage_error",
        "Input was acknowledged, but recovery state could not be cleared.",
        "unknown",
      );
    }
  }
}
