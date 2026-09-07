import { describe, expect, it } from "bun:test";
import { validateArchiveMembers } from "./release-files";

describe("source archive inventory", () => {
  const files = ["package.json", "src/main.ts"];
  const listing =
    "release/\nrelease/package.json\nrelease/src/\nrelease/src/main.ts\nrelease/SOURCE-MANIFEST.json\n";
  it("accepts exactly the public files and generated manifest", () => {
    expect(() => validateArchiveMembers(listing, "release", files)).not.toThrow();
  });
  it("rejects metadata, duplicate files, missing files and foreign paths", () => {
    for (const member of [
      "release/._package.json",
      "release/.DS_Store",
      "release/package.json",
      "/release/private",
      "release/../private",
      "other/",
    ]) {
      expect(() => validateArchiveMembers(`${listing}${member}\n`, "release", files)).toThrow();
    }
    expect(() =>
      validateArchiveMembers(listing.replace("release/src/main.ts\n", ""), "release", files),
    ).toThrow();
  });
});
