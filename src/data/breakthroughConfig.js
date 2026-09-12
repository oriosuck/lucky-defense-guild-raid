// 한계 돌파 공통 설정
// 모든 캐릭터가 동일한 돌파 확률/비용을 공유한다.
// 실패 보정 확률은 아직 미확정이므로 failBonusTable을 임시값으로 두고,
// 실제 규칙 확인 후 이 파일의 데이터만 수정하면 되도록 분리한다.

export const MIN_BREAKTHROUGH_LEVEL = 15;
export const MAX_BREAKTHROUGH_LEVEL = 25;

export const BREAKTHROUGH_CONFIG = {
  15: { toLevel: 16, baseSuccessRate: 70, stoneCost: 30, goldCost: 20000, failBonusTable: [0] },
  16: { toLevel: 17, baseSuccessRate: 50, stoneCost: 32, goldCost: 22000, failBonusTable: [0] },
  17: { toLevel: 18, baseSuccessRate: 30, stoneCost: 34, goldCost: 24000, failBonusTable: [0] },
  18: { toLevel: 19, baseSuccessRate: 20, stoneCost: 36, goldCost: 26000, failBonusTable: [0] },
  19: { toLevel: 20, baseSuccessRate: 12, stoneCost: 38, goldCost: 28000, failBonusTable: [0] },
  20: { toLevel: 21, baseSuccessRate: 8, stoneCost: 40, goldCost: 32000, failBonusTable: [0] },
  21: { toLevel: 22, baseSuccessRate: 6, stoneCost: 42, goldCost: 36000, failBonusTable: [0] },
  22: { toLevel: 23, baseSuccessRate: 4, stoneCost: 44, goldCost: 40000, failBonusTable: [0] },
  23: { toLevel: 24, baseSuccessRate: 2, stoneCost: 47, goldCost: 50000, failBonusTable: [0] },
  24: { toLevel: 25, baseSuccessRate: 1, stoneCost: 50, goldCost: 60000, failBonusTable: [0] },
};

export function getBreakthroughConfig(level) {
  return BREAKTHROUGH_CONFIG[level] ?? null;
}

export function getFailBonus(level, failCount) {
  const config = getBreakthroughConfig(level);
  if (!config) return 0;
  const table = config.failBonusTable ?? [0];
  if (table.length === 0) return 0;
  return table[Math.min(failCount, table.length - 1)] ?? 0;
}
