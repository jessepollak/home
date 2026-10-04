export const usage = "bun run clip start --target chromium|webkit|ios|android --session <name> [--url <url>] [--device <name>|--serial <serial>] [--fixture send|savings-deposit|savings-withdraw] [--viewport WxH] [--max-age <seconds>] [--remote] [--keep-status-bar]\nbun run clip ab --session <name> -- <browser args...>\nbun run clip stop --session <name> --out <path.mp4>\nbun run clip cleanup --session <name>";

export function parseClipArgs(args) {
  const [command, ...rest] = args;
  if (!["start", "ab", "stop", "cleanup"].includes(command)) throw new Error(usage);
  const allowed = command === "start" ? ["target", "session", "url", "device", "serial", "fixture", "viewport", "max-age", "remote", "keep-status-bar"] : command === "stop" ? ["session", "out"] : ["session"];
  const flags = {};
  let browserArgs = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--" && command === "ab") { browserArgs = rest.slice(i + 1); break; }
    const key = arg.startsWith("--") ? arg.slice(2) : "";
    if (!allowed.includes(key) || Object.hasOwn(flags, key)) throw new Error(`Unexpected or duplicate option: ${arg}`);
    if (["remote", "keep-status-bar"].includes(key)) flags[key] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
      flags[key] = value;
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(flags.session ?? "")) throw new Error("--session requires 1–48 letters, digits, underscores or hyphens");
  if (command === "start") {
    if (!["chromium", "webkit", "ios", "android"].includes(flags.target)) throw new Error("--target requires chromium, webkit, ios or android");
    if (flags.target === "webkit" && flags.remote) throw new Error("--remote is not supported by webkit");
    if (flags.fixture && flags.target !== "webkit") throw new Error("--fixture is supported only by webkit; use fixture-session for other targets");
    if (flags.fixture && !["send", "savings-deposit", "savings-withdraw"].includes(flags.fixture)) throw new Error("--fixture requires send, savings-deposit or savings-withdraw");
    flags.viewport = parseViewport(flags.viewport ?? "390x844");
    flags.maxAge = Number(flags["max-age"] ?? 600);
    delete flags["max-age"];
    if (!Number.isSafeInteger(flags.maxAge) || flags.maxAge < 1) throw new Error("--max-age requires a positive integer number of seconds");
    if (flags.target !== "chromium" && rest.includes("--viewport")) throw new Error("--viewport is supported only by chromium; device recordings keep the real screen");
    if (flags.target === "chromium" && flags.device) throw new Error("--device requires webkit, ios or android");
    if (flags.serial && flags.target !== "android") throw new Error("--serial requires android");
    if (flags["keep-status-bar"] && flags.target !== "android") throw new Error("--keep-status-bar requires android");
    if (flags["keep-status-bar"]) { flags.keepStatusBar = true; delete flags["keep-status-bar"]; }
    if (flags.serial && flags.device) throw new Error("Use either --serial or --device, not both");
    if (flags.url) {
      const url = new URL(flags.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("--url requires HTTP(S) without credentials");
    }
  }
  if (command === "stop" && !/\.mp4$/i.test(flags.out ?? "")) throw new Error("--out requires an .mp4 path");
  if (command === "ab") {
    if (!browserArgs.length) throw new Error("ab requires -- followed by browser arguments");
    assertBrowserArgs(browserArgs);
  }
  return { command, ...flags, browserArgs };
}

export function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match || Number(match[1]) < 167 || Number(match[1]) > 4096 || Number(match[2]) < 100 || Number(match[2]) > 4096) throw new Error("--viewport requires WxH, width between 167 and 4096 and height between 100 and 4096 CSS px");
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function assertBrowserArgs(args) {
  const reserved = ["--session", "--cdp", "-p", "--provider", "--device", "--auto-connect", "--profile", "--headed", "--config", "--pin-tab", "--no-pin-tab"];
  if (args.some((arg) => reserved.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) throw new Error("The clip session owns browser target flags; do not override them");
  if (["record", "close"].includes(args[0]) || (args[0] === "set" && args[1] === "viewport")) throw new Error("The clip session owns recording, viewport and browser cleanup");
}

export function assertFixtureNavigation(state, args) {
  if (state.target !== "android" || state.emulator) return;
  if (args[0] === "connect") throw new Error("Physical Android recordings cannot change the CDP connection");
  if (["tab", "batch", "run", "addscript", "addinitscript", "removeinitscript", "set", "cookies", "storage", "state"].includes(args[0]) || args.includes("--new-tab")) throw new Error("Physical Android recordings drive only their own pinned fixture tab");
  if (["open", "goto", "navigate"].includes(args[0])) {
    const url = args[1];
    const target = url && (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) || /^(about|data|file):/.test(url) ? url : `https://${url}`);
    if (!target || new URL(target).origin !== new URL(state.url).origin) throw new Error("Physical Android recordings allow only the session's fixture origin");
  }
}

export function assertFixtureTargets(targets, url, preexisting = [], ownTarget, foregroundTarget = ownTarget) {
  if (!Array.isArray(targets) || !ownTarget || !foregroundTarget) throw new Error("Could not inspect Android page targets");
  const pages = targets.filter((target) => target.type === "page");
  const onOrigin = (target) => { try { return new URL(target.url).origin === new URL(url).origin; } catch { return false; } };
  const own = pages.find((target) => (target.targetId ?? target.id) === ownTarget);
  const foreground = pages.find((target) => (target.targetId ?? target.id) === foregroundTarget);
  const newOffOrigin = pages.filter((target) => !preexisting.includes(target.targetId ?? target.id) && !onOrigin(target)).length;
  if (!own || !onOrigin(own) || !foreground || !onOrigin(foreground) || newOffOrigin) throw new Error(`Physical Android page left the fixture origin; recording discarded (own=${Boolean(own && onOrigin(own))}, foreground=${Boolean(foreground && onOrigin(foreground))}, new off-origin=${newOffOrigin})`);
}

export function assertSessionAge(state, now) {
  if (now - state.createdAt >= state.maxAge * 1000) throw new Error(`Clip session expired after ${state.maxAge}s; recording discarded`);
  if (state.target === "android" && state.recordingAt && now - state.recordingAt >= 170000) throw new Error("Android screenrecord has a 3-minute cap; record a shorter clip (30 seconds or less recommended)");
}

export function targetFlags(state) {
  const flags = ["--session", state.session];
  if (state.target === "android") {
    if (!Number.isInteger(state.cdpPort) || state.cdpPort < 1) throw new Error("Android session has no CDP port");
    flags.push("--cdp", String(state.cdpPort), "--pin-tab");
  } else if (state.target === "ios") {
    flags.push("-p", "ios");
    if (state.device) flags.push("--device", state.device);
  } else if (state.target !== "chromium") throw new Error("Unknown clip target");
  return flags;
}

const even = (n) => Math.round(n / 2) * 2;
export function validateChromiumViewport(viewport) {
  const { width, height, dpr } = viewport;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0) || dpr !== 2) throw new Error("Chromium requires a valid DPR2 viewport");
}
export function chromiumGeometry(raw, viewport, markerWidth) {
  validateChromiumViewport(viewport);
  const { width, height, dpr } = viewport;
  if (![raw.width, raw.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid Chromium capture geometry");
  if (Math.abs(raw.width - width * dpr) > 2 || Math.abs(raw.height - height * dpr) > 2) throw new Error("Chromium raw frame does not match the recorded DPR2 viewport; refusing to guess");
  if (!Number.isFinite(markerWidth) || markerWidth <= 0 || markerWidth > raw.width + 2) throw new Error("Chromium calibration marker not found or invalid; recording discarded");
  const restoredWidth = Math.abs(markerWidth - raw.width) <= 2 ? even(raw.width) : even(raw.width * raw.width / markerWidth);
  const output = { width: even(raw.width), height: even(raw.height) };
  return { ...output, restoredWidth, filter: restoredWidth === output.width ? null : `scale=${restoredWidth}:${output.height},crop=${output.width}:${output.height}:0:0,setsar=1` };
}

export function webkitGeometry(raw, viewport) {
  if (![raw.width, raw.height, viewport.width, viewport.height].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid WebKit capture geometry");
  if (raw.width !== Math.floor(viewport.width / 2) * 2 || raw.height !== Math.floor(viewport.height / 2) * 2) throw new Error("WebKit raw frame does not match the even-rounded CSS viewport; recording discarded");
  const width = viewport.width * 2, height = viewport.height * 2;
  return { width, height, filter: `scale=${width}:${height}:flags=lanczos,setsar=1` };
}

export function androidStatusBar(dump) {
  const failure = () => { throw new Error("Could not determine Android status bar height in device pixels; use --keep-status-bar to retain it explicitly"); };
  const display = dump.split(/(?=^\s*Display: mDisplayId=)/m).find((part) => /^\s*Display: mDisplayId=0\b/m.test(part));
  if (!display) return failure();
  const frame = /mDisplayFrame=Rect\(0,\s*0\s*-\s*(\d+),\s*(\d+)\)/.exec(display);
  const bars = [...display.matchAll(/\btype=statusBars\s+frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g)];
  if (!frame || !bars.length) return failure();
  const width = Number(frame[1]), height = Number(frame[2]);
  const heights = bars.map((bar) => Number(bar[4]));
  if (width < 2 || height < 2 || bars.some((bar) => Number(bar[1]) !== 0 || Number(bar[2]) !== 0 || Number(bar[3]) !== width) || heights.some((value) => value < 1 || value >= height / 2 || value !== heights[0])) return failure();
  return { width, height, statusBarHeight: heights[0] };
}

export function androidGeometry(raw, screen, statusBarHeight) {
  if (!screen || ![raw.width, raw.height, screen.width, screen.height, statusBarHeight].every((value) => Number.isSafeInteger(value) && value > 0) || raw.width !== screen.width || raw.height !== screen.height || statusBarHeight >= raw.height / 2) throw new Error("Android capture does not match the measured status bar geometry; refusing to guess (use --keep-status-bar at start to retain it)");
  const top = Math.ceil(statusBarHeight / 2) * 2;
  const width = Math.floor(raw.width / 2) * 2, height = Math.floor((raw.height - top) / 2) * 2;
  if (width < 2 || height < 2) throw new Error("Invalid Android crop dimensions");
  return { width, height, top, filter: `crop=${width}:${height}:0:${top},setsar=1` };
}

export function measureCalibration(pixels, width, rows = 16, fps = 30) {
  const frameSize = width * rows * 3;
  const matches = [];
  for (let frame = 0; frame < Math.floor(pixels.length / frameSize); frame++) {
    let markerWidth = 0;
    for (let x = 0; x < width; x++) {
      const i = frame * frameSize + (8 * width + x) * 3;
      if (Math.abs(pixels[i] - 17) > 35 || Math.abs(pixels[i + 1] - 233) > 35 || Math.abs(pixels[i + 2] - 71) > 35) break;
      markerWidth++;
    }
    if (markerWidth > width / 4) matches.push({ frame, width: markerWidth });
  }
  if (matches.length < 3) throw new Error("Capture calibration marker not found in at least three frames; recording discarded");
  const widths = matches.map((match) => match.width).sort((a, b) => a - b);
  const markerWidth = widths[Math.floor(widths.length / 2)];
  if (widths.at(-1) - widths[0] > 2) throw new Error("Capture calibration geometry changed during capture; recording discarded");
  return { markerWidth, trim: (matches.at(-1).frame + 2) / fps };
}

export function normalizationArgs(raw, out, filter, trim = 0) {
  const geometry = filter ?? "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1";
  return ["-y", "-i", raw, "-an", "-vf", trim ? `trim=start=${trim},setpts=PTS-STARTPTS,${geometry}` : geometry, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", out];
}

export function loopbackPort(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) return null;
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

export function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

export function previewLabel(state) {
  const size = `${state.css.width}×${state.css.height} CSS px`;
  if (state.target === "android") return `Android Chrome ${state.chromeVersion} (${state.model}${state.emulator ? " emulator" : ""}) ${size}${state.keepStatusBar ? " — status bar retained" : state.statusBarHeight ? " — status bar cropped" : ""}`;
  if (state.target === "webkit") return `WebKit ${state.webkitVersion} (Playwright ${state.device} profile) ${size}`;
  if (state.target === "ios") return `iOS Simulator ${state.model} Safari ${size}`;
  return `Chromium ${size}`;
}
export function selectAndroidDevice(devices, options) {
  const selected = options.serial ? devices.filter((device) => device.serial === options.serial)
    : options.device ? devices.filter((device) => [device.serial, device.model, device.avd].includes(options.device))
    : devices.some((device) => !device.serial.startsWith("emulator-")) ? devices.filter((device) => !device.serial.startsWith("emulator-")) : devices;
  if (selected.length !== 1) throw new Error(`Select one ready Android device with --serial or --device. Choices: ${devices.map((device) => `${device.model} (${device.serial}${device.avd ? `, ${device.avd}` : ""})`).join(", ") || "none"}`);
  return selected[0];
}

export function dndMode(value) {
  const modes = { "0": "all", "1": "priority", "2": "none", "3": "alarms" };
  if (!Object.hasOwn(modes, value)) throw new Error("Could not snapshot Android Do Not Disturb state; refusing full-screen recording");
  return modes[value];
}


export async function activateRecordedPage(cdp, marker, activate, excluded = []) {
  const { targetInfos } = await cdp.command("Target.getTargets");
  for (const target of targetInfos.filter((item) => item.type === "page" && !excluded.includes(item.targetId))) {
    const { sessionId } = await cdp.command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    try {
      const result = await cdp.command("Runtime.evaluate", { expression: `globalThis["home:clip:session"] === ${JSON.stringify(marker)}`, returnByValue: true }, sessionId);
      if (result.result?.value === true) { await activate(cdp, target.targetId, sessionId); return target.targetId; }
    } finally { await cdp.command("Target.detachFromTarget", { sessionId }); }
  }
  throw new Error("Could not find the driven Android tab; refusing to record a different screen");
}

export async function cleanupSteps(steps) {
  const failures = [];
  for (const [name, run] of steps) {
    try { await run(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
  }
  if (failures.length) throw new Error(`Clip cleanup failed:\n${failures.join("\n")}`);
}
