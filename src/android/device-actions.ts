import { AdbRunner, quoteRemoteShellArg } from "./adb-runner.js";

const CRASH_TAG = /(?:^|_)(?:crash|native_crash|anr|tombstone)(?:$|_)/i;
const SAFE_DROPBOX_TAG = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface DeviceFoldState {
  identifier: number;
  name?: string;
}

export interface DropboxEntry {
  /** Stable within one dump: time, tag, and occurrence of that pair. */
  id: string;
  time: string;
  tag: string;
  detail?: string;
}

export interface PrintedDropboxEntry {
  time: string;
  tag: string;
  text: string;
}

export interface ClipboardRead {
  readable: boolean;
  text?: string;
  redacted?: boolean;
  reason?: string;
}

export interface UserRotation {
  mode: "free" | "lock";
  rotation?: number;
  raw: string;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function assertViewUrl(raw: string): URL {
  if (raw.length === 0 || raw.length > 2048 || hasControlCharacter(raw)) {
    throw new Error("URL is empty, too long, or contains control characters");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `URL scheme ${url.protocol} is not allowed. Use http or https.`,
    );
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  if (!url.hostname) throw new Error("URL is missing a host");
  return url;
}

/** `cmd window user-rotation` prints `free` or `lock N`. */
export function parseUserRotation(raw: string): UserRotation {
  const text = raw.trim();
  if (text === "free") return { mode: "free", raw: text };
  const locked = text.match(/^lock\s+([0-3])$/);
  if (locked?.[1]) {
    return { mode: "lock", rotation: Number(locked[1]), raw: text };
  }
  throw new Error(`Unrecognized user rotation: ${text || "(empty)"}`);
}

/** Current `cmd device_state state` may be a bare id or a labeled sentence. */
export function parseCurrentFoldId(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const committed = trimmed.match(/(?:committed|current)[^\d\n]{0,40}(\d+)/i);
  if (committed?.[1]) return Number(committed[1]);
  const identified = trimmed.match(/identifier=(\d+)/);
  if (identified?.[1]) return Number(identified[1]);
  const labeled = trimmed.match(/(?:base|state)[^\d\n]{0,40}(\d+)/i);
  if (labeled?.[1]) return Number(labeled[1]);
  return undefined;
}

export function parseDeviceStates(raw: string): DeviceFoldState[] {
  const states: DeviceFoldState[] = [];
  const seen = new Set<number>();
  const detailed =
    /identifier=(\d+)[^}\n]*name='([^']+)'|identifier=(\d+)[^}\n]*name="([^"]+)"/g;
  for (const match of raw.matchAll(detailed)) {
    const identifier = Number(match[1] ?? match[3]);
    const name = match[2] ?? match[4];
    if (!Number.isInteger(identifier) || seen.has(identifier)) continue;
    seen.add(identifier);
    states.push(name ? { identifier, name } : { identifier });
  }
  if (states.length > 0) return states;
  for (const match of raw.matchAll(/^\s*(\d+)\s*:\s*([A-Za-z0-9_]+)/gm)) {
    const identifier = Number(match[1]);
    const name = match[2];
    if (!Number.isInteger(identifier) || !name || seen.has(identifier))
      continue;
    seen.add(identifier);
    states.push({ identifier, name });
  }
  return states;
}

export function resolveFoldState(
  states: readonly DeviceFoldState[],
  requested: string,
): DeviceFoldState {
  const trimmed = requested.trim();
  if (/^\d+$/.test(trimmed)) {
    const identifier = Number(trimmed);
    const found = states.find((state) => state.identifier === identifier);
    if (!found) {
      throw new Error(
        `Fold state ${trimmed} is not advertised. Known: ${formatStates(states)}`,
      );
    }
    return found;
  }
  const found = states.find(
    (state) => state.name?.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!found) {
    throw new Error(
      `Fold state ${trimmed} is not advertised. Known: ${formatStates(states)}`,
    );
  }
  return found;
}

function formatStates(states: readonly DeviceFoldState[]): string {
  return states
    .map((state) =>
      state.name
        ? `${state.identifier} ${state.name}`
        : String(state.identifier),
    )
    .join(", ");
}

export function crashEntryId(
  time: string,
  tag: string,
  occurrence: number,
): string {
  return `${time}|${tag}|${occurrence}`;
}

export function parseCrashId(id: string): {
  time: string;
  tag: string;
  occurrence: number;
} {
  const match = id.match(/^(.*)\|([A-Za-z0-9_.:-]+)\|(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid crash id: ${id}`);
  }
  return { time: match[1], tag: match[2], occurrence: Number(match[3]) };
}

export function parseDropboxIndex(raw: string): DropboxEntry[] {
  const entries: DropboxEntry[] = [];
  const seen = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+)(?: \(([^)]*)\))?/);
    if (!match?.[1] || !match[2] || !CRASH_TAG.test(match[2])) continue;
    const key = `${match[1]}|${match[2]}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    entries.push({
      id: crashEntryId(match[1], match[2], occurrence),
      time: match[1],
      tag: match[2],
      ...(match[3] ? { detail: match[3] } : {}),
    });
  }
  return entries;
}

/** Split `dumpsys dropbox --print` into one record per banner. */
export function splitPrintedDropbox(raw: string): PrintedDropboxEntry[] {
  const entries: PrintedDropboxEntry[] = [];
  for (const chunk of raw.split(/\n?={8,}\n/)) {
    const text = chunk.trim();
    if (!text) continue;
    const header = text.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+)/);
    if (header?.[1] && header[2]) {
      entries.push({ time: header[1], tag: header[2], text });
      continue;
    }
    const previous = entries.at(-1);
    if (previous) previous.text = `${previous.text}\n========\n${text}`;
  }
  return entries;
}

export function parseClipboardDump(raw: string): ClipboardRead {
  if (!/clipboard/i.test(raw)) {
    return {
      readable: false,
      reason: "dumpsys clipboard did not describe a clipboard",
    };
  }
  if (/\{T:\[REDACTED\]\}|\[REDACTED\]/i.test(raw)) {
    return {
      readable: false,
      redacted: true,
      reason:
        "Android redacted the clipboard. Background reads are blocked on Android 10+.",
    };
  }
  if (/mPrimaryClip:\s*null|Primary clip:\s*null/i.test(raw)) {
    return { readable: true, text: "" };
  }
  const braced = raw.match(/\{T:([^}]*)\}/);
  if (braced?.[1] !== undefined) {
    return { readable: true, text: braced[1] };
  }
  const quoted = raw.match(/text\/plain[^"\n]*"([^"]*)"/);
  if (quoted?.[1] !== undefined) return { readable: true, text: quoted[1] };
  return {
    readable: false,
    reason:
      "Clipboard dump has no primary text. Android 10+ only lets the focused app read it, and this build has no clipboard shell command.",
  };
}

function assertClipboardText(text: string): void {
  if (text.length > 8_000 || text.includes("\0")) {
    throw new Error("Clipboard text is too long or contains a NUL byte");
  }
}

function assertLatLng(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Coordinate is not finite");
  const text = value.toFixed(7).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

export class DeviceActions {
  constructor(readonly adb = new AdbRunner()) {}

  async openUrl(
    serial: string,
    displayId: number,
    rawUrl: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; output: string }> {
    const url = assertViewUrl(rawUrl);
    const result = await this.adb.run(
      [
        "shell",
        "am",
        "start",
        "--display",
        String(displayId),
        "-a",
        "android.intent.action.VIEW",
        "-d",
        quoteRemoteShellArg(url.href),
      ],
      { serial, signal, timeoutMs: 20_000 },
    );
    const output = [result.stdout, result.stderr]
      .map((chunk) => chunk.toString("utf8").trim())
      .filter((chunk) => chunk.length > 0)
      .join("\n");
    if (/^Error:/m.test(output)) throw new Error(output);
    return { url: url.href, output };
  }

  async getOrientation(
    serial: string,
    displayId: number,
    signal?: AbortSignal,
  ): Promise<UserRotation & { displayId: number }> {
    const raw = await this.adb.text(
      ["shell", "cmd", "window", "user-rotation", "-d", String(displayId)],
      { serial, signal },
    );
    return { displayId, ...parseUserRotation(raw) };
  }

  async setOrientation(
    serial: string,
    displayId: number,
    mode: "free" | "lock",
    rotation: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ displayId: number; mode: "free" | "lock"; rotation?: number }> {
    const args = [
      "shell",
      "cmd",
      "window",
      "user-rotation",
      "-d",
      String(displayId),
      mode,
    ];
    if (mode === "lock") {
      if (rotation === undefined || rotation < 0 || rotation > 3) {
        throw new Error("lock requires rotation 0, 1, 2, or 3");
      }
      args.push(String(rotation));
    }
    await this.adb.text(args, { serial, signal });
    return {
      displayId,
      mode,
      ...(mode === "lock" && rotation !== undefined ? { rotation } : {}),
    };
  }

  async getFold(
    serial: string,
    signal?: AbortSignal,
  ): Promise<{
    foldable: boolean;
    states: DeviceFoldState[];
    currentId?: number;
    currentName?: string;
    reason?: string;
  }> {
    let listed: string;
    try {
      listed = await this.adb.text(
        ["shell", "cmd", "device_state", "print-states"],
        { serial, signal },
      );
    } catch (error) {
      return {
        foldable: false,
        states: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const states = parseDeviceStates(listed);
    if (states.length === 0) {
      return {
        foldable: false,
        states: [],
        reason: "cmd device_state did not advertise any states",
      };
    }
    const currentRaw = await this.adb.text(
      ["shell", "cmd", "device_state", "state"],
      { serial, signal },
    );
    const currentId = parseCurrentFoldId(currentRaw);
    const current = states.find((state) => state.identifier === currentId);
    return {
      foldable: true,
      states,
      ...(currentId === undefined ? {} : { currentId }),
      ...(current?.name ? { currentName: current.name } : {}),
    };
  }

  async setFold(
    serial: string,
    requested: string,
    signal?: AbortSignal,
  ): Promise<{ identifier: number; name?: string }> {
    const current = await this.getFold(serial, signal);
    if (!current.foldable) {
      throw new Error(
        current.reason ?? "This device does not advertise fold states",
      );
    }
    const state = resolveFoldState(current.states, requested);
    await this.adb.text(
      ["shell", "cmd", "device_state", "state", String(state.identifier)],
      { serial, signal },
    );
    return {
      identifier: state.identifier,
      ...(state.name ? { name: state.name } : {}),
    };
  }

  async setLocation(
    serial: string,
    latitude: number,
    longitude: number,
    accuracyMeters: number,
    signal?: AbortSignal,
  ): Promise<{
    backend: "emulator" | "test-provider";
    latitude: number;
    longitude: number;
  }> {
    assertLatLng(latitude, longitude);
    if (
      !Number.isFinite(accuracyMeters) ||
      accuracyMeters <= 0 ||
      accuracyMeters > 10_000
    ) {
      throw new Error("accuracyMeters must be between 0 and 10000");
    }
    const qemu = await this.adb.text(["shell", "getprop", "ro.kernel.qemu"], {
      serial,
      signal,
    });
    if (serial.startsWith("emulator-") || qemu === "1") {
      await this.adb.text(
        [
          "emu",
          "geo",
          "fix",
          formatCoordinate(longitude),
          formatCoordinate(latitude),
        ],
        { serial, signal },
      );
      return { backend: "emulator", latitude, longitude };
    }
    await this.assertMockLocationApi(serial, signal);
    const provider = "gps";
    try {
      await this.adb.text(
        [
          "shell",
          "cmd",
          "location",
          "providers",
          "add-test-provider",
          provider,
          "--requiresSatellite",
          "--supportsAltitude",
        ],
        { serial, signal },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already|exists/i.test(message)) throw error;
    }
    await this.adb.text(
      [
        "shell",
        "cmd",
        "location",
        "providers",
        "set-test-provider-enabled",
        provider,
        "true",
      ],
      { serial, signal },
    );
    await this.adb.text(
      [
        "shell",
        "cmd",
        "location",
        "providers",
        "set-test-provider-location",
        provider,
        "--location",
        `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`,
        "--accuracy",
        formatCoordinate(accuracyMeters),
      ],
      { serial, signal },
    );
    return { backend: "test-provider", latitude, longitude };
  }

  async clearLocation(
    serial: string,
    signal?: AbortSignal,
  ): Promise<{ cleared: boolean; warning?: string }> {
    const qemu = await this.adb.text(["shell", "getprop", "ro.kernel.qemu"], {
      serial,
      signal,
    });
    if (serial.startsWith("emulator-") || qemu === "1") {
      throw new Error(
        "The emulator keeps the last geo fix until the next mobile_location set or a cold boot.",
      );
    }
    await this.assertMockLocationApi(serial, signal);
    await this.adb.text(
      [
        "shell",
        "cmd",
        "location",
        "providers",
        "set-test-provider-enabled",
        "gps",
        "false",
      ],
      { serial, signal },
    );
    await this.adb.text(
      ["shell", "cmd", "location", "providers", "remove-test-provider", "gps"],
      { serial, signal },
    );
    return { cleared: true };
  }

  private async assertMockLocationApi(
    serial: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const sdk = Number(
      await this.adb.text(["shell", "getprop", "ro.build.version.sdk"], {
        serial,
        signal,
      }),
    );
    if (!Number.isInteger(sdk) || sdk < 31) {
      throw new Error(
        `Mock location on a device uses cmd location, which requires Android 12 (API 31) or newer. This device reports API ${Number.isInteger(sdk) ? sdk : "unknown"}.`,
      );
    }
  }

  async getClipboard(
    serial: string,
    signal?: AbortSignal,
  ): Promise<ClipboardRead> {
    const dump = await this.adb.text(["shell", "dumpsys", "clipboard"], {
      serial,
      signal,
      timeoutMs: 15_000,
      maxOutputBytes: 1_048_576,
    });
    const parsed = parseClipboardDump(dump);
    if (parsed.readable) return parsed;
    try {
      const shell = await this.adb.text(["shell", "cmd", "clipboard", "get"], {
        serial,
        signal,
      });
      if (/no shell command implementation/i.test(shell)) return parsed;
      return { readable: true, text: shell };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no shell command implementation/i.test(message)) return parsed;
      return parsed;
    }
  }

  async setClipboard(
    serial: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<{ set: true }> {
    assertClipboardText(text);
    let output: string;
    try {
      output = await this.adb.text(
        ["shell", "cmd", "clipboard", "set", quoteRemoteShellArg(text)],
        { serial, signal },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no shell command implementation/i.test(message)) {
        throw new Error(
          "This Android build has no clipboard shell command. Writes need a focused app.",
          { cause: error },
        );
      }
      throw error;
    }
    if (/no shell command implementation/i.test(output)) {
      throw new Error(
        "This Android build has no clipboard shell command. Writes need a focused app.",
      );
    }
    return { set: true };
  }

  async listCrashes(
    serial: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ entries: DropboxEntry[]; truncated: boolean }> {
    const raw = await this.adb.text(["shell", "dumpsys", "dropbox"], {
      serial,
      signal,
      timeoutMs: 20_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    const entries = parseDropboxIndex(raw);
    return {
      entries: entries.slice(-limit).reverse(),
      truncated: entries.length > limit,
    };
  }

  async getCrash(
    serial: string,
    input: { tag?: string | undefined; id?: string | undefined },
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    tag: string;
    time: string;
    text: string;
    truncated: boolean;
  }> {
    const selected = input.id ? parseCrashId(input.id) : undefined;
    const tag = input.tag ?? selected?.tag;
    if (!tag || !SAFE_DROPBOX_TAG.test(tag) || !CRASH_TAG.test(tag)) {
      throw new Error(`Unsupported crash tag: ${tag ?? "(missing)"}`);
    }
    if (selected && input.tag && input.tag !== selected.tag) {
      throw new Error(
        `Crash id tag ${selected.tag} does not match ${input.tag}`,
      );
    }
    const raw = await this.adb.text(
      ["shell", "dumpsys", "dropbox", "--print", tag],
      {
        serial,
        signal,
        timeoutMs: 20_000,
        maxOutputBytes: 8 * 1024 * 1024,
      },
    );
    const printed = splitPrintedDropbox(raw).filter(
      (entry) => entry.tag === tag,
    );
    const chosen = selected
      ? printed.filter((entry) => entry.time === selected.time)[
          selected.occurrence
        ]
      : printed[printed.length - 1];
    if (!chosen) {
      throw new Error(
        selected
          ? `Crash ${input.id} is not in the current dropbox`
          : `No dropbox entry for ${tag}`,
      );
    }
    const occurrence =
      selected?.occurrence ??
      printed.filter((entry) => entry.time === chosen.time).length - 1;
    return {
      id: crashEntryId(chosen.time, chosen.tag, occurrence),
      tag: chosen.tag,
      time: chosen.time,
      text: chosen.text.slice(0, maxChars),
      truncated: chosen.text.length > maxChars,
    };
  }
}
