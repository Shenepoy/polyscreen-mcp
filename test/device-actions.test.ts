import { describe, expect, it } from "vitest";

import { quoteRemoteShellArg } from "../src/android/adb-runner.js";
import {
  assertViewUrl,
  DeviceActions,
  parseClipboardDump,
  parseCurrentFoldId,
  parseDeviceStates,
  parseDropboxIndex,
  parseUserRotation,
  resolveFoldState,
  splitPrintedDropbox,
} from "../src/android/device-actions.js";
import {
  downscaleScreenshot,
  fitScreenshotSize,
  screenshotCoordinateSpace,
} from "../src/android/png.js";
import { UiRefCache } from "../src/android/ui.js";
import { addConnectedDevice, FakeAdbRunner } from "./fake-adb.js";

const SERIAL = "serial-1";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("screenshot coordinate space", () => {
  it("scales screenshot pixels onto the logical display", () => {
    expect(
      screenshotCoordinateSpace(png(540, 960), { width: 1080, height: 1920 }),
    ).toEqual({
      imageWidth: 540,
      imageHeight: 960,
      displayWidth: 1080,
      displayHeight: 1920,
      scaleX: 2,
      scaleY: 2,
    });
  });

  it("fits a long edge to 1280 pixels", () => {
    expect(fitScreenshotSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(fitScreenshotSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("rejects a downscale after the caller has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downscaleScreenshot(png(2000, 3000), controller.signal),
    ).rejects.toThrow(/abort/i);
  });
});

describe("UI refs", () => {
  it("resolves the latest tap point for a ref and drops it after the next read", () => {
    const cache = new UiRefCache();
    cache.replace(SERIAL, 0, [
      { ref: "@n3", nodeIndex: 3, tap: { x: 12, y: 40 } },
      { ref: "@n4", nodeIndex: 4, warnings: ["covered"] },
    ]);

    expect(cache.resolve(SERIAL, 0, "@n3")).toEqual({
      ref: "@n3",
      nodeIndex: 3,
      x: 12,
      y: 40,
    });
    expect(() => cache.resolve(SERIAL, 0, "@n4")).toThrow(/no tap point/);

    cache.replace(SERIAL, 0, []);
    expect(() => cache.resolve(SERIAL, 0, "@n3")).toThrow(/Unknown ref/);
  });
});

describe("device action parsers", () => {
  it("accepts http and https and rejects other schemes", () => {
    expect(assertViewUrl("https://example.com/a?b=1").href).toBe(
      "https://example.com/a?b=1",
    );
    expect(() => assertViewUrl("javascript:alert(1)")).toThrow(/scheme/);
    expect(() => assertViewUrl("https://user:pw@example.com")).toThrow(
      /credentials/,
    );
  });

  it("parses user rotation, fold states, clipboard dumps, and crash indexes", () => {
    expect(parseCurrentFoldId("2")).toBe(2);
    expect(parseCurrentFoldId("Committed state: 2")).toBe(2);
    expect(parseCurrentFoldId("Base state: 0\nCommitted state: 2")).toBe(2);
    expect(parseCurrentFoldId("identifier=3")).toBe(3);
    expect(
      parseCurrentFoldId("DeviceState{identifier=0}\nCommitted state: 2"),
    ).toBe(2);
    expect(parseCurrentFoldId("no state here")).toBeUndefined();
    expect(parseUserRotation("free").mode).toBe("free");
    expect(parseUserRotation("lock 3")).toEqual({
      mode: "lock",
      rotation: 3,
      raw: "lock 3",
    });
    expect(
      parseDeviceStates(`
        DeviceState{identifier=0, name='CLOSED', app_accessible=true},
        DeviceState{identifier=2, name='OPEN', app_accessible=true},
      `),
    ).toEqual([
      { identifier: 0, name: "CLOSED" },
      { identifier: 2, name: "OPEN" },
    ]);
    expect(
      resolveFoldState(
        [
          { identifier: 0, name: "CLOSED" },
          { identifier: 2, name: "OPEN" },
        ],
        "open",
      ).identifier,
    ).toBe(2);
    expect(
      parseClipboardDump(
        "ClipboardService:\n  mPrimaryClip: ClipData { text/plain {T:Hello} }",
      ),
    ).toEqual({ readable: true, text: "Hello" });
    expect(
      parseClipboardDump(
        "ClipboardService:\n  mPrimaryClip: ClipData { text/plain {T:[REDACTED]} }",
      ),
    ).toMatchObject({ readable: false, redacted: true });
    expect(
      parseDropboxIndex(`
        2026-10-01 12:00:01 data_app_crash (text, 1200 bytes)
        2026-10-01 12:00:02 system_app_anr (text, 80 bytes)
        2026-10-01 12:00:03 data_app_wtf (text, 10 bytes)
      `).map((entry) => entry.tag),
    ).toEqual(["data_app_crash", "system_app_anr"]);
    expect(
      parseDropboxIndex("2026-10-01 12:00:01 data_app_crash (text, 1 bytes)")[0]
        ?.id,
    ).toBe("2026-10-01 12:00:01|data_app_crash|0");
    expect(
      splitPrintedDropbox(`
========
2026-10-01 12:00:01 data_app_crash (text, 1 bytes)
first
========
2026-10-01 12:00:02 data_app_crash (text, 1 bytes)
second
      `).map((entry) => entry.time),
    ).toEqual(["2026-10-01 12:00:01", "2026-10-01 12:00:02"]);
    const kept = splitPrintedDropbox(`
========
2026-10-01 12:00:01 data_app_crash (text, 1 bytes)
first
========
stack frame
========
2026-10-01 12:00:02 data_app_crash
second
    `);
    expect(kept).toHaveLength(2);
    expect(kept[0]?.text).toContain("stack frame");
  });
});

describe("DeviceActions", () => {
  it("opens a quoted http URL on the requested display", async () => {
    const url = "https://example.com/a?b=1&c=2";
    const runner = addConnectedDevice(new FakeAdbRunner()).respond(
      [
        "shell",
        "am",
        "start",
        "--display",
        "0",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        quoteRemoteShellArg(url),
      ],
      "Starting: Intent { }",
      { serial: SERIAL },
    );

    const result = await new DeviceActions(runner).openUrl(SERIAL, 0, url);

    expect(result.url).toBe(url);
  });

  it("accepts a start whose intent text contains Error", async () => {
    const url = "https://example.com/Error:%20page";
    const runner = addConnectedDevice(new FakeAdbRunner()).respond(
      [
        "shell",
        "am",
        "start",
        "--display",
        "0",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        quoteRemoteShellArg(url),
      ],
      "Starting: Intent { dat=https://example.com/Error: page }",
      { serial: SERIAL },
    );

    await expect(
      new DeviceActions(runner).openUrl(SERIAL, 0, url),
    ).resolves.toMatchObject({
      url,
    });
  });

  it("rejects an activity start that prints Error on stderr", async () => {
    const url = "https://example.com/";
    const runner = addConnectedDevice(new FakeAdbRunner()).respond(
      [
        "shell",
        "am",
        "start",
        "--display",
        "0",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        quoteRemoteShellArg(url),
      ],
      "Starting: Intent { }",
      { serial: SERIAL, stderr: "Error: Activity not started" },
    );

    await expect(
      new DeviceActions(runner).openUrl(SERIAL, 0, url),
    ).rejects.toThrow(/Activity not started/);
  });

  it("rejects an activity start that prints Error", async () => {
    const url = "https://example.com/";
    const runner = addConnectedDevice(new FakeAdbRunner()).respond(
      [
        "shell",
        "am",
        "start",
        "--display",
        "0",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        quoteRemoteShellArg(url),
      ],
      "Error: Activity not started",
      { serial: SERIAL },
    );

    await expect(
      new DeviceActions(runner).openUrl(SERIAL, 0, url),
    ).rejects.toThrow(/Activity not started/);
  });

  it("sends emulator geo fixes as longitude then latitude", async () => {
    const serial = "emulator-5554";
    const runner = new FakeAdbRunner()
      .respond(["shell", "getprop", "ro.kernel.qemu"], "1", { serial })
      .respond(["emu", "geo", "fix", "46.7", "24.7"], "OK", { serial });

    const result = await new DeviceActions(runner).setLocation(
      serial,
      24.7,
      46.7,
      10,
    );

    expect(result.backend).toBe("emulator");
  });

  it("sends small coordinates as decimals", async () => {
    const serial = "emulator-5554";
    const runner = new FakeAdbRunner()
      .respond(["shell", "getprop", "ro.kernel.qemu"], "1", { serial })
      .respond(["emu", "geo", "fix", "0.0000002", "0.0000001"], "OK", {
        serial,
      });

    await new DeviceActions(runner).setLocation(
      serial,
      0.0000001,
      0.0000002,
      10,
    );
  });

  it("refuses device mock location below API 31", async () => {
    const runner = new FakeAdbRunner()
      .respond(["shell", "getprop", "ro.kernel.qemu"], "0", { serial: SERIAL })
      .respond(["shell", "getprop", "ro.build.version.sdk"], "30", {
        serial: SERIAL,
      });

    await expect(
      new DeviceActions(runner).setLocation(SERIAL, 24.7, 46.7, 10),
    ).rejects.toThrow(/API 31/);
  });

  it("refuses to clear a device mock location below API 31", async () => {
    const runner = new FakeAdbRunner()
      .respond(["shell", "getprop", "ro.kernel.qemu"], "0", { serial: SERIAL })
      .respond(["shell", "getprop", "ro.build.version.sdk"], "30", {
        serial: SERIAL,
      });

    await expect(
      new DeviceActions(runner).clearLocation(SERIAL),
    ).rejects.toThrow(/API 31/);
  });

  it("refuses to clear an emulator geo fix", async () => {
    const serial = "emulator-5554";
    const runner = new FakeAdbRunner().respond(
      ["shell", "getprop", "ro.kernel.qemu"],
      "1",
      { serial },
    );

    await expect(
      new DeviceActions(runner).clearLocation(serial),
    ).rejects.toThrow(/cold boot/);
  });
});
