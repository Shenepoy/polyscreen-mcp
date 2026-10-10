import { spawn } from "node:child_process";

import type { AndroidDisplay } from "./types.js";

/** Longest edge of a screenshot returned to an agent. Larger captures are downscaled. */
export const SCREENSHOT_MAX_EDGE = 1280;

export interface PngSize {
  width: number;
  height: number;
}

export interface ScreenshotCoordinateSpace {
  imageWidth: number;
  imageHeight: number;
  displayWidth?: number;
  displayHeight?: number;
  /** Multiply a screenshot x pixel by this to get a logical input x. */
  scaleX?: number;
  /** Multiply a screenshot y pixel by this to get a logical input y. */
  scaleY?: number;
}

/** Read width and height from a PNG IHDR. The rest of the file is ignored. */
export function pngSize(png: Buffer): PngSize {
  if (
    png.length < 24 ||
    !png.subarray(1, 4).equals(Buffer.from("PNG")) ||
    png.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("screencap PNG is missing an IHDR header");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * How to turn a pixel in the returned screenshot into the logical coordinates
 * `mobile_input_tap` expects. Scale is 1 when screencap matches the display.
 */
export function screenshotCoordinateSpace(
  png: Buffer,
  display: Pick<AndroidDisplay, "width" | "height">,
): ScreenshotCoordinateSpace {
  const image = pngSize(png);
  const space: ScreenshotCoordinateSpace = {
    imageWidth: image.width,
    imageHeight: image.height,
  };
  if (
    display.width === undefined ||
    display.height === undefined ||
    image.width === 0 ||
    image.height === 0
  ) {
    return space;
  }
  space.displayWidth = display.width;
  space.displayHeight = display.height;
  space.scaleX = display.width / image.width;
  space.scaleY = display.height / image.height;
  return space;
}

export function fitScreenshotSize(
  width: number,
  height: number,
  maxEdge = SCREENSHOT_MAX_EDGE,
): PngSize {
  const edge = Math.max(width, height);
  if (edge <= maxEdge || edge === 0) return { width, height };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Downscale a screenshot so the image an agent sees is smaller than the
 * display, and `screenshotCoordinateSpace` is the conversion back. The
 * original bytes are returned when the image is already small or ffmpeg fails.
 */
export async function downscaleScreenshot(
  png: Buffer,
  signal?: AbortSignal,
): Promise<{ png: Buffer; downscaled: boolean }> {
  signal?.throwIfAborted();
  const size = pngSize(png);
  const fitted = fitScreenshotSize(size.width, size.height);
  if (fitted.width === size.width && fitted.height === size.height) {
    return { png, downscaled: false };
  }
  try {
    const scaled = await ffmpegScalePng(
      png,
      fitted.width,
      fitted.height,
      signal,
    );
    const actual = pngSize(scaled);
    return {
      png: scaled,
      downscaled: actual.width !== size.width || actual.height !== size.height,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { png, downscaled: false };
  }
}

function ffmpegScalePng(
  png: Buffer,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vf",
        `scale=${width}:${height}`,
        "-f",
        "image2",
        "-c:v",
        "png",
        "pipe:1",
      ],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const clock = {
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    const onAbort = (): void => fail(new Error("ffmpeg scale aborted"));
    const stopWaiting = (): void => {
      if (clock.timer) clearTimeout(clock.timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      stopWaiting();
      child.kill("SIGKILL");
      reject(error);
    };
    clock.timer = setTimeout(
      () => fail(new Error("ffmpeg scale timed out")),
      15_000,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    const ignoreStreamError = (): void => undefined;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.on("error", ignoreStreamError);
    child.stderr.on("error", ignoreStreamError);
    child.stdin.on("error", ignoreStreamError);
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      stopWaiting();
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg scale failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout));
    });
    child.stdin.end(png);
  });
}
