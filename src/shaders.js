/**
 * Instanced dice shaders.
 * Pip layout and rounded-box shading follow the reference raymarch shader.
 * Six pip slots per die blink in the fragment shader. The mesh is unchanged.
 */

export const DICE_VERT = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_quat;
layout(location = 3) in vec3 a_iPos;
layout(location = 4) in float a_flash;
layout(location = 5) in vec3 a_color;
layout(location = 6) in vec3 a_blink;

uniform mat4 u_viewProj;
uniform float u_scale;
uniform float u_time;
uniform float u_elevAmp;
uniform float u_elevFreq;

out vec3 vLocal;
out vec3 vLocalN;
out vec3 vNormal;
out vec3 vColor;
out vec3 vBlink;
out float vFlash;

vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 local = a_pos * u_scale;
  vec3 world = quatRotate(a_quat, local) + a_iPos;

  float k = u_elevFreq;
  float a = sin(a_iPos.x * k + u_time * 0.48);
  float b = sin(a_iPos.y * k * 0.84 + u_time * 0.31);
  float c = sin((a_iPos.x * 0.62 + a_iPos.y) * k * 0.72 - u_time * 0.22);
  float swell = a * b * 0.5 + 0.5;
  float roll = c * 0.5 + 0.5;
  float lift = u_elevAmp * (0.72 * swell + 0.28 * roll);
  world.z += lift;
  world.y += lift * 0.85;

  vLocal = local;
  vLocalN = a_normal;
  vNormal = quatRotate(a_quat, a_normal);
  vColor = a_color;
  vBlink = a_blink;
  vFlash = a_flash;
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;

export const DICE_FRAG = `#version 300 es
precision highp float;

in vec3 vLocal;
in vec3 vLocalN;
in vec3 vNormal;
in vec3 vColor;
in vec3 vBlink;
in float vFlash;

uniform float u_half;
uniform vec3 u_pipOff;
uniform vec3 u_pipOn;
uniform float u_glow;
uniform int u_pass;
uniform float u_time;
uniform float u_blinkRate;
uniform float u_brightness;
uniform float u_pipActivity;
uniform float u_pipTransient;
uniform float u_illum;

out vec4 fragColor;

const vec3 LIGHT_DIR = normalize(vec3(-0.45, 0.55, 0.75));
const vec3 VIEW_DIR = vec3(0.0, 0.0, 1.0);
const float AMBIENT = 0.24;
const float KEY = 0.74;
const float FILL = 0.16;

int getFaceId(vec3 n) {
  vec3 an = abs(n);
  if (an.z >= an.x && an.z >= an.y) return n.z > 0.0 ? 1 : 6;
  if (an.y >= an.x) return n.y > 0.0 ? 2 : 5;
  return n.x > 0.0 ? 3 : 4;
}

vec2 getFaceUV(int face, vec3 localPos) {
  if (face == 1) return localPos.xy;
  if (face == 6) return vec2(-localPos.x, localPos.y);
  if (face == 2) return localPos.xz;
  if (face == 5) return vec2(-localPos.x, localPos.z);
  if (face == 3) return vec2(-localPos.y, localPos.z);
  return localPos.yz;
}

float pipCircle(vec2 uv, vec2 c, float r) {
  float d = length(uv - c);
  return 1.0 - smoothstep(r * 0.86, r, d);
}

float hash21(float a, float b) {
  return fract(sin(a * 127.1 + b * 311.7) * 43758.5453);
}

void takePip(inout float mask, inout float slot, float m, float s) {
  if (m > mask) {
    mask = m;
    slot = s;
  }
}

void pipOnFace(int face, vec2 uv, inout float mask, inout float slot) {
  float r = 0.18;
  float o = 0.42;
  if (face == 1) {
    takePip(mask, slot, pipCircle(uv, vec2(0.0), r * 1.15), 0.0);
  } else if (face == 2) {
    takePip(mask, slot, pipCircle(uv, vec2(-o, -o), r), 0.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, o), r), 1.0);
  } else if (face == 3) {
    takePip(mask, slot, pipCircle(uv, vec2(-o, -o), r), 0.0);
    takePip(mask, slot, pipCircle(uv, vec2(0.0), r), 1.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, o), r), 2.0);
  } else if (face == 4) {
    takePip(mask, slot, pipCircle(uv, vec2(-o, -o), r), 0.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, -o), r), 1.0);
    takePip(mask, slot, pipCircle(uv, vec2(-o, o), r), 2.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, o), r), 3.0);
  } else if (face == 5) {
    takePip(mask, slot, pipCircle(uv, vec2(-o, -o), r), 0.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, -o), r), 1.0);
    takePip(mask, slot, pipCircle(uv, vec2(0.0), r), 4.0);
    takePip(mask, slot, pipCircle(uv, vec2(-o, o), r), 2.0);
    takePip(mask, slot, pipCircle(uv, vec2(o, o), r), 3.0);
  } else {
    float ox = 0.38;
    float oy = 0.48;
    takePip(mask, slot, pipCircle(uv, vec2(-ox, -oy), r), 0.0);
    takePip(mask, slot, pipCircle(uv, vec2(ox, -oy), r), 1.0);
    takePip(mask, slot, pipCircle(uv, vec2(-ox, 0.0), r), 2.0);
    takePip(mask, slot, pipCircle(uv, vec2(ox, 0.0), r), 3.0);
    takePip(mask, slot, pipCircle(uv, vec2(-ox, oy), r), 4.0);
    takePip(mask, slot, pipCircle(uv, vec2(ox, oy), r), 5.0);
  }
}

float slotOsc(float phase, float rate, float sharpMix) {
  float hz = max(rate, 0.02);
  float sn = sin(u_time * hz * 6.2831853 + phase * 6.2831853);
  float smoothE = pow(max(sn, 0.0), 1.55);
  float ph = fract(u_time * hz + phase);
  float sharpE = ph < 0.035 ? 1.0 : exp(-(ph - 0.035) * 18.0);
  return mix(smoothE, clamp(sharpE, 0.0, 1.0), clamp(sharpMix, 0.0, 1.0));
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 ln = normalize(vLocalN);
  int face = getFaceId(ln);
  vec2 faceUV = getFaceUV(face, vLocal / max(u_half, 0.0001));

  vec3 faceAxis = face == 1 ? vec3(0.0, 0.0, 1.0) :
                  face == 6 ? vec3(0.0, 0.0, -1.0) :
                  face == 2 ? vec3(0.0, 1.0, 0.0) :
                  face == 5 ? vec3(0.0, -1.0, 0.0) :
                  face == 3 ? vec3(1.0, 0.0, 0.0) :
                              vec3(-1.0, 0.0, 0.0);

  float faceFlat = smoothstep(0.55, 0.92, abs(dot(ln, faceAxis)));
  float pipMask = 0.0;
  float pipSlot = 0.0;
  pipOnFace(face, faceUV, pipMask, pipSlot);
  float pip = pipMask * faceFlat;

  float phase = fract(vBlink.x * 0.15915494 + pipSlot * 0.173);
  float rateJ = 0.55 + hash21(vBlink.x, pipSlot + 1.0) * 0.9;
  float sharp = step(0.68, hash21(vBlink.x * 2.0, pipSlot + 4.0));
  sharp = max(sharp, vBlink.z * step(0.45, hash21(pipSlot, vBlink.y)));
  float ambientBlink = slotOsc(phase, vBlink.y * rateJ * u_blinkRate, sharp) * u_brightness;

  float musicPhase = fract(phase + 0.37 + pipSlot * 0.11);
  float musicOsc = slotOsc(musicPhase, vBlink.y * rateJ * u_blinkRate * (1.35 + u_pipActivity * 1.8), hash21(pipSlot, vBlink.x + 6.0));
  float musicModulation = u_pipActivity * musicOsc * (0.35 + 0.65 * hash21(vBlink.x, pipSlot + 8.0));
  float bucket = floor(u_time * (1.6 + u_pipTransient * 5.0));
  float burstPhase = fract(u_time * (1.6 + u_pipTransient * 5.0));
  float pick = step(0.8, hash21(vBlink.x + bucket, pipSlot + 2.5));
  musicModulation += u_pipTransient * pick * exp(-burstPhase * 5.5);

  float waveModulation = vFlash * (0.4 + 0.6 * hash21(vBlink.x, pipSlot + 9.0));
  float e = clamp(ambientBlink + musicModulation + waveModulation, 0.0, 1.35);
  vec3 albedo = vColor;
  albedo *= 0.975 + 0.025 * float(face) / 6.0;
  float grain = fract(sin(dot(vLocal.xy, vec2(12.9898, 78.233))) * 43758.5453);
  albedo *= 0.986 + 0.028 * grain;
  float edgeDist = max(abs(faceUV.x), abs(faceUV.y));
  albedo *= 1.0 - smoothstep(0.62, 1.05, edgeDist) * 0.16;

  vec3 pipColor = mix(u_pipOff, u_pipOn, clamp(e, 0.0, 1.0));
  albedo = mix(albedo, pipColor, pip);

  vec3 glow = u_pipOn * pip * pow(clamp(e, 0.0, 1.0), 1.15);
  if (u_pass == 1) {
    fragColor = vec4(glow * u_glow, 1.0);
    return;
  }

  float ndl = max(dot(n, LIGHT_DIR), 0.0);
  float wrap = max(dot(n, normalize(vec3(0.35, -0.25, 0.55))), 0.0);
  vec3 H = normalize(LIGHT_DIR + VIEW_DIR);
  float spec = pow(max(dot(n, H), 0.0), 48.0) * 0.16;
  spec += pow(max(dot(n, H), 0.0), 12.0) * 0.04;
  spec *= 1.0 - smoothstep(0.0, 0.25, pip);

  float fres = pow(1.0 - max(dot(n, VIEW_DIR), 0.0), 2.2);
  vec3 lit = albedo * (AMBIENT + KEY * ndl + FILL * wrap);
  lit += vec3(1.0, 0.98, 0.96) * spec;
  lit += vec3(0.72) * fres * 0.2 * (1.0 - pip);
  float bottom = smoothstep(0.15, -0.65, n.z);
  lit *= 1.0 - bottom * 0.28;
  lit += glow * (0.35 + 0.7 * u_glow);
  lit *= u_illum;

  fragColor = vec4(lit, 1.0);
}
`;

export const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uDir * 1.0).rgb * 0.1945946;
  c += texture(uTex, vUv - uDir * 1.0).rgb * 0.1945946;
  c += texture(uTex, vUv + uDir * 2.0).rgb * 0.1216216;
  c += texture(uTex, vUv - uDir * 2.0).rgb * 0.1216216;
  c += texture(uTex, vUv + uDir * 3.0).rgb * 0.054054;
  c += texture(uTex, vUv - uDir * 3.0).rgb * 0.054054;
  fragColor = vec4(c, 1.0);
}
`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uBloom;
uniform float u_glow;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uBloom, vUv).rgb * u_glow, 1.0);
}
`;
