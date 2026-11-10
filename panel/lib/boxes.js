"use strict";

const ScreenshotBoxes = (() => {
  // Compare neighboring pixels and discard long, straight edges such as UI dividers.
  function findInk({ data, width, height }, keepLongEdges) {
    const stride = width + 1;
    const ink = new Uint8Array(width * height);

    function markEdges(lines, length, lineStep, runStep, maxRun) {
      const edges = new Uint8Array(length);
      for (let line = 1; line < lines; line++) {
        for (let i = 0; i < length; i++) {
          const pixel = line * lineStep + i * runStep;
          const a = pixel * 4;
          const b = (pixel - lineStep) * 4;
          const alpha = data[a + 3] / 255;
          const otherAlpha = data[b + 3] / 255;
          edges[i] = Math.max(
            Math.abs(data[a + 3] - data[b + 3]),
            Math.abs(data[a] * alpha - data[b] * otherAlpha),
            Math.abs(data[a + 1] * alpha - data[b + 1] * otherAlpha),
            Math.abs(data[a + 2] * alpha - data[b + 2] * otherAlpha)
          ) >= 24 ? 1 : 0;
        }
        let start = -1;
        let last = -1;
        for (let i = 0; i < length + 3; i++) {
          if (edges[i]) {
            if (start < 0) start = i;
            last = i;
          }
          if (start < 0 || i - last < 3) continue;
          if (last - start < maxRun) {
            for (let j = start; j <= last; j++) {
              if (!edges[j]) continue;
              const edge = line * lineStep + j * runStep;
              ink[edge] = 1;
              ink[edge - lineStep] = 1;
            }
          }
          start = -1;
        }
      }
    }

    markEdges(height, width, width, 1, keepLongEdges ? width : Math.max(14, width * 0.095));
    markEdges(width, height, 1, width, keepLongEdges ? height : Math.max(14, height * 0.16));

    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += ink[y * width + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    return (l, t, r, b) =>
      integral[b * stride + r] - integral[t * stride + r] -
      integral[b * stride + l] + integral[t * stride + l];
  }

  function splitBoxes(pixels, limit, { keepLongEdges = false } = {}) {
    const { width, height } = pixels;
    const sum = findInk(pixels, keepLongEdges);
    const full = { l: 0, t: 0, r: width, b: height };

    function makeBox(bounds) {
      let { l, t, r, b } = bounds;
      if (!sum(l, t, r, b)) return { content: bounds, bounds };
      while (!sum(l, t, l + 1, b)) l++;
      while (!sum(r - 1, t, r, b)) r--;
      while (!sum(l, t, r, t + 1)) t++;
      while (!sum(l, b - 1, r, b)) b--;

      const content = { l, t, r, b };
      let split;
      for (const horizontal of [true, false]) {
        const start = horizontal ? t : l;
        const end = horizontal ? b : r;
        const cross = horizontal ? r - l : b - t;
        const minimumGap = horizontal ? 4 : Math.max(9, Math.min(20, (end - start) * 0.018));
        const quiet = Math.floor(cross * 0.004);
        let gap = start;
        for (let i = start; i < end; i++) {
          const ink = horizontal ? sum(l, i, r, i + 1) : sum(i, t, i + 1, b);
          if (ink <= quiet) continue;
          if (i - gap >= minimumGap && gap - start >= 5 && end - i >= 5) {
            const middle = Math.floor((gap + i) / 2);
            const a = horizontal ? sum(l, t, r, gap) : sum(l, t, gap, b);
            const c = horizontal ? sum(l, i, r, b) : sum(i, t, r, b);
            const balance = Math.min(a, c) / Math.max(a, c);
            const span = i - gap;
            let gapScore = span * 2;
            if (!horizontal) {
              // Keep columns of a table together when their content shares the same rows.
              let shared = 0;
              let occupied = 0;
              for (let y = t; y < b; y++) {
                const left = sum(l, y, gap, y + 1) > Math.floor((gap - l) * 0.004);
                const right = sum(i, y, r, y + 1) > Math.floor((r - i) * 0.004);
                if (left && right) shared++;
                if (left || right) occupied++;
              }
              gapScore = Math.min(span, 24) * (0.45 + 2 * (1 - shared / Math.max(1, occupied)));
            }
            const score = gapScore * (0.5 + 0.5 * Math.sqrt(balance));
            if (a >= 8 && c >= 8 && (!split || score > split.score)) {
              split = { middle, horizontal, score };
            }
          }
          gap = i + 1;
        }
      }
      return { content, bounds, split };
    }

    const boxes = [makeBox(full)];
    while (boxes.length < limit) {
      let next = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].split && (next < 0 || boxes[i].split.score > boxes[next].split.score)) next = i;
      }
      if (next < 0) break;
      const { bounds, split } = boxes[next];
      const first = { ...bounds, [split.horizontal ? "b" : "r"]: split.middle };
      const second = { ...bounds, [split.horizontal ? "t" : "l"]: split.middle };
      boxes.splice(next, 1, makeBox(first), makeBox(second));
    }
    return boxes;
  }

  function scaleBoxes(boxes, scaleX, scaleY, padding) {
    return boxes.map(({ content, bounds }) => ({
      id: [bounds.l, bounds.t, bounds.r, bounds.b].join(":"),
      l: Math.max(Math.round(bounds.l * scaleX), Math.round(content.l * scaleX) - padding),
      t: Math.max(Math.round(bounds.t * scaleY), Math.round(content.t * scaleY) - padding),
      r: Math.min(Math.round(bounds.r * scaleX), Math.round(content.r * scaleX) + padding),
      b: Math.min(Math.round(bounds.b * scaleY), Math.round(content.b * scaleY) + padding)
    }));
  }

  function suggestPadding(boxes, scaleX, scaleY, maximum) {
    const sizes = boxes.map(({ l, t, r, b }) => Math.min(r - l, b - t)).sort((a, b) => a - b);
    const typicalSize = sizes[Math.floor(sizes.length / 2)] ?? 0;
    return Math.round(Math.min(maximum, typicalSize / 16, 4 * Math.min(scaleX, scaleY)));
  }

  function byPosition(a, b) {
    return a.t - b.t || a.l - b.l;
  }

  function overlaps(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }

  function enclosure(a, b) {
    return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
  }

  function findMerge(groups, limit, protectedAreas, includeOverlaps) {
    const area = box => (box.r - box.l) * (box.b - box.t);
    let best;
    for (let i = 0; i < groups.length - 1; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let box = enclosure(groups[i], groups[j]);
        if (protectedAreas.some(other => overlaps(box, other))) continue;
        const members = [i, j];
        if (includeOverlaps) {
          // If every pair crosses another box, include the boxes it crosses.
          for (let index = 0; index < groups.length; index++) {
            if (members.includes(index) || !overlaps(box, groups[index])) continue;
            box = enclosure(box, groups[index]);
            members.push(index);
            index = -1;
          }
          if (protectedAreas.some(other => overlaps(box, other))) continue;
        } else if (groups.some((other, index) => index !== i && index !== j && overlaps(box, other))) {
          continue;
        }
        const reduction = members.length - 1;
        const overshoot = Math.max(0, limit - (groups.length - reduction));
        const cost = (area(box) - members.reduce((sum, index) => sum + area(groups[index]), 0)) / reduction;
        if (!best || overshoot < best.overshoot || (overshoot === best.overshoot && cost < best.cost)) {
          best = { members, box, cost, overshoot };
        }
      }
    }
    return best;
  }

  function mergeToLimit(boxes, limit, protectedAreas) {
    if (limit === 0) return [];
    if (boxes.length <= limit) return boxes;
    const groups = [...boxes];
    while (groups.length > limit) {
      const best = findMerge(groups, limit, protectedAreas, false)
        || findMerge(groups, limit, protectedAreas, true);
      if (!best) break;
      const { members, box } = best;
      const [first, ...rest] = members.sort((a, b) => a - b);
      groups[first] = { ...box, id: `merge:${box.l}:${box.t}:${box.r}:${box.b}` };
      for (const index of rest.reverse()) groups.splice(index, 1);
    }
    // A protected region can separate groups that cannot share one rectangle.
    return groups.slice(0, limit);
  }

  function roomForBox({ x, y }, bounds, boxes) {
    let room = bounds;
    const area = box => (box.r - box.l) * (box.b - box.t);
    for (const box of boxes) {
      if (!overlaps(room, box)) continue;
      const horizontal = x < box.l ? { ...room, r: box.l }
        : x >= box.r ? { ...room, l: box.r } : null;
      const vertical = y < box.t ? { ...room, b: box.t }
        : y >= box.b ? { ...room, t: box.b } : null;
      if (!horizontal && !vertical) return null;
      room = horizontal && vertical
        ? (area(horizontal) >= area(vertical) ? horizontal : vertical)
        : horizontal || vertical;
    }
    return room;
  }

  function moveBox(box, x, y, regionWidth, regionHeight, boxes) {
    const width = box.r - box.l;
    const height = box.b - box.t;
    let left = Math.max(0, Math.min(regionWidth - width, x));
    let top = Math.max(0, Math.min(regionHeight - height, y));
    for (const other of boxes) {
      if (other.id === box.id || other.t >= box.b || other.b <= box.t) continue;
      if (other.r <= box.l) left = Math.max(left, other.r);
      if (other.l >= box.r) left = Math.min(left, other.l - width);
    }
    for (const other of boxes) {
      if (other.id === box.id || other.l >= left + width || other.r <= left) continue;
      if (other.b <= box.t) top = Math.max(top, other.b);
      if (other.t >= box.b) top = Math.min(top, other.t - height);
    }
    return { ...box, l: left, t: top, r: left + width, b: top + height };
  }

  function resizeBox(box, width, height, regionWidth, regionHeight, boxes, fromTopLeft = false) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    let left = fromTopLeft ? Math.max(0, box.r - w) : box.l;
    let top = fromTopLeft ? Math.max(0, box.b - h) : box.t;
    let right = fromTopLeft ? box.r : Math.min(regionWidth, box.l + w);
    let bottom = fromTopLeft ? box.b : Math.min(regionHeight, box.t + h);
    for (const other of boxes) {
      if (other.id === box.id || other.t >= box.b || other.b <= box.t) continue;
      if (fromTopLeft && other.r <= box.l) left = Math.max(left, other.r);
      if (!fromTopLeft && other.l >= box.r) right = Math.min(right, other.l);
    }
    for (const other of boxes) {
      if (other.id === box.id || other.l >= right || other.r <= left) continue;
      if (fromTopLeft && other.b <= box.t) top = Math.max(top, other.b);
      if (!fromTopLeft && other.t >= box.b) bottom = Math.min(bottom, other.t);
    }
    return { ...box, l: left, t: top, r: right, b: bottom };
  }

  // Keep the original alpha when a cutout is composited back over the plate.
  // An opaque cutout can conceal a fill sampled from the surrounding pixels.
  function fillBox(plate, original, box, cutout) {
    const { l, t, r, b } = box;
    const { data, width, height } = plate;
    let opaque = true;
    for (let i = 3; i < cutout.length; i += 4) {
      if (cutout[i] !== 255) { opaque = false; break; }
    }

    for (let y = t; y < b; y++) {
      for (let x = l; x < r; x++) {
        const target = (y * width + x) * 4;
        data[target + 3] = 0;
        if (!opaque) continue;

        // Extend the nearest opaque edge into the hole.
        let source = -1;
        let distance = Infinity;
        const left = (y * width + l - 1) * 4;
        const right = (y * width + r) * 4;
        const above = ((t - 1) * width + x) * 4;
        const below = (b * width + x) * 4;
        if (l > 0 && original[left + 3] === 255) { source = left; distance = x - l; }
        if (r < width && r - 1 - x < distance && original[right + 3] === 255) { source = right; distance = r - 1 - x; }
        if (t > 0 && y - t < distance && original[above + 3] === 255) { source = above; distance = y - t; }
        if (b < height && b - 1 - y < distance && original[below + 3] === 255) source = below;
        if (source < 0) continue;
        data[target] = original[source];
        data[target + 1] = original[source + 1];
        data[target + 2] = original[source + 2];
        data[target + 3] = 255;
      }
    }
  }

  return { splitBoxes, scaleBoxes, suggestPadding, byPosition, overlaps, mergeToLimit, roomForBox, moveBox, resizeBox, fillBox };
})();
