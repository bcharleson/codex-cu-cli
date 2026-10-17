// Corrects Computer Use screenshots of windows on lower-resolution displays.
//
// With mixed displays (e.g. a 2× Retina laptop plus a 1× external monitor),
// the service captures a window on the 1× display at 1× but returns it in a
// canvas sized for 2×, with the window in the top-left corner. Clicks use the
// full canvas, so coordinates read off the image land at half the distance.
// This rescales such screenshots to fill the canvas, so screenshot pixels and
// click coordinates agree again. When every display has the same scale it
// does nothing.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Screens (in top-left global coordinates, like CGWindowList) and on-screen
// app windows with their owners.
const LAYOUT_JXA = `
ObjC.import('AppKit'); ObjC.import('CoreGraphics');
const scr = $.NSScreen.screens, mainH = scr.objectAtIndex(0).frame.size.height, screens = [];
for (let i = 0; i < scr.count; i++) {
  const s = scr.objectAtIndex(i), f = s.frame;
  screens.push({ x: f.origin.x, y: mainH - (f.origin.y + f.size.height), w: f.size.width, h: f.size.height, scale: s.backingScaleFactor });
}
const windows = [];
for (const w of ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)))) {
  if (w.kCGWindowLayer !== 0) continue;
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(w.kCGWindowOwnerPID);
  const b = w.kCGWindowBounds;
  windows.push({ name: w.kCGWindowOwnerName, bundle: app.isNil() ? '' : ObjC.unwrap(app.bundleIdentifier), x: b.X, y: b.Y, w: b.Width, h: b.Height });
}
JSON.stringify({ screens, windows });`;

async function layout() {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', LAYOUT_JXA], { timeout: 5000 });
  return JSON.parse(stdout);
}

export async function hasMixedScales() {
  try { return new Set((await layout()).screens.map(s => s.scale)).size > 1; }
  catch { return false; }
}

export function imageSize(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i + 3 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + length;
  }
  return null;
}

// How much larger the canvas is than the captured window, or 1 if they match.
// `apps` are names or bundle ids the session has bound with cua.getApp().
export function shrinkFactor([width, height], { screens, windows }, apps) {
  const wanted = new Set([...apps].map(a => a.toLowerCase()));
  const candidates = windows.filter(
    w => wanted.has(w.name.toLowerCase()) || wanted.has(w.bundle.toLowerCase()),
  );
  const factors = new Set();
  for (const win of candidates) {
    const canvasScale = width / win.w;
    // The canvas is the window at some uniform scale.
    if (Math.abs(height / win.h - canvasScale) > 0.02 * canvasScale) continue;
    const cx = win.x + win.w / 2, cy = win.y + win.h / 2;
    const screen = screens.find(s => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h);
    if (!screen) continue;
    const factor = canvasScale / screen.scale;
    factors.add(factor > 1.05 ? Math.round(factor * 100) / 100 : 1);
  }
  return factors.size === 1 ? [...factors][0] : 1;
}

// Crops the window out of the top-left of the canvas and scales it up to fill
// the canvas, using Core Graphics (sips crop offsets proved unreliable).
const RESCALE_JXA = `
ObjC.import('AppKit'); ObjC.import('CoreGraphics'); ObjC.import('ImageIO');
function run(argv) {
  const [src, out, cw, ch, W, H] = [argv[0], argv[1], +argv[2], +argv[3], +argv[4], +argv[5]];
  const img = $.CGImageSourceCreateImageAtIndex($.CGImageSourceCreateWithURL($.NSURL.fileURLWithPath(src), null), 0, null);
  const crop = $.CGImageCreateWithImageInRect(img, $.CGRectMake(0, 0, cw, ch));
  const ctx = $.CGBitmapContextCreate(null, W, H, 8, 0, $.CGColorSpaceCreateDeviceRGB(), $.kCGImageAlphaPremultipliedLast);
  $.CGContextSetInterpolationQuality(ctx, $.kCGInterpolationHigh);
  $.CGContextDrawImage(ctx, $.CGRectMake(0, 0, W, H), crop);
  const rep = $.NSBitmapImageRep.alloc.initWithCGImage($.CGBitmapContextCreateImage(ctx));
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG, $({ NSImageCompressionFactor: 0.9 })).writeToFileAtomically(out, true);
}`;

async function rescale(buf, [width, height], factor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-'));
  const src = path.join(dir, buf[0] === 0x89 ? 'in.png' : 'in.jpg');
  const out = path.join(dir, 'out.jpg');
  try {
    fs.writeFileSync(src, buf);
    const cw = Math.round(width / factor), ch = Math.round(height / factor);
    await run('osascript', ['-l', 'JavaScript', '-e', RESCALE_JXA, src, out, String(cw), String(ch), String(width), String(height)], { timeout: 5000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Rescales the image items of a tools/call result in place. Never throws: on
// any failure the original screenshot is kept.
export async function fixScreenshots(result, apps, log) {
  if (!Array.isArray(result?.content) || apps.size === 0) return;
  const images = result.content.filter(c => c.type === 'image' && typeof c.data === 'string');
  if (images.length === 0) return;
  try {
    const current = await layout();
    if (new Set(current.screens.map(s => s.scale)).size < 2) return;
    for (const item of images) {
      const buf = Buffer.from(item.data, 'base64');
      const size = imageSize(buf);
      if (!size) continue;
      const factor = shrinkFactor(size, current, apps);
      if (factor === 1) continue;
      item.data = (await rescale(buf, size, factor)).toString('base64');
      item.mimeType = 'image/jpeg';
      log(`rescaled a ${size[0]}x${size[1]} screenshot by ${factor}× (window on a lower-resolution display)`);
    }
  } catch (err) {
    log(`screenshot scale fix skipped: ${err.message}`);
  }
}
