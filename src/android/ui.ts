export interface UiRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiPoint {
  x: number;
  y: number;
}

export interface UiNode {
  /** Document-order position, and this node's stable identity in the dump. */
  nodeIndex: number;
  /** Document-order position of the parent, or -1 for a hierarchy root. */
  parentIndex: number;
  /**
   * Painting sequence. Higher wins a touch. Document order except where
   * `drawing-order` says a sibling (an elevated app bar, say) draws last.
   */
  paintIndex: number;
  depth: number;
  text: string;
  contentDescription: string;
  resourceId: string;
  className: string;
  packageName: string;
  clickable: boolean;
  longClickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  selected: boolean;
  password: boolean;
  bounds?: UiRect;
  /** Geometric centre of `bounds`. It is not always safe to tap — see `tap`. */
  center?: UiPoint;
}

/** Identifies a node in a hierarchy without repeating its whole payload. */
export interface UiNodeRef {
  nodeIndex: number;
  className: string;
  bounds: UiRect;
  resourceId?: string;
  text?: string;
  contentDescription?: string;
}

export interface UiTapTarget extends UiPoint {
  /** Node that Android will route a tap at this point to. */
  nodeIndex: number;
  /**
   * `self` when the node handles clicks, `ancestor` when a container does, and
   * `unhandled` when no node in the chain is exposed as clickable.
   */
  via: "self" | "ancestor" | "unhandled";
  /** True when the point had to move away from the geometric centre. */
  adjusted: boolean;
}

export interface UiTapPlan {
  tappable: boolean;
  tap?: UiTapTarget;
  /** The clickable node that would swallow a tap on the geometric centre. */
  occludedBy?: UiNodeRef;
  warnings: string[];
}

export type UiMatch = UiNode & UiTapPlan;

// Quoted spans are matched whole so an attribute value may contain ">".
const NODE_TOKEN = /<node\b((?:[^>"]|"[^"]*")*)>|<\/node\s*>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
const BOUNDS = /\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]/;
/** Clearance beyond this is treated as equally safe, so ties fall to the centre. */
const CLEARANCE_CAP = 16;
/** Bounds the search on hierarchies where one node overlaps dozens of controls. */
const MAX_CUT_BLOCKERS = 24;
const MAX_CANDIDATES = 256;

function decodeXml(value: string): string {
  return value
    .replaceAll(/&#x([\da-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function companionText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function companionFlag(value: unknown): boolean {
  return value === true;
}

function companionNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Map a companion `hierarchy` response into the same nodes a UI dump produces. */
export function uiNodesFromCompanion(raw: Record<string, unknown>): UiNode[] {
  if (!Array.isArray(raw.nodes)) {
    throw new Error("Companion hierarchy did not include nodes");
  }
  const drawingOrders: number[] = [];
  const nodes = raw.nodes.map((item, nodeIndex) => {
    if (!item || typeof item !== "object") {
      throw new Error("Companion hierarchy node is not an object");
    }
    const record = item as Record<string, unknown>;
    const boundsRaw = record.bounds;
    const bounds =
      boundsRaw && typeof boundsRaw === "object"
        ? {
            left: companionNumber(
              (boundsRaw as Record<string, unknown>).left,
              0,
            ),
            top: companionNumber((boundsRaw as Record<string, unknown>).top, 0),
            right: companionNumber(
              (boundsRaw as Record<string, unknown>).right,
              0,
            ),
            bottom: companionNumber(
              (boundsRaw as Record<string, unknown>).bottom,
              0,
            ),
          }
        : undefined;
    const parentIndex = companionNumber(record.parentIndex, -1);
    drawingOrders.push(
      parentIndex === -1 ? 0 : companionNumber(record.drawingOrder, 0),
    );
    return {
      nodeIndex,
      parentIndex,
      paintIndex: nodeIndex,
      depth: companionNumber(record.depth, 0),
      text: companionText(record.text),
      contentDescription: companionText(record.contentDescription),
      resourceId: companionText(record.viewId),
      className: companionText(record.className),
      packageName: companionText(record.packageName),
      clickable: companionFlag(record.clickable),
      longClickable: companionFlag(record.longClickable),
      enabled: companionFlag(record.enabled),
      focusable: companionFlag(record.focusable),
      focused: companionFlag(record.focused),
      scrollable: companionFlag(record.scrollable),
      checkable: companionFlag(record.checkable),
      checked: companionFlag(record.checked),
      selected: companionFlag(record.selected),
      password: companionFlag(record.password),
      ...(bounds
        ? {
            bounds,
            center: {
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            },
          }
        : {}),
    };
  });
  assignPaintOrder(nodes, drawingOrders);
  return nodes;
}

export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const open: number[] = [];
  const drawingOrders: number[] = [];

  for (const token of xml.matchAll(NODE_TOKEN)) {
    if (token[0].startsWith("</")) {
      open.pop();
      continue;
    }
    const inner = token[1] ?? "";
    const attributes = new Map<string, string>();
    for (const attribute of inner.matchAll(ATTRIBUTE)) {
      if (attribute[1] && attribute[2] !== undefined) {
        attributes.set(attribute[1], decodeXml(attribute[2]));
      }
    }
    const flag = (name: string): boolean => attributes.get(name) === "true";
    const bounds = parseBounds(attributes.get("bounds"));
    const node: UiNode = {
      nodeIndex: nodes.length,
      parentIndex: open.at(-1) ?? -1,
      paintIndex: nodes.length,
      depth: open.length,
      text: attributes.get("text") ?? "",
      contentDescription: attributes.get("content-desc") ?? "",
      resourceId: attributes.get("resource-id") ?? "",
      className: attributes.get("class") ?? "",
      packageName: attributes.get("package") ?? "",
      clickable: flag("clickable"),
      longClickable: flag("long-clickable"),
      // Absent `enabled` means the dump predates the attribute, not disabled.
      enabled: attributes.get("enabled") !== "false",
      focusable: flag("focusable"),
      focused: flag("focused"),
      scrollable: flag("scrollable"),
      checkable: flag("checkable"),
      checked: flag("checked"),
      selected: flag("selected"),
      password: flag("password"),
      ...(bounds ? { bounds, center: centerOf(bounds) } : {}),
    };
    nodes.push(node);
    drawingOrders.push(Number(attributes.get("drawing-order") ?? 0));
    if (!inner.trimEnd().endsWith("/")) open.push(node.nodeIndex);
  }

  assignPaintOrder(nodes, drawingOrders);
  return nodes;
}

/**
 * Walks the tree in painting sequence: a parent, then its children in drawing
 * order. Views with elevation are reported before the content they cover, so
 * document order alone would put a floating app bar *under* the list it hides.
 * A sibling group is only reordered when every child carries a distinct
 * positive `drawing-order`, since 0 means the platform did not report one.
 */
function assignPaintOrder(nodes: UiNode[], drawingOrders: number[]): void {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentIndex);
    if (siblings) siblings.push(node.nodeIndex);
    else children.set(node.parentIndex, [node.nodeIndex]);
  }

  const ordered = (parentIndex: number): number[] => {
    const siblings = children.get(parentIndex) ?? [];
    const orders = siblings.map((index) => drawingOrders[index] ?? 0);
    const usable =
      orders.every((order) => order > 0) &&
      new Set(orders).size === orders.length;
    return usable
      ? [...siblings].sort(
          (a, b) => (drawingOrders[a] ?? 0) - (drawingOrders[b] ?? 0),
        )
      : siblings;
  };

  let paintIndex = 0;
  const stack = [...ordered(-1)].reverse();
  while (stack.length > 0) {
    const index = stack.pop()!;
    nodes[index]!.paintIndex = paintIndex++;
    stack.push(...ordered(index).reverse());
  }
}

export function findUiNodes(
  nodes: UiNode[],
  query: {
    text?: string | undefined;
    contentDescription?: string | undefined;
    resourceId?: string | undefined;
    exact?: boolean | undefined;
  },
): UiNode[] {
  const matches = (actual: string, expected: string | undefined): boolean => {
    if (expected === undefined) return true;
    return query.exact
      ? actual === expected
      : actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  };
  return nodes.filter(
    (node) =>
      matches(node.text, query.text) &&
      matches(node.contentDescription, query.contentDescription) &&
      matches(node.resourceId, query.resourceId),
  );
}

/**
 * Screen rectangle covered by the hierarchy. UIAutomator dumps every window of
 * one display, so the union of the roots is the display's usable area.
 */
export function hierarchyViewport(nodes: UiNode[]): UiRect | undefined {
  let viewport: UiRect | undefined;
  for (const node of nodes) {
    if (node.depth !== 0 || !node.bounds) continue;
    viewport = viewport
      ? {
          left: Math.min(viewport.left, node.bounds.left),
          top: Math.min(viewport.top, node.bounds.top),
          right: Math.max(viewport.right, node.bounds.right),
          bottom: Math.max(viewport.bottom, node.bounds.bottom),
        }
      : node.bounds;
  }
  // Nothing is tappable at a negative coordinate, whatever the dump claims.
  return viewport
    ? {
        ...viewport,
        left: Math.max(viewport.left, 0),
        top: Math.max(viewport.top, 0),
      }
    : undefined;
}

/**
 * Works out where to tap so the event reaches `node`.
 *
 * Android routes a touch to the last-painted clickable view under the point, so
 * the geometric centre of a label is the wrong target whenever a container
 * handles the click, an overlay covers the label, or the label is scrolled off
 * the display. Each of those is reported instead of being papered over.
 */
export function planTap(
  nodes: UiNode[],
  node: UiNode,
  options: { viewport?: UiRect | undefined; painted?: UiNode[] } = {},
): UiTapPlan {
  const viewport = options.viewport ?? hierarchyViewport(nodes);
  const painted = options.painted ?? paintedOrder(nodes);
  const warnings: string[] = [];
  if (!node.bounds || isEmpty(node.bounds)) {
    return { tappable: false, warnings: ["Node has no on-screen bounds"] };
  }
  const handlerIndex = clickHandlerFor(nodes, node);
  const target = handlerIndex === undefined ? node : nodes[handlerIndex]!;
  const via =
    handlerIndex === undefined
      ? "unhandled"
      : handlerIndex === node.nodeIndex
        ? "self"
        : "ancestor";
  if (via === "unhandled") {
    warnings.push(
      "No clickable node in this branch; the tap relies on an undeclared touch handler",
    );
  }
  if (!target.enabled) {
    warnings.push(
      "Click target is disabled; it swallows the touch without acting",
    );
  }

  const full = target.bounds!;
  const visible = viewport ? intersect(full, viewport) : full;
  if (isEmpty(visible)) {
    return {
      tappable: false,
      warnings: [
        ...warnings,
        "Target is off-screen; scroll it into view first",
      ],
    };
  }
  if (area(visible) < area(full)) {
    warnings.push("Target is only partially on-screen");
  }

  const naive = centerOf(full);
  const blockers = nodes.filter(
    (candidate): candidate is UiNode & { bounds: UiRect } =>
      candidate.paintIndex > target.paintIndex &&
      swallowsTouch(candidate) &&
      overlaps(candidate.bounds, visible),
  );

  let best: { point: UiPoint; tier: number; clearance: number } | undefined;
  for (const point of candidatePoints(visible, blockers, naive)) {
    const tier = routingTier(nodes, painted, point, target, via);
    if (tier === undefined) continue;
    const clearance = Math.min(
      clearanceOf(point, visible, blockers),
      CLEARANCE_CAP,
    );
    const better =
      !best ||
      tier < best.tier ||
      (tier === best.tier && clearance > best.clearance);
    if (better) best = { point, tier, clearance };
    // Candidates arrive nearest-first, so nothing later can beat a direct hit
    // that already has full clearance.
    if (tier === 0 && clearance >= CLEARANCE_CAP) break;
  }

  // Probe where an agent would tap without this plan: the node's own centre.
  const occluder = occluderOf(nodes, painted, node.center ?? naive, target);
  if (!best) {
    return {
      tappable: false,
      ...(occluder ? { occludedBy: reference(occluder) } : {}),
      warnings: [
        ...warnings,
        occluder
          ? `Target is fully covered by ${label(occluder)}; dismiss it or scroll the target clear`
          : "No point inside the target routes a tap to it",
      ],
    };
  }

  if (best.tier === 1) {
    const hit = hitTest(painted, best.point);
    if (hit !== undefined && hit !== target.nodeIndex) {
      warnings.push(
        `Tap will land on the nested ${label(nodes[hit]!)} inside the target`,
      );
    }
  }
  if (occluder) {
    warnings.push(
      `Node centre is covered by ${label(occluder)}; tap the reported point instead`,
    );
  }
  const adjusted = best.point.x !== naive.x || best.point.y !== naive.y;

  return {
    tappable: true,
    tap: {
      ...best.point,
      nodeIndex: target.nodeIndex,
      via,
      adjusted,
    },
    ...(occluder ? { occludedBy: reference(occluder) } : {}),
    warnings,
  };
}

const FLAGS = [
  "clickable",
  "longClickable",
  "enabled",
  "focusable",
  "focused",
  "scrollable",
  "checkable",
  "checked",
  "selected",
  "password",
] as const satisfies readonly (keyof UiNode)[];

/**
 * Wire shape for MCP responses. Absent means false or empty, which keeps a
 * 500-node snapshot from tripling in size just to repeat `"checked": false`.
 */
export function serializeUiMatches(
  matches: readonly UiMatch[],
): Record<string, unknown>[] {
  return matches.map((match) => {
    const flags = FLAGS.filter((flag) => match[flag]);
    return {
      nodeIndex: match.nodeIndex,
      ref: `@n${match.nodeIndex}`,
      parentIndex: match.parentIndex,
      className: match.className,
      ...(match.text ? { text: match.text } : {}),
      ...(match.contentDescription
        ? { contentDescription: match.contentDescription }
        : {}),
      ...(match.resourceId ? { resourceId: match.resourceId } : {}),
      ...(match.packageName ? { packageName: match.packageName } : {}),
      ...(flags.length > 0 ? { flags } : {}),
      ...(match.bounds ? { bounds: match.bounds, center: match.center } : {}),
      ...(match.tap ? { tap: match.tap } : {}),
      ...(match.tappable ? {} : { tappable: false }),
      ...(match.occludedBy ? { occludedBy: match.occludedBy } : {}),
      ...(match.warnings.length > 0 ? { warnings: match.warnings } : {}),
    };
  });
}

export interface ResolvedUiRef {
  ref: string;
  nodeIndex: number;
  x: number;
  y: number;
}

/**
 * Refs from the latest UI read for one serial and logical display.
 * The next snapshot, find, or wait replaces them.
 */
export class UiRefCache {
  readonly #displays = new Map<string, Map<string, ResolvedUiRef | string>>();

  replace(
    serial: string,
    displayId: number,
    nodes: readonly Record<string, unknown>[],
  ): void {
    const refs = new Map<string, ResolvedUiRef | string>();
    for (const node of nodes) {
      if (typeof node.ref !== "string" || typeof node.nodeIndex !== "number") {
        continue;
      }
      const tap = node.tap;
      if (
        !isRecord(tap) ||
        typeof tap.x !== "number" ||
        typeof tap.y !== "number"
      ) {
        const warnings = Array.isArray(node.warnings)
          ? node.warnings.filter((warning) => typeof warning === "string")
          : [];
        refs.set(
          node.ref,
          warnings.length > 0
            ? `${node.ref} has no tap point. ${warnings.join(" ")}`
            : `${node.ref} has no tap point`,
        );
        continue;
      }
      refs.set(node.ref, {
        ref: node.ref,
        nodeIndex: node.nodeIndex,
        x: tap.x,
        y: tap.y,
      });
    }
    this.#displays.set(`${serial}\0${displayId}`, refs);
  }

  resolve(serial: string, displayId: number, ref: string): ResolvedUiRef {
    const refs = this.#displays.get(`${serial}\0${displayId}`);
    if (!refs) {
      throw new Error(
        `No UI refs for ${serial} display ${displayId}. Call mobile_ui_snapshot or mobile_ui_find first.`,
      );
    }
    const hit = refs.get(ref);
    if (hit === undefined) {
      throw new Error(
        `Unknown ref ${ref} for ${serial} display ${displayId}. Read the UI again; refs last only until the next snapshot, find, or wait.`,
      );
    }
    if (typeof hit === "string") throw new Error(hit);
    return hit;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Attaches a tap plan to each node in `subset`, hit-testing against `nodes`. */
export function withTapPlans(nodes: UiNode[], subset = nodes): UiMatch[] {
  const options = {
    viewport: hierarchyViewport(nodes),
    painted: paintedOrder(nodes),
  };
  return subset.map((node) => ({ ...node, ...planTap(nodes, node, options) }));
}

function parseBounds(value: string | undefined): UiRect | undefined {
  const match = value?.match(BOUNDS);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return undefined;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

/**
 * A clickable view consumes the touch even when disabled — `View.onTouchEvent`
 * returns `clickable` before it checks `ENABLED` — so a greyed-out button still
 * shields whatever sits behind it.
 */
function swallowsTouch(node: UiNode): node is UiNode & { bounds: UiRect } {
  return (
    (node.clickable || node.longClickable) &&
    node.bounds !== undefined &&
    !isEmpty(node.bounds)
  );
}

/** Nearest self-or-ancestor that Android would deliver the click to. */
function clickHandlerFor(nodes: UiNode[], node: UiNode): number | undefined {
  let current: UiNode | undefined = node;
  while (current) {
    if (swallowsTouch(current)) return current.nodeIndex;
    current = current.parentIndex >= 0 ? nodes[current.parentIndex] : undefined;
  }
  return undefined;
}

function isDescendant(
  nodes: UiNode[],
  index: number,
  ancestorIndex: number,
): boolean {
  let current = nodes[index];
  while (current && current.parentIndex >= 0) {
    if (current.parentIndex === ancestorIndex) return true;
    current = nodes[current.parentIndex];
  }
  return false;
}

/** Last-painted clickable node covering `point`, which is what Android hits. */
function hitTest(
  painted: readonly UiNode[],
  point: UiPoint,
): number | undefined {
  for (let index = painted.length - 1; index >= 0; index -= 1) {
    const node = painted[index]!;
    if (swallowsTouch(node) && contains(node.bounds, point))
      return node.nodeIndex;
  }
  return undefined;
}

/** Nodes in painting sequence, so the last match of a scan is the topmost. */
export function paintedOrder(nodes: UiNode[]): UiNode[] {
  return [...nodes].sort((a, b) => a.paintIndex - b.paintIndex);
}

/** 0 when the tap reaches the target itself, 1 when it stays inside it. */
function routingTier(
  nodes: UiNode[],
  painted: readonly UiNode[],
  point: UiPoint,
  target: UiNode,
  via: UiTapTarget["via"],
): number | undefined {
  const hit = hitTest(painted, point);
  if (hit === target.nodeIndex) return 0;
  if (hit === undefined) return via === "unhandled" ? 1 : undefined;
  return isDescendant(nodes, hit, target.nodeIndex) ? 1 : undefined;
}

function occluderOf(
  nodes: UiNode[],
  painted: readonly UiNode[],
  point: UiPoint,
  target: UiNode,
): UiNode | undefined {
  const hit = hitTest(painted, point);
  if (hit === undefined || hit === target.nodeIndex) return undefined;
  // A clickable ancestor would have become the target, so anything else that
  // wins the hit test is painted over the target rather than wrapping it.
  return isDescendant(nodes, hit, target.nodeIndex) ? undefined : nodes[hit];
}

/**
 * Centre of every gap between blocker edges, so a partly covered target still
 * yields a point in the middle of whatever space is left. Ordered nearest-first
 * from the geometric centre and truncated, which keeps busy screens bounded.
 */
function candidatePoints(
  rect: UiRect,
  blockers: readonly (UiNode & { bounds: UiRect })[],
  naive: UiPoint,
): UiPoint[] {
  const cuts = (
    min: number,
    max: number,
    edges: readonly number[],
  ): number[] => {
    const sorted = [
      ...new Set([
        min,
        max,
        ...edges.filter((edge) => edge > min && edge < max),
      ]),
    ].sort((a, b) => a - b);
    const values: number[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      values.push(Math.floor((sorted[index - 1]! + sorted[index]!) / 2));
    }
    return values;
  };

  const nearest = [...blockers]
    .sort(
      (a, b) =>
        distance(centerOf(a.bounds), naive) -
        distance(centerOf(b.bounds), naive),
    )
    .slice(0, MAX_CUT_BLOCKERS);
  const xs = cuts(
    rect.left,
    rect.right,
    nearest.flatMap((blocker) => [blocker.bounds.left, blocker.bounds.right]),
  );
  const ys = cuts(
    rect.top,
    rect.bottom,
    nearest.flatMap((blocker) => [blocker.bounds.top, blocker.bounds.bottom]),
  );

  const points: UiPoint[] = [];
  for (const y of ys) for (const x of xs) points.push({ x, y });
  points.sort((a, b) => distance(a, naive) - distance(b, naive));
  if (contains(rect, naive)) points.unshift(naive);
  return points.slice(0, MAX_CANDIDATES);
}

/** Distance to the nearest blocker or edge; negative inside a blocker. */
function clearanceOf(
  point: UiPoint,
  rect: UiRect,
  blockers: readonly (UiNode & { bounds: UiRect })[],
): number {
  let clearance = Math.min(
    point.x - rect.left,
    rect.right - 1 - point.x,
    point.y - rect.top,
    rect.bottom - 1 - point.y,
  );
  for (const blocker of blockers) {
    const bounds = blocker.bounds;
    clearance = Math.min(
      clearance,
      Math.max(
        bounds.left - point.x,
        point.x - (bounds.right - 1),
        bounds.top - point.y,
        point.y - (bounds.bottom - 1),
      ),
    );
  }
  return clearance;
}

function reference(node: UiNode): UiNodeRef {
  return {
    nodeIndex: node.nodeIndex,
    className: node.className,
    bounds: node.bounds!,
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.text ? { text: node.text } : {}),
    ...(node.contentDescription
      ? { contentDescription: node.contentDescription }
      : {}),
  };
}

function label(node: UiNode): string {
  const name = node.className.split(".").at(-1) || "node";
  const detail =
    node.text || node.contentDescription || node.resourceId || undefined;
  return detail ? `${name} "${detail}"` : name;
}

function centerOf(rect: UiRect): UiPoint {
  return {
    x: Math.round((rect.left + rect.right) / 2),
    y: Math.round((rect.top + rect.bottom) / 2),
  };
}

function intersect(a: UiRect, b: UiRect): UiRect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function overlaps(a: UiRect, b: UiRect): boolean {
  return !isEmpty(intersect(a, b));
}

function contains(rect: UiRect, point: UiPoint): boolean {
  return (
    point.x >= rect.left &&
    point.x < rect.right &&
    point.y >= rect.top &&
    point.y < rect.bottom
  );
}

function isEmpty(rect: UiRect): boolean {
  return rect.right <= rect.left || rect.bottom <= rect.top;
}

function area(rect: UiRect): number {
  return isEmpty(rect)
    ? 0
    : (rect.right - rect.left) * (rect.bottom - rect.top);
}

function distance(a: UiPoint, b: UiPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
