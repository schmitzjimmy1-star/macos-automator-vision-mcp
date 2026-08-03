#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];
const sessionIndex = args.indexOf("--session");
const session = sessionIndex >= 0 ? args[sessionIndex + 1] : null;
const windowIndex = args.indexOf("--window-id");
const windowId = windowIndex >= 0 ? args[windowIndex + 1] : null;

const base = { ok: true, command, version: "test", session };

switch (command) {
  case "list-apps":
    respond({
      ...base,
      data: {
        apps: [
          {
            bundle_id: "com.grokbuild.app",
            name: "GrokBuild",
            pid: 4242,
            process_instance: "fake-grokbuild-process",
          },
          {
            name: "GrokBuild",
            pid: process.pid,
            process_instance: "fake-helper-process",
          },
        ],
      },
    });
    break;
  case "list-windows":
    respond({
      ...base,
      data: [
        {
          app_name: "GrokBuild",
          bounds: { x: 0, y: 0, width: 1440, height: 30 },
          id: "w-menu",
          is_focused: false,
          pid: 4242,
          title: "GrokBuild",
          visible: false,
        },
        {
          app_name: "GrokBuild",
          bounds: { x: 100, y: 80, width: 1200, height: 800 },
          id: "w-main",
          is_focused: true,
          pid: 4242,
          title: "GrokBuild Workbench",
          visible: true,
        },
      ],
    });
    break;
  case "snapshot":
    respond({
      ...base,
      data: {
        snapshot_id: "snapshot-test",
        window_id: windowId,
        role: "AXWindow",
        title: "GrokBuild Workbench",
        children: [{ ref: "@snapshot-test:e1", role: "AXStaticText", value: "VISION-E2E" }],
      },
    });
    break;
  case "screenshot":
    respond({
      ...base,
      data: {
        data: Buffer.from("fake-png-payload").toString("base64"),
        format: "png",
        width: 1200,
        height: 800,
        scale_factor: 2,
        window_id: windowId,
      },
    });
    break;
  case "permissions":
    respond({
      ...base,
      data: {
        accessibility: { state: "granted" },
        screen_recording: { state: "granted" },
        automation: { state: "unknown" },
      },
    });
    break;
  default:
    process.stdout.write(
      JSON.stringify({
        ok: false,
        command,
        error: { code: "UNSUPPORTED_TEST_COMMAND", message: `Unsupported: ${command}` },
      }) + "\n",
    );
    process.exitCode = 2;
}

function respond(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}
