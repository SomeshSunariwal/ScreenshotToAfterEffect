"use strict";

const ScreenshotAE = (() => {
  const cep = window.__adobe_cep__;
  const nodeRequire = window.cep_node ? window.cep_node.require : window.require;
  const native = Boolean(cep && nodeRequire);
  const fs = native && nodeRequire("fs").promises;
  const path = native && nodeRequire("path");
  const os = native && nodeRequire("os");

  const { canvas, decodeImage } = ScreenshotMedia;

  function host(action, ...args) {
    const script = JSON.stringify(args).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return new Promise((resolve, reject) => {
      cep.evalScript(`Screenshot2AE.run(${JSON.stringify(action)}, ${script})`, result => {
        if (typeof result === "string" && result.startsWith("ok\n")) resolve(result.slice(3));
        else reject(new Error(typeof result === "string" && result.startsWith("error\n")
          ? result.slice(6) : "After Effects did not respond. Reopen the Screenshot2AE panel and try again."));
      });
    });
  }

  async function loadNativeImage(output) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const bytes = await fs.readFile(output);
        return await decodeImage(new Blob([bytes], { type: "image/png" }), output);
      } catch (error) {
        if (attempt === 19) {
          throw new Error("After Effects did not write a readable PNG. Check Scripting & Expressions preferences for file-write access.");
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  async function withScratch(action) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "Screenshot2AE-"));
    try {
      return await action(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function writePng(image, filename) {
    const blob = await new Promise(resolve => image.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not write a PNG. Try selecting a smaller region.");
    await fs.writeFile(filename, new Uint8Array(await blob.arrayBuffer()));
  }

  async function createLayers({ source, region, boxes: rectangles, animation }) {
    const { l, t, r, b } = region;
    const width = r - l;
    const height = b - t;
    if (width > 30000 || height > 30000 || width * height > 64000000) {
      throw new Error("Select a smaller region to create layers (up to 64 megapixels, 30,000 px per side).");
    }
    const documents = cep.getSystemPath("myDocuments");
    const base = documents && documents.startsWith("file:") ? nodeRequire("url").fileURLToPath(documents)
      : documents || path.join(os.homedir(), "Documents");
    const assets = path.join(base, "Screenshot2AE Assets");
    await fs.mkdir(assets, { recursive: true });
    const dir = await fs.mkdtemp(path.join(assets, "Layers-"));

    try {
      const plate = canvas(width, height);
      const plateContext = plate.getContext("2d", { willReadFrequently: true });
      plateContext.drawImage(source.image, l, t, width, height, 0, 0, width, height);
      const pixels = plateContext.getImageData(0, 0, width, height);
      const original = pixels.data.slice();
      const boxes = [];
      const cutout = canvas(1, 1);
      for (const [index, box] of rectangles.entries()) {
        const filename = path.join(dir, `Box-${String(index + 1).padStart(2, "0")}.png`);
        cutout.width = box.r - box.l;
        cutout.height = box.b - box.t;
        const context = cutout.getContext("2d", { willReadFrequently: true });
        context.drawImage(plate, box.l, box.t, cutout.width, cutout.height, 0, 0, cutout.width, cutout.height);
        ScreenshotBoxes.fillBox(pixels, original, box, context.getImageData(0, 0, cutout.width, cutout.height).data);
        await writePng(cutout, filename);
        boxes.push({ path: filename, x: box.l, y: box.t });
      }
      plateContext.putImageData(pixels, 0, 0);
      const background = path.join(dir, "Background.png");
      await writePng(plate, background);
      return await host("create", {
        name: source.name, width, height, boxes, background, animation
      });
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }


  async function decodeFile(file) {
    return await withScratch(async dir => {
      const output = path.join(dir, "decoded.png");
      const extension = (file.name.match(/\.[a-z0-9]{1,12}$/i) || [""])[0];
      const source = file.path || path.join(dir, "source" + extension);
      if (!file.path) await fs.writeFile(source, new Uint8Array(await file.arrayBuffer()));
      try {
        await host("decode", source, output);
      } catch (error) {
        throw new Error(`After Effects could not decode “${file.name}”. ${error.message}`);
      }
      return await loadNativeImage(output);
    });

  }

  async function loadSelectedImage() {
    const [itemId, encodedPath, encodedName] = (await host("selectedImage")).split("\n");
    const source = decodeURIComponent(encodedPath);
    const name = decodeURIComponent(encodedName);
    let image;
    try {
      const bytes = await fs.readFile(source);
      image = await decodeImage(new Blob([bytes]), source);
    } catch (error) {
      image = await withScratch(async dir => {
        const output = path.join(dir, "decoded.png");
        await host("renderSelectedImage", Number(itemId), source, output);
        return await loadNativeImage(output);
      });
    }
    return { image, name };
  }

  return { available: native, decodeFile, loadSelectedImage, createLayers };
})();
