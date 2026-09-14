<!-- markdownlint-disable MD033 MD060 -->

<p align="center">
  <img src="assets/polyscreen-logo.svg" alt="PolyScreen" width="220" />
</p>

<h1 align="center">PolyScreen - شاشات</h1>

<p align="center">
  <strong>polyscreen-mcp</strong><br/>
  Android-first Model Context Protocol server — multi-display automation,<br/>
  structured evidence, and capability probes on real devices.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/polyscreen-mcp"><img alt="npm" src="https://img.shields.io/npm/v/polyscreen-mcp.svg?style=flat-square&label=npm&color=8B6914" /></a>
  <a href="https://github.com/Zyzto/polyscreen-mcp"><img alt="repo" src="https://img.shields.io/badge/github-Zyzto%2Fpolyscreen--mcp-C0C0C0?style=flat-square" /></a>
  <img alt="node" src="https://img.shields.io/badge/Node.js-%3E%3D22.12-C0C0C0?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="android" src="https://img.shields.io/badge/Android-11%2B-C0C0C0?style=flat-square&logo=android&logoColor=white" />
  <img alt="license" src="https://img.shields.io/badge/license-MPL--2.0-8B6914?style=flat-square" />
</p>

<p align="center">
  <a href="#install-and-build">Install</a> ·
  <a href="#client-configs">Client configs</a> ·
  <a href="#features-at-a-glance">Features</a> ·
  <a href="#tool-profiles">Profiles</a> ·
  <a href="#core-tools">Tools</a> ·
  <a href="#agent-interaction-benchmark">Benchmark</a> ·
  <a href="#security">Security</a> ·
  <a href="README.ar.md">العربية</a>
</p>

<p align="center">
  The name <strong>PolyScreen</strong> pairs multi-display automation with Arabic
  <span dir="rtl"><strong>شاشات</strong></span>
  (<em>shāshāt</em>): screens —
  plural of <span dir="rtl"><em>شاشة</em></span> (<em>shāsha</em>).
</p>

> [!WARNING]
> **Latest MCP required.** PolyScreen speaks the current Model Context Protocol revision (`2026-07-28`). Use a recent Cursor / Claude / VS Code / Codex (or other) MCP host that negotiates that era. Older 2025-only clients may connect on a legacy path but will miss modern features such as cacheable `tools/list` hints and `subscriptions/listen`.

---

## Why

Existing mobile MCP servers commonly:

- confuse Android logical display IDs with SurfaceFlinger physical IDs;
- capture one display while injecting input into another;
- expose only a small hard-coded set of physical buttons;
- treat `uiautomator dump` as multi-display aware when it is not;
- return prose that agents must parse;
- expose unrestricted shell commands as ordinary tools.

**PolyScreen** keeps those boundaries explicit and returns structured evidence for every operation. The portable core uses the official `adb` executable and probes each connected device at runtime instead of assuming capabilities from the Android version.

On npm: [`polyscreen-mcp`](https://www.npmjs.com/package/polyscreen-mcp) · Repo: [Zyzto/polyscreen-mcp](https://github.com/Zyzto/polyscreen-mcp)

---

## Features at a glance

| Area          | What you get                                                                |
| ------------- | --------------------------------------------------------------------------- |
| **Displays**  | Logical ↔ physical ID correlation; capture/input stay on the same display   |
| **Input**     | Device-probed `input` help — keys, gamepad, touch, display targeting        |
| **UI**        | Snapshot / find / wait without treating `uiautomator` as multi-display      |
| **Evidence**  | Structured JSON tool results (not prose agents must scrape)                 |
| **Sessions**  | Async record / focus / logcat with marks and wall-clock join keys           |
| **Analysis**  | Black/dim flash detection via ffmpeg; theme-flash reports                   |
| **Profiles**  | Compact `core` plus opt-in apps, diagnostics, files, performance, companion |
| **Transport** | Stdio default; loopback Streamable HTTP with Host/Origin + optional bearer  |

**Platforms:** Android 11+ (multi-display baseline). Host: Node.js 22.12+, `adb` on `PATH`.

---

## Requirements

- Node.js 22.12 or newer
- pnpm 11
- Android platform tools with `adb` on `PATH`, or `ADB_PATH=/absolute/path/to/adb`
- Android 11 or newer for the supported multi-display baseline
- `ffmpeg` and `ffprobe` on `PATH` for `mobile_analyze_recording`
- JDK 17 and Android SDK only when building the optional companion

## Install and build

```bash
pnpm install
pnpm check
pnpm build
```

Stdio remains the default. The server speaks MCP `2026-07-28` (stateless Streamable HTTP via `createMcpHandler`) and still serves legacy 2025-era clients from the same factory. Prefer a client on that revision (or newer) for cacheable `tools/list` hints and `subscriptions/listen`. Wire-up snippets for Cursor, Claude, VS Code, Windsurf, and others: [Client configs](#client-configs).

## Tool profiles

The default `core` profile is deliberately compact. Additional profiles advertise tools only when requested.

| Profile        | Capabilities                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `core`         | Server info, devices, displays, screenshots, async record/analyze, async focus traces, artifacts list/prune, UI, input, apps |
| `apps`         | Packages, default-app roles, notifications (list/get/post), and scoped broadcasts                                            |
| `diagnostics`  | Dumpsys slices, logcat snapshot/start/stop, wake, night mode, debuggable shared_prefs read                                   |
| `files`        | Constrained push/pull under approved roots                                                                                   |
| `performance`  | CPU, power, battery, memory, and frame snapshots                                                                             |
| `device-admin` | Explicit runtime permission grant/revoke                                                                                     |
| `companion`    | All-display accessibility windows and explicit key press/down/up                                                             |
| `all`          | Every implemented profile                                                                                                    |

`unsafe` and emulator profiles are reserved but do not expose raw shell in this release.

## Client configs

Stdio launch (pin the published version):

```text
npx -y polyscreen-mcp@0.7.0 --profile core diagnostics
```

`diagnostics` is required for logcat start/stop, activity tops, wake, and night-mode tools. After editing config or reconnecting, call `mobile_server_info` once and confirm `version`, `toolCount`, and detective tools match a fresh `tools/list`. Prefer an MCP host that speaks `2026-07-28` so the client negotiates the modern era instead of falling back to 2025 `initialize`.

| Client                | Config file                                                                                                                                                                           | Root key                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Cursor**            | `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`                                                                                                                                  | `mcpServers`                    |
| **Claude Desktop**    | macOS `~/Library/Application Support/Claude/claude_desktop_config.json` · Linux `~/.config/Claude/claude_desktop_config.json` · Windows `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers`                    |
| **Claude Code**       | `.mcp.json` (project) or `~/.claude/settings.json`                                                                                                                                    | `mcpServers`                    |
| **VS Code / Copilot** | `.vscode/mcp.json` or **MCP: Open User Configuration**                                                                                                                                | `servers` (+ `"type": "stdio"`) |
| **Windsurf**          | `~/.codeium/windsurf/mcp_config.json`                                                                                                                                                 | `mcpServers`                    |
| **Continue**          | `.continue/mcpServers/*.yaml` (preferred) or `~/.continue/config.yaml`                                                                                                                | `mcpServers`                    |
| **Zed**               | `~/.config/zed/settings.json`                                                                                                                                                         | `context_servers`               |
| **Gemini CLI**        | `~/.gemini/settings.json`                                                                                                                                                             | `mcpServers`                    |
| **Cline / Roo**       | MCP Servers panel → Edit Configuration                                                                                                                                                | `mcpServers`                    |

### Cursor / Claude Desktop / Windsurf / Claude Code / Gemini CLI / Cline

Same `mcpServers` shape (merge into the existing object):

```json
{
  "mcpServers": {
    "polyscreen": {
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.7.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

If the tool list looks stale in Cursor, toggle the server off/on so tool-list change notifications (`list_changed` / `subscriptions/listen`) are applied.

### VS Code (GitHub Copilot)

Workspace `.vscode/mcp.json` — note the `servers` root key (not `mcpServers`):

```json
{
  "servers": {
    "polyscreen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.7.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

### Continue

Preferred: workspace `.continue/mcpServers/polyscreen.yaml` (Continue also accepts the same `mcpServers` list in `~/.continue/config.yaml`, and can load Claude/Cursor-style JSON dropped into `.continue/mcpServers/`):

```yaml
name: PolyScreen MCP
version: 0.7.0
schema: v1
mcpServers:
  - name: polyscreen
    type: stdio
    command: npx
    args:
      - -y
      - polyscreen-mcp@0.7.0
      - --profile
      - core
      - diagnostics
```

### Zed

`~/.config/zed/settings.json` (flat `command` + `args` — not a nested `command.path` object):

```json
{
  "context_servers": {
    "polyscreen": {
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.7.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

### Local Streamable HTTP (any client with URL transport)

```bash
polyscreen-mcp --listen 3300 --token "replace-with-a-secret"
```

Endpoint: `http://127.0.0.1:3300/mcp`. HTTP always binds to loopback, validates `Host` and `Origin`, and optionally requires the configured bearer token.

## Core tools

- `mobile_server_info`
- `mobile_devices_list`
- `mobile_device_inspect`
- `mobile_displays_list`
- `mobile_screen_capture`
- `mobile_screen_capture_pair`
- `mobile_screen_record`
- `mobile_sessions_status`
- `mobile_record_start` / `mobile_record_mark` / `mobile_record_stop`
- `mobile_analyze_recording` (`mode: "flash"` for regression hunting)
- `mobile_theme_flash_report`
- `mobile_focus_trace` (blocking) / `mobile_focus_trace_start` / `mobile_focus_trace_stop`
- `mobile_artifacts_list` / `mobile_artifacts_prune`
- `mobile_ui_snapshot` / `mobile_ui_find` / `mobile_ui_wait`
- `mobile_input_tap` / `mobile_input_swipe` / `mobile_input_drag`
- `mobile_input_key` / `mobile_input_key_combination` / `mobile_input_text`
- `mobile_app_inspect` / `mobile_app_launch` / `mobile_app_stop` / `mobile_app_relaunch_on_displays`
- `mobile_app_install` / `mobile_app_uninstall`

Every display-sensitive tool takes a framework **logical** `displayId`. Screenshot and recording implementations resolve that to a SurfaceFlinger **physical** ID internally.

Screenshots can be retained with `saveArtifact`. Artifact **listings** are metadata stubs only (`uri`, `name`, `mimeType`, `sizeBytes`). Binary bytes are read on demand via `resources/read` — prefer `mobile_analyze_recording` JSON over many `mobile_screen_capture` images when hunting flashes.

### Server info and tool-list integrity

`mobile_server_info` returns `{ version, profiles, toolCount, toolNames, artifactRoot }`. On startup the process logs the registered tool count and names to stderr. HTTP publishes tool-list changes via `subscriptions/listen` (`handler.notify.toolsChanged()`); stdio clients should refresh from `tools/list` / `mobile_server_info` after reconnect.

### Devices and serials

`mobile_devices_list` returns exact ADB serials plus:

- `reachable` — short `get-state` probe (stale wireless/mDNS entries often fail here);
- `hardwareSerial` — `ro.serialno` when the probe succeeds;
- `preferred` / `preferredSerial` — when the same hardware appears under multiple serials (for example TCP `IP:port` and an `adb-tls` mDNS name), the list prefers a reachable TCP serial;
- `aliases` — other serials in the same hardware group (only when `hardwareSerial` matches; empty product/model metadata never collapses unrelated devices).

Never invent a serial. Pass the exact preferred value from this list into every other tool.

### Async recording and visual analysis

`mobile_screen_record` blocks for its full `durationSeconds`. Prefer the async session when input must interleave:

| Tool                       | Purpose                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `mobile_sessions_status`   | List active record / focus / logcat sessions (recover IDs after reconnect).                             |
| `mobile_record_start`      | Start on-device `screenrecord` for one logical display. Returns `{ recordId, pathHint, startedAtIso }`. |
| `mobile_record_mark`       | Label a point with `offsetMs` + `wallClockIso`.                                                         |
| `mobile_record_stop`       | Finalize MP4 + marks sidecar.                                                                           |
| `mobile_analyze_recording` | Quantify black/dim frames from `path` or `artifactUri` (`hasBlackFlash` / `hasDimFlash`).               |

Async sessions do **not** hold the mutation queue.

`mobile_analyze_recording` options:

| Option                 | Default                     | Meaning                                           |
| ---------------------- | --------------------------- | ------------------------------------------------- |
| `mode`                 | `default`                   | `flash` sets sample export on and denser summary  |
| `fps`                  | `30`                        | Sample rate                                       |
| `blackThreshold`       | `16`                        | Mean gray below this = black (`true_black` band)  |
| `dimThreshold`         | `80`                        | Mean gray below this = dim                        |
| `exportSampleFrames`   | `false` (`true` in `flash`) | PNGs at first/last black and each mark            |
| `includeFullTimeline`  | `false`                     | Include full per-frame `meanGrayTimeline` (large) |
| `timelineDownsampleMs` | `200` (`100` in `flash`)    | Step for compact `timelineSummary`                |

Compact fields always returned: counts, `blackRuns`/`dimRuns`, marks, `timelineSummary`, `bucketCounts`, optional `samples`.

`mobile_theme_flash_report` reads night mode, runs `mode: "flash"` analysis, and lists marks whose offsets fall inside any reported black/dim run (± `markWindowMs`). Run lists are capped (`blackRunsTruncated` / `dimRunsTruncated`).

Buckets (OEM-agnostic heuristics; mean-gray ranges are examples, not universal truth):

| Bucket                 | Example mean gray | Meaning                                    |
| ---------------------- | ----------------- | ------------------------------------------ |
| `true_black`           | ~0–15             | Empty / compositor black                   |
| `near_black_content`   | ~16–29            | Near-black splash/content (not empty)      |
| `system_launcher_idle` | ~30–55            | Mid-gray idle chrome / wallpaper-like band |
| `dark_app_ui`          | ~56–119           | Dark theme / dark splash                   |
| `light_app_ui`         | ~190–230          | Light app UI                               |
| `other`                | remainder         | Unclassified                               |

Calibrate with `exportSampleFrames` on the device under test — thresholds alone are insufficient for regressions.

### Time bases (joining record / focus / logcat)

Record/focus sessions share wall-clock ISO timestamps from host `Date.now()`. Logcat session bounds use host ISO; individual lines keep Android `threadtime`:

| Source         | Fields                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Record marks   | `offsetMs` from record start, `wallClockIso`                                                                      |
| Focus samples  | `tMs` from focus session start, `wallClockIso`, optional `recordOffsetMs` when `boundRecordId` is set             |
| Logcat session | Host `startedAtIso` / `stoppedAtIso` (+ optional `boundRecordStartedAtIso`); each line keeps Android `threadtime` |

Join record marks and focus on `wallClockIso` or `recordOffsetMs` when `boundRecordId` is set. Logcat lines are device `threadtime` — correlate the session window to the bound recording via `boundRecordStartedAtIso` / host session bounds, not per-line `recordOffsetMs`.

### Focus timeline

| Tool                                | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `mobile_focus_trace`                | Blocking sample for a fixed `durationMs` (default 250ms interval, ring buffer) |
| `mobile_focus_trace_start` / `stop` | Non-blocking; bind with `boundRecordId` for `recordOffsetMs`                   |

Stop results include `changes` / `changeCount` (focus transitions per display) — prefer that over raw `samples` when hunting launcher/app swaps. Default `maxSamples` is 800 (covers 180s @ 250ms). If the ring evicts, `truncated`/`droppedSamples` report it. Large responses also write a JSON artifact (`samplesArtifactUri`) and inline only a prefix unless `includeAllSamples` is true.

### Artifacts

| Tool                     | Purpose                                |
| ------------------------ | -------------------------------------- |
| `mobile_artifacts_list`  | Metadata stubs only                    |
| `mobile_artifacts_prune` | `maxAgeMs` / `maxCount`, with `dryRun` |

### Diagnostics extras (diagnostics profile)

- `mobile_logcat` / `mobile_logcat_start` / `mobile_logcat_stop`
- `mobile_diagnostics_collect` / `mobile_diagnostics_activity_tops` / `mobile_diagnostics_layer_hints`
- `mobile_power_wake` / `mobile_uimode_get` / `mobile_uimode_set`
- `mobile_app_prefs_read` (debuggable `run-as` shared_prefs)

`mobile_app_launch` / `mobile_app_stop` / `mobile_app_relaunch_on_displays` cover per-package force-stop and display-targeted launch (including stop→launch recipes across multiple logical displays).

### Default apps (`apps` profile)

| Tool                       | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `mobile_default_apps_list` | RoleManager holders for common defaults (home, browser, dialer, sms, …) via `dumpsys role`     |
| `mobile_default_app_get`   | Holders for one role (short name or `android.app.role.*`)                                      |
| `mobile_default_app_set`   | `cmd role add-role-holder` (exclusive clear+add by default); optional `homeComponent` for HOME |
| `mobile_default_app_clear` | `clear-role-holders` or `remove-role-holder` when `packageName` is set                         |

Requires shell access to RoleManager (typical on userdebug/eng or with suitable privileges). `bypassQualification: true` can help assign roles to test APKs. `mobile_broadcast_send` covers app debug broadcasts.

### Notifications (`apps` profile)

| Tool                        | Purpose                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `mobile_notifications_list` | Active keys via `cmd notification list`; optional `packageName` / `includeDetails` (title/text) |
| `mobile_notification_get`   | Details for one key (`userId\|package\|id\|tag\|uid`)                                           |
| `mobile_notification_post`  | Post as `com.android.shell` with `tag` + `text` (optional `title`)                              |

Posted notifications are owned by the shell package. Keys contain `|` and are quoted automatically for the device shell.

### Visual regression workflow (device-agnostic)

Always discover IDs at runtime. Never hardcode serials, logical display IDs, launcher packages, or OEM model names.

1. `mobile_devices_list` → pick a `reachable` / `preferred` serial
2. `mobile_displays_list` → note the logical `displayId`(s) under test
3. `mobile_server_info` — confirm `version` and detective tools after reconnect
4. `mobile_record_start` on the logical display under test
5. Optional (diagnostics): `mobile_logcat_start` with `boundRecordId`
6. `mobile_focus_trace_start` for the relevant `displayIds` (optionally same `boundRecordId`)
7. `mobile_record_mark` → input (tap / key / gamepad / HOME) → `mobile_record_mark`
8. Stop focus/logcat → `mobile_record_stop`
9. `mobile_analyze_recording` with `mode: "flash"` and/or `mobile_theme_flash_report`
10. Assert: no unexpected `hasBlackFlash` / `true_black` runs; use focus `changes` to see if another package briefly owned the display. Treat `system_launcher_idle` as mid-gray idle chrome — not a black flash.

### Optional cookbook: dual-display handhelds

Some handhelds expose two logical displays (for example internal + presentation). After `mobile_displays_list`, pass both IDs to `mobile_focus_trace_start` / `mobile_screen_capture_pair` / `mobile_app_relaunch_on_displays`. Use `mobile_sessions_status` if a reconnect loses session IDs. These devices are stress cases for the same APIs — not a separate tool surface.

## Multi-display model

Android has multiple identifier spaces:

- logical display IDs are small framework integers used by WindowManager, ActivityManager, `input -d`, and accessibility;
- physical display IDs are unsigned 64-bit SurfaceFlinger identifiers used by `screencap -d` and `screenrecord --display-id`;
- virtual displays may have a logical ID but no capturable physical ID.

Physical IDs are represented as decimal strings so JavaScript never loses precision. Correlation uses `DisplayInfo.uniqueId`, display addresses, and bounded evidence from:

- `dumpsys display`
- `dumpsys SurfaceFlinger --display-id`
- `dumpsys input`
- `dumpsys window displays`
- `dumpsys activity activities`

Requested activity placement is always treated as a request. Callers should inspect tasks and window focus to verify the observed result.

## Input behavior

The ADB backend probes the device's own `input` help and exposes only supported options:

- keyboard, dpad, gamepad, and touchscreen sources;
- display targeting with `-d`;
- key press, long press, double tap, and explicit duration where supported;
- any symbolic or numeric Android keycode, including face buttons, shoulders, triggers, thumb buttons, START, SELECT, and MODE;
- taps, swipes, text, and modern command capabilities reported by inspection.

ADB shell gamepad events still use a synthetic virtual device identity. They are not equivalent to a physical controller descriptor.

Points outside the target display are rejected. `input tap` exits `0` for off-screen coordinates and drops the event, which is indistinguishable from a tap that did nothing.

### Where to tap

Android delivers a touch to the **last-painted clickable view** under the point, so the geometric centre of a label is frequently the wrong coordinate: the label itself is usually not clickable, and floating search bars, install buttons, and bottom sheets are painted over the rows behind them.

Every node from `mobile_ui_snapshot`, `mobile_ui_find`, and `mobile_ui_wait` therefore carries a resolved tap plan alongside its raw geometry:

| Field        | Meaning                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `center`     | Raw geometric centre of `bounds`. Reported as-is; it may belong to another view.                          |
| `tap`        | `{ x, y, nodeIndex, via, adjusted }` — the point that reaches this node. Pass this to `mobile_input_tap`. |
| `tappable`   | `false` when the node is off-screen or completely covered.                                                |
| `occludedBy` | The clickable node that would swallow a tap on `center`.                                                  |
| `warnings`   | Why the plan differs from `center`, or why there is no plan.                                              |

Inside `tap`, `nodeIndex` and `via` name the view that receives the click — `self`, an `ancestor` container, or `unhandled` when nothing in the branch is exposed as clickable and the tap depends on an undeclared touch handler. `adjusted` is `true` when the point had to move off that view's own centre to dodge something painted over it. When a node is not tappable, scroll it clear or dismiss the overlay named in `occludedBy` instead of tapping blind.

A disabled control counts as an occluder. `View.onTouchEvent` returns `clickable` before it checks whether the view is enabled, so a greyed-out button still swallows every touch that lands on it.

Boolean node attributes are reported as a `flags` array listing only what is true, for example `"flags": ["clickable", "enabled", "focusable"]`. Empty strings and false flags are omitted rather than serialised, which keeps a 500-node snapshot readable.

## Optional companion

Build:

```bash
gradle -p companion :app:assembleDebug :app:assembleDebugAndroidTest :fixture:assembleDebug
```

Outputs:

- `companion/app/build/outputs/apk/debug/app-debug.apk`
- `companion/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`

Enable the `companion` profile, then call:

1. `mobile_companion_install`
2. `mobile_companion_start`
3. `mobile_companion_key` or `mobile_companion_windows`
4. `mobile_companion_stop`

The host creates a random per-session token and an owned `adb forward` to a local-abstract socket. Frames are length-prefixed JSON with a 1 MiB maximum. The instrumentation process preserves key `downTime`, supports explicit press/down/up and repeats, and releases all held keys when a client disconnects.

Platform limits are reported rather than hidden:

- keys follow Android's focused-display policy because public `KeyEvent` has no portable display setter;
- a normal APK cannot hold the signature-only `INJECT_EVENTS` permission;
- synthetic gamepad events do not have physical controller identity;
- accessibility exposes interactive windows and nodes, not secure or inaccessible rendering.

## Security

- Host-side commands are argv arrays (no host `/bin/sh -c`). On-device async `screenrecord` uses a bounded `sh -c` with a validated physical display ID and quoted remote path under `/data/local/tmp`.
- Device serials, packages, components, keycodes, tags, permissions, paths, and display IDs are validated.
- Input/UI mutations are serialized per device. Async record/logcat/focus sessions intentionally bypass that queue so agents can interleave input.
- Subprocesses have deadlines, cancellation, and output caps.
- Push paths must remain under the server host root.
- Pull/push device paths are restricted to shared storage and `/data/local/tmp`.
- Raw shell, root, remount, verity, SELinux, partition, credential, and system-process operations are not exposed.
- Recording stop probes `/proc/<pid>/cmdline` for this session's `screenrecord` path (token match). Transient probe failures while the PID is still alive are treated as uncertain and still signaled so a live recording is not pulled mid-write.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Agent interaction benchmark

This benchmark compares PolyScreen's structured Android automation surface with
direct `adb` commands on an Android emulator. It uses Janan's **Add
medication** button and name field, plus the Camera shutter, so the actions
exercise navigation, semantic button discovery, text input, and photo capture.

The run targeted `emulator-5554`, logical display `0` (1280×2856), and typed
`PolyScreenTest`. All four tasks succeeded through both paths; both camera
trials produced a JPEG in the emulator's `/sdcard/Pictures/` directory.

Token counts use the `o200k_base` tokenizer and include the agent-visible
request/command text plus textual tool results. MCP initialization bytes,
model reasoning, and binary image bytes are excluded. The `adb` path used
`uiautomator` XML for target discovery and verification; hard-coded
coordinates would use fewer tokens but would be more brittle.

| Task                     |      PolyScreen MCP |         Direct `adb` | Difference                                     | Ease of use                                                                |
| ------------------------ | ------------------: | -------------------: | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Navigate to Janan        | 1 call / 230 tokens | 2 calls / 169 tokens | `adb` used 61 fewer tokens                     | PolyScreen resolves the activity automatically                             |
| Click **Add medication** |             3 / 457 |            3 / 4,241 | PolyScreen used 89.2% fewer                    | PolyScreen returns a semantic match and tap plan                           |
| Input `PolyScreenTest`   |             2 / 324 |            2 / 2,710 | PolyScreen used 88.0% fewer                    | PolyScreen provides a dedicated text operation and structured verification |
| Take a picture           |             4 / 640 |            5 / 4,231 | PolyScreen used 84.9% fewer                    | PolyScreen finds the shutter semantically and targets the logical display  |
| **Task total**           |      **10 / 1,651** |      **12 / 11,351** | **PolyScreen used 85.5% fewer (9,700 tokens)** | **PolyScreen was easier overall**                                          |

The main difference is response shape: `mobile_ui_find` returns only the
matching node and its resolved tap point, while the comparable `adb` workflow
returns the full UI hierarchy for the agent to parse. In this single sequential
run, measured call-time totals were about 15.0 seconds for PolyScreen and 14.0
seconds for `adb`; latency is environment-dependent and was not the primary
measure.

PolyScreen has a one-time session cost: the `core` profile's 33-tool catalog
and discovery calls consumed 12,503 text tokens in this run, compared with 113
tokens for the two basic `adb` setup checks. This catalog cost is separate from
the task table and is normally amortized across a session.

## Testing and development

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
gradle -p companion :app:assembleDebug :app:assembleDebugAndroidTest
```

The local suite covers:

- ADB subprocess timeouts, cancellation, output limits, and argv safety;
- logical/physical display parsing, virtual displays, capture routing, and launch verification;
- UI hierarchy parsing and matching;
- per-device mutation serialization;
- host/device path confinement and typed command validation;
- MCP tool-profile registration and Streamable HTTP security;
- artifact storage and traversal protection;
- companion framing and request correlation.

Device integration checks are intentionally separate from deterministic unit tests. Multi-display acceptance additionally verifies physical-ID capture and recording, all-display accessibility windows, authenticated companion forwarding, and independent key down/up injection.

Never silently select the first connected device: pass the exact serial returned by `mobile_devices_list`.

Occasional `Logical display N is not available` flakes on multi-display handhelds usually clear after re-listing displays, tapping the target display (or waking it), and retrying. The device acceptance scripts recover via `runWithDisplay`.

### Repeatable device acceptance

The generic suite is read-mostly. It captures requested displays and can optionally record, inspect one package, and exercise an already-installed companion:

```bash
POLYSCREEN_DEVICE=<serial-from-devices_list> \
POLYSCREEN_DISPLAY_IDS=<ids-from-displays_list> \
POLYSCREEN_RECORD=1 \
POLYSCREEN_TEST_PACKAGE=com.example.app \
POLYSCREEN_COMPANION=1 \
pnpm test:device
```

The destructive suite uses a dedicated integration-fixture APK, separate from the production companion. It installs and launches the fixture, verifies tap/swipe/drag/text input, grants and revokes CAMERA, force-stops the fixture, and uninstalls it during cleanup:

```bash
POLYSCREEN_DEVICE=<serial-from-devices_list> \
POLYSCREEN_DISPLAY_ID=<id-from-displays_list> \
POLYSCREEN_ALLOW_DESTRUCTIVE=1 \
pnpm test:device:destructive
```

The destructive suite refuses to run without the acknowledgement variable and never chooses a device serial implicitly. Override `POLYSCREEN_FIXTURE_APK` when testing an externally built fixture.

---

## Branding

The logo wordmark uses **[Baz](https://www.1001fonts.com/baz-font.html)** (Baz Light) by fakharia (SIL OFL) — the same Arabic typeface as [Siglat](https://github.com/Zyzto/Siglat) and [Edadat](https://github.com/Zyzto/Edadat). The face is vendored at [`assets/fonts/baz-Light.otf`](assets/fonts/baz-Light.otf); the SVG outlines HarfBuzz-shaped <span dir="rtl">شــاشات</span> (tatweel after <span dir="rtl">ش</span>, not after <span dir="rtl">ا</span>) so GitHub/npm render without loading the font.

---

## License

[MPL-2.0](LICENSE) — weak copyleft, commercial use allowed. Modified package files stay under MPL; your app can remain closed-source.
