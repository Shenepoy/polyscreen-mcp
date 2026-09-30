import { randomUUID } from "node:crypto";

import { abortableDelay } from "../utils/abortable-delay.js";
import {
  AdbCommandError,
  AdbRunner,
  quoteRemoteShellArg,
} from "./adb-runner.js";
import { DeviceQueue } from "./device-queue.js";
import {
  correlatePhysicalDisplays,
  parseDevices,
  parseInputCapabilities,
  parseLogicalDisplays,
  parsePhysicalDisplays,
  parseProperties,
  parseWindowFocus,
} from "./parsers.js";
import type {
  AndroidDevice,
  AndroidDisplay,
  DeviceCapabilities,
  OperationEnvelope,
} from "./types.js";
import { findUiNodes, parseUiNodes } from "./ui.js";

// mDNS serials renamed by Bonjour conflict resolution contain a space and
// parentheses ("adb-XYZ (3)._adb-tls-connect._tcp"), so single inner spaces are
// allowed. ADB is always spawned with an argv array, never a host shell.
const SAFE_SERIAL_TOKEN = String.raw`[A-Za-z0-9._:[\]()@+-]+`;
const SAFE_SERIAL = new RegExp(
  `^${SAFE_SERIAL_TOKEN}(?: ${SAFE_SERIAL_TOKEN})*$`,
);
const SAFE_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const SAFE_COMPONENT = /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/;
const SAFE_KEY = /^(?:KEYCODE_)?[A-Z0-9_]+$|^\d{1,4}$/;
const INPUT_SOURCES = ["keyboard", "dpad", "gamepad"] as const;
const MAX_SEQUENCE_KEYS = 32;
const MAX_TOUCH_COMBO_POINTS = 8;
const MAX_SEQUENCE_DELAY_MS = 5_000;
const MAX_SEQUENCE_DELAY_SUM_MS = 60_000;
const KEY_SEQUENCE_TIMEOUT_PER_KEY_MS = 2_000;
const MAX_KEY_SEQUENCE_TIMEOUT_MS =
  MAX_SEQUENCE_DELAY_SUM_MS +
  MAX_SEQUENCE_KEYS * KEY_SEQUENCE_TIMEOUT_PER_KEY_MS;
const KEY_SEQUENCE_ALIASES: Readonly<Record<string, string>> = {
  A: "BUTTON_A",
  B: "BUTTON_B",
  X: "BUTTON_X",
  Y: "BUTTON_Y",
  UP: "DPAD_UP",
  DOWN: "DPAD_DOWN",
  LEFT: "DPAD_LEFT",
  RIGHT: "DPAD_RIGHT",
  L1: "BUTTON_L1",
  R1: "BUTTON_R1",
  L2: "BUTTON_L2",
  R2: "BUTTON_R2",
  LB: "BUTTON_L1",
  RB: "BUTTON_R1",
  START: "BUTTON_START",
  SELECT: "BUTTON_SELECT",
  HOME: "HOME",
  BACK: "BACK",
};

type InputSource = (typeof INPUT_SOURCES)[number];

// `input` subcommand -> the capability flag parsed from `input` help.
const INPUT_COMMAND_CAPABILITIES: Record<
  string,
  keyof DeviceCapabilities["input"]["commands"]
> = {
  text: "text",
  keyevent: "keyevent",
  tap: "tap",
  swipe: "swipe",
  draganddrop: "dragAndDrop",
  motionevent: "motionEvent",
  keycombination: "keyCombination",
  scroll: "scroll",
};

export interface KeyInput {
  key: string;
  displayId: number;
  source?: InputSource | undefined;
  action?: "press" | "long_press" | "double_tap" | undefined;
  durationMs?: number | undefined;
}

export type KeySequenceStep = {
  delayAfterMs: number;
} & ({ key: string; keyCode: string } | { x: number; y: number });

export interface SequenceUiCheck {
  text?: string | undefined;
  contentDescription?: string | undefined;
  resourceId?: string | undefined;
  exact?: boolean | undefined;
}

export interface SequenceCheckReport {
  index: number;
  found: boolean;
  attempts: number;
  elapsedMs: number;
}

export interface KeySequenceInput {
  displayId: number;
  sequence: string;
  source?: InputSource | undefined;
  gapMs?: number | undefined;
  /** Run each action on its own and poll for a UI node before the next one. */
  stepped?:
    | {
        timeoutMs?: number | undefined;
        pollMs?: number | undefined;
        checks: Array<SequenceUiCheck | null>;
      }
    | undefined;
}

export interface KeySequenceResult {
  source: InputSource;
  displayId: number;
  gapMs: number;
  steps: readonly KeySequenceStep[];
  stepped?: true;
  completed?: boolean;
  stoppedAt?: number;
  checks?: Array<SequenceCheckReport | null>;
}

export class AndroidController {
  readonly #queue = new DeviceQueue();
  readonly #capabilities = new Map<
    string,
    { value: DeviceCapabilities; cachedAt: number; transportId?: string }
  >();

  constructor(readonly adb = new AdbRunner()) {}

  async listDevices(signal?: AbortSignal): Promise<AndroidDevice[]> {
    const devices = parseDevices(
      await this.adb.text(["devices", "-l"], { signal }),
    );
    const probed = await Promise.all(
      devices.map(async (device) => {
        if (device.state !== "device") {
          return { ...device, reachable: false, preferred: false };
        }
        try {
          const [state, hardwareSerial] = await Promise.all([
            this.adb
              .text(["get-state"], {
                serial: device.serial,
                signal,
                timeoutMs: 3_000,
              })
              .then((value) => value.trim())
              .catch((error: unknown) => {
                if (signal?.aborted) throw signal.reason ?? error;
                return "";
              }),
            this.adb
              .text(["shell", "getprop", "ro.serialno"], {
                serial: device.serial,
                signal,
                timeoutMs: 3_000,
              })
              .then((value) => value.trim())
              .catch((error: unknown) => {
                if (signal?.aborted) throw signal.reason ?? error;
                return "";
              }),
          ]);
          return {
            ...device,
            reachable: state === "device",
            ...(hardwareSerial ? { hardwareSerial } : {}),
          };
        } catch {
          if (signal?.aborted) throw signal.reason;
          return { ...device, reachable: false };
        }
      }),
    );

    // Only alias devices that share a hardware serial. Never group on empty
    // product/model/device metadata (that collapses unrelated offline entries).
    const groups = new Map<string, AndroidDevice[]>();
    for (const device of probed) {
      if (!device.hardwareSerial) {
        device.preferred = device.reachable === true;
        device.preferredSerial = device.serial;
        device.aliases = [];
        continue;
      }
      const group = groups.get(device.hardwareSerial) ?? [];
      group.push(device);
      groups.set(device.hardwareSerial, group);
    }

    for (const group of groups.values()) {
      if (group.length < 2) {
        for (const device of group) {
          device.preferred = device.reachable === true;
          device.preferredSerial = device.serial;
          device.aliases = [];
        }
        continue;
      }
      const ranked = [...group].sort(
        (a, b) =>
          Number(b.reachable) - Number(a.reachable) ||
          Number(isTcpSerial(b.serial)) - Number(isTcpSerial(a.serial)) ||
          a.serial.localeCompare(b.serial),
      );
      const preferred = ranked.find((device) => device.reachable) ?? ranked[0]!;
      for (const device of group) {
        device.preferredSerial = preferred.serial;
        // Never mark an unreachable twin as preferred — agents should reconnect.
        device.preferred =
          device.serial === preferred.serial && device.reachable === true;
        device.aliases = group
          .map((candidate) => candidate.serial)
          .filter((serial) => serial !== device.serial)
          .sort();
      }
    }

    return probed.sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      return a.serial.localeCompare(b.serial);
    });
  }

  async requireDevice(
    serial: string,
    signal?: AbortSignal,
  ): Promise<AndroidDevice> {
    if (!SAFE_SERIAL.test(serial))
      throw new Error(`Invalid device serial: ${serial}`);
    const device = (await this.listDevices(signal)).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new Error(`Device is not connected: ${serial}`);
    if (device.state !== "device")
      throw new Error(`Device ${serial} is ${device.state}`);
    if (device.reachable === false) {
      const hint =
        device.preferredSerial && device.preferredSerial !== serial
          ? `; try preferredSerial ${device.preferredSerial}`
          : "";
      throw new Error(`Device ${serial} is listed but not reachable${hint}`);
    }
    return device;
  }

  async inspectDevice(
    serial: string,
    options: {
      refresh?: boolean | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<DeviceCapabilities> {
    const device = await this.requireDevice(serial, options.signal);
    if (!options.refresh) {
      const cached = this.#capabilities.get(serial);
      if (
        cached &&
        Date.now() - cached.cachedAt < 60_000 &&
        cached.transportId === device.transportId
      ) {
        return cached.value;
      }
    }

    const [adbVersion, propertiesText, featuresText, inputHelp] =
      await Promise.all([
        this.adb.text(["version"], { signal: options.signal }),
        this.adb.text(["shell", "getprop"], { serial, signal: options.signal }),
        this.adb.text(["features"], { serial, signal: options.signal }),
        this.probe(serial, ["shell", "input"], options.signal),
      ]);
    const properties = parseProperties(propertiesText);
    const commandNames = [
      "screencap",
      "screenrecord",
      "uiautomator",
      "getevent",
      "sendevent",
      "uinput",
      "logcat",
      "perfetto",
      "simpleperf",
    ];
    const commands = Object.fromEntries(
      await Promise.all(
        commandNames.map(async (command) => {
          const result = await this.probe(
            serial,
            ["shell", "command", "-v", command],
            options.signal,
          );
          return [
            command,
            result.supported && result.output.length > 0,
          ] as const;
        }),
      ),
    );
    const capabilities: DeviceCapabilities = {
      serial,
      adbVersion: adbVersion.split(/\r?\n/)[0] ?? adbVersion,
      apiLevel: Number(properties["ro.build.version.sdk"] ?? 0),
      release: properties["ro.build.version.release"] ?? "unknown",
      manufacturer: properties["ro.product.manufacturer"] ?? "unknown",
      model: properties["ro.product.model"] ?? "unknown",
      buildType: properties["ro.build.type"] ?? "unknown",
      features: featuresText.split(/\s+/).filter(Boolean),
      input: parseInputCapabilities(
        inputHelp.supported ? inputHelp.output : "",
      ),
      commands,
      probedAt: new Date().toISOString(),
    };
    this.#capabilities.set(serial, {
      value: capabilities,
      cachedAt: Date.now(),
      ...(device.transportId ? { transportId: device.transportId } : {}),
    });
    return capabilities;
  }

  async listDisplays(
    serial: string,
    signal?: AbortSignal,
  ): Promise<AndroidDisplay[]> {
    await this.requireDevice(serial, signal);
    const [displayDump, physicalDump, windowDump] = await Promise.all([
      this.adb.text(["shell", "dumpsys", "display"], {
        serial,
        signal,
        timeoutMs: 15_000,
      }),
      this.probe(
        serial,
        ["shell", "dumpsys", "SurfaceFlinger", "--display-id"],
        signal,
      ),
      this.probe(serial, ["shell", "dumpsys", "window", "displays"], signal),
    ]);
    const displays = correlatePhysicalDisplays(
      parseLogicalDisplays(displayDump),
      parsePhysicalDisplays(physicalDump.output),
    );
    this.attachWindowFocus(displays, windowDump.output);
    return displays;
  }

  async captureScreen(
    serial: string,
    displayId: number,
    signal?: AbortSignal,
  ): Promise<{ png: Buffer; display: AndroidDisplay; durationMs: number }> {
    const displays = await this.listDisplays(serial, signal);
    const display = displays.find(
      (candidate) => candidate.logicalId === displayId,
    );
    if (!display) {
      throw new Error(
        `Logical display ${displayId} is not available on ${serial}`,
      );
    }
    const physicalDisplays = displays.filter(
      (candidate) => candidate.physicalId !== undefined,
    );
    if (
      !display.physicalId &&
      (displayId !== 0 || physicalDisplays.length !== 1)
    ) {
      throw new Error(
        `Logical display ${displayId} has no correlated physical ID and cannot be captured by screencap`,
      );
    }
    const args = ["exec-out", "screencap", "-p"];
    if (display.physicalId) args.push("-d", display.physicalId);
    const result = await this.adb.run(args, {
      serial,
      signal,
      timeoutMs: 20_000,
      maxOutputBytes: 32 * 1024 * 1024,
    });
    if (!result.stdout.subarray(1, 4).equals(Buffer.from("PNG"))) {
      throw new Error("screencap did not return a PNG image");
    }
    return { png: result.stdout, display, durationMs: result.durationMs };
  }

  async captureScreenPair(
    serial: string,
    displayIds: number[],
    signal?: AbortSignal,
  ): Promise<{
    serial: string;
    captures: Array<{
      displayId: number;
      display: AndroidDisplay;
      png: Buffer;
      durationMs: number;
    }>;
    skewMs: number;
  }> {
    if (displayIds.length < 2) {
      throw new Error("captureScreenPair requires at least two displayIds");
    }
    const unique = [...new Set(displayIds)];
    const displays = await this.listDisplays(serial, signal);
    const targets = unique.map((displayId) => {
      const display = displays.find(
        (candidate) => candidate.logicalId === displayId,
      );
      if (!display) {
        throw new Error(
          `Logical display ${displayId} is not available on ${serial}`,
        );
      }
      if (!display.physicalId) {
        throw new Error(
          `Logical display ${displayId} has no correlated physical ID and cannot be captured by screencap`,
        );
      }
      return display;
    });

    const started = performance.now();
    const captures = await Promise.all(
      targets.map(async (display) => {
        const captureStarted = performance.now();
        const args = ["exec-out", "screencap", "-p", "-d", display.physicalId!];
        const result = await this.adb.run(args, {
          serial,
          signal,
          timeoutMs: 20_000,
          maxOutputBytes: 32 * 1024 * 1024,
        });
        if (!result.stdout.subarray(1, 4).equals(Buffer.from("PNG"))) {
          throw new Error(
            `screencap did not return a PNG image for display ${display.logicalId}`,
          );
        }
        return {
          displayId: display.logicalId,
          display,
          png: result.stdout,
          durationMs: Math.round(performance.now() - captureStarted),
        };
      }),
    );
    return {
      serial,
      captures,
      skewMs: Math.round(performance.now() - started),
    };
  }

  async sampleFocus(
    serial: string,
    displayIds: number[],
    signal?: AbortSignal,
  ): Promise<
    Record<
      string,
      {
        packageName?: string;
        activity?: string;
        taskId?: number;
        focusedWindow?: string;
      }
    >
  > {
    const output = await this.adb.text(
      ["shell", "dumpsys", "window", "displays"],
      { serial, signal, timeoutMs: 12_000, maxOutputBytes: 2 * 1024 * 1024 },
    );
    const wanted = new Set(displayIds);
    const result: Record<
      string,
      {
        packageName?: string;
        activity?: string;
        taskId?: number;
        focusedWindow?: string;
      }
    > = {};
    for (const sample of parseWindowFocus(output)) {
      if (!wanted.has(sample.logicalId)) continue;
      // Omit displays with no focus evidence — do not invent empty {} states
      // that look like focus loss during dump/parser flakes.
      if (
        !sample.focusedPackage &&
        !sample.focusedActivity &&
        !sample.focusedWindow &&
        sample.focusedTaskId === undefined
      ) {
        continue;
      }
      result[String(sample.logicalId)] = {
        ...(sample.focusedPackage
          ? { packageName: sample.focusedPackage }
          : {}),
        ...(sample.focusedActivity ? { activity: sample.focusedActivity } : {}),
        ...(sample.focusedTaskId !== undefined
          ? { taskId: sample.focusedTaskId }
          : {}),
        ...(sample.focusedWindow
          ? { focusedWindow: sample.focusedWindow }
          : {}),
      };
    }
    return result;
  }

  async uiSnapshot(
    serial: string,
    displayId: number,
    signal?: AbortSignal,
  ): Promise<string> {
    await this.requireDisplay(serial, displayId, signal);
    if (displayId !== 0) {
      throw new Error(
        "Portable uiautomator cannot select a non-default display; enable the instrumentation backend",
      );
    }
    const remotePath = `/data/local/tmp/polyscreen-${randomUUID()}.xml`;
    try {
      const dump = await this.adb.run(
        ["shell", "uiautomator", "dump", remotePath],
        {
          serial,
          signal,
          timeoutMs: 20_000,
        },
      );
      const output = await this.adb.text(["exec-out", "cat", remotePath], {
        serial,
        signal,
        timeoutMs: 20_000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
      const start = output.indexOf("<?xml");
      if (start < 0) {
        const diagnostic = Buffer.concat([dump.stdout, dump.stderr])
          .toString("utf8")
          .trim();
        throw new Error(
          `UIAutomator did not produce an XML hierarchy${diagnostic ? `: ${diagnostic}` : ""}`,
        );
      }
      return output.slice(start);
    } finally {
      await this.adb
        .run(["shell", "rm", "-f", remotePath], { serial })
        .catch(() => undefined);
    }
  }

  async tap(
    serial: string,
    displayId: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<OperationEnvelope<{ x: number; y: number }>> {
    return await this.mutate(
      serial,
      displayId,
      ["touchscreen", "-d", String(displayId), "tap", String(x), String(y)],
      { x, y },
      signal,
      [],
      [{ x, y }],
    );
  }

  async swipe(
    serial: string,
    displayId: number,
    start: { x: number; y: number },
    end: { x: number; y: number },
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{
      start: typeof start;
      end: typeof end;
      durationMs: number;
    }>
  > {
    return await this.mutate(
      serial,
      displayId,
      [
        "touchscreen",
        "-d",
        String(displayId),
        "swipe",
        String(start.x),
        String(start.y),
        String(end.x),
        String(end.y),
        String(durationMs),
      ],
      { start, end, durationMs },
      signal,
      [],
      [start, end],
    );
  }

  async dragAndDrop(
    serial: string,
    displayId: number,
    start: { x: number; y: number },
    end: { x: number; y: number },
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{
      start: typeof start;
      end: typeof end;
      durationMs: number;
    }>
  > {
    const capabilities = await this.inspectDevice(serial, { signal });
    if (!capabilities.input.commands.dragAndDrop) {
      throw new Error(
        "This device does not advertise ADB drag-and-drop support",
      );
    }
    return await this.mutate(
      serial,
      displayId,
      [
        "touchscreen",
        "-d",
        String(displayId),
        "draganddrop",
        String(start.x),
        String(start.y),
        String(end.x),
        String(end.y),
        String(durationMs),
      ],
      { start, end, durationMs },
      signal,
      [],
      [start, end],
    );
  }

  async inputKeyCombination(
    serial: string,
    displayId: number,
    keys: string[],
    durationMs: number,
    source: "keyboard" | "dpad" | "gamepad",
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{
      keys: string[];
      durationMs: number;
      source: "keyboard" | "dpad" | "gamepad";
    }>
  > {
    const capabilities = await this.inspectDevice(serial, { signal });
    if (!capabilities.input.commands.keyCombination) {
      throw new Error(
        "This device does not advertise simultaneous key-combination support",
      );
    }
    for (const key of keys) {
      if (!SAFE_KEY.test(key))
        throw new Error(`Invalid Android keycode: ${key}`);
    }
    return await this.mutate(
      serial,
      displayId,
      [
        source,
        "-d",
        String(displayId),
        "keycombination",
        "-t",
        String(durationMs),
        ...keys,
      ],
      { keys, durationMs, source },
      signal,
    );
  }

  async inputKey(
    serial: string,
    input: KeyInput,
    signal?: AbortSignal,
  ): Promise<OperationEnvelope<KeyInput>> {
    if (!SAFE_KEY.test(input.key))
      throw new Error(`Invalid Android keycode: ${input.key}`);
    const capabilities = await this.inspectDevice(serial, { signal });
    const action = input.action ?? "press";
    const source = input.source ?? "gamepad";
    const args = [source, "-d", String(input.displayId), "keyevent"];
    if (action === "long_press") {
      if (
        input.durationMs !== undefined &&
        capabilities.input.keyOptions.duration
      ) {
        args.push("--duration", String(input.durationMs));
      } else if (capabilities.input.keyOptions.longPress) {
        args.push("--longpress");
      } else {
        throw new Error(
          "This device does not advertise key long-press support",
        );
      }
    } else if (action === "double_tap") {
      if (!capabilities.input.keyOptions.doubleTap) {
        throw new Error(
          "This device does not advertise key double-tap support",
        );
      }
      args.push("--doubletap");
    }
    args.push(input.key);
    return await this.mutate(serial, input.displayId, args, input, signal);
  }

  async inputKeySequence(
    serial: string,
    input: KeySequenceInput,
    signal?: AbortSignal,
  ): Promise<OperationEnvelope<KeySequenceResult>> {
    const source = input.source ?? "gamepad";
    const gapMs = input.gapMs ?? 300;
    const displayId = sequenceDisplayId(input.displayId);
    assertInputSource(source);
    const steps = parseKeySequence(input.sequence, gapMs);
    if (input.stepped) {
      assertSequenceChecks(steps.length, input.displayId, input.stepped);
    }
    const points = steps.flatMap((step) =>
      isTapStep(step) ? [{ x: step.x, y: step.y }] : [],
    );
    const hasKey = steps.some((step) => !isTapStep(step));
    const prepared = await this.prepareInput(
      serial,
      input.displayId,
      hasKey
        ? [source, "-d", displayId, "keyevent"]
        : ["touchscreen", "-d", displayId, "tap"],
      signal,
      [],
      points,
    );
    if (hasKey && points.length > 0) {
      assertInputSupported(
        await this.inspectDevice(serial, { signal }),
        "touchscreen",
        "tap",
      );
    }
    if (input.stepped) {
      return await this.playSteppedSequence(
        serial,
        input.displayId,
        source,
        gapMs,
        displayId,
        steps,
        input.stepped,
        prepared.inputArgs.includes("-d"),
        prepared.warnings,
        signal,
      );
    }
    const script = buildKeySequenceScript(
      source,
      displayId,
      steps,
      prepared.inputArgs.includes("-d"),
    );
    const delaySum = steps.reduce((sum, step) => sum + step.delayAfterMs, 0);
    const timeoutMs = Math.min(
      delaySum + steps.length * KEY_SEQUENCE_TIMEOUT_PER_KEY_MS,
      MAX_KEY_SEQUENCE_TIMEOUT_MS,
    );
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(["shell", "sh", "-c", quoteRemoteShellArg(script)], {
        serial,
        signal,
        timeoutMs,
      }),
    );
    return this.envelope(
      serial,
      input.displayId,
      "adb",
      { source, displayId: input.displayId, gapMs, steps },
      result.durationMs,
      prepared.warnings,
    );
  }

  private async playSteppedSequence(
    serial: string,
    logicalDisplayId: number,
    source: InputSource,
    gapMs: number,
    displayId: string,
    steps: readonly KeySequenceStep[],
    stepped: NonNullable<KeySequenceInput["stepped"]>,
    displayTargeting: boolean,
    warnings: string[],
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{
      source: InputSource;
      displayId: number;
      gapMs: number;
      steps: readonly KeySequenceStep[];
      stepped: true;
      completed: boolean;
      stoppedAt?: number;
      checks: Array<SequenceCheckReport | null>;
    }>
  > {
    const timeoutMs = stepped.timeoutMs ?? 5_000;
    const pollMs = stepped.pollMs ?? 300;
    const played = await this.#queue.mutate(serial, async () => {
      const started = performance.now();
      const checks: Array<SequenceCheckReport | null> = [];
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (!step) continue;
        signal?.throwIfAborted();
        await this.adb.run(
          [
            "shell",
            "input",
            ...sequenceInputArgv(source, displayId, step, displayTargeting),
          ],
          { serial, signal, timeoutMs: KEY_SEQUENCE_TIMEOUT_PER_KEY_MS },
        );
        if (step.delayAfterMs > 0) {
          await abortableDelay(step.delayAfterMs, signal);
        }
        const check = stepped.checks[index] ?? null;
        if (!check) {
          checks.push(null);
          continue;
        }
        const report = await this.pollForUi(
          serial,
          logicalDisplayId,
          check,
          timeoutMs,
          pollMs,
          signal,
        );
        checks.push({ index, ...report });
        if (!report.found) {
          return {
            durationMs: Math.round(performance.now() - started),
            checks,
            completed: false as const,
            stoppedAt: index,
          };
        }
      }
      return {
        durationMs: Math.round(performance.now() - started),
        checks,
        completed: true as const,
      };
    });
    const stopped = played.stoppedAt !== undefined;
    return this.envelope(
      serial,
      logicalDisplayId,
      "adb",
      {
        source,
        displayId: logicalDisplayId,
        gapMs,
        steps,
        stepped: true,
        completed: played.completed,
        checks: played.checks,
        ...(stopped ? { stoppedAt: played.stoppedAt } : {}),
      },
      played.durationMs,
      stopped
        ? [
            ...warnings,
            `UI check failed after step ${played.stoppedAt}: ${describeUiCheck(stepped.checks[played.stoppedAt ?? 0])}`,
          ]
        : warnings,
    );
  }

  private async pollForUi(
    serial: string,
    displayId: number,
    query: SequenceUiCheck,
    timeoutMs: number,
    pollMs: number,
    signal?: AbortSignal,
  ): Promise<{ found: boolean; attempts: number; elapsedMs: number }> {
    const started = performance.now();
    let attempts = 0;
    while (true) {
      signal?.throwIfAborted();
      attempts += 1;
      const nodes = parseUiNodes(
        await this.uiSnapshot(serial, displayId, signal),
      );
      if (findUiNodes(nodes, query).length > 0) {
        return {
          found: true,
          attempts,
          elapsedMs: Math.round(performance.now() - started),
        };
      }
      const elapsed = performance.now() - started;
      if (elapsed >= timeoutMs) {
        return {
          found: false,
          attempts,
          elapsedMs: Math.round(elapsed),
        };
      }
      await abortableDelay(Math.min(pollMs, timeoutMs - elapsed), signal);
    }
  }

  async inputText(
    serial: string,
    displayId: number,
    text: string,
    signal?: AbortSignal,
  ): Promise<OperationEnvelope<{ text: string; unicodeReliable: false }>> {
    const encoded = text.replaceAll(" ", "%s");
    return await this.mutate(
      serial,
      displayId,
      [
        "keyboard",
        "-d",
        String(displayId),
        "text",
        quoteRemoteShellArg(encoded),
      ],
      { text, unicodeReliable: false },
      signal,
      [
        "ADB input text is not reliable for arbitrary Unicode; use the scrcpy backend when enabled",
      ],
    );
  }

  async inspectApp(
    serial: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<string> {
    this.validatePackage(packageName);
    return await this.adb.text(["shell", "dumpsys", "package", packageName], {
      serial,
      signal,
      timeoutMs: 20_000,
      maxOutputBytes: 16 * 1024 * 1024,
    });
  }

  async launchApp(
    serial: string,
    packageName: string,
    displayId: number,
    activity?: string,
    signal?: AbortSignal,
    userId: number | "current" = "current",
  ): Promise<
    OperationEnvelope<{
      packageName: string;
      component: string;
      requestedDisplayId: number;
      observedFocusedDisplayId?: number;
      userId: number | "current";
      output: string;
    }>
  > {
    this.validatePackage(packageName);
    await this.requireDisplay(serial, displayId, signal);
    const component = activity
      ? this.normalizeComponent(packageName, activity)
      : await this.resolveMainActivity(serial, packageName, signal);
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(
        [
          "shell",
          "am",
          "start",
          "-W",
          "--user",
          String(userId),
          "--display",
          String(displayId),
          "-n",
          component,
        ],
        { serial, signal, timeoutMs: 30_000 },
      ),
    );
    const observedDisplay = (await this.listDisplays(serial, signal)).find(
      (display) =>
        display.focusedActivity?.startsWith(`${packageName}/`) ||
        display.focusedWindow?.startsWith(`${packageName}/`),
    );
    const warnings =
      observedDisplay?.logicalId === displayId
        ? []
        : [
            observedDisplay
              ? `Activity was requested on display ${displayId} but focus was observed on display ${observedDisplay.logicalId}`
              : "Launch succeeded but the package was not observed as focused on any display",
          ];
    return this.envelope(
      serial,
      displayId,
      "adb",
      {
        packageName,
        component,
        requestedDisplayId: displayId,
        userId,
        ...(observedDisplay
          ? { observedFocusedDisplayId: observedDisplay.logicalId }
          : {}),
        output: result.stdout.toString("utf8").trim(),
      },
      result.durationMs,
      warnings,
    );
  }

  async stopApp(
    serial: string,
    packageName: string,
    userId: number | "current",
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{ packageName: string; userId: number | "current" }>
  > {
    this.validatePackage(packageName);
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(
        ["shell", "am", "force-stop", "--user", String(userId), packageName],
        {
          serial,
          signal,
        },
      ),
    );
    return this.envelope(
      serial,
      undefined,
      "adb",
      { packageName, userId },
      result.durationMs,
    );
  }

  async installApp(
    serial: string,
    apkPath: string,
    replace: boolean,
    signal?: AbortSignal,
  ): Promise<OperationEnvelope<{ path: string; output: string }>> {
    if (!apkPath.endsWith(".apk"))
      throw new Error("Only .apk installation is supported by this tool");
    const args = ["install"];
    if (replace) args.push("-r");
    args.push(apkPath);
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(args, {
        serial,
        signal,
        timeoutMs: 180_000,
        maxOutputBytes: 2 * 1024 * 1024,
      }),
    );
    return this.envelope(
      serial,
      undefined,
      "adb",
      { path: apkPath, output: result.stdout.toString("utf8").trim() },
      result.durationMs,
    );
  }

  async uninstallApp(
    serial: string,
    packageName: string,
    keepData: boolean,
    signal?: AbortSignal,
  ): Promise<
    OperationEnvelope<{
      packageName: string;
      keepData: boolean;
      output: string;
    }>
  > {
    this.validatePackage(packageName);
    const args = ["uninstall"];
    if (keepData) args.push("-k");
    args.push(packageName);
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(args, { serial, signal, timeoutMs: 60_000 }),
    );
    return this.envelope(
      serial,
      undefined,
      "adb",
      { packageName, keepData, output: result.stdout.toString("utf8").trim() },
      result.durationMs,
    );
  }

  async collectDiagnostics(
    serial: string,
    sections: readonly (
      | "activity"
      | "window"
      | "display"
      | "input"
      | "power"
      | "battery"
      | "meminfo"
      | "cpuinfo"
    )[],
    packageName?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    if (packageName) this.validatePackage(packageName);
    const result: Record<string, string> = {};
    for (const section of sections) {
      const args =
        section === "activity"
          ? ["shell", "dumpsys", "activity", "activities"]
          : section === "window"
            ? ["shell", "dumpsys", "window", "displays"]
            : section === "meminfo" && packageName
              ? ["shell", "dumpsys", "meminfo", packageName]
              : ["shell", "dumpsys", section];
      result[section] = await this.adb.text(args, {
        serial,
        signal,
        maxOutputBytes: 4 * 1024 * 1024,
        timeoutMs: 15_000,
      });
    }
    return result;
  }

  private async mutate<T>(
    serial: string,
    displayId: number,
    inputArgs: string[],
    data: T,
    signal?: AbortSignal,
    warnings: string[] = [],
    points: readonly { x: number; y: number }[] = [],
  ): Promise<OperationEnvelope<T>> {
    const prepared = await this.prepareInput(
      serial,
      displayId,
      inputArgs,
      signal,
      warnings,
      points,
    );
    const result = await this.#queue.mutate(serial, () =>
      this.adb.run(["shell", "input", ...prepared.inputArgs], {
        serial,
        signal,
      }),
    );
    return this.envelope(
      serial,
      displayId,
      "adb",
      data,
      result.durationMs,
      prepared.warnings,
    );
  }

  private async prepareInput(
    serial: string,
    displayId: number,
    inputArgs: string[],
    signal: AbortSignal | undefined,
    warnings: string[],
    points: readonly { x: number; y: number }[],
  ): Promise<{ inputArgs: string[]; warnings: string[] }> {
    const display = await this.requireDisplay(serial, displayId, signal);
    assertPointsOnDisplay(display, points);
    const capabilities = await this.inspectDevice(serial, { signal });
    const source = inputArgs[0];
    const commandIndex = inputArgs.findIndex((value) =>
      Object.hasOwn(INPUT_COMMAND_CAPABILITIES, value.toLowerCase()),
    );
    assertInputSupported(
      capabilities,
      source,
      inputArgs[commandIndex]?.toLowerCase(),
    );
    if (!capabilities.input.displayTargeting) {
      if (displayId !== 0) {
        throw new Error(
          "This device input implementation cannot target non-default displays",
        );
      }
      const displayOption = inputArgs.indexOf("-d");
      if (displayOption >= 0) inputArgs.splice(displayOption, 2);
      warnings = [
        ...warnings,
        "Device input help does not advertise display targeting; used the default-display form",
      ];
    }
    return { inputArgs, warnings };
  }

  private envelope<T>(
    serial: string,
    displayId: number | undefined,
    backend: "adb" | "scrcpy" | "instrumentation",
    data: T,
    durationMs: number,
    warnings: string[] = [],
  ): OperationEnvelope<T> {
    return {
      schemaVersion: "1",
      operationId: this.adb.operationId(),
      device: { serial },
      ...(displayId !== undefined ? { display: { logicalId: displayId } } : {}),
      backend,
      data,
      durationMs,
      warnings,
    };
  }

  private async requireDisplay(
    serial: string,
    displayId: number,
    signal?: AbortSignal,
  ): Promise<AndroidDisplay> {
    const display = (await this.listDisplays(serial, signal)).find(
      (candidate) => candidate.logicalId === displayId,
    );
    if (!display)
      throw new Error(
        `Logical display ${displayId} is not available on ${serial}`,
      );
    return display;
  }

  private attachWindowFocus(displays: AndroidDisplay[], output: string): void {
    for (const sample of parseWindowFocus(output)) {
      const display = displays.find(
        (candidate) => candidate.logicalId === sample.logicalId,
      );
      if (!display) continue;
      if (sample.focusedWindow) display.focusedWindow = sample.focusedWindow;
      if (sample.focusedActivity)
        display.focusedActivity = sample.focusedActivity;
      if (sample.focusedPackage) display.focusedPackage = sample.focusedPackage;
      if (sample.focusedTaskId !== undefined) {
        display.focusedTaskId = sample.focusedTaskId;
      }
    }
  }

  private async resolveMainActivity(
    serial: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const output = await this.adb.text(
      [
        "shell",
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
        packageName,
      ],
      { serial, signal },
    );
    const component = output
      .split(/\r?\n/)
      .find((line) => line.includes("/"))
      ?.trim();
    if (!component || !SAFE_COMPONENT.test(component)) {
      throw new Error(
        `Could not resolve a launcher activity for ${packageName}`,
      );
    }
    return component;
  }

  private normalizeComponent(packageName: string, activity: string): string {
    const normalizedActivity =
      activity.startsWith(".") || activity.includes(".")
        ? activity
        : `.${activity}`;
    const component = activity.includes("/")
      ? activity
      : `${packageName}/${normalizedActivity}`;
    if (!SAFE_COMPONENT.test(component))
      throw new Error(`Invalid activity component: ${component}`);
    return component;
  }

  private validatePackage(packageName: string): void {
    if (!SAFE_PACKAGE.test(packageName))
      throw new Error(`Invalid Android package: ${packageName}`);
  }

  private async probe(
    serial: string,
    args: readonly string[],
    signal?: AbortSignal,
    maxOutputBytes = 1_048_576,
  ): Promise<{ supported: boolean; output: string; exitCode: number }> {
    try {
      const result = await this.adb.run(args, {
        serial,
        signal,
        maxOutputBytes,
        timeoutMs: 15_000,
      });
      return {
        supported: true,
        output: Buffer.concat([result.stdout, result.stderr])
          .toString("utf8")
          .trim(),
        exitCode: result.exitCode,
      };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AdbCommandError) {
        return {
          supported: false,
          output: Buffer.concat([error.result.stdout, error.result.stderr])
            .toString("utf8")
            .trim(),
          exitCode: error.result.exitCode,
        };
      }
      return { supported: false, output: "", exitCode: -1 };
    }
  }
}

function assertInputSupported(
  capabilities: DeviceCapabilities,
  source: string | undefined,
  command: string | undefined,
): void {
  const normalized = command?.toLowerCase();
  const commandKey = normalized
    ? INPUT_COMMAND_CAPABILITIES[normalized]
    : undefined;
  const advertisedCommands = Object.values(capabilities.input.commands).some(
    Boolean,
  );
  if (
    commandKey &&
    advertisedCommands &&
    !capabilities.input.commands[commandKey]
  ) {
    throw new Error(`Device input command is not supported: ${normalized}`);
  }
  if (
    source &&
    capabilities.input.sources.length > 0 &&
    !capabilities.input.sources.includes(source)
  ) {
    throw new Error(`Device input source is not supported: ${source}`);
  }
}

function sequenceKeyCode(step: { key: string; keyCode: string }): string {
  if (!/^KEYCODE_[A-Z0-9_]+$/.test(step.keyCode)) {
    throw new Error(`Invalid Android keycode: ${step.key}`);
  }
  return step.keyCode;
}

function assertInputSource(source: string): asserts source is InputSource {
  if (!(INPUT_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`Device input source is not supported: ${source}`);
  }
}

function sequenceDisplayId(displayId: number): string {
  if (!Number.isInteger(displayId) || displayId < 0) {
    throw new Error(`Invalid logical display id: ${displayId}`);
  }
  return String(displayId);
}

function parseKeySequence(sequence: string, gapMs: number): KeySequenceStep[] {
  if (sequence.length < 1 || sequence.length > 2_000) {
    throw new Error("Key sequence must be 1..2000 characters");
  }
  if (!Number.isInteger(gapMs) || gapMs < 0 || gapMs > MAX_SEQUENCE_DELAY_MS) {
    throw new Error("Key sequence gap must be 0..5000ms");
  }
  const tokens = sequence
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) throw new Error("Key sequence is empty");

  const steps: KeySequenceStep[] = [];
  let pendingDelay: number | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (/^\d+$/.test(token)) {
      if (steps.length === 0) {
        throw new Error("Key sequence cannot start with a delay");
      }
      if (pendingDelay !== undefined) {
        throw new Error("Key sequence cannot contain consecutive delays");
      }
      if (index === tokens.length - 1) {
        throw new Error("Key sequence cannot end with a delay");
      }
      pendingDelay = parseSequenceDelay(token);
      continue;
    }
    const previous = steps[steps.length - 1];
    if (previous) previous.delayAfterMs = pendingDelay ?? gapMs;
    pendingDelay = undefined;
    for (const action of sequenceActions(token)) {
      steps.push({ ...action, delayAfterMs: 0 });
      if (steps.length > MAX_SEQUENCE_KEYS) {
        throw new Error("Key sequence exceeds 32 steps");
      }
    }
  }

  const delaySum = steps.reduce((sum, step) => sum + step.delayAfterMs, 0);
  if (delaySum > MAX_SEQUENCE_DELAY_SUM_MS) {
    throw new Error("Key sequence delays exceed 60000ms");
  }
  return steps;
}

function parseSequenceDelay(token: string): number {
  if (!/^\d{1,4}$/.test(token)) {
    throw new Error(`Key sequence delay must be 0..5000ms: ${token}`);
  }
  const delayMs = Number(token);
  if (delayMs > MAX_SEQUENCE_DELAY_MS) {
    throw new Error(`Key sequence delay must be 0..5000ms: ${token}`);
  }
  return delayMs;
}

function sequenceActions(
  token: string,
): Array<{ key: string; keyCode: string } | { x: number; y: number }> {
  if (token.includes(",")) return parseTouchCombo(token);
  return [{ key: token, keyCode: resolveSequenceKeyCode(token) }];
}

function parseTouchCombo(token: string): { x: number; y: number }[] {
  const parts = token.split("+");
  if (parts.length > MAX_TOUCH_COMBO_POINTS) {
    throw new Error(`Touch combo exceeds ${MAX_TOUCH_COMBO_POINTS} points`);
  }
  return parts.map((part) => {
    const match = /^(\d{1,5}),(\d{1,5})$/.exec(part);
    if (!match?.[1] || !match[2])
      throw new Error(`Invalid touch point: ${token}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

function isTapStep(
  step: KeySequenceStep,
): step is KeySequenceStep & { x: number; y: number } {
  return "x" in step;
}

function resolveSequenceKeyCode(token: string): string {
  const folded = token.toUpperCase();
  const alias = KEY_SEQUENCE_ALIASES[folded];
  if (alias) return `KEYCODE_${alias}`;
  if (/^\d+$/.test(folded) || !SAFE_KEY.test(folded)) {
    throw new Error(`Invalid Android keycode: ${token}`);
  }
  return folded.startsWith("KEYCODE_") ? folded : `KEYCODE_${folded}`;
}

function sequenceInputArgv(
  source: InputSource,
  displayId: string,
  step: KeySequenceStep,
  displayTargeting: boolean,
): string[] {
  const target = displayTargeting ? ["-d", displayId] : [];
  return isTapStep(step)
    ? ["touchscreen", ...target, "tap", String(step.x), String(step.y)]
    : [source, ...target, "keyevent", sequenceKeyCode(step)];
}

function buildKeySequenceScript(
  source: InputSource,
  displayId: string,
  steps: readonly KeySequenceStep[],
  displayTargeting: boolean,
): string {
  return steps
    .map((step) => {
      const command = [
        "input",
        ...sequenceInputArgv(source, displayId, step, displayTargeting),
      ].join(" ");
      if (step.delayAfterMs <= 0) return command;
      return `${command}; sleep ${(step.delayAfterMs / 1000).toFixed(3)}`;
    })
    .join("; ");
}

function assertSequenceChecks(
  actionCount: number,
  displayId: number,
  stepped: NonNullable<KeySequenceInput["stepped"]>,
): void {
  const timeoutMs = stepped.timeoutMs ?? 5_000;
  const pollMs = stepped.pollMs ?? 300;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("UI check timeout must be 100..30000ms");
  }
  if (!Number.isInteger(pollMs) || pollMs < 50 || pollMs > 2_000) {
    throw new Error("UI check poll interval must be 50..2000ms");
  }
  if (stepped.checks.length !== actionCount) {
    throw new Error(
      `UI checks must align with the ${actionCount} sequence actions`,
    );
  }
  let needsUi = false;
  for (const check of stepped.checks) {
    if (!check) continue;
    needsUi = true;
    if (!check.text && !check.contentDescription && !check.resourceId) {
      throw new Error(
        "UI check needs text, content description, or resource id",
      );
    }
  }
  if (needsUi && displayId !== 0) {
    throw new Error(
      "Portable uiautomator cannot select a non-default display; enable the instrumentation backend",
    );
  }
}

function describeUiCheck(check: SequenceUiCheck | null | undefined): string {
  if (!check) return "missing check";
  const parts: string[] = [];
  if (check.text) parts.push(`text ${JSON.stringify(check.text)}`);
  if (check.contentDescription) {
    parts.push(
      `content description ${JSON.stringify(check.contentDescription)}`,
    );
  }
  if (check.resourceId) {
    parts.push(`resource id ${JSON.stringify(check.resourceId)}`);
  }
  return parts.join(", ");
}

function isTcpSerial(serial: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(serial);
}

/**
 * `input tap` accepts off-screen coordinates and silently drops the event, so a
 * stale node bound or a coordinate from the wrong display looks like a tap that
 * did nothing. Refuse those instead, and say what the display actually is.
 */
function assertPointsOnDisplay(
  display: AndroidDisplay,
  points: readonly { x: number; y: number }[],
): void {
  const { width, height } = display;
  if (!width || !height) return;
  for (const point of points) {
    if (point.x >= 0 && point.y >= 0 && point.x < width && point.y < height) {
      continue;
    }
    throw new Error(
      `Point (${point.x}, ${point.y}) is outside display ${display.logicalId}, which is ${width}x${height}`,
    );
  }
}
