import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { ThemePreference } from "./appearance-store";

type OnboardingMistProps = {
  readonly theme: ThemePreference;
};

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

// WebGL intrinsics are capped to keep the fullscreen onboarding film inexpensive on Retina displays.
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const POINTER_EASE = 0.16;
const PRESENCE_EASE = 0.055;
const IDLE_POINTER_DELAY_MS = 2_400;
const IDLE_PRESENCE = 0.58;
const ACTIVE_PRESENCE = 1;
// The shader settles on its final rain frame when the five-second intro hands off to setup.
const ANIMATION_DURATION_SECONDS = 5;

const FULLSCREEN_TRIANGLES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Ported from the v7 Mist study, with its click-to-draw branch removed and a dark palette added.
// The numeric values describe shader geometry and optical response rather than UI design tokens.
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_presence;
uniform float u_dark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float weight = 0.5;
  for (int i = 0; i < 4; i++) {
    value += noise(p) * weight;
    p = p * 2.03 + 0.17;
    weight *= 0.5;
  }
  return value;
}

vec3 spectrum(float h) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb * rgb * (3.0 - 2.0 * rgb);
}

vec3 ray(vec2 p, vec2 apex, vec2 direction, float hue, float reach, float split) {
  vec2 delta = p - apex;
  float along = dot(delta, direction);
  float across = direction.x * delta.y - direction.y * delta.x;
  float forward = smoothstep(-0.02, 0.08, along);
  float width = 0.016 + max(along, 0.0) * 0.18;
  float band = exp(-pow(across / width, 2.0));
  float end = smoothstep(reach, reach - 0.34, along);
  float glow = exp(-max(along, 0.0) * 0.72);
  vec3 neutral = mix(vec3(0.86, 0.85, 0.84), vec3(0.42, 0.53, 0.72), u_dark);
  vec3 color = mix(neutral, spectrum(hue - across / width * split), mix(0.42, 0.66, u_dark));
  return color * band * forward * end * (0.34 + glow * 0.9);
}

float caustic(vec2 p, float time) {
  vec2 q = p * 6.28318;
  float value = 0.0;
  for (int i = 0; i < 3; i++) {
    float index = float(i) + 1.0;
    q += vec2(sin(q.y * index + time * 0.2), cos(q.x * index - time * 0.17));
    value += 0.012 / max(abs(sin(q.x) + cos(q.y)), 0.02);
  }
  return clamp(pow(value, 2.2), 0.0, 1.0);
}

float beads(vec2 uv, float time) {
  vec2 cells = uv * 54.0;
  vec2 id = floor(cells);
  vec2 local = fract(cells) - 0.5;
  float random = hash(id);
  vec2 center = vec2(hash(id + 8.3), hash(id + 19.7)) - 0.5;
  float size = mix(0.04, 0.28, random * random);
  float still = smoothstep(size, 0.0, length(local - center * 0.68));
  still *= step(0.10, hash(id + 3.1));

  vec2 grid = uv * vec2(24.0, 3.0);
  vec2 lane = floor(grid);
  vec2 pos = fract(grid) - vec2(0.5, 0.0);
  float seed = hash(lane + 31.4);
  float fall = 1.0 - fract(time * mix(0.18, 0.36, seed) + hash(lane + 4.2));
  float wave = sin((uv.y + time * 0.14) * 20.0 + seed * 6.0) * 0.11;
  vec2 drop = vec2((seed - 0.5) * 0.52 + wave, fall);
  float body = smoothstep(mix(0.11, 0.23, seed), 0.0, length((pos - drop) * vec2(1.0, 7.5)));
  float trail = smoothstep(0.075, 0.0, abs(pos.x - drop.x));
  trail *= smoothstep(drop.y + 0.02, drop.y + 0.58, pos.y) * smoothstep(1.0, 0.64, pos.y);
  float field = still * 1.5 + body * 0.95 + trail * 0.34;
  return smoothstep(0.18, 0.82, field);
}

vec3 screen(vec3 base, vec3 light) {
  return 1.0 - (1.0 - base) * (1.0 - clamp(light, 0.0, 1.0));
}

vec3 scene(vec2 uv, vec2 pointer, float time, float presence) {
  float aspect = u_resolution.x / u_resolution.y;
  vec3 lightWarm = vec3(0.882, 0.875, 0.861);
  vec3 lightShade = vec3(0.67, 0.665, 0.655);
  vec3 darkWarm = vec3(0.10, 0.115, 0.14);
  vec3 darkShade = vec3(0.018, 0.022, 0.032);
  vec3 warm = mix(lightWarm, darkWarm, u_dark);
  vec3 shade = mix(lightShade, darkShade, u_dark);
  float slope = smoothstep(-0.15, 1.25, uv.x + uv.y * 0.26);
  vec3 base = mix(warm, shade, slope * mix(0.52, 0.78, u_dark));
  float cloud = fbm(uv * vec2(2.25 * aspect, 2.25) + vec2(time * 0.012, -time * 0.009));
  base = mix(base, shade, smoothstep(0.42, 0.96, cloud) * mix(0.27, 0.46, u_dark));

  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 apex = vec2((0.96 + sin(time * 0.045) * 0.014) * aspect, 0.51 + sin(time * 0.038) * 0.025);
  vec2 upper = normalize(vec2(0.40 * aspect, 1.07) - apex);
  vec2 lower = normalize(vec2(0.57 * aspect, -0.08) - apex);
  vec2 mp = vec2(pointer.x * aspect, pointer.y);
  float upperHover = smoothstep(0.25, 0.0, abs(upper.x * (mp.y - apex.y) - upper.y * (mp.x - apex.x)));
  float lowerHover = smoothstep(0.25, 0.0, abs(lower.x * (mp.y - apex.y) - lower.y * (mp.x - apex.x)));
  float bloom = smoothstep(0.0, 1.25, time);
  float reach = 0.35 + bloom * 1.5;
  vec3 light = ray(p, apex, upper, 0.58, reach, 0.07 + upperHover * presence * 0.07);
  light += ray(p, apex, lower, 0.04, reach, 0.07 + lowerHover * presence * 0.07);
  light *= mix(0.69, 0.82, u_dark) + caustic(p * 1.8, time) * 0.31;
  float focus = exp(-dot(p - apex, p - apex) * 18.0);
  vec3 focusColor = mix(vec3(1.0, 0.92, 0.79), vec3(0.54, 0.70, 1.0), u_dark);
  light += focusColor * focus * mix(0.27, 0.42, u_dark) * bloom;
  return screen(base, light);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 pointer = u_pointer / u_resolution;

  vec2 wetUv = (frag - u_resolution * 0.5) / u_resolution.y;
  float wet = beads(wetUv, u_time);
  float stepSize = 0.0019;
  float wetX = beads(wetUv + vec2(stepSize, 0.0), u_time);
  float wetY = beads(wetUv + vec2(0.0, stepSize), u_time);
  vec2 normal = vec2(wetX - wet, wetY - wet);
  float clear = smoothstep(0.05, 0.40, uv.x);
  normal *= clear;

  vec2 delta = uv - pointer;
  vec2 roundDelta = vec2(delta.x * aspect, delta.y);
  float distanceToPointer = length(roundDelta);
  float lens = smoothstep(0.32, 0.0, distanceToPointer) * u_presence;
  vec2 direction = length(delta) > 0.0001 ? normalize(delta) : vec2(0.0);
  vec2 tangent = vec2(-direction.y, direction.x);
  float twist = 0.026 + sin(u_time * 0.38) * 0.012;
  vec2 displacement = tangent * lens * twist;

  vec3 color = scene(uv + displacement - normal * 10.5, pointer, u_time, u_presence);
  vec3 hoverColor = mix(vec3(0.30, 0.25, 0.19), vec3(0.18, 0.34, 0.68), u_dark);
  hoverColor = mix(hoverColor, spectrum(pointer.x * 0.22 + u_time * 0.015) * 0.36, 0.42);
  color = screen(color, hoverColor * lens * mix(0.14, 0.24, u_dark));

  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 glass = normalize(vec3(normal * 150.0, 1.0));
  float shine = pow(max(dot(glass, normalize(vec3(-0.3, 0.6, 0.7))), 0.0), 18.0);
  vec3 fringe = mix(vec3(1.0), spectrum(atan(normal.y, normal.x) * 0.159 + uv.x * 0.33), mix(0.34, 0.58, u_dark));
  float shineThreshold = mix(0.84, 0.34, u_dark);
  color += shine * wet * clear * (mix(0.12, 0.16, u_dark) + smoothstep(shineThreshold, 0.99, luminance) * mix(0.62, 0.74, u_dark)) * fringe;
  color *= 1.0 + wet * smoothstep(shineThreshold, 0.99, luminance) * 0.13;

  float vignette = smoothstep(1.28, 0.24, length(uv - 0.5));
  color *= mix(mix(0.93, 0.82, u_dark), 1.0, vignette);
  color += (hash(frag + fract(u_time) * 93.0) - 0.5) * mix(0.035, 0.022, u_dark);
  float surfaceAlpha = mix(0.54, 0.72, u_dark);
  float rainAlpha = clamp(wet * 0.24 + shine * wet * 0.14, 0.0, 0.30);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), min(0.94, surfaceAlpha + rainAlpha));
}
`;

const styles = stylex.create({
  root: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    backgroundColor: "transparent",
  },
  canvas: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
  },
});

function subscribeSystemDark(onStoreChange: () => void): () => void {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => {
    query.removeEventListener("change", onStoreChange);
  };
}

function getSystemDarkSnapshot(): boolean {
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

function useSystemDark(): boolean {
  return React.useSyncExternalStore(subscribeSystemDark, getSystemDarkSnapshot, () => false);
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function mountMist(canvas: HTMLCanvasElement, isDark: boolean): (() => void) | undefined {
  const shell = canvas.parentElement;
  if (shell === null) {
    return undefined;
  }

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (gl === null) {
    return undefined;
  }

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vertex === null || fragment === null) {
    if (vertex !== null) gl.deleteShader(vertex);
    if (fragment !== null) gl.deleteShader(fragment);
    return undefined;
  }

  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return undefined;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return undefined;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  const position = gl.getAttribLocation(program, "a_position");
  if (buffer === null || position < 0) {
    if (buffer !== null) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return undefined;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLES, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, "u_resolution");
  const pointer = gl.getUniformLocation(program, "u_pointer");
  const time = gl.getUniformLocation(program, "u_time");
  const presence = gl.getUniformLocation(program, "u_presence");
  const dark = gl.getUniformLocation(program, "u_dark");
  const state = {
    frame: 0,
    height: 1,
    lastPointerAt: 0,
    presence: IDLE_PRESENCE,
    ratio: 1,
    startedAt: performance.now(),
    targetPresence: IDLE_PRESENCE,
    targetX: 1,
    targetY: 1,
    width: 1,
    x: 1,
    y: 1,
  };

  const resize = (): void => {
    const box = shell.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    state.ratio = ratio;
    state.width = width;
    state.height = height;
    state.x = width * 0.78;
    state.y = height * 0.5;
    state.targetX = state.x;
    state.targetY = state.y;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  };

  const move = (event: PointerEvent): void => {
    const box = shell.getBoundingClientRect();
    state.targetX = (event.clientX - box.left) * state.ratio;
    state.targetY = (box.bottom - event.clientY) * state.ratio;
    state.targetPresence = ACTIVE_PRESENCE;
    state.lastPointerAt = performance.now();
  };

  const settle = (): void => {
    state.targetPresence = IDLE_PRESENCE;
    state.lastPointerAt = 0;
  };

  const render = (now: number): void => {
    const elapsed = Math.min((now - state.startedAt) / 1_000, ANIMATION_DURATION_SECONDS);
    if (state.lastPointerAt === 0 || now - state.lastPointerAt > IDLE_POINTER_DELAY_MS) {
      state.targetX = state.width * (0.76 + Math.sin(elapsed * 0.21) * 0.11);
      state.targetY = state.height * (0.51 + Math.cos(elapsed * 0.17) * 0.14);
      state.targetPresence = IDLE_PRESENCE;
    }
    state.x += (state.targetX - state.x) * POINTER_EASE;
    state.y += (state.targetY - state.y) * POINTER_EASE;
    state.presence += (state.targetPresence - state.presence) * PRESENCE_EASE;
    gl.uniform2f(resolution, state.width, state.height);
    gl.uniform2f(pointer, state.x, state.y);
    gl.uniform1f(time, elapsed);
    gl.uniform1f(presence, state.presence);
    gl.uniform1f(dark, isDark ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (elapsed >= ANIMATION_DURATION_SECONDS) {
      state.frame = 0;
      return;
    }
    state.frame = requestAnimationFrame(render);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  resize();
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("blur", settle);
  state.frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(state.frame);
    observer.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("blur", settle);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  };
}

function OnboardingMist({ theme }: OnboardingMistProps): React.ReactElement {
  const systemDark = useSystemDark();
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  const canvasRef = (canvas: HTMLCanvasElement | null): (() => void) | undefined => {
    if (canvas === null) {
      return undefined;
    }
    return mountMist(canvas, isDark);
  };

  return (
    <div aria-hidden={true} {...stylex.props(styles.root)}>
      <canvas ref={canvasRef} {...stylex.props(styles.canvas)} />
    </div>
  );
}

export { OnboardingMist };
