// A small QR code maker for the mailed grade letters (mail.js): byte mode, error correction level M, versions 1 to 6
// (up to 106 characters, plenty for a link). Written here from the QR specification (ISO/IEC 18004) so the Worker
// needs no outside package. qrMatrix gives the modules (true = dark); qrSvg draws them with a 4-module quiet zone.
const RAW = [0, 26, 44, 70, 100, 134, 172];        // codewords per version
const ECC = [0, 10, 16, 26, 18, 24, 16];           // error-correction codewords per block, level M
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];              // blocks, level M
const ALIGN = [0, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function divisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
    root = gfMul(root, 2);
  }
  return r;
}
function remainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
  return r;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let ver = 0;
  for (let v = 1; v <= 6; v++) { const cap = RAW[v] - ECC[v] * BLOCKS[v]; if (4 + 8 + bytes.length * 8 <= cap * 8) { ver = v; break; } }
  if (!ver) throw new Error('too long for a small QR code');
  const dataCap = RAW[ver] - ECC[ver] * BLOCKS[ver];
  // Bits: byte mode, the length, the bytes, a terminator, then padding.
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xEC; data.length < dataCap; pad ^= 0xEC ^ 0x11) data.push(pad);
  // Error correction per block, then interleaved.
  const nb = BLOCKS[ver], el = ECC[ver], raw = RAW[ver], shortN = nb - raw % nb, shortLen = Math.floor(raw / nb), div = divisor(el);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - el + (i < shortN ? 0 : 1)); k += dat.length;
    const ecc = remainder(dat, div);
    if (i < shortN) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const words = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= shortN) words.push(b[i]); });

  const size = 17 + 4 * ver;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = ALIGN[ver], last = al.length - 1;
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = mask => {
    const d = (0 << 3) | mask;             // level M is 00
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  // The codewords, in the zigzag order.
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && n < words.length * 8) { m[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
    }
  }
  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
  ];
  const flip = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x]; };
  // Pick the mask with the lowest penalty (long runs, 2x2 blocks, uneven dark share), as scanners prefer.
  const penalty = () => {
    let p = 0, dark = 0;
    for (let a = 0; a < size; a++) {
      let rr = 1, rc = 1;
      for (let b = 1; b < size; b++) {
        if (m[a][b] === m[a][b - 1]) rr++; else { if (rr >= 5) p += rr - 2; rr = 1; }
        if (m[b][a] === m[b - 1][a]) rc++; else { if (rc >= 5) p += rc - 2; rc = 1; }
      }
      if (rr >= 5) p += rr - 2; if (rc >= 5) p += rc - 2;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestP = Infinity;
  for (let k = 0; k < 8; k++) { flip(k); format(k); const p = penalty(); if (p < bestP) { bestP = p; best = k; } flip(k); }
  flip(best); format(best);
  return m;
}

// An SVG of the code, black on white, with the quiet zone scanners need.
export function qrSvg(text, label) {
  const m = qrMatrix(text), size = m.length, q = 4;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) d += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (size + 2 * q) + ' ' + (size + 2 * q) + '" shape-rendering="crispEdges" role="img" aria-label="' + String(label || 'QR code').replace(/[<>&"]/g, '') + '"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
