import { describe, expect, it } from "vitest";

import {
  findUiNodes,
  parseUiNodes,
  planTap,
  uiNodesFromCompanion,
  withTapPlans,
} from "../src/android/ui.js";

describe("UI hierarchy", () => {
  const xml = `<?xml version="1.0"?>
    <hierarchy>
      <node text="Library" resource-id="com.example:id/library" class="android.widget.TextView"
        content-desc="Game library" bounds="[10,20][210,120]" />
      <node text="Settings" resource-id="com.example:id/settings" class="android.widget.Button"
        content-desc="" bounds="[10,140][210,240]" />
    </hierarchy>`;

  it("parses accessible labels and centers", () => {
    const nodes = parseUiNodes(xml);
    expect(nodes[0]).toMatchObject({
      text: "Library",
      contentDescription: "Game library",
      center: { x: 110, y: 70 },
    });
  });

  it("finds nodes case-insensitively by default", () => {
    expect(findUiNodes(parseUiNodes(xml), { text: "setting" })).toHaveLength(1);
  });

  it("keeps self-closing leaves out of the parent chain", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="a" bounds="[0,0][100,100]">
        <node class="b" bounds="[0,0][50,50]" />
        <node class="c" bounds="[50,0][100,50]" />
      </node>
      <node class="d" bounds="[0,100][100,200]" />
    </hierarchy>`);

    expect(
      nodes.map((node) => [node.className, node.depth, node.parentIndex]),
    ).toEqual([
      ["a", 0, -1],
      ["b", 1, 0],
      ["c", 1, 0],
      ["d", 0, -1],
    ]);
  });

  it("decodes numeric and named XML entities in attributes", () => {
    const nodes = parseUiNodes(
      `<hierarchy><node text="Tom &amp; Jerry&#39;s &#x22;show&#x22;" class="x" bounds="[0,0][2,2]" /></hierarchy>`,
    );
    expect(nodes[0]?.text).toBe(`Tom & Jerry's "show"`);
  });

  it("reads the actionable flags uiautomator reports", () => {
    const nodes = parseUiNodes(
      `<hierarchy><node class="x" bounds="[0,0][2,2]" clickable="true" long-clickable="false"
        enabled="false" scrollable="true" checkable="true" checked="true" selected="true"
        focusable="true" focused="true" password="true" package="com.example" /></hierarchy>`,
    );
    expect(nodes[0]).toMatchObject({
      clickable: true,
      longClickable: false,
      enabled: false,
      scrollable: true,
      checkable: true,
      checked: true,
      selected: true,
      focusable: true,
      focused: true,
      password: true,
      packageName: "com.example",
    });
  });
});

describe("tap planning", () => {
  const row = (
    text: string,
    rowBounds: string,
    labelBounds: string,
  ): string => `
    <node class="android.widget.LinearLayout" clickable="true" enabled="true" bounds="${rowBounds}">
      <node class="android.widget.TextView" text="${text}" clickable="false" enabled="true" bounds="${labelBounds}" />
    </node>`;

  it("routes a label tap to the clickable row that handles it", () => {
    const nodes = parseUiNodes(
      `<hierarchy>${row("Display", "[0,100][1080,300]", "[48,180][300,220]")}</hierarchy>`,
    );
    const plan = planTap(nodes, nodes[1]!);

    expect(plan).toMatchObject({
      tappable: true,
      tap: { x: 540, y: 200, nodeIndex: 0, via: "ancestor" },
    });
  });

  /**
   * Trimmed from a real One UI 8 Settings home dump (SM-S721B, Android 16),
   * where the list scrolls under a floating bottom search bar. Tapping the last
   * row's label centre at (816, 2269) opened search instead of the row.
   */
  const settingsHome = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
    <hierarchy rotation="0">
      <node class="android.widget.ScrollView" resource-id="com.android.settings:id/coordinator"
        clickable="false" enabled="true" bounds="[0,0][1080,2340]" drawing-order="1">
        <node class="android.widget.LinearLayout" resource-id="com.android.settings:id/content_layout"
          clickable="false" enabled="true" bounds="[0,931][1080,2340]" drawing-order="2">
          <node class="androidx.recyclerview.widget.RecyclerView" resource-id="com.android.settings:id/recycler_view"
            scrollable="true" clickable="false" enabled="true" bounds="[0,931][1080,2340]" drawing-order="1">
            <node class="android.widget.LinearLayout" clickable="true" enabled="true"
              bounds="[26,1996][1054,2143]" drawing-order="9">
              <node class="android.widget.TextView" text="الإشعارات" resource-id="android:id/title"
                clickable="false" enabled="true" bounds="[725,2035][891,2103]" drawing-order="1" />
            </node>
            <node class="android.widget.LinearLayout" clickable="true" enabled="true"
              bounds="[26,2196][1054,2340]" drawing-order="11">
              <node class="android.widget.RelativeLayout" resource-id="com.android.settings:id/title_frame"
                clickable="false" enabled="true" bounds="[741,2235][891,2303]" drawing-order="1">
                <node class="android.widget.TextView" text="الشاشة" resource-id="android:id/title"
                  clickable="false" enabled="true" bounds="[741,2235][891,2303]" drawing-order="1" />
              </node>
            </node>
          </node>
        </node>
        <node class="android.widget.FrameLayout" resource-id="com.android.settings:id/floating_bottom_container"
          clickable="false" enabled="true" bounds="[0,2138][1080,2301]" drawing-order="5">
          <node class="androidx.appcompat.widget.LinearLayoutCompat" resource-id="com.android.settings:id/search_view"
            clickable="false" enabled="true" bounds="[0,2138][1080,2275]" drawing-order="2">
            <node class="android.widget.LinearLayout" resource-id="com.android.settings:id/search_plate"
              clickable="true" enabled="true" bounds="[220,2138][860,2275]" drawing-order="1">
              <node class="android.widget.TextView" text="بحث" resource-id="com.android.settings:id/search_src_text"
                clickable="false" enabled="true" bounds="[378,2169][750,2243]" drawing-order="2" />
              <node class="android.widget.ImageView" resource-id="com.android.settings:id/search_voice_btn"
                clickable="true" enabled="true" bounds="[257,2138][352,2275]" drawing-order="3" />
            </node>
          </node>
        </node>
      </node>
    </hierarchy>`;

  it("moves the tap out from under an overlay that covers the centre", () => {
    const nodes = parseUiNodes(settingsHome);
    const [match] = withTapPlans(nodes, findUiNodes(nodes, { text: "الشاشة" }));
    const row = nodes.find(
      (node) => node.clickable && node.bounds?.top === 2196,
    );

    // The centre is the coordinate that opened search on the device.
    expect(match?.center).toEqual({ x: 816, y: 2269 });
    expect(match).toMatchObject({
      tappable: true,
      tap: { x: 606, y: 2307, nodeIndex: row?.nodeIndex, via: "ancestor" },
      occludedBy: { resourceId: "com.android.settings:id/search_plate" },
    });
    expect(match?.warnings.join(" ")).toMatch(/covered by/);
  });

  /** View.onTouchEvent returns `clickable` before it checks ENABLED. */
  it("treats a disabled clickable overlay as a blocker, not as transparent", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">
        ${row("Display", "[0,1000][1080,1200]", "[48,1080][300,1120]")}
        <node class="android.widget.Button" resource-id="greyed" clickable="true"
          enabled="false" bounds="[300,1000][1080,1200]" />
      </node>
    </hierarchy>`);
    const plan = planTap(nodes, nodes[1]!);

    // Ignoring the greyed button would hand back the row centre at (540, 1100),
    // where the touch dies without reaching the row.
    expect(plan.tap).toMatchObject({ x: 150, y: 1100, via: "self" });
    expect(plan.occludedBy).toMatchObject({ resourceId: "greyed" });
  });

  it("reports a disabled click target instead of pretending it works", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">
        <node class="android.widget.Button" text="Continue" clickable="true" enabled="false"
          bounds="[0,1000][1080,1200]" />
      </node>
    </hierarchy>`);
    const plan = planTap(nodes, nodes[1]!);

    expect(plan.tap).toMatchObject({ x: 540, y: 1100, via: "self" });
    expect(plan.warnings.join(" ")).toMatch(/disabled; it swallows the touch/);
  });

  it("refuses a target the overlay covers completely", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">
        ${row("Display", "[0,2200][1080,2260]", "[741,2210][891,2250]")}
        <node class="android.widget.LinearLayout" resource-id="sheet" clickable="true"
          enabled="true" bounds="[0,2100][1080,2340]" />
      </node>
    </hierarchy>`);
    const plan = planTap(nodes, nodes[2]!);

    expect(plan.tappable).toBe(false);
    expect(plan.tap).toBeUndefined();
    expect(plan.occludedBy).toMatchObject({ resourceId: "sheet" });
    expect(plan.warnings.join(" ")).toMatch(/fully covered/);
  });

  it("refuses a node scrolled past the display edge", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">
        ${row("Offscreen", "[0,2400][1080,2600]", "[48,2450][300,2500]")}
      </node>
    </hierarchy>`);
    const plan = planTap(nodes, nodes[2]!);

    expect(plan.tappable).toBe(false);
    expect(plan.warnings.join(" ")).toMatch(/off-screen; scroll it into view/);
  });

  it("warns when only a nested control is reachable", () => {
    const nodes = parseUiNodes(`<hierarchy>
      <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">
        <node class="android.widget.LinearLayout" clickable="true" enabled="true" bounds="[0,100][1080,300]">
          <node class="android.widget.TextView" text="Wi-Fi" bounds="[48,180][300,220]" />
          <node class="android.widget.Switch" content-desc="Wi-Fi toggle" clickable="true"
            enabled="true" bounds="[0,100][1080,300]" />
        </node>
      </node>
    </hierarchy>`);
    const plan = planTap(nodes, nodes[2]!);

    expect(plan.tappable).toBe(true);
    expect(plan.warnings.join(" ")).toMatch(/nested Switch "Wi-Fi toggle"/);
  });

  it("flags a branch with no clickable node at all", () => {
    const nodes = parseUiNodes(
      `<hierarchy><node class="android.widget.TextView" text="Label" bounds="[0,0][100,100]" /></hierarchy>`,
    );
    const plan = planTap(nodes, nodes[0]!);

    expect(plan).toMatchObject({
      tappable: true,
      tap: { x: 50, y: 50, via: "unhandled" },
    });
    expect(plan.warnings.join(" ")).toMatch(/undeclared touch handler/);
  });

  /**
   * An elevated app bar is reported before the list it covers, so document
   * order alone puts the covered row on top. Real dumps carry `drawing-order`
   * for exactly this case.
   */
  it("honours drawing-order when it contradicts document order", () => {
    const xml = (appBarOrder: number, listOrder: number): string =>
      `<hierarchy>
        <node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]" drawing-order="1">
          <node class="android.widget.LinearLayout" resource-id="app_bar" clickable="true"
            enabled="true" bounds="[0,0][1080,420]" drawing-order="${appBarOrder}" />
          <node class="android.widget.LinearLayout" clickable="true" enabled="true"
            bounds="[0,300][1080,500]" drawing-order="${listOrder}">
            <node class="android.widget.TextView" text="Row" bounds="[40,340][300,460]" />
          </node>
        </node>
      </hierarchy>`;

    const covered = parseUiNodes(xml(2, 1));
    const notCovered = parseUiNodes(xml(1, 2));

    expect(covered.map((node) => node.paintIndex)).toEqual([0, 3, 1, 2]);
    expect(planTap(covered, covered[3]!)).toMatchObject({
      tap: { x: 540, y: 460, via: "ancestor", adjusted: true },
      occludedBy: { resourceId: "app_bar" },
    });
    // Same geometry, app bar underneath: the row's own centre stays valid.
    const under = planTap(notCovered, notCovered[3]!);
    expect(under.tap).toMatchObject({ x: 540, y: 400, adjusted: false });
    expect(under.occludedBy).toBeUndefined();
  });

  it("hit-tests a subset against the whole hierarchy", () => {
    const nodes = parseUiNodes(settingsHome);
    const label = findUiNodes(nodes, { text: "الشاشة" })[0]!;
    const row = nodes.find(
      (node) => node.clickable && node.bounds?.top === 2196,
    );

    // Planning one node still sees the overlay that is not in the subset.
    const matches = withTapPlans(nodes, [label]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.tap?.nodeIndex).toBe(row?.nodeIndex);
    expect(matches[0]?.occludedBy?.resourceId).toBe(
      "com.android.settings:id/search_plate",
    );
  });

  it("paints a companion child above its parent", () => {
    const nodes = uiNodesFromCompanion({
      nodes: [
        {
          parentIndex: -1,
          drawingOrder: 5,
          className: "root",
          clickable: true,
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
        },
        {
          parentIndex: 0,
          drawingOrder: 1,
          className: "child",
          clickable: true,
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
        },
      ],
    });

    expect(nodes[1]?.paintIndex).toBeGreaterThan(nodes[0]?.paintIndex ?? 0);
  });

  it("keeps companion window order when root drawing orders disagree", () => {
    const nodes = uiNodesFromCompanion({
      nodes: [
        { parentIndex: -1, drawingOrder: 2, className: "bottom" },
        { parentIndex: -1, drawingOrder: 1, className: "top" },
      ],
    });

    expect(nodes[1]?.paintIndex).toBeGreaterThan(nodes[0]?.paintIndex ?? 0);
  });
});
