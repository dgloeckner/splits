// Generates the two regression PNG fixtures for the e2e-critic.
//
// empty-canvas.png       — 256x160, mostly black canvas with a thin grey
//                          "stat bar" strip across the top. Represents the
//                          historical empty-canvas regression (PRD-0015 /
//                          0015-01): race surface mounted, no boat drawn.
//
// race-canvas-visible.png — same dimensions, same stat bar, plus a solid
//                          coloured horizontal band (representing lane
//                          markings) and a small bright rectangle near the
//                          left edge (representing the user boat at the
//                          start line).
//
// Both PNGs are hand-built as raw 8-bit RGBA via Node's zlib — no external
// deps — and end up well under 10 KB.
//
// Run:  node make-fixtures.mjs

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WIDTH = 256;
const HEIGHT = 160;

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(pixels, width, height) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR: 8-bit RGBA
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  ihdr[10] = 0;     // compression
  ihdr[11] = 0;     // filter
  ihdr[12] = 0;     // interlace
  // IDAT: prepend filter byte (0) to each scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makePixels(fillFn) {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const i = (y * WIDTH + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
}

// Stat bar: top 16 px, mid-grey. Canvas area: black.
function emptyCanvas(x, y) {
  if (y < 16) return [60, 60, 70, 255];
  return [0, 0, 0, 255];
}

// Same stat bar, plus:
//   - horizontal lane band at y = 96..104 in dim blue
//   - a small bright cyan boat rectangle at x = 24..40, y = 92..108
function raceCanvasVisible(x, y) {
  if (y < 16) return [60, 60, 70, 255];
  if (y >= 96 && y <= 104) return [30, 60, 130, 255];
  if (x >= 24 && x <= 40 && y >= 92 && y <= 108) return [80, 220, 240, 255];
  return [0, 0, 0, 255];
}

writeFileSync(join(__dirname, 'empty-canvas.png'), encodePng(makePixels(emptyCanvas), WIDTH, HEIGHT));
writeFileSync(join(__dirname, 'race-canvas-visible.png'), encodePng(makePixels(raceCanvasVisible), WIDTH, HEIGHT));

console.log('wrote empty-canvas.png and race-canvas-visible.png');
