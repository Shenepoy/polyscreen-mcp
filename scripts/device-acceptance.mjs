import {
  assert,
  connectIntegrationClient,
  requiredEnvironment,
  runWithDisplay,
} from "./integration-client.mjs";

const serial = requiredEnvironment("POLYSCREEN_DEVICE");
const displayIds = (process.env.POLYSCREEN_DISPLAY_IDS ?? "0")
  .split(",")
  .map((value) => Number(value.trim()));
if (
  displayIds.length === 0 ||
  displayIds.some((value) => !Number.isInteger(value) || value < 0)
) {
  throw new Error("POLYSCREEN_DISPLAY_IDS must be comma-separated integers");
}

const shouldRecord = process.env.POLYSCREEN_RECORD === "1";
const shouldTestCompanion = process.env.POLYSCREEN_COMPANION === "1";
const packageName = process.env.POLYSCREEN_TEST_PACKAGE?.trim();
const { client, call } = await connectIntegrationClient("device-acceptance");
let companionStarted = false;
const summary = { serial, displayIds };

try {
  const tools = await client.listTools();
  summary.toolCount = tools.tools.length;

  const devices = await call("mobile_devices_list", {});
  const device = devices.devices.find(
    (candidate) => candidate.serial === serial && candidate.state === "device",
  );
  assert(device, `Device is not online: ${serial}`);
  summary.device = device;

  const inspection = await call("mobile_device_inspect", {
    serial,
    refresh: true,
  });
  summary.capabilities = {
    apiLevel: inspection.capabilities.apiLevel,
    model: inspection.capabilities.model,
    inputDisplayTargeting: inspection.capabilities.input.displayTargeting,
  };

  summary.displays = [];
  summary.captures = [];
  summary.recordings = [];
  for (const displayId of displayIds) {
    const displayOpts = { serial, displayId, requirePhysical: true };
    const { display, result: capture } = await runWithDisplay(
      call,
      displayOpts,
      async () =>
        await call("mobile_screen_capture", {
          serial,
          displayId,
          saveArtifact: true,
        }),
    );
    summary.displays.push({
      logicalId: display.logicalId,
      physicalId: display.physicalId,
      width: display.width,
      height: display.height,
      state: display.state,
    });
    assert(capture.sizeBytes > 8, `Display ${displayId} capture was empty`);
    assert(
      capture.coordinateSpace?.imageWidth > 0 &&
        capture.coordinateSpace?.imageHeight > 0,
      `Display ${displayId} capture has no coordinate space`,
    );
    assert(capture.artifactUri, `Display ${displayId} capture was not saved`);
    const resource = await client.readResource({ uri: capture.artifactUri });
    assert(
      resource.contents.length === 1 && resource.contents[0].blob,
      `Display ${displayId} artifact could not be read`,
    );
    summary.captures.push({
      displayId,
      sizeBytes: capture.sizeBytes,
      artifactUri: capture.artifactUri,
    });

    if (shouldRecord) {
      const { result: recording } = await runWithDisplay(
        call,
        displayOpts,
        async () =>
          await call("mobile_screen_record", {
            serial,
            displayId,
            durationSeconds: 1,
          }),
      );
      assert(
        recording.sizeBytes > 0,
        `Display ${displayId} recording was empty`,
      );
      summary.recordings.push({
        displayId,
        sizeBytes: recording.sizeBytes,
        artifactUri: recording.artifactUri,
      });
    }
  }

  const diagnostics = await call("mobile_diagnostics_collect", {
    serial,
    sections: ["display", "window", "input", "battery"],
  });
  summary.diagnostics = Object.fromEntries(
    Object.entries(diagnostics.sections).map(([name, value]) => [
      name,
      Buffer.byteLength(value),
    ]),
  );

  const packages = await call("mobile_packages_list", {
    serial,
    userId: 0,
    thirdPartyOnly: true,
    includeDisabled: true,
  });
  summary.thirdPartyPackages = packages.packages.length;

  const foreground = await call("mobile_app_foreground", { serial });
  assert(foreground.source, "Foreground app did not name a source");
  const orientation = await call("mobile_orientation", {
    serial,
    displayId: displayIds[0] ?? 0,
    action: "get",
  });
  assert(
    orientation.mode === "free" || orientation.mode === "lock",
    "Orientation get did not return a mode",
  );
  const fold = await call("mobile_device_fold", { serial });
  assert(
    typeof fold.foldable === "boolean",
    "Fold get did not return foldable",
  );
  const clipboard = await call("mobile_clipboard", { serial, action: "get" });
  assert(
    typeof clipboard.readable === "boolean",
    "Clipboard get did not return readable",
  );
  const crashes = await call("mobile_crashes_list", { serial, limit: 5 });
  assert(Array.isArray(crashes.entries), "Crash list did not return entries");
  summary.deviceState = {
    foreground: foreground.source,
    orientation: orientation.mode,
    foldable: fold.foldable,
    clipboardReadable: clipboard.readable,
    crashes: crashes.entries.length,
  };

  if (packageName) {
    const app = await call("mobile_app_inspect", { serial, packageName });
    assert(
      app.dump.includes(packageName),
      `Package dump does not mention ${packageName}`,
    );
    const performance = await call("mobile_performance_snapshot", {
      serial,
      packageName,
    });
    summary.package = {
      name: packageName,
      dumpBytes: Buffer.byteLength(app.dump),
      performanceSections: Object.keys(performance.sections),
    };
  }

  if (shouldTestCompanion) {
    const started = await call("mobile_companion_start", { serial });
    companionStarted = true;
    const windows = await call("mobile_companion_windows", { serial });
    await call("mobile_companion_key", {
      serial,
      keyCode: 19,
      action: "down",
      source: "dpad",
      repeat: 0,
      metaState: 0,
    });
    await call("mobile_companion_key", {
      serial,
      keyCode: 19,
      action: "up",
      source: "dpad",
      repeat: 0,
      metaState: 0,
    });
    await call("mobile_companion_stop", { serial });
    companionStarted = false;
    summary.companion = {
      protocol: started.session.protocol,
      backend: started.session.backend,
      displayCount: windows.result.displays.length,
      keyLifecycle: true,
    };
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (companionStarted) {
    await client
      .callTool({
        name: "mobile_companion_stop",
        arguments: { serial },
      })
      .catch(() => undefined);
  }
  await client.close().catch(() => undefined);
}
