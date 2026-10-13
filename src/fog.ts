// Fog: value noise drawn once into a small canvas, stretched over the page.

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const noise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

export const paintFog = (layers: HTMLElement[]) => {
  const w = 240;
  const h = 150;
  const canvas = Object.assign(document.createElement("canvas"), {
    width: w,
    height: h,
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      let amp = 0.5;
      let freq = 1 / 46;
      for (let o = 0; o < 4; o++) {
        // Stretched sideways, as mist lies.
        n += amp * noise(x * freq, y * freq * 1.7);
        amp *= 0.5;
        freq *= 2;
      }
      const i = (y * w + x) * 4;
      const light = n > 0.5;
      img.data[i] = img.data[i + 1] = light ? 255 : 150;
      img.data[i + 2] = light ? 252 : 146;
      img.data[i + 3] = Math.round(Math.abs(n - 0.5) * 2 * 80);
    }
  ctx.putImageData(img, 0, 0);
  const url = `url(${canvas.toDataURL()})`;
  for (const layer of layers) layer.style.backgroundImage = url;
};
