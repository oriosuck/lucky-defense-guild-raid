const MAX_DPR = 1.75;
const TARGET_FRAME_MS = 1000 / 30;

function numberFromPercent(value) {
  return Number.parseFloat(value || '0') / 100;
}

function hashSeed(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function loadImage(cache, source) {
  if (!source) return null;
  if (cache.has(source)) return cache.get(source);
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  cache.set(source, image);
  return image;
}

function drawContained(context, image, x, y, width, height) {
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + height - drawHeight,
    drawWidth,
    drawHeight,
  );
}

class BattleCanvasRenderer {
  constructor(canvas, { monsterSrc }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.supported = Boolean(this.context);
    this.monsterSrc = monsterSrc;
    this.imageCache = new Map();
    this.sprites = [];
    this.monsterCount = 0;
    this.paused = false;
    this.width = 0;
    this.height = 0;
    this.lastFrameAt = 0;
    this.visualTime = 0;
    this.animationFrame = null;
    this.visible = !document.hidden;
    this.handleVisibility = () => {
      this.visible = !document.hidden;
      if (this.visible) this.start();
    };
    document.addEventListener('visibilitychange', this.handleVisibility);
    if (this.supported) this.start();
  }

  sync(stage, state) {
    if (!this.supported || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.resize(rect.width, rect.height);
    this.paused = Boolean(state.paused);
    this.monsterCount = Math.min(12, Math.ceil(state.monsterCount || 0));
    this.sprites = [...stage.querySelectorAll('.stage-hero-token[data-canvas-src]')].map((node) => ({
      source: node.dataset.canvasSrc,
      seed: hashSeed(node.dataset.canvasSeed),
      left: numberFromPercent(node.style.left),
      top: numberFromPercent(node.style.top),
      width: numberFromPercent(node.style.width),
      height: numberFromPercent(node.style.height),
      filter: node.dataset.canvasFilter || 'none',
      row: Number(node.dataset.canvasRow || 0),
    })).sort((a, b) => a.row - b.row);
  }

  resize(width, height) {
    const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.width = width;
    this.height = height;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    if (!this.supported || !this.visible || this.animationFrame) return;
    const frame = (now) => {
      this.animationFrame = null;
      if (!this.visible) return;
      if (!this.lastFrameAt) this.lastFrameAt = now;
      const elapsed = Math.min(100, now - this.lastFrameAt);
      if (elapsed >= TARGET_FRAME_MS) {
        this.lastFrameAt = now;
        if (!this.paused) this.visualTime += elapsed;
        this.draw();
      }
      this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  draw() {
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    this.drawMonsters(context);
    for (const sprite of this.sprites) this.drawHero(context, sprite);
  }

  drawMonsters(context) {
    if (!this.monsterCount) return;
    const monster = loadImage(this.imageCache, this.monsterSrc);
    if (!monster?.complete) return;
    const visibleCount = Math.min(8, this.monsterCount);
    for (let index = 0; index < visibleCount; index += 1) {
      const lane = index % 3;
      const seed = hashSeed(`monster-${index}`);
      const cycle = (this.visualTime * (0.000025 + seed * 0.000012) + seed) % 1;
      const fromLeft = index % 2 === 0;
      const xProgress = fromLeft ? cycle : 1 - cycle;
      const x = this.width * (0.08 + xProgress * 0.84);
      const y = this.height * (0.385 + lane * 0.012) + Math.sin(this.visualTime / 180 + index) * 1.5;
      const size = this.width * (0.045 + lane * 0.004);
      context.save();
      context.globalAlpha = 0.58;
      context.translate(x, y);
      if (!fromLeft) context.scale(-1, 1);
      drawContained(context, monster, -size / 2, -size, size, size);
      context.restore();
    }
  }

  drawHero(context, sprite) {
    const image = loadImage(this.imageCache, sprite.source);
    if (!image?.complete) return;
    const boxWidth = this.width * sprite.width;
    const boxHeight = this.height * sprite.height;
    const baseX = this.width * sprite.left - boxWidth / 2;
    const baseY = this.height * sprite.top;
    const phase = (this.visualTime / (1050 + sprite.seed * 650) + sprite.seed) % 1;
    const idle = Math.sin((this.visualTime / 420) + sprite.seed * Math.PI * 2) * Math.min(2.5, boxHeight * 0.018);
    const attackPhase = phase > 0.76 ? (phase - 0.76) / 0.24 : -1;
    const lunge = attackPhase >= 0 ? Math.sin(Math.PI * attackPhase) * Math.min(7, boxWidth * 0.14) : 0;
    const squash = attackPhase >= 0 ? 1 - Math.sin(Math.PI * attackPhase) * 0.035 : 1;

    context.save();
    context.fillStyle = 'rgba(12, 9, 7, 0.34)';
    context.beginPath();
    context.ellipse(
      baseX + boxWidth / 2 + lunge,
      baseY + boxHeight,
      boxWidth * 0.22,
      Math.max(1.2, boxHeight * 0.035),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

    context.translate(baseX + boxWidth / 2 + lunge, baseY + boxHeight);
    context.scale(1 / squash, squash);
    context.translate(-(baseX + boxWidth / 2 + lunge), -(baseY + boxHeight));
    context.filter = sprite.filter;
    drawContained(context, image, baseX + lunge, baseY + idle, boxWidth, boxHeight);
    context.restore();
  }

  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.imageCache.clear();
  }
}

export function createBattleCanvas(canvas, options) {
  return new BattleCanvasRenderer(canvas, options);
}
