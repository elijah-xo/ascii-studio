import { dustSelected, rectangleMask, paintMask, MASK_SIZE, reverseWind } from "./model.mjs";

const $ = (id) => document.getElementById(id);

function bounds(map) {
  const l = map.lattice, rows = map.map.replace(/\n$/, "").split("\n").length;
  const scale = 0.9 / Math.max(map.columns * l.px, rows * l.py + l.dim_dy);
  return { x: (1 - map.columns * l.px * scale) / 2, y: (1 - (rows * l.py + l.dim_dy) * scale) / 2,
    width: map.columns * l.px * scale, height: rows * l.py * scale };
}

export function setupAnimation({ getMap, getSettings, isPortraitReady, onCommit, onDownload, onChange = () => {} }) {
  let visible = false, renderer = null, playing = false, elapsed = 0, previous = 0, frame;
  let previewTimer, revision = 0, ready = false, selecting = false, selection = null;
  let signature = "", videoAbort = null;
  let cursor = { x: 0.5, y: 0.5 };

  function payload(size = 1024) {
    const map = getMap(), s = getSettings();
    return { map: map.map, columns: map.columns, size, duration: s.duration, autoplay: s.webAutoplay, angle: s.windAngle,
      strength: s.windStrength, density: s.dustDensity,
      mask: s.dustMask,
      ...(s.dustTint ? { dust: s.dustColor } : {}),
      region: [s.dustLeft, s.dustTop, s.dustRight, s.dustBottom],
      radius: s.radius, bg: s.bg, ink: s.ink, shadow: s.shadow };
  }

  function buttons() {
    const enabled = ready && isPortraitReady();
    $("play-animation").disabled = $("restart-animation").disabled = $("animation-scrub").disabled = !enabled;
    $("export-html").disabled = $("export-video").disabled = $("export-website").disabled = !enabled || !!videoAbort;
    $("animation-controls").disabled = !!videoAbort;
    $("videoSize").disabled = !!videoAbort;
  }

  function regionOutline() {
    if (!getMap()) return;
    const b = bounds(getMap()), s = getSettings(), box = $("dust-region");
    box.hidden = !visible || !selecting || !!s.dustMask;
    box.style.left = `${100 * (b.x + b.width * s.dustLeft)}%`;
    box.style.top = `${100 * (b.y + b.height * s.dustTop)}%`;
    box.style.width = `${100 * b.width * (s.dustRight - s.dustLeft)}%`;
    box.style.height = `${100 * b.height * (s.dustBottom - s.dustTop)}%`;
    const rows = getMap().map.replace(/\n$/, "").split("\n");
    let count = 0;
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if ("#.@rq".includes(c) && (s.dustMask ? dustSelected(s, (x + 0.5) / getMap().columns, (y + 0.5) / rows.length)
        : x >= Math.floor(s.dustLeft * getMap().columns) && x < Math.ceil(s.dustRight * getMap().columns)
        && y >= Math.floor(s.dustTop * rows.length) && y < Math.ceil(s.dustBottom * rows.length))) count++;
    }));
    $("region-summary").textContent = count ? `${count.toLocaleString()} dots in the dust area.` : "This area has no dots. Select part of the figure.";
    const overlay = $("selection-overlay"), ctx = overlay.getContext("2d");
    overlay.hidden = !visible || !selecting;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (overlay.hidden) return;
    if (s.dustMask) {
      ctx.fillStyle = "#79c8ed55";
      for (let i = 0; i < s.dustMask.length; i++) if (s.dustMask[i] === "1") {
        ctx.fillRect((b.x + i % MASK_SIZE / MASK_SIZE * b.width) * overlay.width,
          (b.y + Math.floor(i / MASK_SIZE) / MASK_SIZE * b.height) * overlay.height,
          b.width * overlay.width / MASK_SIZE + 0.5, b.height * overlay.height / MASK_SIZE + 0.5);
      }
    }
    if ($("selection-tool").value !== "rectangle") {
      ctx.strokeStyle = "#bdeaff"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.ellipse((b.x + cursor.x * b.width) * overlay.width, (b.y + cursor.y * b.height) * overlay.height,
        Number($("brush-size").value) / 100 * b.width * overlay.width,
        Number($("brush-size").value) / 100 * b.height * overlay.height, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function labels() {
    const s = getSettings();
    $("duration-value").value = `${s.duration} seconds`;
    $("windAngle-value").value = `${s.windAngle}°`;
    $("windStrength-value").value = `${s.windStrength.toFixed(2)}×`;
    $("dustDensity-value").value = `${Math.round(s.dustDensity * 100)}%`;
    $("animation-scrub").max = s.duration;
    regionOutline();
  }

  function drawFrame() {
    if (!renderer) return;
    const duration = getSettings().duration;
    elapsed = Math.max(0, Math.min(elapsed, duration));
    renderer.render(elapsed);
    $("animation-scrub").value = elapsed;
    $("animation-time").value = `${elapsed.toFixed(1)} / ${duration.toFixed(1)} s`;
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);
    $("play-animation").textContent = "Play";
  }

  function tick(now) {
    if (!playing || !visible) return;
    elapsed = (elapsed + (now - previous) / 1000) % getSettings().duration;
    previous = now;
    drawFrame();
    frame = requestAnimationFrame(tick);
  }

  function setSelecting(value) {
    selecting = value;
    if (value) pause();
    $("select-region").setAttribute("aria-pressed", String(value));
    $("select-region").textContent = value ? "Finish selecting ✓" : "Draw dust area ↗";
    $("region-selector").hidden = !value || !visible;
    if (value) $("motion-compare").checked = false;
    comparison();
    regionOutline();
  }

  function comparison() {
    const enabled = visible && $("motion-compare").checked && !selecting;
    const split = Number($("motion-split").value);
    $("motion-comparison-controls").hidden = $("motion-divider").hidden = $("motion-labels").hidden = !enabled;
    $("animation-preview").style.clipPath = enabled ? `inset(0 0 0 ${split}%)` : "none";
    $("motion-divider").style.left = `${split}%`;
    $("motion-split-value").value = `${split}%`;
  }
  $("motion-compare").addEventListener("change", () => {
    if ($("motion-compare").checked) setSelecting(false);
    comparison();
  });
  $("motion-split").addEventListener("input", comparison);

  async function post(path, data, signal) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(typeof error.detail === "string" ? error.detail : "The animation could not be processed.");
    }
    return response;
  }

  async function build(current, data, key) {
    try {
      const response = await post("/api/animation/scene", data);
      const scene = await response.json();
      if (current !== revision || !visible) return;
      renderer = window.createDotScene(scene, $("animation-preview"), true);
      signature = key;
      ready = true;
      drawFrame();
      $("animation-status").textContent = "Loop ready. Play, scrub, or choose a dust area.";
    } catch (error) {
      if (current === revision) $("animation-status").textContent = error.message;
    } finally { buttons(); }
  }

  function invalidate() {
    revision++;
    ready = false;
    pause();
    clearTimeout(previewTimer);
    buttons();
    if (visible) $("animation-status").textContent = "Updating the animation…";
  }

  function refresh() {
    labels();
    onChange();
    if (!visible || !getMap() || !isPortraitReady()) return;
    const data = payload(), key = JSON.stringify(data);
    if (key === signature && renderer) {
      if (!ready) invalidate();
      ready = true; drawFrame(); buttons(); return;
    }
    invalidate();
    const current = revision;
    previewTimer = setTimeout(() => build(current, data, key), 200);
  }

  $("play-animation").addEventListener("click", () => {
    if (playing) { pause(); return; }
    if (!ready) return;
    setSelecting(false);
    if (elapsed >= getSettings().duration) elapsed = 0;
    playing = true; previous = performance.now();
    $("play-animation").textContent = "Pause";
    frame = requestAnimationFrame(tick);
  });
  $("restart-animation").addEventListener("click", () => { elapsed = 0; drawFrame(); });
  $("animation-scrub").addEventListener("input", () => { pause(); elapsed = Number($("animation-scrub").value); drawFrame(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  $("select-region").addEventListener("click", () => setSelecting(!selecting));
  $("selection-tool").addEventListener("change", () => setSelecting(true));
  $("brush-size").addEventListener("input", () => {
    $("brush-size-value").value = `${$("brush-size").value}%`; regionOutline();
  });
  $("whole-region").addEventListener("click", () => {
    $("dustMask").value = "";
    $("dustLeft").value = $("dustTop").value = 0;
    $("dustRight").value = $("dustBottom").value = 1;
    onCommit(); refresh();
  });
  $("clear-region").addEventListener("click", () => {
    $("dustMask").value = "0".repeat(4096); onCommit(); refresh();
  });
  for (const id of ["duration", "windAngle", "windStrength", "dustDensity", "dustLeft", "dustTop", "dustRight", "dustBottom"]) {
    $(id).addEventListener("input", () => {
      if (id.startsWith("dust") && id !== "dustDensity") $("dustMask").value = "";
      if (id === "dustLeft") $(id).value = Math.min(Number($(id).value), Number($("dustRight").value) - 0.01);
      if (id === "dustRight") $(id).value = Math.max(Number($(id).value), Number($("dustLeft").value) + 0.01);
      if (id === "dustTop") $(id).value = Math.min(Number($(id).value), Number($("dustBottom").value) - 0.01);
      if (id === "dustBottom") $(id).value = Math.max(Number($(id).value), Number($("dustTop").value) + 0.01);
      refresh();
    });
    $(id).addEventListener("change", onCommit);
  }
  $("videoSize").addEventListener("change", onCommit);
  $("reverse-wind").addEventListener("click", () => {
    $("windAngle").value = reverseWind(Number($("windAngle").value)); onCommit(); refresh();
  });
  $("dustColor").addEventListener("input", () => { $("dustTint").checked = true; refresh(); });
  $("dustColor").addEventListener("change", onCommit);
  $("dustTint").addEventListener("change", () => { onCommit(); refresh(); });

  function point(event) {
    const rect = $("region-selector").getBoundingClientRect(), b = bounds(getMap());
    const clamp = (n) => Math.min(1, Math.max(0, n));
    return { x: clamp(((event.clientX - rect.left) / rect.width - b.x) / b.width),
      y: clamp(((event.clientY - rect.top) / rect.height - b.y) / b.height) };
  }
  function paint(start, end) {
    $("dustMask").value = paintMask($("dustMask").value || rectangleMask(getSettings()), start, end,
      Number($("brush-size").value) / 100, $("selection-tool").value === "erase");
  }
  $("region-selector").addEventListener("keydown", event => {
    if (!ready || videoAbort) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (direction) {
      event.preventDefault();
      const step = (event.shiftKey ? 4 : 1) / MASK_SIZE;
      cursor = { x: Math.max(0, Math.min(1, cursor.x + direction[0] * step)), y: Math.max(0, Math.min(1, cursor.y + direction[1] * step)) };
      regionOutline();
    } else if (event.code === "Space" && $("selection-tool").value !== "rectangle") {
      event.preventDefault(); paint(cursor, cursor); onCommit(); refresh();
    } else if (event.key === "Escape") { event.preventDefault(); setSelecting(false); }
  });
  $("region-selector").addEventListener("pointerdown", (event) => {
    if (!ready || selection || videoAbort || event.button !== 0 || event.isPrimary === false) return;
    cursor = point(event);
    selection = { start: cursor, last: cursor, pointer: event.pointerId };
    if ($("selection-tool").value !== "rectangle") paint(cursor, cursor);
    onChange();
    regionOutline();
    $("region-selector").setPointerCapture(event.pointerId);
    $("region-selector").focus({ preventScroll: true });
    event.preventDefault();
  });
  $("region-selector").addEventListener("pointermove", (event) => {
    cursor = point(event);
    if (!selection) { regionOutline(); return; }
    if (!selection || selection.pointer !== event.pointerId) return;
    const end = cursor, start = selection.start;
    if ($("selection-tool").value === "rectangle") {
      $("dustMask").value = "";
      $("dustLeft").value = Math.min(0.99, Math.min(start.x, end.x));
      $("dustRight").value = Math.max(Number($("dustLeft").value) + 0.01, Math.max(start.x, end.x));
      $("dustTop").value = Math.min(0.99, Math.min(start.y, end.y));
      $("dustBottom").value = Math.max(Number($("dustTop").value) + 0.01, Math.max(start.y, end.y));
    } else paint(selection.last, end);
    selection.last = end;
    labels();
    onChange();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("region-selector").addEventListener(event, (pointer) => {
    if (selection?.pointer === pointer.pointerId) { selection = null; onCommit(); refresh(); }
  });

  $("export-html").addEventListener("click", async () => {
    if (!ready || videoAbort) return;
    $("export-html").disabled = true;
    try { const response = await post("/api/animation/html", payload()); onDownload(await response.blob(), "html"); }
    catch (error) { $("animation-status").textContent = error.message; }
    finally { buttons(); }
  });

  $("export-website").addEventListener("click", async () => {
    if (!ready || videoAbort) return;
    $("export-website").disabled = true;
    try {
      const response = await post("/api/animation/website", payload());
      onDownload(await response.blob(), "zip");
      $("animation-status").textContent = "Website kit downloaded: animation, still fallback, embed example, and instructions.";
    } catch (error) { $("animation-status").textContent = error.message; }
    finally { buttons(); }
  });

  $("cancel-video").addEventListener("click", () => videoAbort?.abort());
  $("export-video").addEventListener("click", async () => {
    if (!ready || videoAbort) return;
    videoAbort = new AbortController();
    buttons();
    $("video-progress-area").hidden = false;
    $("cancel-video").hidden = false;
    $("video-progress").value = 0;
    $("video-status").textContent = "Starting export. Later edits apply to your next video.";
    let completed = false;
    try {
      const response = await post("/api/animation/video", payload(getSettings().videoSize), videoAbort.signal);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "progress") {
            $("video-progress").value = event.progress;
            $("video-status").textContent = `${event.message} ${Math.round(event.progress * 100)}%`;
          }
          if (event.type === "complete") {
            const binary = atob(event.data), bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            onDownload(new Blob([bytes], { type: "video/mp4" }), "mp4");
            completed = true;
            $("video-progress").value = 1;
            $("video-status").textContent = "MP4 downloaded. Your loop is ready.";
          }
        }
      }
      if (!completed) throw new Error("The export connection ended before the video was ready. Try again.");
    } catch (error) {
      $("video-status").textContent = error.name === "AbortError" ? "Export cancelled. The renderer is stopping; wait a moment before retrying." : error.message;
      videoAbort.abort();
    } finally {
      videoAbort = null;
      $("cancel-video").hidden = true;
      buttons();
    }
  });

  return {
    refresh, invalidate,
    enter() { visible = true; $("animation-preview").hidden = $("animation-player").hidden = false; setSelecting(selecting); refresh(); },
    exit() { visible = false; pause(); setSelecting(false); $("animation-preview").hidden = $("animation-player").hidden = true; },
  };
}
