"use strict";

const ScreenshotMedia = (() => {
  function canvas(width, height) {
    const image = document.createElement("canvas");
    image.width = width;
    image.height = height;
    return image;
  }

  async function decodeImage(blob, name) {
    try {
      return await createImageBitmap(blob);
    } catch (bitmapError) {
      // SVG and some ICO variants are only available through the image element.
      if (/\.svg$/i.test(name) && blob.type !== "image/svg+xml") {
        blob = blob.slice(0, blob.size, "image/svg+xml");
      }
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  return { canvas, decodeImage };
})();
