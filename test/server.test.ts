import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";

import { createPolyScreenServer } from "../src/mcp/server.js";
import { CORE_DETECTIVE_TOOLS, PACKAGE_VERSION } from "../src/version.js";

describe("MCP server contract", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("advertises detective tools and optional profiles", async () => {
    const server = createPolyScreenServer({
      profiles: new Set(["core", "diagnostics", "apps"]),
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const tool of CORE_DETECTIVE_TOOLS) {
      expect(names).toContain(tool);
    }
    expect(names).toContain("mobile_server_info");
    expect(names).toContain("mobile_focus_trace_start");
    expect(names).toContain("mobile_focus_trace_stop");
    expect(names).toContain("mobile_artifacts_list");
    expect(names).toContain("mobile_logcat_start");
    expect(names).toContain("mobile_diagnostics_activity_tops");
    expect(names).toContain("mobile_broadcast_send");
    expect(names).toContain("mobile_default_apps_list");
    expect(names).toContain("mobile_default_app_get");
    expect(names).toContain("mobile_default_app_set");
    expect(names).toContain("mobile_default_app_clear");
    expect(names).toContain("mobile_input_double_tap");
    expect(names).toContain("mobile_input_long_press");
    expect(names).toContain("mobile_batch");
    expect(names).toContain("mobile_app_foreground");
    expect(names).toContain("mobile_open_url");
    expect(names).toContain("mobile_orientation");
    expect(names).toContain("mobile_device_fold");
    expect(names).toContain("mobile_location");
    expect(names).toContain("mobile_clipboard");
    expect(names).toContain("mobile_crashes_list");
    expect(names).toContain("mobile_crash_get");
    expect(names).toContain("mobile_notifications_list");
    expect(names).toContain("mobile_notification_get");
    expect(names).toContain("mobile_notification_post");
    expect(names).not.toContain("mobile_companion_key");
    expect(server.listRegisteredTools()).toEqual([...names].sort());
  });

  it("exposes version and tool list via mobile_server_info", async () => {
    const server = createPolyScreenServer({ profiles: new Set(["core"]) });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const response = await client.callTool({
      name: "mobile_server_info",
      arguments: {},
    });
    const info = response.structuredContent as {
      version: string;
      toolCount: number;
      toolNames: string[];
      profiles: string[];
    };
    const listed = (await client.listTools()).tools
      .map((tool) => tool.name)
      .sort();
    expect(info.version).toBe(PACKAGE_VERSION);
    expect(info.profiles).toEqual(["core"]);
    expect(info.toolCount).toBe(info.toolNames.length);
    expect(info.toolCount).toBe(listed.length);
    expect([...info.toolNames].sort()).toEqual(listed);
    expect(info.toolNames).toEqual(server.listRegisteredTools());
    for (const tool of CORE_DETECTIVE_TOOLS) {
      expect(info.toolNames).toContain(tool);
    }
  });
});
