import { describe, expect, it } from "vitest";

import { quoteRemoteShellArg } from "../src/android/adb-runner.js";
import { AndroidController } from "../src/android/android-controller.js";
import { addConnectedDevice, FakeAdbRunner } from "./fake-adb.js";

const SERIAL = "serial-1";
const DISPLAY_DUMP = `
  Logical Displays: size=3
    Display 0:
      mDisplayId=0
      mBaseDisplayInfo=DisplayInfo{"Top", displayId 0", real 1080 x 1920, rotation 0, state ON, uniqueId "local:111111111111111111", density 320}
      mOverrideDisplayInfo=DisplayInfo{"Top", displayId 0", real 1920 x 1080, rotation 1, state OFF, uniqueId "local:111111111111111111", density 320}
    Display 4:
      mDisplayId=4
      mBaseDisplayInfo=DisplayInfo{"Bottom", displayId 4", real 1080 x 1240, rotation 0, state ON, uniqueId "local:222222222222222222", density 320}
      mOverrideDisplayInfo=DisplayInfo{"Bottom", displayId 4", real 1240 x 1080, rotation 1, state OFF, uniqueId "local:222222222222222222", density 320}
    Display 8:
      mDisplayId=8
      mBaseDisplayInfo=DisplayInfo{"Virtual", displayId 8", real 800 x 600, rotation 0, state ON, uniqueId "virtual:owner,Virtual,0", density 240}
`;

const WINDOW_DUMP = `
  Display: mDisplayId=4
    mCurrentFocus=Window{abc u0 com.example/com.example.BottomActivity}
    mFocusedApp=ActivityRecord{def u0 com.example/.BottomActivity} t1}
  Display: mDisplayId=0
    mCurrentFocus=Window{ghi u0 com.game/com.game.MainActivity}
    mFocusedApp=ActivityRecord{jkl u0 com.game/.MainActivity} t2}
`;

function displayRunner(): FakeAdbRunner {
  return addConnectedDevice(new FakeAdbRunner())
    .respond(["shell", "dumpsys", "display"], DISPLAY_DUMP, { serial: SERIAL })
    .respond(
      ["shell", "dumpsys", "SurfaceFlinger", "--display-id"],
      "Display 111111111111111111\nDisplay 222222222222222222\n",
      { serial: SERIAL },
    )
    .respond(["shell", "dumpsys", "window", "displays"], WINDOW_DUMP, {
      serial: SERIAL,
    });
}

const INPUT_HELP = `
  Usage: input [<source>] [-d DISPLAY_ID] <command> [<arg>...]
  The sources are: keyboard dpad gamepad touchscreen mouse
  The commands and default sources are:
    text <string>
    keyevent [--longpress|--doubletap] <key code number or name>
    tap <x> <y>
    swipe <x1> <y1> <x2> <y2> [duration(ms)]
    draganddrop <x1> <y1> <x2> <y2> [duration(ms)]
    motionevent <DOWN|UP|MOVE|CANCEL> <x> <y>
    keycombination [-t duration(ms)] <key code 1> <key code 2>
    scroll <x> <y> <hScroll> <vScroll>
`;

/** Responses for the capability probe behind every input mutation. */
function capabilityRunner(): FakeAdbRunner {
  const runner = displayRunner()
    .respond(["version"], "Android Debug Bridge version 1.0.41")
    .respond(["shell", "getprop"], "[ro.build.version.sdk]: [33]\n", {
      serial: SERIAL,
    })
    .respond(["features"], "shell_v2 cmd", { serial: SERIAL })
    .respond(["shell", "input"], INPUT_HELP, { serial: SERIAL });
  for (const command of [
    "screencap",
    "screenrecord",
    "uiautomator",
    "getevent",
    "sendevent",
    "uinput",
    "logcat",
    "perfetto",
    "simpleperf",
  ]) {
    runner.respond(
      ["shell", "command", "-v", command],
      `/system/bin/${command}`,
      {
        serial: SERIAL,
      },
    );
  }
  return runner;
}

describe("AndroidController", () => {
  it("separates logical, physical, and virtual displays", async () => {
    const controller = new AndroidController(displayRunner());
    const displays = await controller.listDisplays(SERIAL);

    expect(displays).toMatchObject([
      {
        logicalId: 0,
        physicalId: "111111111111111111",
        state: "ON",
        width: 1920,
        height: 1080,
        focusedActivity: "com.game/.MainActivity",
        focusedPackage: "com.game",
        focusedTaskId: 2,
      },
      {
        logicalId: 4,
        physicalId: "222222222222222222",
        state: "ON",
        focusedWindow: "com.example/com.example.BottomActivity",
        focusedPackage: "com.example",
        focusedTaskId: 1,
      },
      {
        logicalId: 8,
        uniqueId: "virtual:owner,Virtual,0",
      },
    ]);
    expect(displays[2]?.physicalId).toBeUndefined();
  });

  it("captures a requested display through its physical ID", async () => {
    const runner = displayRunner();
    const png = Buffer.concat([
      Buffer.from([0x89]),
      Buffer.from("PNG\r\nfixture"),
    ]);
    runner.respond(
      ["exec-out", "screencap", "-p", "-d", "222222222222222222"],
      png,
      { serial: SERIAL },
    );
    const controller = new AndroidController(runner);

    const capture = await controller.captureScreen(SERIAL, 4);

    expect(capture.png).toEqual(png);
    expect(capture.display.logicalId).toBe(4);
  });

  it("refuses to capture a virtual display instead of using the wrong screen", async () => {
    const controller = new AndroidController(displayRunner());
    await expect(controller.captureScreen(SERIAL, 8)).rejects.toThrow(
      "has no correlated physical ID",
    );
  });

  it("does not implicitly capture display 0 when physical correlation is ambiguous", async () => {
    const uncorrelatedDump = DISPLAY_DUMP.replaceAll(
      "local:111111111111111111",
      "local:999",
    ).replaceAll("local:222222222222222222", "local:998");
    const runner = addConnectedDevice(new FakeAdbRunner())
      .respond(["shell", "dumpsys", "display"], uncorrelatedDump, {
        serial: SERIAL,
      })
      .respond(
        ["shell", "dumpsys", "SurfaceFlinger", "--display-id"],
        "Display 111111111111111111\nDisplay 222222222222222222\n",
        { serial: SERIAL },
      )
      .respond(["shell", "dumpsys", "window", "displays"], WINDOW_DUMP, {
        serial: SERIAL,
      });

    await expect(
      new AndroidController(runner).captureScreen(SERIAL, 0),
    ).rejects.toThrow("has no correlated physical ID");
  });

  it("verifies the observed focused display after launch", async () => {
    const runner = displayRunner()
      .respond(
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
          "com.example",
        ],
        "com.example/.BottomActivity",
        { serial: SERIAL },
      )
      .respond(
        [
          "shell",
          "am",
          "start",
          "-W",
          "--user",
          "current",
          "--display",
          "4",
          "-n",
          "com.example/.BottomActivity",
        ],
        "Status: ok",
        { serial: SERIAL },
      );
    const controller = new AndroidController(runner);

    const result = await controller.launchApp(SERIAL, "com.example", 4);

    expect(result.data).toMatchObject({
      requestedDisplayId: 4,
      observedFocusedDisplayId: 4,
    });
    expect(result.warnings).toEqual([]);
  });

  it("preserves a fully-qualified explicit activity name", async () => {
    const runner = displayRunner().respond(
      [
        "shell",
        "am",
        "start",
        "-W",
        "--user",
        "current",
        "--display",
        "4",
        "-n",
        "com.example/com.example.MainActivity",
      ],
      "Status: ok",
      { serial: SERIAL },
    );
    const controller = new AndroidController(runner);

    const result = await controller.launchApp(
      SERIAL,
      "com.example",
      4,
      "com.example.MainActivity",
    );

    expect(result.data.component).toBe("com.example/com.example.MainActivity");
  });

  it("accepts camelCase-keyed input capabilities for multi-word commands", async () => {
    const runner = capabilityRunner().respond(
      [
        "shell",
        "input",
        "keyboard",
        "-d",
        "0",
        "keycombination",
        "-t",
        "60",
        "KEYCODE_CTRL_LEFT",
        "KEYCODE_A",
      ],
      "",
      { serial: SERIAL },
    );

    const result = await new AndroidController(runner).inputKeyCombination(
      SERIAL,
      0,
      ["KEYCODE_CTRL_LEFT", "KEYCODE_A"],
      60,
      "keyboard",
    );

    expect(result.data.keys).toEqual(["KEYCODE_CTRL_LEFT", "KEYCODE_A"]);
  });

  it("taps display coordinates through the display-targeted form", async () => {
    const runner = capabilityRunner().respond(
      ["shell", "input", "touchscreen", "-d", "0", "tap", "10", "20"],
      "",
      { serial: SERIAL },
    );

    const result = await new AndroidController(runner).tap(SERIAL, 0, 10, 20);

    expect(result.data).toEqual({ x: 10, y: 20 });
  });

  // `input tap` exits 0 for off-screen points and drops the event, which reads
  // as a tap that did nothing.
  it("rejects points outside the display instead of dropping them", async () => {
    const controller = new AndroidController(capabilityRunner());

    await expect(controller.tap(SERIAL, 0, 2000, 20)).rejects.toThrow(
      /outside display 0, which is 1920x1080/,
    );
    await expect(controller.tap(SERIAL, 0, 10, -1)).rejects.toThrow(
      /outside display 0/,
    );
    await expect(
      controller.swipe(SERIAL, 0, { x: 10, y: 20 }, { x: 10, y: 5000 }, 300),
    ).rejects.toThrow(/outside display 0/);
  });

  it("still rejects input commands the device does not advertise", async () => {
    const runner = capabilityRunner().respond(
      ["shell", "input"],
      INPUT_HELP.replace("tap <x> <y>", ""),
      { serial: SERIAL },
    );

    await expect(
      new AndroidController(runner).tap(SERIAL, 0, 10, 20),
    ).rejects.toThrow(/not supported: tap/);
  });

  it("sends a timed key sequence as one remote shell", async () => {
    const sequence =
      "UP 350 X 400 DOWN 300 A 700 R1 R1 RIGHT RIGHT A 700 START 450 A";
    const script = [
      "input gamepad -d 0 keyevent KEYCODE_DPAD_UP; sleep 0.350",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_X; sleep 0.400",
      "input gamepad -d 0 keyevent KEYCODE_DPAD_DOWN; sleep 0.300",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_A; sleep 0.700",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_R1; sleep 0.300",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_R1; sleep 0.300",
      "input gamepad -d 0 keyevent KEYCODE_DPAD_RIGHT; sleep 0.300",
      "input gamepad -d 0 keyevent KEYCODE_DPAD_RIGHT; sleep 0.300",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_A; sleep 0.700",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_START; sleep 0.450",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_A",
    ].join("; ");
    const signal = new AbortController().signal;
    const runner = capabilityRunner().respond(
      ["shell", "sh", "-c", quoteRemoteShellArg(script)],
      "",
      { serial: SERIAL },
    );

    const result = await new AndroidController(runner).inputKeySequence(
      SERIAL,
      { displayId: 0, sequence },
      signal,
    );

    const shells = runner.calls.filter((call) => call.args[1] === "sh");
    expect(shells).toEqual([
      {
        args: ["shell", "sh", "-c", quoteRemoteShellArg(script)],
        options: { serial: SERIAL, signal, timeoutMs: 26_100 },
      },
    ]);
    expect(
      runner.calls.filter(
        (call) => call.args[1] === "input" && call.args.includes("keyevent"),
      ),
    ).toEqual([]);
    expect(result.data).toEqual({
      source: "gamepad",
      displayId: 0,
      gapMs: 300,
      steps: [
        { key: "UP", keyCode: "KEYCODE_DPAD_UP", delayAfterMs: 350 },
        { key: "X", keyCode: "KEYCODE_BUTTON_X", delayAfterMs: 400 },
        { key: "DOWN", keyCode: "KEYCODE_DPAD_DOWN", delayAfterMs: 300 },
        { key: "A", keyCode: "KEYCODE_BUTTON_A", delayAfterMs: 700 },
        { key: "R1", keyCode: "KEYCODE_BUTTON_R1", delayAfterMs: 300 },
        { key: "R1", keyCode: "KEYCODE_BUTTON_R1", delayAfterMs: 300 },
        { key: "RIGHT", keyCode: "KEYCODE_DPAD_RIGHT", delayAfterMs: 300 },
        { key: "RIGHT", keyCode: "KEYCODE_DPAD_RIGHT", delayAfterMs: 300 },
        { key: "A", keyCode: "KEYCODE_BUTTON_A", delayAfterMs: 700 },
        { key: "START", keyCode: "KEYCODE_BUTTON_START", delayAfterMs: 450 },
        { key: "A", keyCode: "KEYCODE_BUTTON_A", delayAfterMs: 0 },
      ],
    });
  });

  it("rejects an invalid key sequence before calling adb", async () => {
    const runner = capabilityRunner();
    const controller = new AndroidController(runner);
    const tooManyKeys = Array.from({ length: 33 }, () => "A").join(" ");
    const delaysTooLong = Array.from({ length: 14 }, () => "A").join(" ");

    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "UP not-a-key",
      }),
    ).rejects.toThrow("Invalid Android keycode: not-a-key");
    await expect(
      controller.inputKeySequence(SERIAL, { displayId: 0, sequence: "350 UP" }),
    ).rejects.toThrow(/cannot start with a delay/);
    await expect(
      controller.inputKeySequence(SERIAL, { displayId: 0, sequence: "A 100" }),
    ).rejects.toThrow(/cannot end with a delay/);
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "A 100 200 B",
      }),
    ).rejects.toThrow(/consecutive delays/);
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: tooManyKeys,
      }),
    ).rejects.toThrow(/exceeds 32 steps/);
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "1,2,3",
      }),
    ).rejects.toThrow("Invalid touch point: 1,2,3");
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: Array.from({ length: 9 }, (_, index) => `${index},1`).join(
          "+",
        ),
      }),
    ).rejects.toThrow(/Touch combo exceeds 8 points/);
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: delaysTooLong,
        gapMs: 5_000,
      }),
    ).rejects.toThrow(/exceed 60000ms/);
    expect(runner.calls).toEqual([]);
  });

  it("rejects a key sequence when the device does not advertise keyevent", async () => {
    const runner = capabilityRunner().respond(
      ["shell", "input"],
      INPUT_HELP.replace("keyevent", "removed"),
      { serial: SERIAL },
    );

    await expect(
      new AndroidController(runner).inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "A B",
      }),
    ).rejects.toThrow("Device input command is not supported: keyevent");
    expect(runner.calls.some((call) => call.args[1] === "sh")).toBe(false);
  });

  it("omits display targeting on the default display when input help lacks it", async () => {
    const script =
      "input gamepad keyevent KEYCODE_BUTTON_A; sleep 0.300; input gamepad keyevent KEYCODE_BUTTON_B";
    const runner = capabilityRunner().respond(
      ["shell", "input"],
      INPUT_HELP.replace("[-d DISPLAY_ID] ", ""),
      { serial: SERIAL },
    );
    runner.respond(["shell", "sh", "-c", quoteRemoteShellArg(script)], "", {
      serial: SERIAL,
    });

    const result = await new AndroidController(runner).inputKeySequence(
      SERIAL,
      { displayId: 0, sequence: "A B" },
    );

    expect(result.warnings).toEqual([
      "Device input help does not advertise display targeting; used the default-display form",
    ]);
    await expect(
      new AndroidController(runner).inputKeySequence(SERIAL, {
        displayId: 4,
        sequence: "A",
      }),
    ).rejects.toThrow(
      "This device input implementation cannot target non-default displays",
    );
  });

  it("sends a touch combo inside a timed sequence as one remote shell", async () => {
    const script = [
      "input gamepad -d 0 keyevent KEYCODE_DPAD_UP; sleep 0.350",
      "input touchscreen -d 0 tap 100 200",
      "input touchscreen -d 0 tap 300 400; sleep 0.400",
      "input gamepad -d 0 keyevent KEYCODE_BUTTON_A",
    ].join("; ");
    const runner = capabilityRunner().respond(
      ["shell", "sh", "-c", quoteRemoteShellArg(script)],
      "",
      { serial: SERIAL },
    );

    const result = await new AndroidController(runner).inputKeySequence(
      SERIAL,
      { displayId: 0, sequence: "UP 350 100,200+300,400 400 A" },
    );

    expect(runner.calls.filter((call) => call.args[1] === "sh")).toEqual([
      {
        args: ["shell", "sh", "-c", quoteRemoteShellArg(script)],
        options: { serial: SERIAL, timeoutMs: 8_750 },
      },
    ]);
    expect(result.data.steps).toEqual([
      { key: "UP", keyCode: "KEYCODE_DPAD_UP", delayAfterMs: 350 },
      { x: 100, y: 200, delayAfterMs: 0 },
      { x: 300, y: 400, delayAfterMs: 400 },
      { key: "A", keyCode: "KEYCODE_BUTTON_A", delayAfterMs: 0 },
    ]);
  });

  it("sends a tap sequence when the device does not advertise keyevent", async () => {
    const script =
      "input touchscreen -d 0 tap 10 20; sleep 0.300; input touchscreen -d 0 tap 30 40";
    const runner = capabilityRunner()
      .respond(["shell", "input"], INPUT_HELP.replace("keyevent", "removed"), {
        serial: SERIAL,
      })
      .respond(["shell", "sh", "-c", quoteRemoteShellArg(script)], "", {
        serial: SERIAL,
      });

    const result = await new AndroidController(runner).inputKeySequence(
      SERIAL,
      { displayId: 0, sequence: "10,20 30,40" },
    );

    expect(result.data.steps).toEqual([
      { x: 10, y: 20, delayAfterMs: 300 },
      { x: 30, y: 40, delayAfterMs: 0 },
    ]);
  });

  it("rejects a touch sequence the device cannot tap, and points outside the display", async () => {
    const unsupported = capabilityRunner().respond(
      ["shell", "input"],
      INPUT_HELP.replace("tap <x> <y>", ""),
      { serial: SERIAL },
    );
    await expect(
      new AndroidController(unsupported).inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "A 100,200",
      }),
    ).rejects.toThrow("Device input command is not supported: tap");
    expect(unsupported.calls.some((call) => call.args[1] === "sh")).toBe(false);

    const runner = capabilityRunner();
    await expect(
      new AndroidController(runner).inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "2000,20",
      }),
    ).rejects.toThrow(/outside display 0, which is 1920x1080/);
    expect(runner.calls.some((call) => call.args[1] === "sh")).toBe(false);
  });

  it("steps through actions and continues after the UI node appears", async () => {
    const runner = capabilityRunner()
      .respond(
        [
          "shell",
          "input",
          "gamepad",
          "-d",
          "0",
          "keyevent",
          "KEYCODE_BUTTON_A",
        ],
        "",
        { serial: SERIAL },
      )
      .respond(
        [
          "shell",
          "input",
          "gamepad",
          "-d",
          "0",
          "keyevent",
          "KEYCODE_BUTTON_B",
        ],
        "",
        { serial: SERIAL },
      );

    const result = await new FixedUiController(
      runner,
      LIBRARY_XML,
    ).inputKeySequence(SERIAL, {
      displayId: 0,
      sequence: "A B",
      gapMs: 0,
      stepped: {
        timeoutMs: 500,
        pollMs: 50,
        checks: [null, { text: "Library" }],
      },
    });

    expect(keyEvents(runner)).toEqual(["KEYCODE_BUTTON_A", "KEYCODE_BUTTON_B"]);
    expect(runner.calls.some((call) => call.args[1] === "sh")).toBe(false);
    expect(result.data.completed).toBe(true);
    expect(result.data.stoppedAt).toBeUndefined();
    expect(result.data.checks?.[1]).toMatchObject({
      index: 1,
      found: true,
      attempts: 1,
    });
  });

  it("stops a stepped sequence when the UI check does not match", async () => {
    const runner = capabilityRunner().respond(
      ["shell", "input", "gamepad", "-d", "0", "keyevent", "KEYCODE_BUTTON_A"],
      "",
      { serial: SERIAL },
    );

    const result = await new FixedUiController(
      runner,
      LIBRARY_XML,
    ).inputKeySequence(SERIAL, {
      displayId: 0,
      sequence: "A B",
      gapMs: 0,
      stepped: {
        timeoutMs: 100,
        pollMs: 50,
        checks: [{ text: "Missing" }, { text: "Library" }],
      },
    });

    expect(keyEvents(runner)).toEqual(["KEYCODE_BUTTON_A"]);
    expect(result.data.completed).toBe(false);
    expect(result.data.stoppedAt).toBe(0);
    expect(result.warnings.join("\n")).toContain('text "Missing"');
  });

  it("rejects a stepped UI plan before calling adb", async () => {
    const runner = capabilityRunner();
    const controller = new AndroidController(runner);

    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 0,
        sequence: "A B",
        stepped: { checks: [null] },
      }),
    ).rejects.toThrow("UI checks must align with the 2 sequence actions");
    await expect(
      controller.inputKeySequence(SERIAL, {
        displayId: 4,
        sequence: "A",
        stepped: { checks: [{ text: "Library" }] },
      }),
    ).rejects.toThrow(/non-default display/);
    expect(runner.calls).toEqual([]);
  });
});

const LIBRARY_XML = `<?xml version="1.0"?>
<hierarchy>
  <node text="Library" resource-id="com.example:id/library" class="android.widget.TextView" bounds="[10,20][210,120]" />
</hierarchy>`;

class FixedUiController extends AndroidController {
  constructor(
    adb: FakeAdbRunner,
    private readonly xml: string,
  ) {
    super(adb);
  }

  override async uiSnapshot(): Promise<string> {
    return this.xml;
  }
}

function keyEvents(runner: FakeAdbRunner): string[] {
  return runner.calls
    .filter((call) => call.args.includes("keyevent"))
    .map((call) => call.args.at(-1) ?? "");
}
