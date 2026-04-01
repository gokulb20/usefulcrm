import { describe, expect, it } from "vitest";
import { toLocalClipboardPath } from "./workspace-paths";

describe("toLocalClipboardPath", () => {
  it("expands workspace-relative paths against workspaceRoot (copies real local path)", () => {
    expect(toLocalClipboardPath("marketing/influencer/notes.md", "/ws")).toBe(
      "/ws/marketing/influencer/notes.md",
    );
  });

  it("maps virtual skills paths into the workspace skills directory", () => {
    expect(toLocalClipboardPath("~skills/crm/SKILL.md", "/ws")).toBe(
      "/ws/skills/crm/SKILL.md",
    );
  });

  it("maps ~workspace aliases into the current workspace root", () => {
    expect(toLocalClipboardPath("~workspace/marketing/influencer", "/ws")).toBe(
      "/ws/marketing/influencer",
    );
    expect(toLocalClipboardPath("~workspace", "/ws")).toBe("/ws");
  });

  it("leaves absolute and home-relative paths unchanged", () => {
    expect(toLocalClipboardPath("/tmp/readme.md", "/ws")).toBe("/tmp/readme.md");
    expect(toLocalClipboardPath("~/Desktop/readme.md", "/ws")).toBe(
      "~/Desktop/readme.md",
    );
  });

  it("keeps unresolved workspace-relative paths unchanged when workspaceRoot is missing", () => {
    expect(toLocalClipboardPath("skills/crm/SKILL.md")).toBe("skills/crm/SKILL.md");
    expect(toLocalClipboardPath("~skills/crm/SKILL.md")).toBe("~skills/crm/SKILL.md");
  });
});
