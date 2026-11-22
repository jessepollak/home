export type FieldMode = "hero" | "customers" | "team";

export const vertexSource = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const common = `
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform float uScroll;
uniform float uView;
uniform vec4 uGuard;
uniform vec4 uColumn;
uniform vec2 uEdge;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 srgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float blob(vec2 p, vec2 c, float r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
float rectMask(vec2 p, vec4 r, float f) {
  vec2 lo = smoothstep(r.xy - f, r.xy, p);
  vec2 hi = 1.0 - smoothstep(r.zw, r.zw + f, p);
  return lo.x * lo.y * hi.x * hi.y;
}
float ribbon(vec2 p, float y0, float slope, float amp, float freq, float t, float w) {
  float y = y0 + slope * p.x + amp * sin(p.x * freq + t) + amp * 0.45 * sin(p.x * freq * 2.3 - t * 1.4);
  float d = (p.y - y) / w;
  return exp(-d * d);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const hero = `
${common}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 S = uRes / uScale;
  float H = uEdge.x;
  float t = uTime;
  float s = uScroll;
  float k = clamp(S.x / 1.4, 0.5, 1.0);
  vec2 q = p + 0.055 * vec2(sin(p.y * 3.1 + t * 0.31), sin(p.x * 2.3 - t * 0.27));
  vec2 m = mix(vec2(0.72 * S.x, 0.42 * H), uPointer, uPointerOn);

  vec2 cA = vec2(0.70 * S.x + 0.11 * S.x * sin(t * 0.21), 0.46 * H + 0.16 * H * cos(t * 0.17));
  vec2 cB = vec2(0.20 * S.x + 0.14 * S.x * cos(t * 0.15), 0.98 * H + 0.12 * H * sin(t * 0.23));
  vec2 cC = vec2(0.90 * S.x + 0.07 * S.x * sin(t * 0.29 + 1.0), 0.10 * H + 0.14 * H * sin(t * 0.19));
  vec2 cD = vec2(0.42 * S.x + 0.18 * S.x * sin(t * 0.13 + 2.0), 0.12 * H + 0.12 * H * cos(t * 0.25));
  cA = mix(cA, m, 0.32); cA.y -= s * 0.25 * H;
  cB = mix(cB, m, 0.10); cB.y -= s * 0.35 * H;
  cC = mix(cC, m, 0.45);
  cD = mix(cD, m, 0.16); cD.y += s * 0.2 * H;

  vec3 col = mix(lin(vec3(0.008, 0.024, 0.13)), lin(vec3(0.03, 0.06, 0.33)), smoothstep(0.0, H, p.y));
  col = mix(col, lin(vec3(0.10, 0.20, 1.0)), 0.80 * blob(q, cD, 0.46 * k));
  col = mix(col, lin(vec3(0.0, 0.32, 1.0)), 0.95 * blob(q, cA, 0.58 * k));
  col = mix(col, lin(vec3(0.36, 0.22, 0.92)), (0.80 + 0.2 * s) * blob(q, cB, 0.52 * k));

  float r1 = ribbon(q, 0.95 * H + 0.12 * (m.y - 0.42 * H), -0.42, 0.05, 3.2, t * 0.55, 0.07 * k);
  float r2 = ribbon(q, 1.18 * H - s * 0.2, -0.36, 0.06, 2.4, -t * 0.42 + 1.7, 0.10 * k);
  float right = smoothstep(0.25 * S.x, 0.95 * S.x, p.x);
  float curtain = 0.82 + 0.18 * sin(q.x * 34.0 + t * 0.9);
  col = mix(col, lin(vec3(0.16, 0.78, 1.0)), (0.85 - 0.35 * s) * r1 * right * curtain);
  col = mix(col, lin(vec3(0.52, 0.40, 1.0)), 0.55 * r2 * right * curtain);
  col = mix(col, lin(vec3(0.20, 0.82, 1.0)), (0.9 - 0.4 * s) * blob(q, cC, 0.26 * k));

  col = mix(col, lin(vec3(0.0, 0.32, 1.0)), 0.55 * smoothstep(H - 0.3, H + 0.02, p.y));
  col = mix(col, lin(vec3(0.30, 0.55, 1.0)), 0.55 * smoothstep(H, uEdge.y, p.y));

  float g = rectMask(p, uGuard, 0.16);
  col = mix(col, vec3(col.r * 0.7, col.g * 0.3, col.b), g);
  float L = luma(col);
  float cap = 0.05;
  if (L > cap) col *= mix(1.0, cap / L, g);

  float a = 1.0 - smoothstep(H, uEdge.y, p.y);
  vec3 outc = srgb(col) + (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(outc * a, a);
}
`;

const light = `
${common}
uniform vec3 uBg;
uniform float uTravel;
uniform float uGuardAll;
uniform float uIntensity;

vec3 acc; float wsum; float keep;
void add(vec3 c, float w) { acc += lin(c) * w; wsum += w; keep *= 1.0 - w; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 S = uRes / uScale;
  float t = uTime;
  float k = clamp(S.x / 1.4, 0.5, 1.0);
  float fade = uEdge.x;
  vec2 q = p + 0.05 * vec2(sin(p.y * 2.7 + t * 0.29), sin(p.x * 2.1 - t * 0.33));
  vec2 m = mix(vec2(0.85 * S.x, 0.3), uPointer, uPointerOn);
  acc = vec3(0.0); wsum = 0.0; keep = 1.0;

  float top = (1.0 - smoothstep(fade - 0.2, fade + 0.25, p.y)) * smoothstep(0.0, 0.22, p.y) * uIntensity;
  vec2 cA = mix(vec2(0.86 * S.x + 0.06 * S.x * sin(t * 0.2), 0.26 + 0.08 * cos(t * 0.17)), m, 0.18);
  vec2 cB = mix(vec2(0.99 * S.x + 0.04 * S.x * cos(t * 0.23), 0.58 + 0.10 * sin(t * 0.21)), m, 0.10);
  vec2 cC = mix(vec2(0.04 * S.x + 0.05 * S.x * sin(t * 0.19 + 1.0), 0.50 + 0.12 * cos(t * 0.16)), m, 0.08);
  add(vec3(0.0, 0.32, 1.0), 0.92 * top * blob(q, cA, 0.44 * k));
  add(vec3(0.16, 0.78, 1.0), 0.80 * top * blob(q, cB, 0.30 * k));
  add(vec3(0.36, 0.22, 0.92), 0.75 * top * blob(q, cC, 0.34 * k));
  float rb = ribbon(q, 0.05 + 0.04 * sin(t * 0.2), 0.12, 0.04, 3.0, t * 0.5, 0.06 * k);
  add(vec3(0.24, 0.52, 1.0), 0.6 * top * rb * smoothstep(0.55 * S.x, 1.0 * S.x, p.x));

  float below = smoothstep(fade, fade + 0.4, p.y) * uTravel;
  float hue = 0.5 + 0.5 * sin(uScroll * 6.2832);
  vec2 cL = vec2(uColumn.x - 0.16 + 0.03 * sin(t * 0.3), uView + 0.10 * sin(t * 0.21));
  vec2 cR = vec2(uColumn.z + 0.16 + 0.03 * cos(t * 0.27), uView + 0.22 + 0.10 * cos(t * 0.19));
  add(mix(vec3(0.36, 0.22, 0.92), vec3(0.0, 0.32, 1.0), hue), 0.85 * below * blob(q, cL, 0.30 * k));
  add(mix(vec3(0.16, 0.78, 1.0), vec3(0.0, 0.32, 1.0), 1.0 - hue), 0.85 * below * blob(q, cR, 0.30 * k));

  float a = (1.0 - keep) * (1.0 - smoothstep(S.y - 0.3, S.y - 0.02, p.y));
  vec3 col = wsum > 0.0001 ? acc / wsum : vec3(0.0);

  float g = max(rectMask(p, uGuard, 0.24), rectMask(p, vec4(uColumn.x, fade - 0.12, uColumn.z, S.y + 1.0), 0.24));
  g = max(g, uGuardAll);
  float Lb = luma(uBg);
  float Lc = luma(col);
  float minL = 0.85;
  float amax = Lc < minL ? clamp((Lb - minL) / max(Lb - Lc, 0.0001), 0.0, 1.0) : 1.0;
  a = min(a, mix(1.0, amax, g));

  vec3 outc = srgb(col) + (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(outc * a, a);
}
`;

export const fragmentSources: Record<FieldMode, string> = { hero, customers: light, team: light };
