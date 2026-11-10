"use strict";

const ScreenshotElements = (() => {
  const contrast = 18;
  const componentLimit = 2400;

  function differs(data, index, background) {
    const alpha = data[index + 3];
    const opacity = alpha / 255;
    return Math.abs(alpha - background.a) >= contrast
      || Math.abs(data[index] * opacity - background.r) >= contrast
      || Math.abs(data[index + 1] * opacity - background.g) >= contrast
      || Math.abs(data[index + 2] * opacity - background.b) >= contrast;
  }

  function sampleBackground({ data, width }, { l, t, r, b }) {
    const samples = [];
    const step = Math.max(1, Math.floor(Math.max(r - l, b - t) / 64));
    for (let x = l; x < r; x += step) {
      samples.push((t * width + x) * 4, ((b - 1) * width + x) * 4);
    }
    for (let y = t + 1; y < b - 1; y += step) {
      samples.push((y * width + l) * 4, (y * width + r - 1) * 4);
    }
    const bins = new Map();
    let mode;
    for (const index of samples) {
      const a = data[index + 3];
      const opacity = a / 255;
      const r = data[index] * opacity;
      const g = data[index + 1] * opacity;
      const b = data[index + 2] * opacity;
      const key = ((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0, a: 0 };
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.a += a;
      bins.set(key, bin);
      if (!mode || bin.count > mode.count) mode = bin;
    }
    const background = { r: mode.r / mode.count, g: mode.g / mode.count, b: mode.b / mode.count, a: mode.a / mode.count };
    const coverage = samples.filter(index => !differs(data, index, background)).length / samples.length;
    return { background, coverage };
  }

  function components({ data, width }, area, background) {
    const w = area.r - area.l;
    const h = area.b - area.t;
    const foreground = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let index = ((area.t + y) * width + area.l) * 4;
      for (let x = 0; x < w; x++, index += 4) {
        foreground[y * w + x] = differs(data, index, background);
      }
    }
    const stack = new Int32Array(foreground.length);
    const result = [];
    const dots = [];
    for (let start = 0; start < foreground.length; start++) {
      if (!foreground[start]) continue;
      let size = 1;
      let count = 0;
      let l = w, t = h, r = 0, b = 0;
      stack[0] = start;
      foreground[start] = 0;
      while (size) {
        const pixel = stack[--size];
        const x = pixel % w;
        const y = (pixel / w) | 0;
        l = Math.min(l, x);
        t = Math.min(t, y);
        r = Math.max(r, x + 1);
        b = Math.max(b, y + 1);
        count++;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
            const next = ny * w + nx;
            if (!foreground[next]) continue;
            foreground[next] = 0;
            stack[size++] = next;
          }
        }
      }
      const cw = r - l;
      const ch = b - t;
      if (count < 2 || (ch <= 2 && cw >= 32) || (cw <= 2 && ch >= 32)) continue;
      const region = { l: l + area.l, t: t + area.t, r: r + area.l, b: b + area.t, count };
      if (cw <= 3 && ch <= 3) {
        // Keep punctuation on ordinary screenshots and ignore dense dot patterns.
        if (dots.length <= 160) dots.push(region);
        continue;
      }
      result.push(region);
      if (result.length > componentLimit) return [];
    }
    return dots.length <= 160 ? result.concat(dots) : result;
  }

  function groupText(regions, maxHeight) {
    const letters = regions.filter(({ l, t, r, b }) => b - t <= maxHeight && r - l <= 4 * (b - t))
      .sort((a, b) => a.l - b.l);
    const parent = letters.map((_, index) => index);
    function root(index) {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    }
    for (const [index, a] of letters.entries()) {
      const height = a.b - a.t;
      for (let j = index + 1; j < letters.length && letters[j].l <= a.r + height; j++) {
        const b = letters[j];
        const short = Math.min(height, b.b - b.t);
        const tall = Math.max(height, b.b - b.t);
        const overlap = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        const sameLine = short >= tall * 0.45 && overlap >= short * 0.5
          && Math.abs(a.b - b.b) <= Math.max(2, tall * 0.35)
          && b.l - a.r <= Math.max(2, short * 0.85);
        const dot = short <= 3 && b.l < a.r && overlap >= -Math.max(2, tall * 0.35);
        if (sameLine || dot) parent[root(j)] = root(index);
      }
    }
    const grouped = new Map();
    for (const [index, part] of letters.entries()) {
      const key = root(index);
      const line = grouped.get(key);
      grouped.set(key, line ? {
        l: Math.min(line.l, part.l), t: Math.min(line.t, part.t),
        r: Math.max(line.r, part.r), b: Math.max(line.b, part.b), count: line.count + part.count
      } : part);
    }
    const letterSet = new Set(letters);
    return regions.filter(region => !letterSet.has(region)).concat([...grouped.values()]);
  }

  function findRegions(pixels, area, scale, depth = 0) {
    const { background, coverage } = sampleBackground(pixels, area);
    if (coverage < (depth ? 0.65 : 0.45)) return [];
    const found = components(pixels, area, background);
    if (!depth && coverage < 0.7 && found.some(({ l, t, r, b }) => (r - l) * (b - t) > pixels.width * pixels.height * 0.7)) {
      return [];
    }
    const regions = [];
    for (const region of found) {
      const { l, t, r, b } = region;
      if (depth < 2 && r - l >= 90 * scale && b - t >= 54 * scale) {
        // Sample a card's interior separately from the page and its border.
        const inset = Math.max(2, Math.round(3 * scale));
        const inner = { l: l + inset, t: t + inset, r: r - inset, b: b - inset };
        const inside = findRegions(pixels, inner, scale, depth + 1).filter(part =>
          part.count >= 12 && part.l > inner.l && part.t > inner.t && part.r < inner.r && part.b < inner.b);
        if (inside.length >= 2) {
          regions.push(...inside);
          continue;
        }
      }
      regions.push(region);
    }
    return groupText(regions, Math.max(12, 34 * scale));
  }

  function paddingRoom(a, b) {
    const left = a.content.l <= b.content.l ? a : b;
    const right = left === a ? b : a;
    const top = a.content.t <= b.content.t ? a : b;
    const bottom = top === a ? b : a;
    const xGap = right.content.l - left.content.r;
    const yGap = bottom.content.t - top.content.b;
    if (xGap >= yGap) {
      const middle = left.content.r + Math.floor(xGap / 2);
      left.bounds.r = Math.min(left.bounds.r, middle);
      right.bounds.l = Math.max(right.bounds.l, middle);
    } else {
      const middle = top.content.b + Math.floor(yGap / 2);
      top.bounds.b = Math.min(top.bounds.b, middle);
      bottom.bounds.t = Math.max(bottom.bounds.t, middle);
    }
  }

  function detect(pixels) {
    const { width, height } = pixels;
    const area = { l: 0, t: 0, r: width, b: height };
    const scale = Math.max(0.5, width / 960);
    const regions = findRegions(pixels, area, scale)
      .filter(({ count, l, t, r, b }) => count >= 6 && (r - l > 2 || b - t > 2))
      .sort((a, b) => b.count - a.count || ScreenshotBoxes.byPosition(a, b));
    const boxes = [];
    for (const region of regions) {
      if (boxes.some(box => ScreenshotBoxes.overlaps(box.content, region))) continue;
      const { l, t, r, b } = region;
      const box = { content: { l, t, r, b }, bounds: { ...area } };
      for (const other of boxes) paddingRoom(box, other);
      boxes.push(box);
      if (boxes.length === 100) break;
    }
    return boxes.length ? boxes : null;
  }

  return { detect };
})();
