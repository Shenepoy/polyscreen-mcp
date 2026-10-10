import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";

import { AdbRunner } from "../android/adb-runner.js";
import { DeviceQueue } from "../android/device-queue.js";
import { abortableDelay } from "../utils/abortable-delay.js";

const TEST_PACKAGE = "dev.polyscreen.companion.test";
const TARGET_PACKAGE = "dev.polyscreen.companion";
const RUNNER = "dev.polyscreen.companion.BridgeInstrumentation";
const MAX_FRAME_BYTES = 1024 * 1024;

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal | undefined;
  onAbort?: (() => void) | undefined;
}

export class CompanionConnection {
  readonly #pending = new Map<number, PendingRequest>();
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  onClose?: (() => void) | undefined;

  constructor(readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("error", (error) => this.rejectAll(error));
    socket.on("close", () => {
      this.rejectAll(new Error("Companion connection closed"));
      this.onClose?.();
    });
  }

  async request(
    operation: Record<string, unknown>,
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const id = this.#nextId++;
    const payload = Buffer.from(JSON.stringify({ id, ...operation }), "utf8");
    if (payload.length > MAX_FRAME_BYTES)
      throw new Error("Companion request is too large");
    const frame = Buffer.allocUnsafe(payload.length + 4);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (pending) this.clearPending(id, pending);
        reject(new Error(`Companion request ${id} timed out`));
      }, timeoutMs);
      const onAbort = (): void => {
        const pending = this.#pending.get(id);
        if (pending) this.clearPending(id, pending);
        reject(signal?.reason ?? new Error("Companion request aborted"));
      };
      this.#pending.set(id, { resolve, reject, timer, signal, onAbort });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.socket.write(frame);
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private consume(chunk: Buffer): void {
    try {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      while (this.#buffer.length >= 4) {
        const length = this.#buffer.readUInt32BE(0);
        if (length <= 0 || length > MAX_FRAME_BYTES) {
          throw new Error(`Invalid companion frame length: ${length}`);
        }
        if (this.#buffer.length < length + 4) return;
        const payload = this.#buffer.subarray(4, length + 4);
        this.#buffer = this.#buffer.subarray(length + 4);
        const parsed: unknown = JSON.parse(payload.toString("utf8"));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("Companion response must be a JSON object");
        }
        const response = parsed as Record<string, unknown>;
        const id = Number(response.id);
        if (!Number.isSafeInteger(id)) {
          throw new Error("Companion response has an invalid id");
        }
        const pending = this.#pending.get(id);
        if (!pending) continue;
        this.clearPending(id, pending);
        if (response.ok === false) {
          pending.reject(
            new Error(String(response.error ?? "Companion operation failed")),
          );
        } else {
          pending.resolve(response);
        }
      }
    } catch (error) {
      this.socket.destroy(
        error instanceof Error
          ? error
          : new Error("Malformed companion response"),
      );
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.#pending) {
      this.clearPending(id, pending);
      pending.reject(error);
    }
  }

  private clearPending(id: number, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.onAbort) {
      pending.signal?.removeEventListener("abort", pending.onAbort);
    }
    this.#pending.delete(id);
  }
}

interface CompanionSession {
  connection: CompanionConnection;
  instrumentation: ChildProcessWithoutNullStreams;
  port: number;
}

export class CompanionManager {
  readonly #sessions = new Map<string, CompanionSession>();
  readonly #lifecycle = new DeviceQueue();

  constructor(readonly adb = new AdbRunner()) {}

  async install(
    serial: string,
    appApk: string,
    testApk: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.adb.run(["install", "-r", appApk], {
      serial,
      signal,
      timeoutMs: 120_000,
    });
    await this.adb.run(["install", "-r", "-t", testApk], {
      serial,
      signal,
      timeoutMs: 120_000,
    });
  }

  async start(
    serial: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return await this.#lifecycle.mutate(serial, () =>
      this.startUnlocked(serial, signal),
    );
  }

  private async startUnlocked(
    serial: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.#sessions.has(serial))
      throw new Error(`Companion is already active on ${serial}`);
    await this.forceStop(serial);
    const token = randomBytes(24).toString("base64url");
    const socketName = `polyscreen_mcp_${randomBytes(18).toString("base64url")}`;
    const portText = await this.adb.text(
      ["forward", "tcp:0", `localabstract:${socketName}`],
      { serial, signal },
    );
    const port = Number(portText);
    if (!Number.isInteger(port) || port <= 0)
      throw new Error(`ADB returned invalid port: ${portText}`);

    const instrumentation = spawn(
      this.adb.executable,
      [
        "-s",
        serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-e",
        "token",
        token,
        "-e",
        "socket",
        socketName,
        `${TEST_PACKAGE}/${RUNNER}`,
      ],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    instrumentation.on("error", () => undefined);

    try {
      const { connection, hello } = await connectAndAuthenticate(
        port,
        token,
        signal,
      );
      if (hello.protocol !== 1 || hello.backend !== "uiautomation") {
        connection.close();
        throw new Error("Companion returned an incompatible handshake");
      }
      const session = { connection, instrumentation, port };
      this.#sessions.set(serial, session);
      connection.onClose = () => void this.cleanupUnexpected(serial, session);
      instrumentation.once(
        "error",
        () => void this.cleanupUnexpected(serial, session),
      );
      instrumentation.once(
        "exit",
        () => void this.cleanupUnexpected(serial, session),
      );
      return hello;
    } catch (error) {
      instrumentation.kill("SIGKILL");
      await this.forceStop(serial);
      await this.adb
        .run(["forward", "--remove", `tcp:${port}`], { serial })
        .catch(() => undefined);
      throw error;
    }
  }

  async key(
    serial: string,
    keyCode: number,
    action: "press" | "down" | "up",
    source: "keyboard" | "dpad" | "gamepad" | "joystick",
    repeat = 0,
    metaState = 0,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return await this.session(serial).connection.request(
      {
        op: "key",
        keyCode,
        action,
        source,
        repeat,
        metaState,
      },
      10_000,
      signal,
    );
  }

  async windows(
    serial: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return await this.session(serial).connection.request(
      { op: "windows" },
      10_000,
      signal,
    );
  }

  isActive(serial: string): boolean {
    return this.#sessions.has(serial);
  }

  async clipboard(
    serial: string,
    action: "get" | "set",
    text?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return await this.session(serial).connection.request(
      {
        op: "clipboard",
        action,
        ...(text === undefined ? {} : { text }),
      },
      10_000,
      signal,
    );
  }

  async hierarchy(
    serial: string,
    displayId: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return await this.session(serial).connection.request(
      { op: "hierarchy", displayId },
      10_000,
      signal,
    );
  }

  async releaseAll(serial: string, signal?: AbortSignal): Promise<void> {
    await this.session(serial).connection.request(
      { op: "releaseAll" },
      10_000,
      signal,
    );
  }

  async stop(serial: string): Promise<void> {
    await this.#lifecycle.mutate(serial, () => this.stopUnlocked(serial));
  }

  private async stopUnlocked(serial: string): Promise<void> {
    const session = this.#sessions.get(serial);
    if (!session) return;
    this.#sessions.delete(serial);
    session.connection.onClose = undefined;
    await session.connection.request({ op: "shutdown" }).catch(() => undefined);
    session.connection.close();
    session.instrumentation.kill("SIGTERM");
    await this.forceStop(serial);
    await this.adb
      .run(["forward", "--remove", `tcp:${session.port}`], { serial })
      .catch(() => undefined);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      [...this.#sessions.keys()].map((serial) => this.stop(serial)),
    );
  }

  private session(serial: string): CompanionSession {
    const session = this.#sessions.get(serial);
    if (!session) throw new Error(`Companion is not active on ${serial}`);
    return session;
  }

  private async cleanupUnexpected(
    serial: string,
    session: CompanionSession,
  ): Promise<void> {
    await this.#lifecycle.mutate(serial, async () => {
      if (this.#sessions.get(serial) !== session) return;
      this.#sessions.delete(serial);
      session.connection.onClose = undefined;
      session.connection.close();
      session.instrumentation.kill("SIGKILL");
      await this.forceStop(serial);
      await this.adb
        .run(["forward", "--remove", `tcp:${session.port}`], { serial })
        .catch(() => undefined);
    });
  }

  private async forceStop(serial: string): Promise<void> {
    await this.adb
      .run(["shell", "am", "force-stop", TEST_PACKAGE], { serial })
      .catch(() => undefined);
    await this.adb
      .run(["shell", "am", "force-stop", TARGET_PACKAGE], { serial })
      .catch(() => undefined);
  }
}

async function connectAndAuthenticate(
  port: number,
  token: string,
  signal?: AbortSignal,
): Promise<{
  connection: CompanionConnection;
  hello: Record<string, unknown>;
}> {
  const deadline = Date.now() + 10_000;
  let lastConnectionError: unknown;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    let connection: CompanionConnection | undefined;
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const socket = new Socket();
        const onError = (error: Error): void => {
          socket.destroy();
          reject(error);
        };
        socket.once("error", onError);
        socket.connect(port, "127.0.0.1", () => {
          socket.removeListener("error", onError);
          resolve(socket);
        });
      });
      connection = new CompanionConnection(socket);
      const hello = await connection.request(
        { op: "hello", token },
        1_000,
        signal,
      );
      return { connection, hello };
    } catch (error) {
      connection?.close();
      if (signal?.aborted) throw signal.reason;
      if (connection) throw error;
      lastConnectionError = error;
      await abortableDelay(150, signal);
    }
  }
  throw new Error(
    "Timed out connecting and authenticating with the instrumentation companion",
    { cause: lastConnectionError },
  );
}
