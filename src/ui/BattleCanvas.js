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
const FLOATING_HINTS = ['water', 'gravity', 'dragon', 'pulse', 'mage', 'ato', 'watt'];

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

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
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
      tier: node.dataset.canvasTier || 'normal',
      attackStyle: attackStyleFor(node.dataset.canvasHeroId),
      floating: FLOATING_HINTS.some((hint) => (node.dataset.canvasHeroId || '').includes(hint)),
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
    const tierSpeed = sprite.tier === 'mythic' || sprite.tier === 'immortal' ? 1.08 : 1;
    const cycleMs = (1450 + sprite.seed * 650) / tierSpeed;
    const phase = (this.visualTime / cycleMs + sprite.seed) % 1;
    const windup = phase >= 0.58 && phase < 0.72 ? (phase - 0.58) / 0.14 : -1;
    const strike = phase >= 0.72 && phase < 0.84 ? (phase - 0.72) / 0.12 : -1;
    const recover = phase >= 0.84 ? (phase - 0.84) / 0.16 : -1;
    let action = 0;
    if (windup >= 0) action = -easeInOutSine(windup);
    if (strike >= 0) action = easeOutCubic(strike);
    if (recover >= 0) action = 1 - easeInOutSine(recover);
    return {
      phase,
      windup,
      strike,
      recover,
      action,
      breathe: Math.sin((this.visualTime / 760) + sprite.seed * Math.PI * 2),
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
      return strike > 0.74 && strike < 0.98;
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
    const attackAmount = Math.max(0, motion.action);
    const windupAmount = Math.max(0, -motion.action);
    const floatY = sprite.floating ? motion.breathe * Math.min(1.6, boxHeight * 0.012) : 0;
    const groundedSway = sprite.floating ? 0 : motion.breathe * 0.012;
    const style = sprite.attackStyle;
    const lungeY = style === 'melee' ? attackAmount * Math.min(9, boxHeight * 0.11) : 0;
    const recoilY = style === 'ranged' ? attackAmount * Math.min(2.5, boxHeight * 0.03) : 0;
    const kickX = style === 'ranged' ? attackAmount * boxWidth * 0.055 : 0;
    const castLift = style === 'magic' ? attackAmount * Math.min(4, boxHeight * 0.045) : 0;
    const rotation = style === 'melee'
      ? (-windupAmount * 0.065 + attackAmount * 0.085)
      : style === 'ranged'
        ? (-attackAmount * 0.045)
        : groundedSway;
    const scaleX = style === 'magic' ? 1 + attackAmount * 0.045 : 1 + windupAmount * 0.025;
    const scaleY = style === 'melee' ? 1 - attackAmount * 0.055 : 1 - windupAmount * 0.018;

    context.save();
    context.fillStyle = 'rgba(12, 9, 7, 0.34)';
    context.beginPath();
    context.ellipse(
      baseX + boxWidth / 2,
      baseY + boxHeight + floatY,
      boxWidth * (0.22 - attackAmount * 0.025),
      Math.max(1.2, boxHeight * 0.035),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

    const anchorX = baseX + boxWidth / 2;
    const anchorY = baseY + boxHeight + floatY - lungeY - castLift + recoilY;
    context.translate(anchorX - kickX, anchorY);
    context.rotate(rotation);
    context.scale(scaleX, scaleY);
    context.translate(-(anchorX - kickX), -anchorY);
    context.filter = sprite.filter;
    drawContained(context, image, baseX - kickX, baseY + floatY - lungeY - castLift + recoilY, boxWidth, boxHeight);
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
    const progress = easeOutCubic(Math.min(1, local * 1.18));
    const endX = startX + (bossX - startX) * progress;
    const endY = startY + (bossY - startY) * progress;
    const alpha = local < 0.72 ? 1 : (1 - local) / 0.28;

    context.save();
    context.globalAlpha = Math.max(0, alpha) * 0.82;
    context.lineCap = 'round';

    if (sprite.attackStyle === 'melee') {
      const arcRadius = Math.max(8, boxWidth * 0.54);
      const slashX = startX + (bossX - startX) * 0.18;
      const slashY = startY + (bossY - startY) * 0.18;
      context.strokeStyle = '#fff0a6';
      context.lineWidth = Math.max(1.8, boxWidth * 0.055);
      context.beginPath();
      context.arc(slashX, slashY, arcRadius, Math.PI * 1.08, Math.PI * (1.08 + local * 0.85));
      context.stroke();
    } else if (sprite.attackStyle === 'magic') {
      const pulse = 4 + local * 10;
      context.fillStyle = 'rgba(151, 104, 255, 0.28)';
      context.strokeStyle = '#d8c1ff';
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(startX, startY, pulse, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const gradient = context.createLinearGradient(startX, startY, endX, endY);
      gradient.addColorStop(0, 'rgba(151, 104, 255, 0)');
      gradient.addColorStop(0.55, '#b993ff');
      gradient.addColorStop(1, '#fff0ff');
      context.strokeStyle = gradient;
      context.lineWidth = Math.max(1.4, boxWidth * 0.045);
      context.beginPath();
      context.moveTo(startX, startY);
      context.quadraticCurveTo((startX + endX) / 2 + Math.sin(local * Math.PI) * 7, (startY + endY) / 2, endX, endY);
      context.stroke();
    } else {
      const gradient = context.createLinearGradient(startX, startY, endX, endY);
      gradient.addColorStop(0, 'rgba(255, 222, 102, 0)');
      gradient.addColorStop(0.72, '#ffd65f');
      gradient.addColorStop(1, '#fffbd7');
      context.strokeStyle = gradient;
      context.lineWidth = Math.max(1.2, boxWidth * 0.035);
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      context.fillStyle = '#fff7bd';
      context.beginPath();
      context.arc(endX, endY, Math.max(2, boxWidth * 0.055), 0, Math.PI * 2);
      context.fill();
    }
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
