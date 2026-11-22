export const vertexSource = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const fragmentSource = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform vec2 uPointerVel;
uniform float uPointerOn;
uniform float uCalm;
uniform vec4 uCopy;
uniform vec2 uFade;
uniform float uScale;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = ROT * p;
    a *= 0.5;
  }
  return s;
}

vec3 toLinear(vec3 c) { return c * c; }
vec3 toGamma(vec3 c) { return sqrt(max(c, 0.0)); }

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float unit = max(uRes.x * 0.42, 520.0 * uScale);
  vec2 p = (px - vec2(uRes.x * 0.62, uRes.y * 0.35)) / unit;
  float t = uTime;

  vec2 m = (uPointer - vec2(uRes.x * 0.62, uRes.y * 0.35)) / unit;
  vec2 d = p - m;
  float r2 = dot(d, d);
  float fall = exp(-r2 * 5.0) * uPointerOn;
  p += vec2(-d.y, d.x) * fall * 0.55;
  p -= uPointerVel * fall * 0.9;
  p += d * sin(sqrt(r2) * 22.0 - t * 9.0) * fall * 0.025;

  p.y += uCalm * 0.35;
  p *= 0.85;

  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.9)), fbm(p + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(
    fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 1.2),
    fbm(p + 3.4 * q + vec2(8.3, 2.8) - t * 0.8)
  );
  vec2 w = p + 3.4 * r;
  float f = fbm(w);
  float f2 = fbm(w + vec2(0.05, 0.07));
  float sheen = clamp((f2 - f) * 16.0, -1.0, 1.0);

  vec3 ink = vec3(0.010, 0.027, 0.120);
  vec3 deep = vec3(0.000, 0.110, 0.520);
  vec3 blue = vec3(0.000, 0.322, 1.000);
  vec3 indigo = vec3(0.180, 0.110, 0.720);
  vec3 bright = vec3(0.341, 0.545, 0.980);
  vec3 ice = vec3(0.860, 0.910, 1.000);

  float lift = length(q) * 0.55 + f * 0.75;
  vec3 col = mix(ink, deep, smoothstep(0.28, 0.5, lift));
  col = mix(col, blue, smoothstep(0.45, 0.72, lift));
  col = mix(col, indigo, smoothstep(0.5, 0.85, r.y) * 0.5 * (1.0 - smoothstep(0.6, 0.85, lift)));
  col = mix(col, bright, smoothstep(0.7, 0.92, lift) * 0.85);

  float band = 1.0 - abs(sin(f * 7.0 + r.x * 4.0 + t * 0.8));
  float caustic = pow(band, 12.0) * smoothstep(0.45, 0.75, lift);
  col += ice * caustic * 0.45;
  col += ice * pow(max(sheen, 0.0), 2.0) * 0.6 * smoothstep(0.4, 0.75, lift);
  col *= 1.0 + min(sheen, 0.0) * 0.35;
  col += bright * fall * 0.18;

  col = mix(col, mix(ink, deep, 0.55), uCalm * 0.35);

  vec2 c = (uCopy.xy + uCopy.zw) * 0.5;
  vec2 h = (uCopy.zw - uCopy.xy) * 0.5;
  vec2 e = abs(px - c) - h;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  float copyMask = 1.0 - smoothstep(0.0, 180.0 * uScale, sd);

  vec3 lin = toLinear(col);
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float cap = 0.04;
  float soft = cap * (1.0 - exp(-lum / cap));
  vec3 calmed = lin * (soft / max(lum, 1e-5));
  lin = mix(lin, calmed, copyMask);
  col = toGamma(lin);

  float fade = smoothstep(uFade.x, uFade.y, px.y);
  col = mix(col, mix(blue, bright, 0.5) + ice * caustic * 0.3, smoothstep(0.0, 0.55, fade) * 0.7);
  col = mix(col, ice, smoothstep(0.45, 1.0, fade) * 0.6);
  float alpha = 1.0 - smoothstep(0.35, 1.0, fade);

  outColor = vec4(col * alpha, alpha);
}
`;
