<template>
  <canvas ref="canvasRef" class="bg-mesh" aria-hidden="true" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";

// Living mesh background for the hero. Floating nodes drift; when two come
// close they "connect" — both nodes type "connecting" then sit at "connected"
// while a tiny link readout shows latency + bandwidth. Pull them apart and
// they type "disconnecting" before going dark. Ported from fips-site.

const canvasRef = ref(null);
let cleanup = null;

const NODE_DENSITY = 0.000022;
const NODE_MIN = 10;
const NODE_MAX = 20;
const CONNECT_DIST = 240;
const DISCONNECT_DIST = 290;
const WL_SHORT_SCALE = 0.55;
const WL_LONG_SCALE = 1.85;
const HANDSHAKE_MS = 900;
const NODE_RADIUS = 6;
const DRIFT_NUDGE = 0.012;
const LATENCY_MIN_MS = 6;
const LATENCY_MAX_MS = 80;
const BW_MIN_MBPS = 4;
const BW_MAX_MBPS = 96;
const LINE_W_MIN = 0.8;
const LINE_W_MAX = 2.6;
const PACKET_SPAWN_PERIOD_MS = 650;
const PACKET_HOP_MS_MIN = 120;
const PACKET_HOP_MS_MAX = 900;
const PACKET_HOP_MS_PER_LATENCY = 9;
const PACKET_TAIL_FADE_HOPS = 1.4;

const COLOR_NODE = "#22d3ee";
const COLOR_NODE_GLOW = "rgba(34, 211, 238, 0.45)";
const COLOR_LABEL = "rgba(226, 232, 240, 0.92)";
const COLOR_LABEL_DIM = "rgba(136, 150, 171, 0.65)";
const COLOR_EDGE_CONNECTING = "rgba(245, 158, 11, ALPHA)";
const COLOR_EDGE_CONNECTED = "rgba(34, 211, 238, ALPHA)";
const COLOR_EDGE_DISCONNECTING = "rgba(248, 113, 113, ALPHA)";

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduceMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = reduceMotionMQ.matches;

  let width = 0;
  let height = 0;
  let nodes = [];
  const edges = new Map();
  let rafId = null;
  const start = performance.now();

  function edgeKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  function isWireless(a, b) {
    const h = ((a * 2654435761) ^ (b * 40503)) >>> 0;
    return h % 100 < 35;
  }
  function isLongRange(a, b) {
    if (!isWireless(a, b)) return false;
    const h = ((a * 1597) ^ (b * 1009)) >>> 0;
    return h % 100 < 12;
  }

  function rangesFor(a, b) {
    if (isLongRange(a, b)) {
      return {
        connect: CONNECT_DIST * WL_LONG_SCALE,
        disconnect: DISCONNECT_DIST * WL_LONG_SCALE,
      };
    }
    if (isWireless(a, b)) {
      return {
        connect: CONNECT_DIST * WL_SHORT_SCALE,
        disconnect: DISCONNECT_DIST * WL_SHORT_SCALE,
      };
    }
    return { connect: CONNECT_DIST, disconnect: DISCONNECT_DIST };
  }

  function rebuildNodes() {
    const area = Math.max(1, width * height);
    const count = Math.min(
      NODE_MAX,
      Math.max(NODE_MIN, Math.round(area * NODE_DENSITY)),
    );
    nodes = [];
    edges.clear();
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '10px "JetBrains Mono", monospace';
    rebuildNodes();
  }

  function tickPhysics(dtMs) {
    if (reduceMotion) return;
    const dt = Math.min(dtMs, 32) / 16;
    const pad = 12;
    for (const n of nodes) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vx *= 0.998;
      n.vy *= 0.998;
      n.vx += (Math.random() - 0.5) * DRIFT_NUDGE;
      n.vy += (Math.random() - 0.5) * DRIFT_NUDGE;
      const speed = Math.hypot(n.vx, n.vy);
      const cap = 1.4;
      if (speed > cap) {
        n.vx = (n.vx / speed) * cap;
        n.vy = (n.vy / speed) * cap;
      }
      if (n.x < pad) {
        n.x = pad;
        n.vx = Math.abs(n.vx);
      }
      if (n.x > width - pad) {
        n.x = width - pad;
        n.vx = -Math.abs(n.vx);
      }
      if (n.y < pad) {
        n.y = pad;
        n.vy = Math.abs(n.vy);
      }
      if (n.y > height - pad) {
        n.y = height - pad;
        n.vy = -Math.abs(n.vy);
      }
    }
  }

  function tickEdges(now) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        const key = edgeKey(a.id, b.id);
        const existing = edges.get(key);
        const r = rangesFor(a.id, b.id);

        if (!existing) {
          if (d < r.connect) {
            edges.set(key, {
              a: a.id,
              b: b.id,
              state: "connecting",
              startedAt: now,
            });
          }
          continue;
        }

        const age = now - existing.startedAt;
        if (existing.state === "connecting") {
          if (d > r.disconnect) {
            edges.delete(key);
          } else if (age >= HANDSHAKE_MS) {
            existing.state = "connected";
            existing.startedAt = now;
          }
        } else if (existing.state === "connected") {
          if (d > r.disconnect) {
            existing.state = "disconnecting";
            existing.startedAt = now;
          }
        } else if (existing.state === "disconnecting") {
          if (d < r.connect) {
            existing.state = "connected";
          } else if (age >= HANDSHAKE_MS) {
            edges.delete(key);
          }
        }
      }
    }
  }

  function nodeStatus(idx, now) {
    let connecting = null;
    let disconnecting = null;
    for (const e of edges.values()) {
      if (e.a !== idx && e.b !== idx) continue;
      if (e.state === "connecting") {
        if (!connecting || e.startedAt > connecting.startedAt) connecting = e;
      } else if (e.state === "disconnecting") {
        if (!disconnecting || e.startedAt > disconnecting.startedAt)
          disconnecting = e;
      }
    }

    const handshake = connecting ?? disconnecting;
    if (handshake) {
      const text =
        handshake.state === "connecting" ? "connecting…" : "disconnecting…";
      const t = (now - handshake.startedAt) / HANDSHAKE_MS;
      const revealed = Math.min(text.length, Math.ceil(t * text.length));
      const alpha = t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
      return { kind: "typing", text, revealed, alpha };
    }
    return { kind: "idle" };
  }

  function linkStrength(d, disconnect) {
    return Math.max(0, Math.min(1, 1 - d / disconnect));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function drawEdges(now) {
    for (const e of edges.values()) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      if (!a || !b) continue;
      const r = rangesFor(e.a, e.b);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const strength = linkStrength(dist, r.disconnect);
      const age = now - e.startedAt;
      let alpha = 0.45;
      let template = COLOR_EDGE_CONNECTED;
      let lineW = lerp(LINE_W_MIN, LINE_W_MAX, strength);
      if (e.state === "connecting") {
        alpha = Math.min(0.6, age / HANDSHAKE_MS);
        template = COLOR_EDGE_CONNECTING;
        lineW = 1;
      } else if (e.state === "disconnecting") {
        alpha = Math.max(0, 0.6 * (1 - age / HANDSHAKE_MS));
        template = COLOR_EDGE_DISCONNECTING;
        lineW = lerp(LINE_W_MIN, LINE_W_MAX, strength) * (1 - age / HANDSHAKE_MS);
      }
      ctx.strokeStyle = template.replace("ALPHA", alpha.toFixed(3));
      ctx.lineWidth = lineW;
      if (isLongRange(e.a, e.b)) {
        ctx.setLineDash([Math.max(3, lineW * 1.4), Math.max(7, lineW * 4)]);
      } else if (isWireless(e.a, e.b)) {
        ctx.setLineDash([Math.max(2, lineW * 1.2), Math.max(3, lineW * 2.4)]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (e.state === "connected") {
        drawLinkStats(a, b, dist, strength);
      }
    }
  }

  function latencyMsFor(idA, idB) {
    const a = nodes[idA];
    const b = nodes[idB];
    if (!a || !b) return LATENCY_MAX_MS;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const r = rangesFor(idA, idB);
    const strength = linkStrength(dist, r.disconnect);
    return lerp(LATENCY_MAX_MS, LATENCY_MIN_MS, strength);
  }

  function packetHopMs(idA, idB) {
    const ms = latencyMsFor(idA, idB) * PACKET_HOP_MS_PER_LATENCY;
    return Math.max(PACKET_HOP_MS_MIN, Math.min(PACKET_HOP_MS_MAX, ms));
  }

  function drawLinkStats(a, b, dist, strength) {
    if (dist < 110) return;
    const latency = Math.round(lerp(LATENCY_MAX_MS, LATENCY_MIN_MS, strength));
    const bw = Math.round(lerp(BW_MIN_MBPS, BW_MAX_MBPS, strength));
    const text = `${latency}ms · ${bw} Mb/s`;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    const nx = -dy / norm;
    const ny = dx / norm;
    const px = mx + nx * 8;
    const py = my + ny * 8;
    ctx.save();
    ctx.fillStyle = COLOR_LABEL_DIM;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px, py);
    ctx.restore();
  }

  function drawLabel(x, y, text, revealed, alpha) {
    const slice = text.slice(0, revealed);
    ctx.fillStyle = COLOR_LABEL.replace("0.92", (0.92 * alpha).toFixed(3));
    ctx.textAlign = "center";
    ctx.fillText(slice, x, y);
    if (revealed < text.length) {
      const caretX = x + ctx.measureText(slice).width / 2 + 1;
      ctx.fillStyle = COLOR_LABEL_DIM;
      ctx.fillRect(caretX, y - 8, 1, 9);
    }
  }

  function drawNodes(now) {
    const labelOffset = NODE_RADIUS + 18;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const grad = ctx.createRadialGradient(
        n.x,
        n.y,
        0,
        n.x,
        n.y,
        NODE_RADIUS * 4,
      );
      grad.addColorStop(0, COLOR_NODE_GLOW);
      grad.addColorStop(1, "rgba(34, 211, 238, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_RADIUS * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLOR_NODE;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      const status = nodeStatus(i, now);
      if (status.kind === "typing") {
        drawLabel(
          n.x,
          n.y - labelOffset,
          status.text,
          status.revealed,
          status.alpha,
        );
      }
    }
  }

  const packets = [];
  let lastSpawn = 0;

  function buildRoutedPath() {
    const adj = new Map();
    for (const e of edges.values()) {
      if (e.state !== "connected") continue;
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    const sources = [...adj.keys()];
    if (sources.length === 0) return null;
    const src = sources[Math.floor(Math.random() * sources.length)];

    const dist = new Map();
    const parent = new Map();
    dist.set(src, 0);
    const queue = [src];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adj.get(cur) ?? []) {
        if (dist.has(nb)) continue;
        dist.set(nb, dist.get(cur) + 1);
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
    const farEnough = [...dist.entries()].filter(([, d]) => d >= 2 && d <= 4);
    const pool =
      farEnough.length > 0
        ? farEnough
        : [...dist.entries()].filter(([, d]) => d >= 1);
    if (pool.length === 0) return null;
    const [target] = pool[Math.floor(Math.random() * pool.length)];

    const path = [];
    let cur = target;
    while (cur !== undefined) {
      path.unshift(cur);
      cur = parent.get(cur);
    }
    return path;
  }

  function maybeSpawnPacket(now) {
    const due = lastSpawn + PACKET_SPAWN_PERIOD_MS + Math.random() * 400;
    if (now < due) return;
    const path = buildRoutedPath();
    lastSpawn = now;
    if (!path || path.length < 2) return;
    packets.push({ path, startedAt: now });
  }

  function drawPackets(now) {
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      const hopMs = [];
      let total = 0;
      for (let h = 0; h < p.path.length - 1; h++) {
        const ms = packetHopMs(p.path[h], p.path[h + 1]);
        hopMs.push(ms);
        total += ms;
      }
      const elapsed = now - p.startedAt;
      if (elapsed >= total) {
        packets.splice(i, 1);
        continue;
      }
      drawPacketAtMs(elapsed, p.path, hopMs, 1);
      const avgHop = total / hopMs.length;
      const trailSteps = 4;
      for (let s = 1; s <= trailSteps; s++) {
        const back =
          elapsed - (s / trailSteps) * PACKET_TAIL_FADE_HOPS * avgHop;
        if (back < 0) break;
        drawPacketAtMs(back, p.path, hopMs, 1 - s / (trailSteps + 1));
      }
    }
  }

  function drawPacketAtMs(elapsed, path, hopMs, alpha) {
    if (elapsed < 0) return;
    let idx = 0;
    let into = elapsed;
    while (idx < hopMs.length && into >= hopMs[idx]) {
      into -= hopMs[idx];
      idx++;
    }
    if (idx >= hopMs.length) return;
    const t = into / hopMs[idx];
    const a = nodes[path[idx]];
    const b = nodes[path[idx + 1]];
    if (!a || !b) return;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const r = 1.4 + 1.4 * alpha;
    ctx.fillStyle = `rgba(186, 244, 255, ${(alpha * 0.95).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  let lastFrame = start;
  function frame(now) {
    const dt = now - lastFrame;
    lastFrame = now;
    tickPhysics(dt);
    tickEdges(now);
    maybeSpawnPacket(now);
    ctx.clearRect(0, 0, width, height);
    drawEdges(now);
    drawPackets(now);
    drawNodes(now);
    rafId = requestAnimationFrame(frame);
  }

  function onMotionChange(ev) {
    reduceMotion = ev.matches;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  rafId = requestAnimationFrame(frame);
  reduceMotionMQ.addEventListener?.("change", onMotionChange);

  cleanup = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    ro.disconnect();
    reduceMotionMQ.removeEventListener?.("change", onMotionChange);
  };
});

onBeforeUnmount(() => {
  if (cleanup) cleanup();
});
</script>

<style scoped>
.bg-mesh {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.9) 14%,
    rgba(0, 0, 0, 0.9) 80%,
    rgba(0, 0, 0, 0) 100%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.9) 14%,
    rgba(0, 0, 0, 0.9) 80%,
    rgba(0, 0, 0, 0) 100%
  );
}
</style>
