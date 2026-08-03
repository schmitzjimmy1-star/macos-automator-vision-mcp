import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const DEFAULT_AGENT_DESKTOP_PATH = "/Applications/GrokBuild.app/Contents/MacOS/agent-desktop";
const DEFAULT_ALLOWED_APPS = ["GrokBuild"];
const DEFAULT_ALLOWED_BUNDLE_IDS = ["com.grokbuild.app"];
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

export type VisionWindow = {
  id: string;
  title: string;
  appName: string;
  visible: boolean;
  focused: boolean;
  pid: number;
  width: number;
  height: number;
};

export type InspectOptions = {
  interactiveOnly?: boolean;
  includeBounds?: boolean;
  maxDepth?: number;
};

export type VisionCapture = {
  data: string;
  mimeType: string;
  format: string;
  width?: number;
  height?: number;
  scaleFactor?: number;
  window: VisionWindow;
};

export type VisionVerification = {
  snapshot: string;
  capture: VisionCapture;
};

export class VisionInspectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionInspectorError";
  }
}

export class VisionInspector {
  readonly agentDesktopPath: string;
  readonly allowedApps: readonly string[];
  readonly allowedBundleIds: readonly string[];
  readonly session: string;
  readonly timeoutMs: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.agentDesktopPath = env.AGENT_DESKTOP_PATH || DEFAULT_AGENT_DESKTOP_PATH;
    this.allowedApps = parseAllowedApps(env.MACOS_AUTOMATOR_VISION_ALLOWED_APPS);
    this.allowedBundleIds = parseList(
      env.MACOS_AUTOMATOR_VISION_ALLOWED_BUNDLE_IDS,
      DEFAULT_ALLOWED_BUNDLE_IDS,
    );
    const sessionPrefix =
      env.MACOS_AUTOMATOR_VISION_SESSION_PREFIX ||
      env.MACOS_AUTOMATOR_VISION_SESSION ||
      "claude-cowork";
    this.session = `${sanitizeSession(sessionPrefix)}-${process.pid}`;
    this.timeoutMs = parseTimeout(env.MACOS_AUTOMATOR_VISION_TIMEOUT_SECONDS);
  }

  async assertReady(): Promise<void> {
    try {
      await fs.access(this.agentDesktopPath);
    } catch {
      throw new VisionInspectorError(
        `agent-desktop was not found at ${this.agentDesktopPath}. Install GrokBuild or set AGENT_DESKTOP_PATH.`,
      );
    }
  }

  async permissions(): Promise<string> {
    await this.assertReady();
    const payload = await this.run(["permissions"]);
    return JSON.stringify(payload, null, 2);
  }

  async inspect(appInput: string, options: InspectOptions = {}): Promise<string> {
    await this.assertReady();
    const app = this.requireAllowedApp(appInput);
    const window = await this.resolveMainWindow(app);
    const payload = await this.snapshotWindow(window, options);
    return JSON.stringify(payload, null, 2);
  }

  async capture(appInput: string): Promise<VisionCapture> {
    await this.assertReady();
    const app = this.requireAllowedApp(appInput);
    const window = await this.resolveMainWindow(app);
    return this.captureWindow(window);
  }

  async verify(appInput: string, options: InspectOptions = {}): Promise<VisionVerification> {
    await this.assertReady();
    const app = this.requireAllowedApp(appInput);
    const window = await this.resolveMainWindow(app);
    const snapshotPayload = await this.snapshotWindow(window, options);
    const capture = await this.captureWindow(window);
    return {
      snapshot: JSON.stringify(snapshotPayload, null, 2),
      capture,
    };
  }

  requireAllowedApp(appInput: string): string {
    const requested = appInput.trim();
    const allowed = this.allowedApps.find(
      (candidate) => candidate.localeCompare(requested, undefined, { sensitivity: "accent" }) === 0,
    );
    if (!allowed) {
      throw new VisionInspectorError(
        `Vision access is limited to: ${this.allowedApps.join(", ")}. Requested: ${requested || "(empty)"}.`,
      );
    }
    return allowed;
  }

  private async resolveMainWindow(app: string): Promise<VisionWindow> {
    const appPayload = await this.run(["list-apps"]);
    const appData = asObject(appPayload.data);
    const appRecords = Array.isArray(appData.apps) ? appData.apps : [];
    const allowedPids = new Set(
      appRecords
        .map(asObject)
        .filter(
          (record) =>
            typeof record.name === "string" &&
            record.name.localeCompare(app, undefined, { sensitivity: "accent" }) === 0 &&
            typeof record.bundle_id === "string" &&
            this.allowedBundleIds.includes(record.bundle_id),
        )
        .map((record) => numberOrUndefined(record.pid))
        .filter((pid): pid is number => pid !== undefined),
    );
    if (allowedPids.size === 0) {
      throw new VisionInspectorError(
        `No running ${app} process matched the allowed bundle IDs: ${this.allowedBundleIds.join(", ")}.`,
      );
    }

    const payload = await this.run(["list-windows", "--app", app]);
    const records = Array.isArray(payload.data) ? payload.data : [];
    const windows = records
      .map(parseWindow)
      .filter((window): window is VisionWindow => window !== null && allowedPids.has(window.pid));
    const preferred = selectPreferredWindow(windows);
    if (!preferred) {
      throw new VisionInspectorError(`No usable visible window was found for ${app}.`);
    }
    return preferred;
  }

  private async snapshotWindow(window: VisionWindow, options: InspectOptions): Promise<JsonObject> {
    // Resolve through the allowlisted app, then target only the stable window
    // id. The signed agent-desktop helper can itself appear as another process
    // carrying GrokBuild's name, making a redundant --app filter ambiguous.
    const args = ["snapshot", "--window-id", window.id, "--compact"];
    if (options.interactiveOnly) args.push("--interactive-only");
    if (options.includeBounds) args.push("--include-bounds");
    if (options.maxDepth !== undefined) args.push("--max-depth", String(options.maxDepth));
    return this.run(args);
  }

  private async captureWindow(window: VisionWindow): Promise<VisionCapture> {
    const payload = await this.run(["screenshot", "--window-id", window.id]);
    const image = asObject(payload.data);
    const encoded = typeof image.data === "string" ? image.data : "";
    const format = typeof image.format === "string" ? image.format.toLowerCase() : "png";
    if (!encoded || !isPlausibleBase64(encoded)) {
      throw new VisionInspectorError("agent-desktop returned no valid screenshot image.");
    }

    return {
      data: encoded,
      mimeType: format === "jpeg" || format === "jpg" ? "image/jpeg" : "image/png",
      format,
      width: numberOrUndefined(image.width),
      height: numberOrUndefined(image.height),
      scaleFactor: numberOrUndefined(image.scale_factor),
      window,
    };
  }

  private async run(commandArgs: string[]): Promise<JsonObject> {
    const [command, ...args] = commandArgs;
    const fullArgs = [command, "--session", this.session, ...args];
    const { stdout, stderr, exitCode } = await spawnAndCollect(
      this.agentDesktopPath,
      fullArgs,
      this.timeoutMs,
    );

    const raw = stdout.trim() || stderr.trim();
    let payload: JsonObject;
    try {
      payload = asObject(JSON.parse(raw));
    } catch {
      throw new VisionInspectorError(
        `agent-desktop returned invalid JSON${exitCode === 0 ? "" : ` (exit ${exitCode})`}.`,
      );
    }

    if (exitCode !== 0 || payload.ok !== true) {
      const error = asObject(payload.error);
      const code = typeof error.code === "string" ? ` [${error.code}]` : "";
      const message =
        typeof error.message === "string"
          ? error.message
          : stderr.trim() || `agent-desktop failed with exit ${exitCode}`;
      throw new VisionInspectorError(`${message}${code}`);
    }
    return payload;
  }
}

export function selectPreferredWindow(windows: readonly VisionWindow[]): VisionWindow | undefined {
  return windows
    .filter((window) => window.visible && window.width > 0 && window.height > 60)
    .sort((left, right) => {
      if (left.focused !== right.focused) return left.focused ? -1 : 1;
      const areaDifference = right.width * right.height - left.width * left.height;
      if (areaDifference !== 0) return areaDifference;
      if (left.title.length !== right.title.length) return right.title.length - left.title.length;
      return left.id.localeCompare(right.id);
    })[0];
}

function parseAllowedApps(raw: string | undefined): string[] {
  return parseList(raw, DEFAULT_ALLOWED_APPS);
}

function parseList(raw: string | undefined, defaults: readonly string[]): string[] {
  const values = (raw || defaults.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : [...defaults];
}

function sanitizeSession(raw: string): string {
  const sanitized = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 96);
  return sanitized || `claude-cowork-${process.pid}`;
}

function parseTimeout(raw: string | undefined): number {
  const seconds = Number.parseInt(raw || "", 10);
  const bounded = Number.isFinite(seconds)
    ? Math.min(Math.max(seconds, 5), 120)
    : DEFAULT_TIMEOUT_SECONDS;
  return bounded * 1000;
}

function parseWindow(value: unknown): VisionWindow | null {
  const record = asObject(value);
  const bounds = asObject(record.bounds);
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : "",
    appName: typeof record.app_name === "string" ? record.app_name : "",
    visible: record.visible === true,
    focused: record.is_focused === true,
    pid: numberOrUndefined(record.pid) ?? -1,
    width: numberOrUndefined(bounds.width) ?? 0,
    height: numberOrUndefined(bounds.height) ?? 0,
  };
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlausibleBase64(value: string): boolean {
  return value.length >= 8 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function spawnAndCollect(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    };

    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        fail(new VisionInspectorError("agent-desktop output exceeded the 24 MiB safety limit."));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderrChunks, chunk));
    child.on("error", (error) => fail(new VisionInspectorError(error.message)));

    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      fail(new VisionInspectorError(`agent-desktop timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}
