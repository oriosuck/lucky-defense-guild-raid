const MAX_DPR = 1.75;
const TARGET_FRAME_MS = 1000 / 30;

const RANGED_HINTS = [
  'archer', 'thrower', 'ranger', 'hunter', 'eagle', 'sheriff', 'warmachine',
  'rocketchu', 'roka', 'hailey', 'lancelot',
];
const MAGIC_HINTS = [
  'water', 'robot', 'shock', 'storm', 'gravity', 'coldi', 'blob', 'dragon',
  'tar', 'gigi', 'pulse', 'mage', 'monopoly', 'mama', 'frog', 'ato', 'ray',
  'watt', 'shaman', 'penguin',
];

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

function attackStyleFor(heroId = '') {
  if (RANGED_HINTS.some((hint) => heroId.includes(hint))) return 'ranged';
  if (MAGIC_HINTS.some((hint) => heroId.includes(hint))) return 'magic';
  return 'melee';
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

function drawSheetFrame(context, image, frameIndex, x, y, width, height) {
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  const columns = 4;
  const rows = 2;
  const sourceWidth = image.naturalWidth / columns;
  const sourceHeight = image.naturalHeight / rows;
  const sourceX = (frameIndex % columns) * sourceWidth;
  const sourceY = Math.floor(frameIndex / columns) * sourceHeight;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x + (width - drawWidth) / 2,
    y + height - drawHeight,
    drawWidth,
    drawHeight,
  );
}

class BattleCanvasRenderer {
  constructor(canvas, { monsterSrc, bossSrc, bossLayout, onImpact }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.supported = Boolean(this.context);
    this.monsterSrc = monsterSrc;
    this.bossSrc = bossSrc;
    this.bossLayout = bossLayout;
    this.onImpact = onImpact;
    this.imageCache = new Map();
    this.sprites = [];
    this.monsterCount = 0;
    this.paused = false;
    this.width = 0;
    this.height = 0;
    this.lastFrameAt = 0;
    this.visualTime = 0;
    this.animationFrame = null;
    this.lastImpactAt = -Infinity;
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
      sheetSource: node.dataset.canvasSheet || '',
      heroId: node.dataset.canvasHeroId || '',
      attackStyle: attackStyleFor(node.dataset.canvasHeroId),
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
    this.drawBoss(context);
    this.drawMonsters(context);
    for (const sprite of this.sprites) {
      const motion = this.heroMotion(sprite);
      this.drawHero(context, sprite, motion);
      this.drawAttackEffect(context, sprite, motion);
    }
  }

  heroMotion(sprite) {
    const cycleMs = 1650 + sprite.seed * 450;
    const phase = (this.visualTime / cycleMs + sprite.seed) % 1;
    const attackStart = 0.66;
    const attackPhase = phase >= attackStart ? (phase - attackStart) / (1 - attackStart) : -1;
    const idleFrame = Math.min(3, Math.floor((phase / attackStart) * 4));
    const attackFrame = Math.min(7, 4 + Math.floor(Math.max(0, attackPhase) * 4));
    return {
      attackPhase,
      frameIndex: attackPhase >= 0 ? attackFrame : idleFrame,
    };
  }

  drawBoss(context) {
    const boss = loadImage(this.imageCache, this.bossSrc);
    if (!boss?.complete || !this.bossLayout) return;
    const layout = this.bossLayout;
    const x = this.width * (layout.left / 100);
    const y = this.height * (layout.top / 100);
    const width = this.width * (layout.width / 100);
    const height = this.height * (layout.height / 100);
    const breathe = 1 + Math.sin(this.visualTime / 650) * 0.012;
    const hit = this.sprites.some((sprite) => {
      const phase = this.heroMotion(sprite).attackPhase;
      return phase > 0.58 && phase < 0.86;
    });
    if (hit && this.visualTime - this.lastImpactAt > 190) {
      this.lastImpactAt = this.visualTime;
      this.onImpact?.();
    }

    context.save();
    context.fillStyle = 'rgba(8, 7, 10, 0.34)';
    context.beginPath();
    context.ellipse(x + width / 2, y + height * 0.94, width * 0.29, height * 0.08, 0, 0, Math.PI * 2);
    context.fill();
    context.translate(x + width / 2, y + height);
    context.scale(1 / breathe, breathe);
    context.translate(-(x + width / 2), -(y + height));
    context.filter = hit
      ? 'brightness(1.55) drop-shadow(0 0 10px rgba(255, 207, 78, .9)) drop-shadow(0 6px 8px rgba(0, 0, 0, .45))'
      : 'drop-shadow(0 6px 8px rgba(0, 0, 0, .45))';
    drawContained(context, boss, x, y, width, height);
    context.restore();
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

  drawHero(context, sprite, motion) {
    const sheet = sprite.sheetSource ? loadImage(this.imageCache, sprite.sheetSource) : null;
    const image = sheet || loadImage(this.imageCache, sprite.source);
    if (!image?.complete) return;
    const boxWidth = this.width * sprite.width;
    const boxHeight = this.height * sprite.height;
    const baseX = this.width * sprite.left - boxWidth / 2;
    const baseY = this.height * sprite.top;

    context.save();
    context.fillStyle = 'rgba(12, 9, 7, 0.34)';
    context.beginPath();
    context.ellipse(
      baseX + boxWidth / 2,
      baseY + boxHeight,
      boxWidth * 0.22,
      Math.max(1.2, boxHeight * 0.035),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.filter = sprite.filter;
    if (sheet) {
      drawSheetFrame(context, sheet, motion.frameIndex, baseX, baseY, boxWidth, boxHeight);
    } else {
      // 전용 원화 프레임이 없는 캐릭터는 제자리 정지 이미지를 유지한다. 몸 전체를
      // 위아래로 흔들거나 회전시켜 가짜 모션을 만들지 않는다.
      drawContained(context, image, baseX, baseY, boxWidth, boxHeight);
    }
    context.restore();
  }

  drawAttackEffect(context, sprite, motion) {
    const { attackPhase } = motion;
    if (attackPhase < 0.18 || attackPhase > 0.9 || sprite.sheetSource) return;
    const local = (attackPhase - 0.18) / 0.72;
    const boxWidth = this.width * sprite.width;
    const boxHeight = this.height * sprite.height;
    const startX = this.width * sprite.left;
    const startY = this.height * sprite.top + boxHeight * 0.42;
    const alpha = local < 0.7 ? 1 : (1 - local) / 0.3;

    context.save();
    context.globalAlpha = Math.max(0, alpha) * 0.78;
    context.lineCap = 'round';

    // 보스까지 이어지는 공통 직선 투사체 대신 캐릭터 주변에서 끝나는 짧은 효과만
    // 사용한다. 전용 시트가 추가되면 이 보조 효과도 해당 프레임 원화로 대체된다.
    if (sprite.attackStyle === 'melee') {
      context.strokeStyle = '#fff0ae';
      context.lineWidth = Math.max(1.5, boxWidth * 0.05);
      context.beginPath();
      context.arc(startX, startY, Math.max(7, boxWidth * 0.42), Math.PI * 0.85, Math.PI * (0.85 + local * 0.7));
      context.stroke();
    } else if (sprite.attackStyle === 'ranged') {
      context.fillStyle = '#fff3a8';
      context.beginPath();
      context.arc(startX, startY, 2 + Math.sin(local * Math.PI) * Math.max(3, boxWidth * 0.12), 0, Math.PI * 2);
      context.fill();
    } else {
      context.strokeStyle = '#cfb2ff';
      context.lineWidth = Math.max(1.2, boxWidth * 0.035);
      context.beginPath();
      context.arc(startX, startY, 4 + local * Math.max(8, boxWidth * 0.32), 0, Math.PI * 2);
      context.stroke();
    }
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
