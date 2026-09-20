const MAX_DPR = 1.75;
const TARGET_FRAME_MS = 1000 / 30;

const RANGED_HINTS = [
  'archer', 'thrower', 'ranger', 'hunter', 'eagle', 'sheriff', 'warmachine',
  'rocketchu', 'roka', 'hailey', 'bane', 'batman', 'lancelot',
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

function easeInOut(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function easeOut(value) {
  return 1 - ((1 - value) ** 3);
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
    const phase = (this.visualTime / (1650 + sprite.seed * 700) + sprite.seed) % 1;
    const windup = phase >= 0.6 && phase < 0.74 ? (phase - 0.6) / 0.14 : -1;
    const strike = phase >= 0.74 && phase < 0.86 ? (phase - 0.74) / 0.12 : -1;
    const recover = phase >= 0.86 ? (phase - 0.86) / 0.14 : -1;
    const windupAmount = windup >= 0 ? easeInOut(windup) : 0;
    const strikeAmount = strike >= 0 ? easeOut(strike) : 0;
    const recoverAmount = recover >= 0 ? 1 - easeInOut(recover) : 0;
    return {
      windup,
      strike,
      windupAmount,
      attackAmount: strike >= 0 ? strikeAmount : recoverAmount,
      breathe: Math.sin((this.visualTime / 850) + sprite.seed * Math.PI * 2),
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
      const { strike } = this.heroMotion(sprite);
      return strike > 0.72 && strike < 0.98;
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
    const image = loadImage(this.imageCache, sprite.source);
    if (!image?.complete) return;
    const boxWidth = this.width * sprite.width;
    const boxHeight = this.height * sprite.height;
    const baseX = this.width * sprite.left - boxWidth / 2;
    const baseY = this.height * sprite.top;
    const { windupAmount, attackAmount, breathe } = motion;
    const direction = sprite.seed > 0.5 ? 1 : -1;
    const style = sprite.attackStyle;
    const idleScaleX = 1 + breathe * 0.004;
    const idleScaleY = 1 - breathe * 0.003;
    const recoil = style === 'ranged' ? -direction * attackAmount * Math.min(3, boxWidth * 0.055) : 0;
    const shove = style === 'melee' ? direction * attackAmount * Math.min(4, boxWidth * 0.08) : 0;
    const rotation = style === 'melee'
      ? direction * (-windupAmount * 0.075 + attackAmount * 0.11)
      : style === 'ranged'
        ? direction * (windupAmount * 0.04 - attackAmount * 0.065)
        : direction * (windupAmount * 0.025 + attackAmount * 0.04);
    const scaleX = idleScaleX + windupAmount * 0.035 + (style === 'magic' ? attackAmount * 0.04 : 0);
    const scaleY = idleScaleY - windupAmount * 0.045 + attackAmount * 0.015;

    context.save();
    context.fillStyle = 'rgba(12, 9, 7, 0.34)';
    context.beginPath();
    context.ellipse(
      baseX + boxWidth / 2,
      baseY + boxHeight,
      boxWidth * (0.22 - attackAmount * 0.018),
      Math.max(1.2, boxHeight * 0.035),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

    const anchorX = baseX + boxWidth / 2;
    const anchorY = baseY + boxHeight;
    context.translate(anchorX + recoil + shove, anchorY);
    context.rotate(rotation);
    context.scale(scaleX, scaleY);
    context.translate(-anchorX, -anchorY);
    context.filter = sprite.filter;
    drawContained(context, image, baseX, baseY, boxWidth, boxHeight);
    context.restore();
  }

  drawAttackEffect(context, sprite, motion) {
    const { strike } = motion;
    if (strike < 0 || !this.bossLayout) return;
    const local = strike;
    const boxWidth = this.width * sprite.width;
    const boxHeight = this.height * sprite.height;
    const startX = this.width * sprite.left;
    const startY = this.height * sprite.top + boxHeight * 0.42;
    const bossX = this.width * ((this.bossLayout.left + this.bossLayout.width / 2) / 100);
    const bossY = this.height * ((this.bossLayout.top + this.bossLayout.height * 0.58) / 100);
    const alpha = local < 0.7 ? 1 : (1 - local) / 0.3;

    context.save();
    context.globalAlpha = Math.max(0, alpha) * 0.78;
    context.lineCap = 'round';

    // 공격 이펙트는 캐릭터 주변에서만 끝난다. 보스까지 이어지는 직선/투사체는
    // 사용하지 않고, 캐릭터 자체의 움직임을 보조하는 짧은 잔상만 그린다.
    if (sprite.attackStyle === 'melee') {
      const direction = sprite.seed > 0.5 ? 1 : -1;
      const radius = Math.max(7, boxWidth * 0.42);
      context.strokeStyle = '#fff0ae';
      context.lineWidth = Math.max(1.5, boxWidth * 0.045);
      context.beginPath();
      if (direction > 0) {
        context.arc(startX, startY, radius, Math.PI * 0.85, Math.PI * (0.85 + local * 0.7));
      } else {
        context.arc(startX, startY, radius, Math.PI * (0.15 - local * 0.7), Math.PI * 0.15);
      }
      context.stroke();
    } else if (sprite.attackStyle === 'ranged') {
      const radius = 2 + Math.sin(local * Math.PI) * Math.max(3, boxWidth * 0.12);
      context.fillStyle = '#fff3a8';
      context.beginPath();
      context.arc(startX, startY, radius, 0, Math.PI * 2);
      context.fill();
    } else {
      const radius = 4 + local * Math.max(8, boxWidth * 0.32);
      context.strokeStyle = '#cfb2ff';
      context.lineWidth = Math.max(1.2, boxWidth * 0.035);
      context.beginPath();
      context.arc(startX, startY, radius, 0, Math.PI * 2);
      context.stroke();
    }

    // 타격 순간 보스에는 짧은 피격 링만 표시한다. 공격 경로는 그리지 않는다.
    if (local > 0.78) {
      const impact = (local - 0.78) / 0.22;
      context.globalAlpha = 1 - impact;
      context.strokeStyle = '#fff4a8';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(bossX, bossY, 5 + impact * 18, 0, Math.PI * 2);
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
