// 영웅 외 공용 이미지 에셋 (public/ 하위, 서브 경로 배포 대응을 위해 BASE_URL을 붙인다)
const BASE = import.meta.env.BASE_URL;
export const BOSS_IMAGE = `${BASE}bg/boss.png`;
export const BACKGROUND_IMAGE = `${BASE}bg/battlefield_v2.webp`;

// 필드에서 실제로 사용 중인 원화 파일명과 같은 이름의 8프레임 시트를 찾는다.
// 변신형 영웅도 resolveHeroImage()가 반환한 현재 원화 기준으로 자동 연결된다.
export function heroAnimationSheetFor(imageSource) {
  const filename = String(imageSource ?? '').split('/').pop()?.split('?')[0] ?? '';
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem ? `${BASE}sprites/${stem}_actions.webp` : '';
}

// battlefield_v2.webp 원본 크기(847x1857, 기존과 같은 688:1508 비율)에서
// 실측한 좌표를 %로 변환한 값.
// 검은 테두리로 표시돼 있던 돌판 프레임은 가로세로 비율이 6x4 칸과 정확히
// 맞아떨어져서(512x278px) 전장 그리드 자리였다 - 보스는 그 위 빈 하늘 공간에 배치한다.
// field는 배경 원화에 그려진 돌판 프레임과 정확히 겹쳐야 해서 계속 실측값을 쓴다.
// boss는 배경에 그려진 요소가 아니라 위에 얹는 스프라이트라 목업(375x812)의 px 좌표를
// 그대로 %로 환산해서 썼다(left:77.5/375, top:150/812, width:220/375) - height는 고정값
// 대신 boss.png 실제 비율(851x700)로 자동 계산해서 이미지가 눌리지 않게 했다
// (width% * stageWidth/stageHeight / imgRatio = 58.67 * (688/1508) / 1.2157 ≈ 22.02).
export const BACKGROUND_ASPECT_RATIO = '688 / 1508';
export const STAGE_LAYOUT = {
  // battlefield_v2.webp의 검은 외곽선 안쪽 실제 전투면을 다시 실측한 값.
  // 바깥 석재 프레임까지 그리드로 덮지 않아 승인안의 작은 발판 비율을 유지한다.
  field: { left: 13.2, top: 42.16, width: 73.0, height: 16.97 },
  boss: { left: 20.67, top: 18.47, width: 58.67, height: 22.02 },
  // 좌우 굴은 "전장 바로 위 모서리"가 아니라 배경 원화에 그려진 톱니바퀴 장식의 중심축
  // (동그란 청동색 허브)이다 - 예전 값(14.97/85.03, 44.23/44.4)은 실제로는 전장 박스
  // 모서리 근처를 가리키고 있었고 톱니바퀴 그림과는 안 맞았다("굴 위치가 이상하다"는
  // 피드백의 원인). {8,92}/{40.5,40.5}로 한 번 더 재실측했는데도 "여전히 위치가
  // 다르다"는 재지적을 받아서, 1% 간격 격자 + 크로스헤어 오버레이로 왼쪽/오른쪽 각각
  // 어두운 구멍의 정중앙을 다시 정밀 측정했다(왼쪽/오른쪽이 완전 대칭이 아니라 따로
  // 쟀다). 이 값이 지금까지 중 가장 정밀하게 측정된 값이다.
  leftHole: { x: 7.3, y: 41.4 },
  rightHole: { x: 93.4, y: 42.0 },
};

// 군체 타르(m_tar)는 1~3단계 그래픽이 별도로 존재한다(3단계 도달이 불멸 승급 조건).
export const TAR_STAGE_IMAGES = {
  1: `${BASE}heroes/m_tar_stage1.webp`,
  2: `${BASE}heroes/m_tar_stage2.webp`,
  3: `${BASE}heroes/m_tar_stage3.webp`,
};

// 드래곤은 드레인(마왕 드래곤 승급 재료)으로 일시 변신한다. 승급 준비(드레인 확보)가
// 되면 이 이미지로 표시한다.
export const DRAGON_DRAIN_IMAGE = `${BASE}heroes/m_dragon_drain.webp`;

// 개구리왕자(신화)의 "변신 모습" 보조 썸네일. 사신 개구리(불멸)는 승급 이후 실제
// 개체가 바뀌므로 더 이상 별도 변신 썸네일이 필요 없다 - i_death_frog_evolved가
// 그 역할(2차 변신)을 실제 영웅 데이터로 대신한다(heroes.js의 SECOND_STAGE_IMMORTAL).
export const FROG_TRANSFORM_IMAGES = {
  m_frog_prince: `${BASE}heroes/m_frog_prince_transform.webp`,
};

// 로켓츄(신화)/아이언미야옹(신화)/에이스 배트맨(불멸)도 필드에서 별도 변신 모습을
// 보조 썸네일로 같이 보여준다. 아이언미야옹과 에이스 배트맨은 변신 모습이 2개씩 있다.
export const ROCKETCHU_TRANSFORM_IMAGE = `${BASE}heroes/m_rocketchu_transform.webp`;
export const IRON_MEYAONG_TRANSFORM_IMAGES = [
  `${BASE}heroes/m_iron_meyaong_transform1.webp`,
  `${BASE}heroes/m_iron_meyaong_transform2.webp`,
];
export const ACE_BATMAN_TRANSFORM_IMAGES = {
  pitcher: `${BASE}heroes/i_ace_batman_pitcher.webp`,
  batter: `${BASE}heroes/i_ace_batman_batter.webp`,
};

// 사용자가 제공한 UI 버튼/배지/아이콘 아트 (public/ui/). 이번 라운드에서 사용자가
// 숫자 파일명 대신 한글 이름으로 다시 붙인 zip을 줘서(예: "몬스터 카운트 바.png"),
// 이전처럼 파일을 눈으로 열어 모양을 추측할 필요 없이 파일명을 그대로 신뢰해서 매핑했다.
//
// 헷갈렸던 것 재정리:
// - "룰렛 배경.png"(커튼 프레임 + 보석/인원/X 아이콘이 그림 안에 박혀있는 이미지)는
//   이름과 달리 실제 목업 HTML 어디에도 쓰이지 않는 자산이었다(목업의 .popup은 전부
//   순수 CSS 그라데이션 배경이지 이 이미지를 참조하지 않음) - 저번 라운드에 이걸
//   상시 노출되는 top-badge 배경으로 잘못 썼던 게 "팝업 전용 요소가 항상 떠 있다"는
//   버그의 원인이었다. top-badge는 목업 그대로 이미지 없는 순수 CSS 박스로 되돌렸고,
//   이 이미지는 어디에도 매핑하지 않는다(public/ui에도 안 남겨둠 - 필요해지면 zip에서
//   다시 꺼내 쓸 것).
// - "카운트 이미지.png"(위쪽에 탭이 튀어나온 명패 모양, 스켈레톤 없음)도 이번 zip에
//   있었지만 목업 어디에도 대응하는 자리가 없어서(몬스터 카운트는 "몬스터 카운트
//   바.png"라는 이름의 스켈레톤+바 이미지가 따로 있고, 목업의 `.skull`+`.text` 구조와도
//   이쪽이 훨씬 잘 맞음) 매핑하지 않았다.
export const UI_IMAGES = {
  summonBtn: `${BASE}ui/summon_btn.png`,
  mythicBtn: `${BASE}ui/mythic_btn.png`,
  rouletteBtn: `${BASE}ui/roulette_btn.png`,
  enhanceBtn: `${BASE}ui/enhance_btn.png`,
  rouletteRare: `${BASE}ui/roulette_rare.png`,
  rouletteHero: `${BASE}ui/roulette_hero.png`,
  rouletteLegendary: `${BASE}ui/roulette_legendary.png`,
  resourceBar: `${BASE}ui/resource_bar.png`, // "재화 및 맵 카운트 바.png" - 상시 노출되는 하단 stat-row
  skullIcon: `${BASE}ui/skull_icon.png`, // "룰렛 실패.png" - 룰렛 실패 표시 전용, 몬스터 표시엔 안 씀
  speedOn: `${BASE}ui/speed_on.png`,
  speedOff: `${BASE}ui/speed_off.png`,
  monsterIcon: `${BASE}ui/monster.png`, // "몬스터.png"(동글동글 웃는 얼굴)
  impIcon: `${BASE}ui/imp.png`, // "임프.png"(각진 몸통+왕관, 마마 전용 소환체) - 몬스터와 다른 이미지
  immobilizeIcon: `${BASE}ui/immobilize_icon.png`, // "속박.png"
  goldIcon: `${BASE}ui/gold_icon.png`, // "코인.png"
  luckstoneIcon: `${BASE}ui/luckstone_icon.png`, // "행운석.png"
  monsterCountBg: `${BASE}ui/monster_count_bg.png`, // "몬스터 카운트 바.png" - 스켈레톤 메달+바
  // 강화 팝업 4열(일반~희귀/영웅/전설~불멸/소환 확률) 아이콘. 전부 GameState.globalEnhance의
  // 실제 전역 트랙과 연결된 진짜 버튼이다(actions.js의 upgradeGlobalEnhance) - 데미지 계산이
  // 범위 밖이라 레벨을 올려도 실질 효과는 없지만(소환 확률도 항상 고정), 골드/보석을 실제로
  // 쓰고 레벨이 실제로 오르는 진행형 시스템으로 구현했다. 특정 선택 영웅과는 무관.
  enhanceCommon: `${BASE}ui/enhance_common.png`, // "강화_일반희귀.png"
  enhanceHero: `${BASE}ui/enhance_hero.png`, // "강화_영웅.png"
  enhanceLegendary: `${BASE}ui/enhance_legendary.png`, // "강화_신화~불멸.png"
  enhanceRate: `${BASE}ui/enhance_rate.png`, // "강화_소환확률.png"
};
