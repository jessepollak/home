export type LensShape = { width: number; height: number; radius: number };

export type LensOptions = {
  pixelRatio: number;
  bezel: number;
  thickness: number;
  refractiveIndex?: number;
  lightAngle?: number;
};

export type LensMaps = {
  width: number;
  height: number;
  displacement: Uint8ClampedArray;
  specular: Uint8ClampedArray;
  scale: number;
};

function lightAlpha(dot: number, slope: number): number {
  return 255 * slope * (dot > 0 ? 0.27 * dot ** 6 : 0.07 * (-dot) ** 6);
}

export function generateLensMaps(shape: LensShape, options: LensOptions): LensMaps {
  const cssWidth = Number.isFinite(shape.width) ? Math.max(0, shape.width) : 0;
  const cssHeight = Number.isFinite(shape.height) ? Math.max(0, shape.height) : 0;
  const ratio = Number.isFinite(options.pixelRatio)
    ? Math.max(1, Math.min(2, options.pixelRatio))
    : 1;
  const width = Math.round(cssWidth * ratio);
  const height = Math.round(cssHeight * ratio);
  const displacement = new Uint8ClampedArray(width * height * 4);
  const specular = new Uint8ClampedArray(width * height * 4);
  const radius = Number.isFinite(shape.radius)
    ? Math.max(0, Math.min(shape.radius, cssWidth / 2, cssHeight / 2))
    : 0;
  const bezel = Number.isFinite(options.bezel)
    ? Math.max(0, Math.min(options.bezel, cssWidth / 2, cssHeight / 2))
    : 0;
  const thickness = Number.isFinite(options.thickness) ? Math.max(0, options.thickness) : 0;
  const index = Number.isFinite(options.refractiveIndex)
    ? Math.max(1, options.refractiveIndex ?? 1.5)
    : 1.5;
  const angle = Number.isFinite(options.lightAngle) ? (options.lightAngle ?? -Math.PI / 3) : -Math.PI / 3;
  const lightX = -Math.cos(angle);
  const lightY = Math.sin(angle);
  const steps = Math.max(1, Math.ceil(bezel * ratio * 8));
  const travel = new Float64Array(steps + 1);
  const slopeStrength = new Float64Array(steps + 1);

  if (bezel > 0 && thickness > 0 && index > 1) {
    for (let step = 0; step < steps; step++) {
      const x = Math.max(step / steps, 1e-6);
      const u = 1 - x;
      const slope = (thickness / bezel) * (u * u * u) / Math.pow(1 - u * u * u * u, 0.75);
      const normalAngle = Math.atan(slope);
      travel[step] = thickness * Math.tan(normalAngle - Math.asin(Math.sin(normalAngle) / index));
      slopeStrength[step] = slope / Math.hypot(1, slope);
    }
  }

  let maximum = 0;
  for (let row = 0; row < Math.ceil(height / 2); row++) {
    const y = (row + 0.5) * cssHeight / height;
    for (let col = 0; col < Math.ceil(width / 2); col++) {
      const x = (col + 0.5) * cssWidth / width;
      const qx = radius - x;
      const qy = radius - y;
      const distance = qx > 0 && qy > 0 ? radius - Math.hypot(qx, qy) : Math.min(x, y);
      if (distance <= 0 || distance >= bezel) continue;
      const position = distance * steps / bezel;
      const lower = Math.floor(position);
      const magnitude = travel[lower] + (travel[lower + 1] - travel[lower]) * (position - lower);
      if (magnitude > maximum) maximum = magnitude;
    }
  }

  for (let row = 0; row < Math.ceil(height / 2); row++) {
    const y = (row + 0.5) * cssHeight / height;
    const oppositeRow = height - 1 - row;
    for (let col = 0; col < Math.ceil(width / 2); col++) {
      const x = (col + 0.5) * cssWidth / width;
      const oppositeCol = width - 1 - col;
      const qx = radius - x;
      const qy = radius - y;
      const distance = qx > 0 && qy > 0 ? radius - Math.hypot(qx, qy) : Math.min(x, y);
      let red = 128;
      let green = 128;
      let highlight = 0;
      let highlightX = 0;
      let highlightY = 0;
      let oppositeHighlight = 0;
      if (distance > 0 && distance < bezel) {
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0) {
          const length = Math.hypot(qx, qy);
          nx = qx / length;
          ny = qy / length;
        } else if (x <= y) {
          nx = 1;
        } else {
          ny = 1;
        }
        const position = distance * steps / bezel;
        const lower = Math.floor(position);
        const fraction = position - lower;
        const magnitude = travel[lower] + (travel[lower + 1] - travel[lower]) * fraction;
        const slope = slopeStrength[lower] + (slopeStrength[lower + 1] - slopeStrength[lower]) * fraction;
        if (maximum > 0) {
          red = nx === 0 ? 128 : Math.round(127.5 - 127.5 * magnitude * nx / maximum);
          green = ny === 0 ? 128 : Math.round(127.5 - 127.5 * magnitude * ny / maximum);
        }
        const dx = -nx * lightX;
        const dy = -ny * lightY;
        highlight = lightAlpha(dx + dy, slope);
        highlightX = lightAlpha(-dx + dy, slope);
        highlightY = lightAlpha(dx - dy, slope);
        oppositeHighlight = lightAlpha(-dx - dy, slope);
      }
      const a = (row * width + col) * 4;
      const b = (row * width + oppositeCol) * 4;
      const c = (oppositeRow * width + col) * 4;
      const d = (oppositeRow * width + oppositeCol) * 4;
      displacement[a] = red;
      displacement[a + 1] = green;
      displacement[b] = red === 128 ? 128 : 255 - red;
      displacement[b + 1] = green;
      displacement[c] = red;
      displacement[c + 1] = green === 128 ? 128 : 255 - green;
      displacement[d] = red === 128 ? 128 : 255 - red;
      displacement[d + 1] = green === 128 ? 128 : 255 - green;
      specular[a + 3] = highlight;
      specular[b + 3] = highlightX;
      specular[c + 3] = highlightY;
      specular[d + 3] = oppositeHighlight;
      for (let corner = 0; corner < 4; corner++) {
        const offset = corner === 0 ? a : corner === 1 ? b : corner === 2 ? c : d;
        displacement[offset + 2] = 128;
        displacement[offset + 3] = 255;
        specular[offset] = 255;
        specular[offset + 1] = 255;
        specular[offset + 2] = 255;
      }
    }
  }
  return { width, height, displacement, specular, scale: 2 * maximum };
}
