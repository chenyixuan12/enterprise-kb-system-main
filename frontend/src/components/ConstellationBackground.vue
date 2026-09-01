<template>
  <svg
    class="constellation-bg"
    :width="width"
    :height="height"
    aria-hidden="true"
  >
    <defs>
      <radialGradient :id="gradientId" cx="50%" cy="50%" r="50%">
        <stop offset="0%" :stop-color="color" stop-opacity="1" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </radialGradient>
    </defs>
    <g ref="lineGroupRef" class="ct-lines" />
    <g ref="nodeGroupRef" class="ct-nodes" />
  </svg>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  density: { type: Number, default: 8 },
  linkDistance: { type: Number, default: 150 },
  mouseRadius: { type: Number, default: 240 },
  nodeSize: { type: Number, default: 2.2 },
  color: { type: String, default: '#5b8def' },
  // SVG 性能护栏：粒子数与连线数都封顶，防止连线数随密度平方级增长
  maxParticles: { type: Number, default: 110 },
  maxLinksPerNode: { type: Number, default: 4 },
  maxLinks: { type: Number, default: 320 }
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const lineGroupRef = ref(null);
const nodeGroupRef = ref(null);
const width = ref(0);
const height = ref(0);
const gradientId = `ct-glow-${Math.random().toString(36).slice(2, 9)}`;

let particles = [];
let nodeEls = [];
let linePool = [];
let rafId = 0;
let reducedMotion = false;
const mouse = { x: -9999, y: -9999, active: false };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function seedParticles() {
  // 按照面积控制粒子密度，并限制 DOM 数量以保证性能
  const count = clamp(
    Math.round(((width.value * height.value) / 10000) * props.density),
    18,
    props.maxParticles
  );
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width.value,
    y: Math.random() * height.value,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.8
  }));
  buildNodes();
}

function buildNodes() {
  if (nodeGroupRef.value) nodeGroupRef.value.innerHTML = '';
  nodeEls = [];
  for (let i = 0; i < particles.length; i += 1) {
    const wrap = document.createElementNS(SVG_NS, 'g');
    wrap.setAttribute('opacity', '0.5');
    const glow = document.createElementNS(SVG_NS, 'circle');
    glow.setAttribute('r', props.nodeSize * 3.4);
    glow.setAttribute('fill', `url(#${gradientId})`);
    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('r', props.nodeSize);
    core.setAttribute('fill', props.color);
    wrap.appendChild(glow);
    wrap.appendChild(core);
    nodeGroupRef.value.appendChild(wrap);
    nodeEls.push({ wrap, glow, core });
  }
}

function drawLinks(links) {
  for (let i = 0; i < Math.max(links.length, linePool.length); i += 1) {
    if (i < links.length) {
      let line = linePool[i];
      if (!line) {
        line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('stroke', props.color);
        linePool[i] = line;
        lineGroupRef.value.appendChild(line);
      }
      const link = links[i];
      line.setAttribute('x1', link.x1);
      line.setAttribute('y1', link.y1);
      line.setAttribute('x2', link.x2);
      line.setAttribute('y2', link.y2);
      line.setAttribute('stroke-opacity', link.opacity);
      line.setAttribute('display', '');
    } else if (linePool[i]) {
      linePool[i].setAttribute('display', 'none');
    }
  }
}

function buildLinks() {
  const links = [];
  const link2 = props.linkDistance * props.linkDistance;
  const candidates = [];
  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    for (let j = i + 1; j < particles.length; j += 1) {
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < link2) {
        candidates.push({
          i,
          j,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          d: Math.sqrt(d2)
        });
      }
    }
  }
  candidates.sort((a, b) => a.d - b.d);

  // 贪心取最近邻：每个节点最多连接 maxLinksPerNode 条，总连线不超过 maxLinks
  const degree = new Array(particles.length).fill(0);
  for (const c of candidates) {
    if (links.length >= props.maxLinks) break;
    if (degree[c.i] >= props.maxLinksPerNode || degree[c.j] >= props.maxLinksPerNode) continue;
    degree[c.i] += 1;
    degree[c.j] += 1;
    links.push({
      x1: c.x1,
      y1: c.y1,
      x2: c.x2,
      y2: c.y2,
      opacity: (1 - c.d / props.linkDistance) * 0.5
    });
  }

  if (mouse.active) {
    for (let i = 0; i < particles.length && links.length < props.maxLinks; i += 1) {
      const p = particles[i];
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < props.mouseRadius * props.mouseRadius) {
        const d = Math.sqrt(d2);
        links.push({
          x1: mouse.x,
          y1: mouse.y,
          x2: p.x,
          y2: p.y,
          opacity: (1 - d / props.mouseRadius) * 0.4
        });
      }
    }
  }

  return links;
}

function tick(timestamp) {
  const now = timestamp / 1000;
  const w = width.value;
  const h = height.value;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    if (mouse.active) {
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const d2 = dx * dx + dy * dy;
      const radius2 = props.mouseRadius * props.mouseRadius;
      if (d2 < radius2 && d2 > 1) {
        const d = Math.sqrt(d2);
        const force = (1 - d / props.mouseRadius) * 0.05;
        p.vx += (dx / d) * force;
        p.vy += (dy / d) * force;
      }
    }

    p.vx += (Math.random() - 0.5) * 0.02;
    p.vy += (Math.random() - 0.5) * 0.02;
    const speed = Math.hypot(p.vx, p.vy);
    const maxSpeed = 0.6;
    if (speed > maxSpeed) {
      p.vx = (p.vx / speed) * maxSpeed;
      p.vy = (p.vy / speed) * maxSpeed;
    }
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < -10) { p.x = -10; p.vx = Math.abs(p.vx); }
    else if (p.x > w + 10) { p.x = w + 10; p.vx = -Math.abs(p.vx); }
    if (p.y < -10) { p.y = -10; p.vy = Math.abs(p.vy); }
    else if (p.y > h + 10) { p.y = h + 10; p.vy = -Math.abs(p.vy); }

    // 节点呼吸：透明度随相位缓慢变化
    const twinkle = 0.5 + 0.5 * Math.sin(now * p.speed + p.phase);
    nodeEls[i].wrap.setAttribute('opacity', 0.35 + 0.35 * twinkle);
    nodeEls[i].glow.setAttribute('cx', p.x);
    nodeEls[i].glow.setAttribute('cy', p.y);
    nodeEls[i].core.setAttribute('cx', p.x);
    nodeEls[i].core.setAttribute('cy', p.y);
  }

  drawLinks(buildLinks());
  rafId = requestAnimationFrame(tick);
}

function onResize() {
  width.value = window.innerWidth;
  height.value = window.innerHeight;
  seedParticles();
}

function onMouseMove(event) {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
  mouse.active = true;
}

function onMouseLeave() {
  mouse.active = false;
}

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  width.value = window.innerWidth;
  height.value = window.innerHeight;
  seedParticles();

  if (reducedMotion) {
    // 减少动态效果偏好：仅绘制一帧静态画面
    drawLinks([]);
    return;
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseout', onMouseLeave);
  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseout', onMouseLeave);
});
</script>

<style scoped>
.constellation-bg {
  position: absolute;
  inset: 0;
  display: block;
  animation: ct-fade-in 1.4s ease-out;
}

@keyframes ct-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>