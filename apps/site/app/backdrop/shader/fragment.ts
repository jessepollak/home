export const TRAIL_SLOTS = 8;
export const PULSE_SLOTS = 4;

export const vertexSource = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const fragmentSource = `#version 300 es
precision highp float;

#define TRAIL ${TRAIL_SLOTS}
#define PULSES ${PULSE_SLOTS}

uniform vec2 uRes;
uniform float uTime;
uniform float uClock;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform float uCalm;
uniform float uIntro;
uniform vec4 uCopy;
uniform vec4 uFade;
uniform float uScale;
uniform vec4 uTrail[TRAIL];
uniform vec4 uPulse[PULSES];

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
  vec2 origin = vec2(uRes.x * 0.62, uRes.y * 0.35);
  float unit = max(uRes.x * 0.42, 520.0 * uScale);
  vec2 p = (px - origin) / unit;
  float t = uTime;
  float intro = uIntro;

  vec2 slope = vec2(0.0);
  vec2 shift = vec2(0.0);
  float glow = 0.0;

  vec2 m = (uPointer - origin) / unit;
  vec2 d = p - m;
  float fall = exp(-dot(d, d) * 7.0) * uPointerOn;
  shift += vec2(-d.y, d.x) * fall * 0.14;

  for (int i = 0; i < TRAIL; i++) {
    vec4 tr = uTrail[i];
    vec2 td = p - (tr.xy - origin) / unit;
    float g = exp(-dot(td, td) * 11.0);
    shift -= tr.zw * g * 0.07;
    float speed = length(tr.zw);
    slope += td * g * speed * 3.0;
    glow += g * speed * 0.07;
  }

  for (int i = 0; i < PULSES; i++) {
    vec4 pu = uPulse[i];
    float age = uClock - pu.z;
    if (pu.w <= 0.0 || age < 0.0 || age > 2.6) continue;
    vec2 rel = (px - pu.xy) / uScale;
    float dist = length(rel) + 1e-3;
    vec2 dir = rel / dist;
    float radius = age * 430.0;
    float width = 46.0 + age * 70.0;
    float x = (dist - radius) / width;
    float amp = pu.w * exp(-age * 1.35) * smoothstep(0.0, 0.12, age);
    float g = exp(-x * x);
    float wave = -2.0 * x * g * amp;
    shift += dir * wave * 0.06;
    slope += dir * wave * 1.4;
    glow += g * amp * 0.12;
  }

  p.y += uCalm * 0.35;
  p *= 0.85 * (1.0 + 0.22 * intro);

  float warp = 3.4 + 1.4 * intro;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.9)), fbm(p + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(
    fbm(p + warp * q + vec2(1.7, 9.2) + t * 1.2),
    fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.8)
  );
  vec2 w = p + warp * r + shift;
  const float E = 0.06;
  float f = fbm(w);
  float fx = fbm(w + vec2(E, 0.0));
  float fy = fbm(w + vec2(0.0, E));
  vec2 grad = vec2(fx - f, fy - f) / E;

  vec3 n = normalize(vec3(-(grad * 0.42 + slope), 1.0));
  vec3 L = normalize(vec3(0.42, -0.58, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = dot(n, L);
  float nh = max(dot(n, H), 0.0);
  float spec = pow(nh, 80.0) * 1.9 + pow(nh, 12.0) * 0.3;
  float rim = pow(clamp((1.0 - n.z) * 4.0, 0.0, 1.0), 1.6);

  vec3 ink = vec3(0.008, 0.022, 0.105);
  vec3 deep = vec3(0.000, 0.095, 0.480);
  vec3 blue = vec3(0.000, 0.322, 1.000);
  vec3 indigo = vec3(0.165, 0.105, 0.690);
  vec3 bright = vec3(0.341, 0.545, 0.980);
  vec3 ice = vec3(0.860, 0.910, 1.000);
  vec3 cyan = vec3(0.620, 0.860, 1.000);
  vec3 lilac = vec3(0.800, 0.760, 1.000);

  float lift = length(q) * 0.55 + f * 0.75;
  float lit = smoothstep(0.32, 0.74, lift);
  vec3 col = mix(ink, deep, smoothstep(0.28, 0.5, lift));
  col = mix(col, blue, smoothstep(0.46, 0.74, lift));
  col = mix(col, indigo, smoothstep(0.5, 0.85, r.y) * 0.5 * (1.0 - smoothstep(0.6, 0.85, lift)));
  col = mix(col, bright, smoothstep(0.72, 0.94, lift) * 0.8);

  col *= 0.5 + 0.72 * clamp(diff, 0.0, 1.0);

  vec3 film = mix(cyan, lilac, 0.5 + 0.5 * sin(f * 11.0 + n.x * 7.0 - n.y * 4.0 + t * 0.7));
  col += film * spec * (0.3 + 0.7 * lit);
  col += mix(deep, bright, 0.65) * rim * (0.25 + 0.4 * lit);

  float band = 1.0 - abs(sin(f * 7.0 + r.x * 4.0 + t * 0.8));
  float caustic = pow(band, 6.0) * lit;
  col += film * caustic * 0.22;
  col += bright * (glow + fall * 0.06);

  col = mix(col, mix(ink, deep, 0.55), uCalm * 0.35);
  col *= 1.0 - 0.2 * intro;

  vec2 c = (uCopy.xy + uCopy.zw) * 0.5;
  vec2 h = (uCopy.zw - uCopy.xy) * 0.5;
  vec2 e = abs(px - c) - h;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  float copyMask = 1.0 - smoothstep(0.0, 180.0 * uScale, sd);

  vec3 lin = toLinear(col);
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float cap = 0.04;
  float soft = cap * (1.0 - exp(-lum / cap));
  vec3 tint = toLinear(mix(deep, blue, 0.35));
  vec3 calmed = mix(lin * (soft / max(lum, 1e-5)), tint * (soft / dot(tint, vec3(0.2126, 0.7152, 0.0722))), 0.6);
  lin = mix(lin, calmed, copyMask);
  col = toGamma(lin);

  float fade = max(smoothstep(uFade.z, uFade.w, px.y), 1.0 - smoothstep(uFade.x, uFade.y, px.y));
  col = mix(col, mix(blue, bright, 0.5) + ice * caustic * 0.3, smoothstep(0.0, 0.55, fade) * 0.7);
  col = mix(col, ice, smoothstep(0.45, 1.0, fade) * 0.6);
  float alpha = 1.0 - smoothstep(0.35, 1.0, fade);

  outColor = vec4(col * alpha, alpha);
}
`;
