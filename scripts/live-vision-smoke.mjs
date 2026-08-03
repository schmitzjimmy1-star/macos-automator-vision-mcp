#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "dist", "server.js");
const agentDesktopPath =
  process.env.AGENT_DESKTOP_PATH || "/Applications/GrokBuild.app/Contents/MacOS/agent-desktop";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  stderr: "pipe",
  env: {
    MCP_E2E_TESTING: "true",
    AGENT_DESKTOP_PATH: agentDesktopPath,
    MACOS_AUTOMATOR_VISION_ALLOWED_APPS: "GrokBuild",
    MACOS_AUTOMATOR_VISION_ALLOWED_BUNDLE_IDS: "com.grokbuild.app",
    MACOS_AUTOMATOR_VISION_SESSION_PREFIX: "live-smoke",
    MACOS_AUTOMATOR_VISION_TIMEOUT_SECONDS: "30",
  },
});

const client = new Client({ name: "macos-automator-vision-live-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const toolNames = tools.map((tool) => tool.name).sort();
  const expected = [
    "capture_app",
    "execute_script",
    "get_scripting_tips",
    "inspect_app",
    "verify_app",
    "vision_permissions",
  ];
  assert(JSON.stringify(toolNames) === JSON.stringify(expected), `Unexpected tools: ${toolNames}`);

  const permissions = await client.callTool({ name: "vision_permissions", arguments: {} });
  assert(!permissions.isError, "vision_permissions failed");
  const permissionText = textContent(permissions);
  assert(permissionText.includes('"accessibility"'), "Accessibility receipt missing");
  assert(permissionText.includes('"screen_recording"'), "Screen Recording receipt missing");

  const inspection = await client.callTool({
    name: "inspect_app",
    arguments: { app: "GrokBuild", interactive_only: false, max_depth: 12 },
  });
  assert(!inspection.isError, `inspect_app failed: ${textContent(inspection)}`);
  const inspectionText = textContent(inspection);
  assert(inspectionText.includes("GrokBuild"), "GrokBuild was absent from the snapshot");

  const capture = await client.callTool({
    name: "capture_app",
    arguments: { app: "GrokBuild" },
  });
  assert(!capture.isError, `capture_app failed: ${textContent(capture)}`);
  const image = capture.content?.find((item) => item.type === "image");
  assert(image?.mimeType === "image/png", `Unexpected image type: ${image?.mimeType}`);
  assert(typeof image?.data === "string" && image.data.length > 1000, "Screenshot was empty");
  const decodedImage = Buffer.from(image.data, "base64");
  assert(
    decodedImage.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "Screenshot did not contain a valid PNG signature",
  );

  const verification = await client.callTool({
    name: "verify_app",
    arguments: { app: "GrokBuild", interactive_only: true, max_depth: 12 },
  });
  assert(!verification.isError, `verify_app failed: ${textContent(verification)}`);
  assert(
    verification.content?.some((item) => item.type === "image"),
    "verify_app returned no image",
  );

  const denied = await client.callTool({
    name: "capture_app",
    arguments: { app: "Messages" },
  });
  assert(denied.isError === true, "Non-allowlisted application was not denied");

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        server: serverPath,
        agent_desktop: agentDesktopPath,
        tools: toolNames,
        permission_receipt_present: true,
        snapshot_mentions_grokbuild: true,
        image: {
          mime_type: image.mimeType,
          base64_bytes: image.data.length,
          png_signature_valid: true,
        },
        verify_image_present: true,
        unrelated_app_denied: true,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client.close();
}

function textContent(result) {
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
