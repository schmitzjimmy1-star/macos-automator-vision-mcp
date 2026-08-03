import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  selectPreferredWindow,
  VisionInspector,
  VisionInspectorError,
  type VisionWindow,
} from "../src/VisionInspector.js";

const FIXTURE = path.resolve(__dirname, "fixtures", "fake-agent-desktop.mjs");

describe("VisionInspector", () => {
  it("isolates the session and returns an accessibility snapshot", async () => {
    const inspector = createInspector();
    const snapshot = JSON.parse(await inspector.inspect("grokbuild"));

    expect(inspector.session).toBe(`claude-cowork-test-${process.pid}`);
    expect(snapshot.session).toBe(`claude-cowork-test-${process.pid}`);
    expect(snapshot.data.window_id).toBe("w-main");
    expect(snapshot.data.children[0].value).toBe("VISION-E2E");
  });

  it("returns native image data from the selected main window", async () => {
    const capture = await createInspector().capture("GrokBuild");

    expect(capture.mimeType).toBe("image/png");
    expect(capture.window.id).toBe("w-main");
    expect(capture.width).toBe(1200);
    expect(Buffer.from(capture.data, "base64").toString("utf8")).toBe("fake-png-payload");
  });

  it("verifies one window with a fresh snapshot and screenshot", async () => {
    const verification = await createInspector().verify("GrokBuild", {
      includeBounds: true,
      maxDepth: 8,
    });

    expect(JSON.parse(verification.snapshot).data.window_id).toBe("w-main");
    expect(verification.capture.window.id).toBe("w-main");
  });

  it("rejects applications outside the explicit allowlist", async () => {
    await expect(createInspector().inspect("Messages")).rejects.toThrow(
      "Vision access is limited to: GrokBuild",
    );
  });

  it("reads permissions without requesting them", async () => {
    const permissions = JSON.parse(await createInspector().permissions());
    expect(permissions.data.accessibility.state).toBe("granted");
    expect(permissions.data.screen_recording.state).toBe("granted");
  });

  it("fails closed when agent-desktop is missing", async () => {
    const inspector = new VisionInspector({
      AGENT_DESKTOP_PATH: "/definitely/missing/agent-desktop",
      MACOS_AUTOMATOR_VISION_ALLOWED_APPS: "GrokBuild",
    });
    await expect(inspector.permissions()).rejects.toBeInstanceOf(VisionInspectorError);
  });
});

describe("selectPreferredWindow", () => {
  it("rejects hidden helper surfaces and prefers the focused visible main window", () => {
    const windows: VisionWindow[] = [
      windowRecord({ id: "menu", visible: false, width: 1440, height: 30 }),
      windowRecord({ id: "secondary", width: 900, height: 700 }),
      windowRecord({ id: "main", focused: true, width: 1200, height: 800 }),
    ];
    expect(selectPreferredWindow(windows)?.id).toBe("main");
  });

  it("returns undefined when no visible standard window exists", () => {
    expect(
      selectPreferredWindow([
        windowRecord({ id: "hidden", visible: false }),
        windowRecord({ id: "menu", width: 1400, height: 30 }),
      ]),
    ).toBeUndefined();
  });
});

function createInspector() {
  return new VisionInspector({
    AGENT_DESKTOP_PATH: FIXTURE,
    MACOS_AUTOMATOR_VISION_ALLOWED_APPS: "GrokBuild",
    MACOS_AUTOMATOR_VISION_ALLOWED_BUNDLE_IDS: "com.grokbuild.app",
    MACOS_AUTOMATOR_VISION_SESSION_PREFIX: "claude cowork test",
    MACOS_AUTOMATOR_VISION_TIMEOUT_SECONDS: "5",
  });
}

function windowRecord(overrides: Partial<VisionWindow>): VisionWindow {
  return {
    id: "window",
    title: "GrokBuild",
    appName: "GrokBuild",
    visible: true,
    focused: false,
    pid: 4242,
    width: 800,
    height: 600,
    ...overrides,
  };
}
