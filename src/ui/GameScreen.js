import { HEROES_BY_ID, TIER_LABEL, heroesByTier, SECOND_STAGE_IMMORTAL, IMP_HERO_ID } from '../data/heroes.js';
import { STAGE_LAYOUT, BOSS_IMAGE, UI_IMAGES } from '../data/assets.js';
import { missionDefinitions, MISSION_TOAST_SEC } from '../logic/missions.js';
import { summonNormal, summonRoulette } from '../logic/summon.js';
import { ROULETTE_SUCCESS_RATE, ROULETTE_COST } from '../data/heroes.js';
import {
  synthesize,
  craftMythic,
  sellHero,
  feedMythicToChad,
  countHeroOnField,
  craftableMythicCount,
} from '../logic/synthesis.js';
import {
  enhanceHero,
  moveHero,
  digTreasure,
  upgradeGlobalEnhance,
  chooseBatmanMode,
  advanceIronMeyaong,
  nextEnhanceGoldCost,
  nextEnhanceLuckstoneCost,
  nextEnhanceSuccessRate,
  nextGlobalEnhanceCost,
} from '../logic/actions.js';
import {
  checkImmortalPromotion,
  isImmortalPromotionReady,
  cannibalizeTar,
  attemptSecondStageEvolution,
  attemptFrogTransform,
  callRaySword,
  craftRaySword,
  resetRaySwords,
} from '../logic/immortal.js';
import { IMMOBILIZE_GAUGE_FILL_SEC, DELETE_START_AT_TIME_LEFT, DELETE_TRIGGER_AT_TIME_LEFT, INDY_TREASURE_INTERVAL_SEC, isInstanceStunned } from '../logic/waveEvents.js';
import { GLOBAL_ENHANCE_TRACKS, GLOBAL_ENHANCE_LABEL, GLOBAL_ENHANCE_MAX_LEVEL } from '../data/constants.js';
import { RAY_SWORD_TIER_LABEL, RAY_SWORD_TIER_COLOR, RAY_SWORD_CRAFT_MAX } from '../data/raySwords.js';
import { fieldOccupantCount, isFieldPhysicallyFull, FIELD_ROWS, FIELD_COLS } from '../state/gameState.js';
import { el } from './components/dom.js';
import { heroImage, resolveHeroImage } from './components/heroVisual.js';
import { createBattleCanvas } from './BattleCanvas.js';

/**
 * @param {{ getState:()=>object, dispatch:(s:object)=>void, onExit:()=>void }} props
 * @returns {{root:HTMLElement, update:(s:object)=>void}}
 */
export function GameScreen({ getState, dispatch, onExit }) {
  const root = el('div', { class: 'screen game-screen' });
  // 필드 캐릭터와 몬스터는 하나의 영구 Canvas에서 렌더링한다. 게임 상태 UI와
  // 드래그 판정용 칸은 기존 DOM을 유지하되, 0.2초마다 이미지 노드를 다시 만드는
  // 비용은 없앤다. canvas 노드는 render()의 root.innerHTML 초기화 뒤에도 같은
  // 인스턴스를 새 stage에 다시 붙여 애니메이션/이미지 캐시가 끊기지 않는다.
  const battleCanvas = el('canvas', {
    class: 'battle-canvas',
    'aria-label': '필드 캐릭터와 몬스터 전투 화면',
  });
  const battleRenderer = createBattleCanvas(battleCanvas, { monsterSrc: UI_IMAGES.monsterIcon });
  const ui = {
    selectedSlot: null, // {row,col} | null - 선택 기준은 개체가 아니라 칸 자체
    popup: null, // null | 'mythic' | 'roulette' | 'enhance' | 'mission'
    mythicTab: 'mythic', // 'mythic' | 'immortal'
    mythicSelectedId: null,
    spinningTier: null, // 룰렛 스핀 연출 중인 등급
    rouletteFailTier: null, // 방금 실패해서 해골을 잠깐 보여줄 등급
    rouletteSuccessHero: null, // 방금 성공해서 나온 영웅 그림을 잠깐 보여줄 heroId
    // 채드/기가채드 "판매하기" 버튼을 눌러 화살표 선택 모드에 들어간 상태 - 어느 채드가
    // 먹이는 쪽인지(m_chad는 신화만, i_giga_chad는 신화+불멸) 구분해야 해서 boolean이
    // 아니라 그 채드의 instanceId를 담는다(null이면 꺼진 상태).
    chadSellMode: null,
    // 인디 개체별로 "보물 위치를 다시 보여달라"고 클릭한 시각(instanceId -> ms) -
    // indyTreasures가 인디 개체별 맵이 된 것과 같은 이유로, 이 플래시 트리거도
    // 개체별로 독립돼야 한다(안 그러면 인디 A를 클릭했는데 인디 B의 보물까지
    // 같이 반짝이는 등 서로 간섭한다).
    indyMarkerFlashAt: {},
  };

  function apply(result) {
    if (result?.newState) dispatch(result.newState);
  }

  function openPopup(name, state) {
    ui.popup = name;
    render(state);
  }
  function closePopup(state) {
    ui.popup = null;
    render(state);
  }

  // 배경 원본 비율(688:1508)을 유지한다 - 순수 CSS만으로는 뷰포트 비율에 따라 눌려 보이는
  // 문제가 있어서 실측 후 픽셀로 못박는다(CLAUDE.md 참고).
  const STAGE_RATIO = 688 / 1508;

  // 뷰포트 비율이 STAGE_RATIO와 안 맞을 때 "cover"(꽉 채우고 넘치는 부분 자르기)로
  // 바꿔봤었는데, 카카오톡 인앱 브라우저 같은 환경에서 위쪽 UI(상단 배지)가 통째로
  // 잘려나가는 부작용이 나왔다(사용자 스크린샷으로 확인) - "안되면 크기 그냥
  // 원래대로 해야할거 같아"라는 지시대로 "contain"(전체가 다 보이게, 안 맞는
  // 쪽엔 검은 여백)으로 되돌렸다. 이때 여백을 우회하려고 추가했던 전체화면 버튼은
  // 이후 사용자 요청으로 제거했다(renderStageControls 참고).
  // CDP 프로파일링으로 실측해보니(사용자 렉 리포트 조사) `wrap.clientWidth`/
  // `clientHeight` 읽기 단 두 줄이 8초 샘플 중 327ms(약 4%)를 먹고 있었다 - 원인은
  // 이 함수가 render()에서 매번(초당 5회) `root.innerHTML=''`로 DOM을 통째로 갈아엎은
  // 직후에 곧바로 호출되는데, 그 직후의 clientWidth 읽기는 브라우저가 지금까지 쌓인
  // 레이아웃 변경을 동기적으로 강제 계산(forced synchronous reflow)해야만 정확한 값을
  // 반환할 수 있어서 초당 5번씩 레이아웃 스래싱이 발생하고 있었다. 실제로는 뷰포트
  // 크기(wrap의 가용 공간)가 매 렌더마다 바뀌는 게 아니라 브라우저 창 크기가 실제로
  // 바뀔 때만 바뀌므로, 계산 결과를 캐시해두고 `window resize` 이벤트가 왔을 때만
  // 다시 측정하도록 바꿨다 - 매번 새로 생성되는 stage 노드에는 캐시된 값을 그대로
  // 적용만 하면 되므로 시각적으로는 완전히 동일하게 동작한다.
  let cachedStageSize = null;
  let needsStageRemeasure = true;

  function sizeStageToFit(wrap, stage) {
    if (!needsStageRemeasure && cachedStageSize) {
      stage.style.width = `${cachedStageSize.w}px`;
      stage.style.height = `${cachedStageSize.h}px`;
      return;
    }
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (!availW || !availH) return; // 아직 DOM에 안 붙은 최초 렌더 - 다음 재렌더(0.2초 뒤)에 재시도
    let w;
    let h;
    if (availW / availH > STAGE_RATIO) {
      h = availH;
      w = h * STAGE_RATIO;
    } else {
      w = availW;
      h = w / STAGE_RATIO;
    }
    cachedStageSize = { w, h };
    needsStageRemeasure = false;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
  }

  function render(state) {
    // 0.2초마다 전체 DOM을 갈아엎다 보니 신화 팝업의 등급 그리드(.mythic-grid,
    // overflow-y:auto)도 매번 새 엘리먼트로 다시 생겨서 scrollTop이 계속 0으로
    // 리셋됐다 - 사용자가 스크롤을 내려도 다음 렌더에서 바로 맨 위로 튕겨 보이니
    // "스크롤이 안 된다"로 보였다. 재생성 직전 스크롤 위치를 저장했다가 재생성 직후
    // 그대로 복원한다(같은 클래스의 새 노드에 값만 옮겨 붙이는 방식).
    const prevScrollEl = root.querySelector('.mythic-grid');
    const prevScrollTop = prevScrollEl ? prevScrollEl.scrollTop : null;
    root.innerHTML = '';
    const stage = renderStage(state);
    const stageWrap = el('div', { class: 'game-stage-wrap' }, [stage]);
    root.appendChild(stageWrap);
    sizeStageToFit(stageWrap, stage);
    battleRenderer.sync(stage, state);
    if (prevScrollTop != null) {
      const newScrollEl = root.querySelector('.mythic-grid');
      if (newScrollEl) newScrollEl.scrollTop = prevScrollTop;
    }
  }

  // window에 등록하는 리스너(resize/pointermove/pointerup/pointercancel)는 root와
  // 달리 게임 화면을 나가도 저절로 사라지지 않는다 - root는 DOM에서 떨어져 나가면
  // 참조가 없어져 가비지 컬렉션되지만, window는 페이지가 살아있는 한 계속 남아있어서
  // 그 안에 등록된 리스너(와 그 클로저가 붙잡고 있는 이 GameScreen 인스턴스 전체)도
  // 계속 살아있게 된다. 사용자가 게임을 나갔다가 다시 시작하는(mountGame이 다시
  // 호출되는) 매 라운드마다 이 4개가 누적돼서, 여러 판을 하고 나면 겹겹이 쌓인
  // 리스너들이 매 pointermove/resize마다 전부 실행돼 체감 랙("버벅거리고 멈추고")의
  // 원인이 될 수 있다 - 한 판만 해도 즉시 눈에 띄는 정도는 아니지만 재시작을 반복할수록
  // 누적되는 전형적인 메모리/리스너 누수 패턴이다. 함수 참조를 변수로 잡아뒀다가
  // destroy()에서 명시적으로 해제한다(main.js가 onExit 시 호출).
  // 앱을 백그라운드로 보냈다가 다시 돌아오면(다른 앱 전환, 화면 잠금 해제 등)
  // 모바일 브라우저가 주소창을 숨겼다 다시 보여주는 애니메이션 중에 resize 이벤트를
  // 짧은 시간에 여러 번 연달아 쏜다 - 그때마다 매번 즉시 render()를 부르면, 주소창
  // 애니메이션이 진행 중인 매 순간의 과도기적인(아직 자리를 못 잡은) 뷰포트 크기를
  // 그대로 읽어서 스테이지 크기가 실제로 프레임마다 커졌다 작아졌다 하며 화면이
  // 깜빡이는 것처럼 보였다(사용자 리포트 - "세션 잠깐 나갔다가 다시들어오면 엄청
  // 깜빡거려... 다시 껐다가 들어와야해"). resize 이벤트가 몰아칠 때마다 렌더를
  // 즉시 실행하지 않고 타이머를 계속 뒤로 미루는 디바운스로 바꿔서, 이벤트가
  // 잠잠해진 뒤(200ms) 뷰포트가 자리를 잡은 시점의 값 딱 한 번만으로 재측정+렌더
  // 하도록 했다.
  let resizeRenderTimer = null;
  const handleResize = () => {
    needsStageRemeasure = true; // 실제 창 크기 변경 시에만 sizeStageToFit()이 다시 측정하도록
    if (resizeRenderTimer) clearTimeout(resizeRenderTimer);
    resizeRenderTimer = setTimeout(() => {
      resizeRenderTimer = null;
      if (root.isConnected) render(getState());
    }, 200);
  };
  window.addEventListener('resize', handleResize);

  // 게임 루프가 0.2초마다 전체 DOM을 다시 그리는데, 그 사이에 클릭(mousedown~mouseup)이
  // 걸리면 누르고 있던 버튼이 통째로 교체돼서 클릭이 씹히는 문제가 있었다(매번 두 번씩
  // 눌러야 겨우 눌리던 버그의 원인). 포인터가 눌려있는 동안에는 주기적 재렌더링을 건너뛰고,
  // 클릭 핸들러 안에서 직접 호출하는 render()는 그대로 즉시 반영되게 둔다. 이 가드
  // 덕분에 드래그하는 동안(pointerdown~pointerup) DOM 노드가 안 바뀌므로, 포인터
  // 캡처로 잡은 시작 칸 엘리먼트가 드롭 시점까지 그대로 유지된다.
  let pointerDown = false;

  // pointerdown 핸들러 안에서 팝업 닫힘/선택 해제/채드 모드 취소를 곧바로 반영하려고
  // render()를 그 자리에서 동기 호출하고 있었는데, 이게 바로 그 "터치 중간에 DOM을
  // 통째로 갈아엎는" 패턴이라 문제가 됐다(사용자 리포트 - "캐릭터를 선택했을 때
  // 더블탭을 아무데나 하면 화면이 확대된다" - 캐릭터가 선택된 상태에서 바깥을 탭하면
  // 이 핸들러가 즉시 선택 해제 + render()를 실행해 DOM을 통째로 재생성하는데, 이게
  // "더블탭"의 첫 번째 탭이 아직 끝나기도 전(touchstart~touchend 사이)에 일어나면서
  // 브라우저의 네이티브 더블탭-확대 제스처 인식을 (우리 JS의 preventDefault와는
  // 별개로) 방해했을 가능성이 높다 - 판매 버튼 겹침으로 오판했던 이전 시도와 달리,
  // 이번엔 버튼이 전혀 없는 빈 공간을 눌러도 재현된다는 사용자의 정정으로 원인을
  // 좁혔다). requestAnimationFrame으로 한 프레임 미뤄서, 지금 처리 중인 터치
  // 이벤트의 동기 실행 구간 밖에서 DOM이 바뀌게 한다 - 육안으로는 여전히 즉시
  // 반영되는 것처럼 보이면서도(한 프레임 이내) 터치 제스처 도중 DOM을 건드리지
  // 않는다.
  function deferredRender(state) {
    requestAnimationFrame(() => {
      if (root.isConnected) render(state);
    });
  }

  // 칸 드래그 이동: 버튼 클릭 대신 영웅이 있는 칸을 다른 칸으로 직접 드래그해서
  // 옮긴다(사용자 요청 - "이동은 버튼이 아니라 드래그 방식으로"). 이동량이 거의
  // 없으면(제자리에서 뗌) 기존처럼 탭으로 취급해 선택만 토글한다.
  const DRAG_MOVE_THRESHOLD_PX = 8;
  let dragState = null; // { instanceId, fromRow, fromCol, startX, startY, moved }
  let dragHoverEl = null;

  function setDragHover(el) {
    if (dragHoverEl === el) return;
    if (dragHoverEl) dragHoverEl.classList.remove('drag-hover');
    dragHoverEl = el;
    if (dragHoverEl) dragHoverEl.classList.add('drag-hover');
  }

  root.addEventListener('pointerdown', (e) => {
    pointerDown = true;

    // 채드 판매(화살표) 모드 중엔 renderCellQuickActions()가 통째로 숨어서
    // "취소" 버튼조차 안 보인다(line 872 근처 가드) - 화살표를 눌러 강제로
    // 먹이는 것 말고는 이 모드를 빠져나갈 방법이 없었다. 사용자 요청 - "채드로
    // 판매하기 눌렀을 때 아무것도 안파는 경우도 있거든 그럴때 밖에 아무거나
    // 클릭했을 때 초록 화살표 없어지게 해줘" - 화살표(.chad-sell-arrow) 자체를
    // 누른 게 아니면 이 탭으로 다른 동작(칸 선택 등)을 같이 수행하지 않고
    // 화살표 모드만 취소하고 끝낸다(팝업 바깥 클릭 시 팝업만 닫고 끝내는
    // 아래 로직과 동일한 패턴).
    if (ui.chadSellMode && !e.target.closest('.chad-sell-arrow')) {
      ui.chadSellMode = null;
      deferredRender(getState());
      return;
    }

    // 팝업이 하나라도 열려 있으면 팝업 바깥을 누르는 즉시 자동으로 닫는다(사용자
    // 요청 - "팝업 뜨는것들은 전부 팝업 외부를 눌렀을 때 자동으로 꺼지게 해줘").
    // 미션 팝업(.popup-overlay)은 이미 자체적으로 어두운 배경 클릭 시 닫히는 로직이
    // 있어서(popup-box 내부는 제외) 여기서는 그 팝업 전체를 "안쪽"으로만 판정해
    // 건드리지 않는다(이중 처리 방지). 룰렛/강화/신화 팝업은 전체화면을 덮는 모달이
    // 아니라 하단 시트(.game-popup/.mythic-popup)라 필드 위쪽과 왼쪽 즉시소환 바가
    // 여전히 보이는데도 조작이 막혀 있었다 - 처음엔 룰렛만 예외를 뒀었는데(사용자가
    // 그때 룰렛만 콕 집었었음), 이번에 "팝업 떠있을 때 필드 조작 가능하게 해달라
    // 했잖아"라는 재요청으로 하단 시트 팝업 전부(roulette/enhance/mythic)로
    // 넓혔다 - 미션 팝업(.popup-overlay)만 전체화면이라 예외 대상이 아니다.
    // 왼쪽 즉시소환/승급 바(.favorite-bar)도 같은 요청("왼쪽에 신화/불멸 조합
    // 뜨는거 클릭도 가능하게")으로 이 예외에 추가했다 - 안 그러면 그 버튼을 누르는
    // 순간 이 pointerdown 핸들러가 먼저 popup을 닫고 render()로 DOM을 통째로
    // 다시 그려버려서, 뒤이어 오는 click 이벤트가 이미 사라진(고아가 된) 노드를
    // 대상으로 남아 버튼의 onclick이 실행되지 않는다(CLAUDE.md의 "신화 팝업 클릭이
    // 잘 안 먹힘" 섹션과 같은 계열의 함정 - pointerdown에서 DOM을 바꾸면 그 제스처의
    // 나머지 이벤트가 고아 노드를 향하게 된다).
    const BOTTOM_SHEET_POPUPS = ['roulette', 'enhance', 'mythic'];
    if (ui.popup) {
      const insidePopup = e.target.closest('.game-popup, .mythic-popup, .popup-overlay');
      const insideFieldWhilePopupOpen = BOTTOM_SHEET_POPUPS.includes(ui.popup)
        && e.target.closest('.field-slot, .cell-quick-actions, .chad-arrow-layer, .favorite-bar');
      if (!insidePopup && !insideFieldWhilePopupOpen) {
        ui.popup = null;
        deferredRender(getState());
        return;
      }
    }

    const cellEl = e.target.closest('.field-slot');
    if (!cellEl) {
      // 칸도, 그 칸의 액션 버튼도, 채드 화살표도 아닌 곳을 누르면 선택 해제
      // (사용자 지정 - "칸 선택 후 다른 곳 아무데나 누르면 해제").
      if (!ui.popup && ui.selectedSlot && !e.target.closest('.cell-quick-actions') && !e.target.closest('.chad-arrow-layer')) {
        ui.selectedSlot = null;
        deferredRender(getState());
      }
      return;
    }
    // 위 팝업 자동 닫힘 처리를 이미 통과했으므로, 여기까지 왔다는 건 팝업이 없거나
    // 룰렛 팝업이 열려 있는 상태뿐이다 - 그 외 팝업은 이미 위에서 닫혔다.
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);
    const state = getState();
    const slot = state.field.find((s) => s.row === row && s.col === col);
    if (!slot) return;
    // 빈 칸이어도 dragState를 세워야 한다 - 그래야 pointerup의 endDrag()가
    // onSlotClick()까지 도달해서 "다른(빈) 칸을 누르면 바로 선택 해제"가 된다
    // (사용자 지적 - "다른곳 누르면 바로 선택 해제되어야 하는데 지금 바로
    // 해제가 안돼"). 예전엔 여기서 빈 칸을 바로 return 해버려서 endDrag/
    // onSlotClick 경로 자체를 못 타 해제가 안 됐다. 드래그 이동(moveHero)은
    // 빈 칸이 출발지면 자체적으로 안전하게 실패 처리되므로 빈 칸에서 드래그를
    // 시작해도 부작용이 없다.
    dragState = {
      fromRow: row, fromCol: col,
      startX: e.clientX, startY: e.clientY, moved: false,
      // 기절 상태인 칸은 탭 선택은 그대로 되지만 실제 드래그 이동은
      // endDrag에서 막는다(보스 기절 이벤트 지속 시간 동안 캐릭터를 움직일 수
      // 있던 버그 리포트 반영).
      immobilized: isImmobilized(state, slot),
    };
    cellEl.classList.add('dragging-source');
  });

  const handlePointerMove = (e) => {
    if (!dragState) return;
    if (!dragState.moved) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (Math.hypot(dx, dy) < DRAG_MOVE_THRESHOLD_PX) return;
      dragState.moved = true;
      // 선택된 칸의 판매/합성/기타 퀵액션 버튼(.cell-quick-btn)은 위/아래로
      // 튀어나와서 이웃 칸(특히 바로 위 행) 위에 그대로 겹쳐 그려질 수 있다 -
      // 그 버튼은 클릭 가능해야 하므로 pointer-events:auto가 명시돼 있는데, 이
      // 때문에 드래그 도중 elementFromPoint()가 그 버튼 밑에 깔린 실제 필드
      // 칸을 못 찾고 버튼 자신을 반환해버린다(사용자 리포트 - "버튼쪽에 가려진
      // 칸에 가려 하면 이동이 안돼"). 실제로 Playwright로 재현: 버튼이 정확히
      // 위 칸 중앙을 덮고 있어서 그 칸으로의 드래그 이동이 항상 조용히
      // 실패했다. 드래그가 실제로 시작된 순간(threshold를 넘는 순간)부터
      // root에 클래스를 달아 이 버튼들만 일시적으로 pointer-events:none으로
      // 만들어서, 드래그 중에는 그 아래 실제 필드 칸이 히트테스트에 잡히게
      // 한다 - 버튼 자체의 위치/모양은 그대로 두고(더블탭 확대 방지를 위해
      // 최근에 늘려둔 간격을 다시 좁히지 않아도 됨), 드래그가 끝나면(endDrag)
      // 바로 원래대로 되돌린다.
      root.classList.add('drag-in-progress');
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = target?.closest('.field-slot');
    setDragHover(cellEl ?? null);
  };
  window.addEventListener('pointermove', handlePointerMove);

  function endDrag(e) {
    if (!dragState) {
      pointerDown = false;
      root.classList.remove('drag-in-progress');
      return;
    }
    const sourceEl = root.querySelector('.dragging-source');
    if (sourceEl) sourceEl.classList.remove('dragging-source');
    setDragHover(null);
    const { fromRow, fromCol, moved, immobilized } = dragState;
    dragState = null;
    if (!moved) {
      // 이동량이 거의 없으면 드래그가 아니라 탭 - 기존 선택 토글 동작을 그대로 수행.
      // (기절이어도 정보 확인용 선택은 막지 않는다 - 실제 이동만 아래에서 막음)
      pointerDown = false;
      root.classList.remove('drag-in-progress');
      const state = getState();
      const slot = state.field.find((s) => s.row === fromRow && s.col === fromCol);
      if (slot) onSlotClick(state, slot); // onSlotClick 내부에서 deferredRender를 씀
      return;
    }
    // elementFromPoint()는 drag-in-progress 클래스가 아직 붙어 있는(퀵액션
    // 버튼이 클릭 통과 상태인) 동안에 호출해야 한다 - 클래스를 먼저 떼버리면
    // 버튼이 다시 밑에 깔린 필드 칸을 가려서 정작 필요한 순간에 히트테스트가
    // 실패한다(처음 구현했을 때 실제로 이 순서 버그를 냈다 - 클래스를 함수
    // 맨 위에서 떼고 나중에 elementFromPoint를 불러서 고침 자체가 무효화됐음,
    // Playwright로 재현해서 발견함). 그래서 여기서는 아직 클래스를 유지한 채로
    // 타겟을 먼저 찾고, 그 다음에 뗀다.
    if (immobilized) {
      pointerDown = false;
      root.classList.remove('drag-in-progress');
      return; // 기절 상태에선 드래그 이동 자체가 성립하지 않는다
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = target?.closest('.field-slot');
    root.classList.remove('drag-in-progress');
    if (!cellEl) {
      pointerDown = false;
      return;
    }
    const toRow = Number(cellEl.dataset.row);
    const toCol = Number(cellEl.dataset.col);
    if (toRow === fromRow && toCol === fromCol) {
      pointerDown = false;
      return;
    }
    // 드래그로 캐릭터를 옮기면 선택 표시(원형 링/칸 버튼)도 캐릭터를 따라가야
    // 한다(사용자 지적 - "내가 처음 선택한 칸에 남은게 아니라 캐릭터가 이동한
    // 곳에 동그라미가 있어야해"). ui.selectedSlot이 여전히 출발 칸(fromRow/fromCol)을
    // 가리키고 있으면, 빈 칸으로 이동한 경우엔 링이 그냥 사라지고(출발 칸이
    // 비었으므로) 다른 칸과 맞바꾸는 이동(스왑)인 경우엔 원래 선택했던 칸에
    // 새로 들어온(맞바뀐) 다른 캐릭터를 계속 선택 중인 것처럼 보이는 버그가 있었다.
    ui.selectedSlot = { row: toRow, col: toCol };
    // apply()는 main.js의 dispatch()를 거치는데, dispatch가 곧바로 screen.update()
    // (동기 render())를 부른다 - update()는 pointerDown이 true인 동안엔 그 동기
    // 렌더를 건너뛰도록 이미 가드돼 있지만(클릭 도중 버튼이 통째로 바뀌는 걸 막기
    // 위한 기존 장치), 지금까지는 이 함수 맨 위에서 pointerDown을 이미 false로
    // 만들어버린 뒤에 apply()를 불렀기 때문에 그 가드가 전혀 작동하지 않았다 -
    // 드래그로 캐릭터를 옮길 때마다 그 pointerup 이벤트 자신의 처리 도중(터치
    // 제스처가 채 끝나기도 전에) DOM이 통째로 다시 그려지고 있었던 것이다(사용자
    // 리포트 - "캐릭터 클릭하고 드래그 해서 이동할 때 확대될 때가 있어" - Playwright로
    // 재현: 드래그 이동 직후 .field-slot 노드가 이미 detach돼 있었음, onSlotClick과
    // 같은 계열의 문제). apply() 호출 시점까지는 pointerDown을 일부러 true로 유지해서
    // update()의 동기 렌더를 막고, 상태 반영이 끝난 뒤에야 false로 바꾸고 우리
    // deferredRender로 다음 프레임에 그린다.
    apply(moveHero(getState(), fromRow, fromCol, toRow, toCol));
    pointerDown = false;
    deferredRender(getState());
  }

  const handlePointerUp = (e) => { endDrag(e); };
  const handlePointerCancel = () => {
    pointerDown = false;
    root.classList.remove('drag-in-progress');
    const sourceEl = root.querySelector('.dragging-source');
    if (sourceEl) sourceEl.classList.remove('dragging-source');
    setDragHover(null);
    dragState = null;
  };
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);

  // 화면에 표시할 몬스터 수는 Math.floor가 아니라 Math.ceil로 반올림한다 - 필드
  // 영웅이 많으면 처치 속도가 스폰 속도를 거의 항상 앞질러서 실제 monsterCount가
  // 정수 1에 못 미치는 소수(예: 0.3)로 계속 맴돌 수 있는데, floor를 쓰면 이런
  // "몬스터가 실제로 존재하긴 하는" 상태가 화면엔 늘 0으로만 보여서 "몬스터가 아예
  // 안 나온다"는 리포트로 이어졌다(사용자 지적, 시뮬레이션으로 실측 - 풀 필드
  // 기준 화면 표시값은 거의 100% 0이었지만 판정에 쓰는 원시값은 시간의 약 65%가
  // 0보다 컸다). 몬스터 처치/스폰 속도 자체(10라운드 보스 4초 전멸 요구사항과
  // 맞물린 밸런스 수치)는 건드리지 않고, 소수로 존재하는 몬스터를 "없다"가 아니라
  // "1마리 이상 있다"로 보여주는 표시 방식만 고쳤다 - 승패 판정(monsterCount>=
  // monsterMax)은 원시값을 그대로 쓰므로 이 변경과 무관하게 그대로 동작한다.
  function displayMonsterCount(state) {
    return Math.ceil(state.monsterCount);
  }

  function renderStage(state) {
    const stage = el('div', { class: 'game-stage' });
    stage.appendChild(renderTopBadge(state));
    stage.appendChild(renderMonsterRow(state));
    stage.appendChild(renderBoss(state));
    const holeEffects = renderHoleEffects(state);
    if (holeEffects) stage.appendChild(holeEffects);
    if (battleRenderer.supported) stage.appendChild(battleCanvas);
    stage.appendChild(renderField(state));
    const deleteLine = renderDeleteLineEffect(state);
    if (deleteLine) stage.appendChild(deleteLine);
    stage.appendChild(renderHeroTokenLayer(state));
    const quickActions = renderCellQuickActions(state);
    if (quickActions) stage.appendChild(quickActions);
    const chadArrows = renderChadArrowLayer(state);
    if (chadArrows) stage.appendChild(chadArrows);
    stage.appendChild(renderFavoriteBar(state));
    stage.appendChild(renderStageControls(state));
    stage.appendChild(renderResourceRow(state));
    stage.appendChild(renderSideControls(state));
    stage.appendChild(renderActionRow(state));
    stage.appendChild(renderEnhanceOpenBtn(state));
    const raySwordBanner = renderRaySwordBanner(state);
    if (raySwordBanner) stage.appendChild(raySwordBanner);
    const missionToast = renderMissionToast(state);
    if (missionToast) stage.appendChild(missionToast);
    if (ui.popup === 'roulette') stage.appendChild(renderRoulettePopup(state));
    if (ui.popup === 'enhance') stage.appendChild(renderEnhancePopup(state));
    if (ui.popup === 'mythic') stage.appendChild(renderMythicPopup(state));
    if (ui.popup === 'mission') stage.appendChild(renderMissionPopup(state));
    if (state.result) stage.appendChild(renderResultOverlay(state));
    return stage;
  }

  function formatClock(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function renderTopBadge(state) {
    return el('div', { class: 'top-badge' }, [
      el('span', { class: 'top-badge-label', text: `WAVE ${state.wave}` }),
      el('span', { class: 'top-badge-value', text: formatClock(state.waveTimeLeft) }),
    ]);
  }

  // 몬스터 카운트는 필드 누적치(state.monsterCount, 최대 state.monsterMax=110)를
  // 그대로 보여준다 - 라운드당 40마리(MONSTER_PER_ROUND)는 매 라운드 이 누적치에
  // 트리클로 더해지는 "증가분"일 뿐, 화면에 표시되는 최대값과는 다른 개념이다
  // (waveEvents.js의 tickWave 참고). 헷갈려서 한 번 40을 최대값으로 잘못 표시했었다.
  function renderMonsterRow(state) {
    return el('div', { class: 'monster-row' }, [
      el('span', { class: 'monster-count-text', text: `${displayMonsterCount(state)} / ${state.monsterMax}` }),
    ]);
  }

  function renderBoss(state) {
    const raid = state.bossRaidWindow;
    const raidLabel = raid ? (raid.open ? '레이드 창 열림!' : '몬스터 소탕 대기 중') : null;
    const boss = el('div', {
      class: 'stage-boss',
      style: `left:${STAGE_LAYOUT.boss.left}%; top:${STAGE_LAYOUT.boss.top}%; width:${STAGE_LAYOUT.boss.width}%; height:${STAGE_LAYOUT.boss.height}%;`,
    }, [el('img', { class: 'stage-boss-img', src: BOSS_IMAGE, alt: '보스' })]);
    if (raidLabel) boss.appendChild(el('span', { class: `raid-window-badge ${raid.open ? 'open' : ''}`, text: raidLabel }));
    return boss;
  }

  // 좌우 굴 보라색 소용돌이는 성능 문제로 제거했다(사용자 요청 - conic-gradient
  // 회전 애니메이션이 항상 켜져 있는 게 렉의 상당 부분을 차지한다고 실측 확인,
  // CLAUDE.md 참고). 라운드 종료 5초 전 카운트다운 배지만 남긴다 - 0라운드(1웨이브
  // 시작 전 5초 대기 구간)에도 이미 waveTimeLeft가 5→0으로 카운트다운 중이라
  // 똑같이 보여준다.
  function renderHoleEffects(state) {
    if (state.wave < 0 || state.result) return null;
    const secLeft = Math.ceil(state.waveTimeLeft);
    if (secLeft < 1 || secLeft > 5) return null;
    return el('div', { class: 'hole-effects' }, [
      el('div', {
        class: 'hole-countdown',
        style: `left:${STAGE_LAYOUT.leftHole.x}%; top:${STAGE_LAYOUT.leftHole.y}%;`,
      }, [
        el('span', { class: 'hole-countdown-icon', text: '⏱️' }),
        el('span', { class: 'hole-countdown-num', text: String(secLeft) }),
      ]),
    ]);
  }

  // 전체화면 버튼은 사용자 요청으로 제거했다(모바일 검은 여백 문제 우회용으로
  // 넣었던 것 - "전체화면 모드는 제거해줘").
  function renderStageControls(state) {
    const buttons = [
      el('button', {
        class: `stage-control-btn ${state.paused ? 'active' : ''}`,
        text: state.paused ? '▶' : '⏸',
        onclick: () => {
          const next = structuredClone(state);
          next.paused = !state.paused;
          dispatch(next);
        },
      }),
    ];
    buttons.push(el('button', { class: 'stage-control-btn', text: '🚪', onclick: onExit }));
    return el('div', { class: 'stage-controls' }, buttons);
  }

  const FAVORITE_BAR_MAX = 5;

  // 좌측 세로 아이콘 목록. 두 종류를 함께 보여준다:
  // 1) 승급 가능한 불멸 - 조건을 채운 신화 개체를 칸 클릭 후 아래 "승급 시도" 버튼이
  //    아니라 신화 조합과 똑같은 방식으로 왼쪽 아이콘에 노출한다(사용자 지정 규칙 -
  //    "불멸이 먼저, 신화가 밑으로"). instance별 판정이라 heroId가 아니라 instanceId
  //    기준으로 찾는다.
  // 2) 지금 조합 가능한 신화(재료가 필드에 다 갖춰진 신화). 신화 소환은 항상 "재료를
  //    먼저 없애고 신화를 추가"하는 방식이라 무료 재소환 같은 예외가 없다(사용자
  //    지적 - 예전엔 즐겨찾기 등록 + 한 번 조합한 신화는 재료 없이 무한 재소환되는
  //    "즉시소환" 버튼이 따로 있었는데, "재료도 안 없어지고 소환만 되는 중"이라는
  //    지적을 받고 그 예외를 완전히 없앴다. `unlockedInstantSummons`/
  //    `instantSummonFavorite`도 함께 삭제 - 항상 craftMythic() 하나로 통일).
  // 정렬은 불멸 승급 후보를 항상 앞에 두고, 그 안에서/신화 목록 안에서는 각각
  // 즐겨찾기 우선.
  function favoriteBarItems(state) {
    const favoriteIds = new Set(state.heroSettings.filter((h) => h.favorite).map((h) => h.heroId));

    // 필드에는 불멸이 종류별로 최대 1마리만 존재할 수 있으므로(immortal.js의
    // checkImmortalPromotion 가드), 같은 heroId를 가진 신화가 여러 마리 있고
    // 전부 동시에 승급 조건을 채워도 실제로 승급 가능한 건 하나뿐이다 - 왼쪽
    // 아이콘도 그 규칙과 맞춰서 heroId당 하나만 보여준다(사용자 지적 - "마마
    // 2마리라고 왼쪽에 불멸 2마리 뜨잖아... 필드에는 1마리 정상 적용되어도
    // 왼쪽에도 적용되어야지"). 어느 개체를 누르든 결과는 같으니(승급 가능 여부는
    // 공유 자원 기준이라 하나가 승급하면 나머지도 곧 조건을 다시 채워야 함) 필드
    // 순서상 먼저 찾은 개체를 대표로 쓴다.
    const promoteHeroIds = new Set();
    const promoteItems = [];
    for (const slot of state.field) {
      for (const occ of slot.occupants) {
        const heroDef = HEROES_BY_ID[occ.heroId];
        if (promoteHeroIds.has(occ.heroId)) continue;
        if (heroDef?.tier === 'mythic' && heroDef.immortalCondition && isImmortalPromotionReady(state, occ.instanceId)) {
          promoteHeroIds.add(occ.heroId);
          promoteItems.push({ kind: 'promote', instanceId: occ.instanceId, heroId: occ.heroId });
        }
      }
    }
    promoteItems.sort((a, b) => Number(favoriteIds.has(b.heroId)) - Number(favoriteIds.has(a.heroId)));

    const craftIds = heroesByTier('mythic')
      .filter((heroDef) => craftMaterialsReady(state, heroDef))
      .map((heroDef) => heroDef.id);
    craftIds.sort((a, b) => Number(favoriteIds.has(b)) - Number(favoriteIds.has(a)));
    const craftItems = craftIds.map((heroId) => ({ kind: 'craft', heroId }));

    return [...promoteItems, ...craftItems].slice(0, FAVORITE_BAR_MAX);
  }

  function renderFavoriteBar(state) {
    const items = favoriteBarItems(state);
    const favoriteIds = new Set(state.heroSettings.filter((h) => h.favorite).map((h) => h.heroId));
    // 즐겨찾기로 등록해 둔 영웅은 왼쪽 아이콘에도 별표를 달아 표시한다(사용자 요청).
    const starBadge = (heroId) => (favoriteIds.has(heroId) ? el('span', { class: 'favorite-icon-star', text: '★' }) : null);
    return el(
      'div',
      { class: 'favorite-bar' },
      items.map((item) => {
        const heroDef = HEROES_BY_ID[item.heroId];
        if (item.kind === 'promote') {
          // 빨간 테두리 원 안에는 지금(신화) 그림이 아니라 승급될 불멸 그림이 들어가야
          // 한다(사용자 지정 - 목표를 미리 보여주는 자리).
          const immortalDef = HEROES_BY_ID[heroDef.immortalCondition.id] ?? heroDef;
          return el(
            'button',
            {
              class: 'favorite-icon favorite-icon-promote',
              title: immortalDef?.name,
              onclick: () => apply(checkImmortalPromotion(state, item.instanceId)),
            },
            [
              heroImage(immortalDef, { className: 'favorite-icon-image' }),
              starBadge(item.heroId),
              el('span', { class: 'favorite-icon-label', text: '승급 가능!' }),
            ],
          );
        }
        return el(
          'button',
          {
            class: 'favorite-icon',
            title: heroDef?.name,
            onclick: () => apply(craftMythic(state, item.heroId)),
          },
          [
            heroImage(heroDef, { className: 'favorite-icon-image' }),
            starBadge(item.heroId),
            el('span', { class: 'favorite-icon-label', text: '조합 가능' }),
          ],
        );
      }),
    );
  }

  function renderField(state) {
    const grid = el('div', {
      class: 'field-grid stage-field',
      style: `left:${STAGE_LAYOUT.field.left}%; top:${STAGE_LAYOUT.field.top}%; width:${STAGE_LAYOUT.field.width}%; height:${STAGE_LAYOUT.field.height}%;`,
    });
    for (const slot of state.field) {
      const filling = isImmobilizeFilling(state, slot);
      const cell = el('div', {
        class: [
          `field-slot count-${slot.occupants.length}`,
          slot.occupants.length ? '' : 'empty',
          filling ? 'immobilize-filling' : '',
          isImmobilized(state, slot) ? 'immobilize-active' : '',
        ].filter(Boolean).join(' '),
        style: `grid-column:${slot.col + 1}; grid-row:${slot.row + 1};${filling ? ` --fill-sec:${IMMOBILIZE_GAUGE_FILL_SEC}s; animation-delay:-${(IMMOBILIZE_GAUGE_FILL_SEC - state.eventLog.immobilizeEvent.timer) * 1000}ms;` : ''}`,
        'data-row': slot.row, 'data-col': slot.col,
        // 탭/드래그는 위쪽 root pointerdown/pointermove/pointerup 핸들러가 전담한다
        // (드래그 이동과 탭 선택을 한 제스처에서 구분해야 하므로 onclick을 쓰지 않음).
        // ondragstart를 막아야 하는 이유는 heroVisual.js의 draggable=false 주석 참고.
        ondragstart: (e) => e.preventDefault(),
      });
      // 기절 사슬 아이콘은 칸 구석의 작은 아이콘이 아니라 캐릭터 앞을 덮는 큰
      // 아이콘이어야 한다는 사용자 지적(참고 이미지) - renderHeroTokenLayer가 캐릭터
      // 토큰과 같은 좌표계에서 그린다(여기서는 더 이상 그리지 않음).
      // 보물 위치는 필드 임의의 칸에 랜덤 등장한다(기획서 명시 사항) - 작은 코너 아이콘이
      // 아니라 칸 전체가 노란색으로 빛나야 눈에 띈다는 사용자 지적을 반영해 글로우로 표시.
      // "신화 인게임에서 깜빡거리는 버그" 리포트의 원인 - `.treasure-mark`의
      // `animation: treasure-glow 1s infinite`가 고정 delay 없이 걸려 있어서,
      // 게임 루프가 0.2초마다 전체 DOM을 다시 그리는 이 프로젝트 구조상(main.js)
      // 매번 새로 생성되는 이 div가 항상 0% 키프레임(opacity 0.65)부터 다시
      // 재생되다가 0.2초 만에 또 잘려나가길 반복해서 부드럽게 도는 대신 파르르
      // 떠는 것처럼 보였다(몬스터 이동/공격 모션과 같은 계열의 함정, CLAUDE.md 참고).
      // 인디(신화)가 보물을 찾는 동안 계속 눈에 띄는 요소라 "신화" 버그로 체감된
      // 것으로 보인다 - 다른 이펙트들과 같은 방식으로 실제 경과 시간(`Date.now()`를
      // 1초 주기로 나눈 나머지) 기준 `animation-delay`를 매 렌더 다시 계산해서 넣는다.
      if (isTreasureSlot(state, slot)) {
        const glowDelayMs = Date.now() % 1000;
        cell.appendChild(el('div', {
          class: 'treasure-mark',
          style: `animation-delay:-${glowDelayMs}ms;`,
        }, [el('span', { text: '💰' })]));
      }
      grid.appendChild(cell);
    }
    return grid;
  }

  function fieldCellRect(row, col) {
    const cellW = STAGE_LAYOUT.field.width / FIELD_COLS;
    const cellH = STAGE_LAYOUT.field.height / FIELD_ROWS;
    return {
      left: STAGE_LAYOUT.field.left + col * cellW,
      top: STAGE_LAYOUT.field.top + row * cellH,
      width: cellW,
      height: cellH,
    };
  }

  // 13/20라운드 삭제 공격: 로직(waveEvents.js handleDeleteEvent)은 이미 행/열 하나를
  // 골라 targetSlots에 담아두고 phase:'filling' 동안 9초(DELETE_START~TRIGGER_AT_TIME_LEFT
  // 차이)를 세다가 다 차면 그 라인을 지운다 - 여기서는 그 라인 전체를 감싸는 네모
  // 테두리를 그리고, 왼쪽(행)/위쪽(열)에서부터 게이지가 차오르는 오버레이를 겹쳐서
  // 사용자가 요청한 시각 효과로 표현한다.
  function renderDeleteLineEffect(state) {
    const ev = state.eventLog.deleteEvent;
    if (!ev || ev.phase !== 'filling' || ev.targetSlots.length === 0) return null;
    const isRow = ev.targetSlots.every((t) => t.row === ev.targetSlots[0].row);
    const first = fieldCellRect(ev.targetSlots[0].row, ev.targetSlots[0].col);
    const last = fieldCellRect(
      ev.targetSlots[ev.targetSlots.length - 1].row,
      ev.targetSlots[ev.targetSlots.length - 1].col,
    );
    const rect = {
      left: Math.min(first.left, last.left),
      top: Math.min(first.top, last.top),
      width: isRow ? STAGE_LAYOUT.field.width : first.width,
      height: isRow ? first.height : STAGE_LAYOUT.field.height,
    };
    const totalFillSec = DELETE_START_AT_TIME_LEFT - DELETE_TRIGGER_AT_TIME_LEFT;
    const elapsedSec = DELETE_START_AT_TIME_LEFT - state.waveTimeLeft;
    const progress = Math.max(0, Math.min(1, elapsedSec / totalFillSec));
    return el('div', {
      class: 'delete-line-box',
      style: `left:${rect.left}%; top:${rect.top}%; width:${rect.width}%; height:${rect.height}%;`,
    }, [
      el('div', {
        class: `delete-line-gauge ${isRow ? 'from-left' : 'from-top'}`,
        style: isRow ? `width:${progress * 100}%;` : `height:${progress * 100}%;`,
      }),
    ]);
  }

  // 필드 캐릭터는 칸 안에 눕혀 넣는 flex 자식이 아니라, 칸 좌표를 기준으로 절대배치되는
  // 별도 오버레이 레이어로 그린다(.field-slot이 overflow:hidden이라 칸보다 큰 이미지를
  // 담을 수 없어서). z-index를 그리드 행(row) 번호로 매겨 아래쪽(화면 앞쪽) 행 캐릭터가
  // 위쪽(화면 뒷쪽) 행 캐릭터를 가리는 입체감을 낸다(사용자 참고 스크린샷 그대로 -
  // 원근감 있는 배치).
  // 캐릭터의 "맨 밑선"(발)을 칸 바닥선이 아니라 칸 정중앙에 맞춘다(사용자 지정 -
  // "캐릭터 맨 밑선 기준으로 중앙에다가 정렬"). 박스 전체를 칸 중앙에 놓는 게
  // 아니라 발끝이 중앙에 오도록 박스를 위로 끌어올리는 방식이라, 몸통/머리는
  // 칸 위로 넘치고 발은 칸 안쪽(정중앙)에 남는다.
  //
  // 3배로 키웠던 걸 사용자가 "너무 크다"고 되돌렸다 - 이번엔 "3마리가 쌓였을 때
  // 그 발끝(맨 하단)들이 전부 칸 하나의 가로 폭 안에 들어와야 한다"는 조건으로
  // 크기를 역산했다. stackOffsets(3)의 좌우 오프셋이 ±0.3*tokenWidth이고 각
  // 캐릭터 폭이 tokenWidth이므로, 3마리의 가로 전체 스팬은
  // 2*(0.3+0.5)*tokenWidth = 1.6*tokenWidth - 이게 칸 너비(1.0) 안에 들어오려면
  // tokenWidth <= 0.625여야 한다. 여유를 좀 두고 0.55로 잡았다(스팬 0.88, 칸 폭의
  // 88%만 사용 - 발끝이 칸 가장자리에 닿을 듯 말 듯하지 않게). 높이는 예전
  // 비율(0.8/0.44≈1.82)을 그대로 유지해서 0.55*1.82≈1.0으로 잡았다 - 정확히 칸
  // 높이 1배라 계산이 깔끔하기도 하고, 캐릭터가 서 있을 때 칸 하나 높이만큼
  // 위로 솟아 있는 정도라 "적당히 크다"는 느낌과도 맞아떨어진다.
  //
  // 캐릭터 크기는 그 칸에 몇 마리가 쌓여있든 항상 고정이다(사용자 지적 - 예전엔
  // 칸 너비를 마리 수만큼 나눠서 1마리일 때와 3마리일 때 크기가 달라졌었음).
  //
  // "신화/불멸이 일반~전설보다 커야 하는데 지금 반대로 보인다"는 지적에 맞춰
  // 일반~전설 기준 비율을 20% 줄이고(0.55/1.0 → 0.44/0.8), 신화/불멸 배율은 기존
  // 절대 크기(1.25배) 대비 20% 더 키웠다 - 신화/불멸 배율은 이 기준 비율에 곱해지는
  // 값이라, 최종 신화 절대 크기가 "예전 신화 크기(0.55×1.25=0.6875)의 120%"가
  // 되도록 역산하면 0.6875×1.2 / 0.44 = 1.875. 이후 사용자 요청으로 그 1.875배에서
  // 다시 10%를 줄였다(1.875 × 0.9 = 1.6875).
  const HERO_TOKEN_HEIGHT_RATIO = 0.8;
  const HERO_TOKEN_WIDTH_RATIO = 0.44;
  const IMP_TOKEN_SCALE = 0.5; // 마마 임프는 다른 캐릭터의 절반 크기(사용자 지적 - 너무 컸음)
  const MYTHIC_TOKEN_SCALE = 1.6875;
  // "신화들 크기가 다 다르고 불멸 크기가 다 다르다 - 일반~전설은 전기로봇 크기,
  // 신화/불멸은 인디 크기로 맞춰달라"는 사용자 지정에 따라 크기 보정 체계를
  // 처음 도입했었는데(높이를 정확히 맞추는 공식), 실제로 배포해보니 "높이를
  // 맞춘다기보다는 비슷한 크기(비율)면 좋겠다 - 서있는 애들은 인디와 비슷해도
  // 되지만 그보다 10% 낮추고, 낮은 자세인 애들은 알아서 작게"라는 재지적을
  // 받았다 - 순수 높이 맞추기는 기가채드처럼 이미지가 납작한 캐릭터를 인디와
  // 같은 높이로 억지로 맞추려다 보니 폭이 인디의 2배 넘게 부풀어(칸을 넘어 옆칸
  // 까지 침범) "너무 크다"는 결과를 냈었다.
  //
  // 그래서 높이가 아니라 **면적(전체 크기)**을 맞추는 방식으로 바꿨다. 이미지
  // 종횡비 Ri, 박스 종횡비 RB에 대해 `object-fit:contain`이 실제로 그리는
  // 콘텐츠의 면적은 `S² × Hb² × f(Ri)`(S=배율, Hb=박스 높이 기준값)이고
  // `f(Ri) = Ri (Ri≤RB일 때, 이미 박스를 꽉 채움) 또는 RB²/Ri (Ri>RB일 때,
  // 납작해서 위아래 여백이 생김)`이다 - 이 89장 안에서는 전부 Ri>RB(모든
  // 이미지가 박스보다 납작함)라서 사실상 항상 `f(Ri)=RB²/Ri`가 쓰인다. 면적을
  // 기준 캐릭터와 맞추려면 `S_h = S_ref × sqrt(f(Ri_ref)/f(Ri_h))`인데,
  // f(Ri)=RB²/Ri 형태에서는 RB가 완전히 상쇄돼 `S_h = S_ref × sqrt(Ri_h/Ri_ref)`로
  // 단순화된다 - 순수 이미지 종횡비 비율의 제곱근만으로 배율이 정해지므로,
  // 높이 맞추기(Ri에 선형 비례)보다 훨씬 완만하게 반응한다(제곱근이 극단값을
  // 눌러준다). 결과적으로 이미지가 원래 세로로 긴("서 있는") 캐릭터는 높이가
  // 커지고, 원래 가로로 넓은("누워있는"/웅크린) 캐릭터는 면적은 비슷해도
  // 높이 자체는 자연히 더 작아진다 - "낮은 자세인 애들은 알아서 작게" 요구사항이
  // 이 공식의 자연스러운 결과로 충족된다. 알파 bbox 실측(Python Pillow
  // `getbbox()`)으로 89장 전체 Ri를 다시 쟀다.
  //
  // 신화/불멸은 기준(인디) 자신의 배율도 `S_ref=0.9`(사용자 지정 - "서있는 애들은
  // 인디랑 비슷해도 될 거 같긴 한데 그거보다 10% 높이를 낮추고")로 둬서, 인디
  // 자신도 예전(높이 100% 맞춤) 대비 10% 작아졌다 - 높이는 S에 선형 비례하므로
  // 이 10%는 그대로 "인디의 새 높이 = 예전 높이의 90%"로 반영된다. 일반~전설은
  // 기준(전기로봇) 자신을 `S_ref=1`(그대로) 유지한다.
  const MYTHIC_SIZE_COMPENSATION = {
    i_ace_batman: 0.942, i_ancient_chona: 0.930, i_archmage_gigi: 0.991, i_awakened_hailey: 1.126,
    i_blob_gang: 1.126, i_boss_gorazo: 1.138, i_captain_roka: 1.301, i_death_frog: 1.190,
    i_death_frog_evolved: 1.030, i_demon_lord_dragon: 1.030, i_devil_monopoly: 1.005, i_dr_pulse: 1.080,
    i_ghost_ninja: 1.030, i_giga_chad: 1.376, i_grand_cat_mage: 1.121, i_grand_mama: 0.978,
    i_hero_ray: 1.144, i_im_meyaong: 0.872, i_knight_lancelot: 1.081, i_noise_king_penguin: 1.011,
    i_orc_leader: 1.098, i_primal_bamba: 1.190, i_queen_coldi: 1.118, i_sage_kun: 1.156,
    i_sky_dragon_uchi: 1.067, i_spacetime_ato: 1.126, i_super_gravity_bomb: 1.044, i_swarm_tar: 1.060,
    i_top_bane: 1.301, m_ato: 0.847, m_bamba: 1.124, m_bane: 1.236,
    m_batman: 0.928, m_blob: 0.906, m_cat_mage: 1.078, m_chad: 0.944,
    m_chona: 1.083, m_coldi: 1.060, m_dragon: 1.055, m_frog_prince: 1.113,
    m_gigi: 0.978, m_gorazo: 0.974, m_gravity_bomb: 1.065, m_hailey: 1.135,
    m_indy: 0.900, m_iron_meyaong: 1.195, m_lancelot: 0.847, m_mama: 0.982,
    m_master_kun: 0.965, m_monopoly_man: 1.034, m_ninja: 0.835, m_orc_shaman: 0.911,
    m_penguin_musician: 1.074, m_pulse_generator: 0.982, m_ray: 1.010, m_rocketchu: 1.146,
    m_roka: 1.231, m_tar: 1.103, m_uchi: 1.089, m_watt: 1.251,
  };
  // 일반~전설도 같은 면적 기반 공식으로 재계산했다(기준: 전기로봇). `LEGENDARY_
  // TOKEN_SCALE`은 더 이상 필요 없어져서 삭제 - 등급 구분 없이 이 표 하나로 통일.
  const TIER_SIZE_COMPENSATION = {
    n_archer: 1.185, n_thrower: 1.273, n_barbarian: 1.072, n_water_spirit: 1.093, n_bandit: 1.191,
    r_ranger: 1.071, r_shock_robot: 1.159, r_paladin: 1.079, r_sandman: 1.051, r_demon_soldier: 1.093,
    h_electric_robot: 1.000, h_tree: 1.226, h_hunter: 1.212, h_eagle_general: 1.079, h_wolf_warrior: 1.317,
    l_warmachine: 1.336, l_tiger_master: 1.282, l_storm_giant: 1.289, l_sheriff: 1.356,
  };
  const ULTIMATE_FLASH_MS = 3000; // 베인 궁 이펙트 지속 시간(사용자 요청으로 3초로 연장)
  // 머리 위 숫자 배지(로카 탄약/배트맨 강화 레벨 공용) 위치 - 토큰 박스
  // top(box top)을 그대로 쓰면 신화 박스가 실제 그림보다 훨씬 커서(object-fit:
  // contain 여백) 머리 위에서 한참 떨어져 보였다(사용자 지적 - "로카 바로 머리
  // 위에 뜨면 좋겠는데 지금 너무 멀어"). 박스 안쪽으로 내려서 실제 머리 근처에
  // 오도록 비율을 잡았다(스크린샷으로 확인하며 튜닝한 값 - 나중에 토큰 크기
  // 배율이 또 바뀌면 다시 확인해야 한다).
  const HEAD_BADGE_TOP_RATIO = 0.68;

  // 한 칸에 쌓인 마리 수별 배치 오프셋(토큰 폭/높이 대비 비율). 3마리는 일렬이 아니라
  // 뒤 2마리 + 앞 1마리의 삼각형 대열로 배치한다(사용자 참고 이미지). 인덱스 순서가
  // 뒤→앞이라 나중에 그려지는 앞쪽 캐릭터가 자연히 뒤쪽 위에 겹쳐 보인다(같은 칸
  // 안에서는 z-index를 따로 안 써도 DOM에 그려지는 순서만으로 앞/뒤가 갈림).
  // 3마리 배치 규칙(사용자 정정 - "위에 있는 2마리는 밑선을 가운데에 맞추고 그
  // 아래에 한 마리를 추가하는 걸로 가자. 지금은 정렬이 흐트러져 보여"): 뒤 2마리의
  // 발끝(dy:0)이 다른 마리 수와 똑같이 칸 중앙에 오도록 맞추고, 앞 1마리는 그
  // 기준선보다 아래(dy:양수)에 별도로 추가한다 - 뒤 2마리끼리는 같은 높이로
  // 나란히 정렬되고, 앞 1마리만 그 아래 걸쳐 보인다.
  function stackOffsets(n) {
    if (n <= 1) return [{ dx: 0, dy: 0 }];
    if (n === 2) return [{ dx: -0.22, dy: 0 }, { dx: 0.22, dy: 0 }];
    return [
      { dx: -0.3, dy: 0 }, // 뒤-왼쪽(밑선이 칸 중앙)
      { dx: 0.3, dy: 0 }, // 뒤-오른쪽(밑선이 칸 중앙)
      { dx: 0, dy: 0.2 }, // 앞-중앙(그 아래 추가)
    ];
  }

  // "합성 가능" 표시는 칸을 감싸는 사각 테두리가 아니라(사용자 지적 - "누가
  // 네모로 하랬냐"), 캐릭터 이미지의 실제 알파 채널(실루엣)을 따라가는 흰색
  // 외곽선이어야 한다. drop-shadow를 여러 방향으로 얇게 겹쳐 쌓으면 투명 배경은
  // 그대로 투명하게 두고 그림이 있는 픽셀 가장자리에만 색이 번져서 실루엣
  // 외곽선처럼 보인다.
  // 함정: CSS `filter: drop-shadow(A) drop-shadow(B) ...`는 각 항이 원본이 아니라
  // "이전까지 누적된 결과물"에 다시 적용된다(체이닝) - 8방향을 그대로 다 겹치면
  // 오프셋들이 서로 누적돼 실제 시각적 크기가 훨씬 크게 부풀어 보인다. 지난 라운드에
  // 이걸 0.6px/4방향까지 줄였더니 이번엔 반대로 아예 안 보인다는 지적을 받았다 -
  // 1.5px로 다시 키워서 눈에 띄면서도 예전(2px/8방향)처럼 뭉개지지 않는 지점을
  // 찾았다(Playwright 스크린샷으로 직접 눈으로 확인하며 맞춤).
  const OUTLINE_OFFSET_PX = 1.5;
  function outlineFilter(color = '#fff') {
    const offsets = [
      [OUTLINE_OFFSET_PX, 0], [-OUTLINE_OFFSET_PX, 0], [0, OUTLINE_OFFSET_PX], [0, -OUTLINE_OFFSET_PX],
    ];
    return offsets.map(([x, y]) => `drop-shadow(${x}px ${y}px 0 ${color})`).join(' ');
  }

  // 인디가 보유한 보물 등급에 따라 인디 본인의 외곽선 색을 바꾼다(사용자 지정) -
  // 등급 색은 기존 팔레트(main.css의 --tier-color 변수들)와 맞춰뒀다.
  const INDY_TREASURE_OUTLINE_COLOR = {
    normal: '#8b93a8', rare: '#4fc3f7', hero: '#9b6df0', legendary: '#f5a623',
  };

  const INDY_GAUGE_FLASH_MS = 1500; // "완료" 텍스트가 잠깐 떠 있는 시간(1회성)

  // 인디의 보물 발굴 쿨타임(30초)을 인디 캐릭터 바로 밑에 항상 보여주는 게이지
  // (사용자 지정 - "이건 클릭 안 해도 보여지게"). 칸을 선택했는지와 무관하게 항상
  // 그린다(renderHeroTokenLayer에서 인디가 있는 칸마다 호출). 게이지가 다 차서 새
  // 보물이 등장한 순간(indyTreasure.completedAt)부터 INDY_GAUGE_FLASH_MS 동안만
  // "완료" 텍스트를 한 번 보여준다 - 궁극기 링/공격 모션과 같은 이유로 고정 delay가
  // 아니라 실제 경과 시간으로 판정한다(0.2초마다 DOM이 재생성되는 구조라 매 렌더
  // 새로 계산해야 멈추지 않고 자연스럽게 사라진다).
  // **주의**: 처음엔 칸(rect) 하단 기준으로 그렸는데, 인디는 신화 등급이라 토큰
  // 박스가 칸보다 훨씬 커서(위쪽으로 크게 튀어나옴) 실제 캐릭터 발밑과 칸 하단이
  // 안 맞아 게이지가 멀리 떨어져 보였다(사용자 지적 - "인디도 바가 지금 너무
  // 멀어") - 베인 궁 게이지와 같은 이유/같은 방식으로, 칸이 아니라 토큰 자신의
  // 좌표(centerX/footY/tokenWidth)를 기준으로 다시 그려서 실제 발밑 바로 아래에
  // 오도록 고쳤다.
  function renderIndyTreasureGauge(state, instanceId, centerX, footY, width) {
    const t = state.indyTreasures[instanceId] ?? { timer: INDY_TREASURE_INTERVAL_SEC, completedAt: null };
    const fillRatio = Math.max(0, Math.min(1, 1 - t.timer / INDY_TREASURE_INTERVAL_SEC));
    const completedElapsedMs = t.completedAt ? Date.now() - t.completedAt : Infinity;
    const showComplete = completedElapsedMs < INDY_GAUGE_FLASH_MS;
    return el('div', {
      class: 'indy-treasure-gauge',
      style: `left:${centerX - width / 2}%; top:${footY}%; width:${width}%;`,
    }, [
      el('div', { class: 'indy-treasure-gauge-fill', style: `width:${fillRatio * 100}%;` }),
      showComplete ? el('div', { class: 'indy-treasure-gauge-complete', text: '완료' }) : null,
    ]);
  }

  // 탑 베인의 궁극기(이동 15~20회 랜덤 환산) 쿨타임을 캐릭터 바로 밑에 항상
  // 보여주는 게이지(사용자 요청 - "베인 궁 쿨타임 차는거 밑에 바로 보여주면
  // 좋겠어"). immortal.js의 recordImmortalEvent가 매번 남기는
  // ultimateWindowStart(이번 구간 시작 시점의 누적 이동수)~nextUltimateAt(이번
  // 구간이 끝나는 누적 이동수) 사이에서 progress가 어디쯤 왔는지로 채움 비율을
  // 계산한다 - 인디 게이지와 같은 시각 스타일을 재사용. **주의**: 처음엔 칸(rect)
  // 하단 기준으로 그렸는데, 신화 등급은 토큰 박스가 칸보다 훨씬 커서(위쪽으로
  // 크게 튀어나옴) 실제 캐릭터 발밑과 칸 하단이 안 맞아 게이지가 멀리 떨어져
  // 보였다(사용자 지적 - "베인이랑 바가 너무 멀어") - 칸이 아니라 토큰 자신의
  // 좌표(centerX/footY/tokenWidth)를 기준으로 다시 그려서 실제 발밑 바로 아래에
  // 오도록 고쳤다.
  function renderBaneUltimateGauge(occ, centerX, footY, width) {
    // 불멸 승급 판정에 쓰이는 occ.progress는 이제 "궁극기 사용 횟수"(target 12)라서
    // 이 게이지(다음 궁극기까지 남은 이동량)는 별도로 쌓이는 occ.moveProgress
    // 기준으로 계산해야 한다(immortal.js recordImmortalEvent 참고).
    const start = occ.ultimateWindowStart ?? 0;
    const end = occ.nextUltimateAt ?? start;
    const fillRatio = end > start ? Math.max(0, Math.min(1, ((occ.moveProgress ?? 0) - start) / (end - start))) : 0;
    return el('div', {
      class: 'indy-treasure-gauge',
      style: `left:${centerX - width / 2}%; top:${footY}%; width:${width}%;`,
    }, [
      el('div', { class: 'indy-treasure-gauge-fill', style: `width:${fillRatio * 100}%;` }),
    ]);
  }

  // 용사 레이(신화)의 "검 부르기" 쿨타임(고정 40초)을 캐릭터 바로 밑에 항상
  // 보여주는 게이지(사용자 요청 - "쿨타임 바도 보여줘") - 베인/인디와 같은 시각
  // 스타일을 재사용한다. 다 찬 뒤(instance.manaReady=true)에도 tickOverrides.m_ray의
  // while 루프가 elapsed/nextTick을 계속 다음 주기로 넘겨버리므로, 그 값을 그대로
  // 쓰면 이미 다 찼는데도 다시 채워지는 중처럼 보인다 - manaReady가 true인 동안은
  // 무조건 100%로 고정해서 보여준다.
  function renderRayCooldownGauge(occ, centerX, footY, width) {
    const t = occ.immortalTick;
    const fillRatio = occ.manaReady ? 1 : (t && t.nextTick > 0 ? Math.max(0, Math.min(1, t.elapsed / t.nextTick)) : 0);
    return el('div', {
      class: 'indy-treasure-gauge',
      style: `left:${centerX - width / 2}%; top:${footY}%; width:${width}%;`,
    }, [
      el('div', { class: 'indy-treasure-gauge-fill', style: `width:${fillRatio * 100}%;` }),
    ]);
  }

  function renderHeroTokenLayer(state) {
    const layer = el('div', { class: 'stage-hero-layer' });
    for (const slot of state.field) {
      if (slot.occupants.length === 0) continue;
      const rect = fieldCellRect(slot.row, slot.col);
      const firstHeroTier = HEROES_BY_ID[slot.occupants[0].heroId]?.tier;
      const isImpCell = slot.occupants[0].heroId === IMP_HERO_ID;
      const isMythicCell = firstHeroTier === 'mythic' || firstHeroTier === 'immortal';
      const sizeScale = isImpCell
        ? IMP_TOKEN_SCALE
        : isMythicCell
          ? MYTHIC_TOKEN_SCALE * (MYTHIC_SIZE_COMPENSATION[slot.occupants[0].heroId] ?? 1)
          : TIER_SIZE_COMPENSATION[slot.occupants[0].heroId] ?? 1;
      const tokenHeight = rect.height * HERO_TOKEN_HEIGHT_RATIO * sizeScale;
      const n = slot.occupants.length;
      // 발끝(박스 하단) 기준선: 일반~영웅은 칸 정중앙(사용자 지정) - 마리 수와
      // 무관하게 항상 같은 기준선을 쓴다. 3마리일 때 뒤 2마리의 발끝이 바로 이
      // 기준선에 오고, 앞 1마리만 stackOffsets의 dy로 그 아래에 별도로 걸린다
      // (사용자 정정 - "위에 있는 2마리는 밑선을 가운데에 맞추고 그 아래에 한
      // 마리를 추가"). 신화/불멸(항상 1마리, 훨씬 큼)은 그 "앞 1마리" 기준선에
      // 맞춘다(사용자 지정 - "일반 3마리일 때 아래에 있는 애 발선 있잖아 거기
      // 맞추면 됨") - 칸 정중앙에서 기본(1배) 칸 높이의 0.2배만큼 더 아래.
      const baseTop = isMythicCell
        ? rect.top + rect.height * (0.5 + 0.2 * HERO_TOKEN_HEIGHT_RATIO) - tokenHeight
        : rect.top + rect.height / 2 - tokenHeight;
      const tokenWidth = rect.width * HERO_TOKEN_WIDTH_RATIO * sizeScale; // 마리 수와 무관하게 항상 고정
      const cellCenterX = rect.left + rect.width / 2;
      const offsets = stackOffsets(n);
      const positions = offsets.map((o) => ({
        centerX: cellCenterX + o.dx * tokenWidth,
        top: baseTop + o.dy * tokenHeight,
      }));

      // 흰 외곽선은 선택 여부와 무관하게 3마리가 다 찬 칸에만 뜬다(합성 가능한
      // 등급 - 일반~영웅만, 전설 이상은 스택 개념이 없거나 합성 대상이 아님).
      // 사용자가 명시적으로 정정한 규칙 - "흰색 테두리는 내가 3마리 있을때만
      // 하라 했다. 1~2마리일 때 칸 클릭해도 뜨면 안 된다" - 그래서 선택
      // 여부(`selected`)는 이 판정에서 아예 빼야 한다.
      const firstHeroDef = HEROES_BY_ID[slot.occupants[0].heroId];
      const readyToCombine = n === 3 && ['normal', 'rare', 'hero'].includes(firstHeroDef?.tier);
      const outlined = readyToCombine;

      slot.occupants.forEach((occ, i) => {
        const heroDef = HEROES_BY_ID[occ.heroId];
        // 디버프는 개체 하나가 아니라 칸 전체에 적용되고(사용자 지적 - 한 칸에 3마리가
        // 있으면 그 중 1마리만이 아니라 칸에 있는 전원이 대상이어야 한다), 칸도 한 번에
        // 6개까지 동시에 물든다(사용자 지정 - 기절 게이지형과 동일).
        // 디버프는 칸이 아니라 개체(instanceId) 기준 - 캐릭터를 다른 칸으로 옮기면
        // 보라색도 같이 따라가야 한다(사용자 지적).
        const debuffEv = state.eventLog.debuffEvent;
        const debuffed = debuffEv && debuffEv.instanceIds.includes(occ.instanceId);
        // 탑 베인이 방금 궁극기 환산 임계치(이동 왕복 15~20회 랜덤)를 넘겼으면 잠깐
        // 이펙트를 준다(사용자 요청 - immortal.js의 recordImmortalEvent가 남긴
        // 타임스탬프 확인). 게임 루프가 0.2초마다 전체 DOM을 다시 그리는 구조라
        // (main.js), infinite 애니메이션에 고정 delay를 넣으면 매번 처음부터
        // 재생되며 멈춘 것처럼 보인다(몬스터 이동 애니메이션과 같은 함정, CLAUDE.md
        // 참고) - 실제 경과 시간 기준으로 animation-delay를 매 렌더 다시 계산해서
        // 넣는다.
        const ultimateElapsedMs = occ.ultimateFlashAt ? Date.now() - occ.ultimateFlashAt : Infinity;
        const usingUltimate = occ.heroId === 'm_bane' && ultimateElapsedMs < ULTIMATE_FLASH_MS;
        const { centerX, top } = positions[i];

        // filter는 CSS 클래스를 여러 개 동시에 걸어도 서로 값을 덮어쓸 뿐 합쳐지지
        // 않는다(마지막에 매치된 규칙만 적용됨) - 합성가능 외곽선/디버프/궁극기
        // 발광이 동시에 필요할 수 있어서 상태에 맞는 filter 문자열을 직접 합성해
        // 인라인 style로 넣는다.
        const filterParts = ['drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5))'];
        if (usingUltimate) filterParts.push('drop-shadow(0 0 10px #ffd54a)', 'drop-shadow(0 0 18px #ff9d2f)');
        if (debuffed) filterParts.push('sepia(1)', 'hue-rotate(220deg)', 'saturate(3)');
        if (outlined) filterParts.push(outlineFilter());
        // 인디가 보유한 보물 등급에 따라 인디 자신의 외곽선 색을 바꾼다(사용자 지정).
        const indyOutlineColor = occ.heroId === 'm_indy' ? INDY_TREASURE_OUTLINE_COLOR[occ.indyTreasureTier] : null;
        if (indyOutlineColor) filterParts.push(outlineFilter(indyOutlineColor));

        // 공격 모션(위아래 스쿼시-스트레치)은 렉 개선을 위해 제거했다(사용자 요청 -
        // 몬스터 이동/보라색 소용돌이 제거와 같은 이유로 실측 확인, CLAUDE.md 참고).
        const imgStyle = `filter:${filterParts.join(' ')};`;

        layer.appendChild(el('div', {
          class: `stage-hero-token${usingUltimate ? ' ultimate-flash' : ''}`,
          style: `left:${centerX}%; top:${top}%; width:${tokenWidth}%; height:${tokenHeight}%; z-index:${2 + slot.row};${usingUltimate ? ` --ring-delay:-${ultimateElapsedMs % 800}ms;` : ''}`,
          'data-canvas-src': resolveHeroImage(heroDef, occ),
          'data-canvas-seed': occ.instanceId,
          'data-canvas-row': slot.row,
          'data-canvas-filter': filterParts.join(' '),
        }, [
          battleRenderer.supported ? null : el('div', { class: 'stage-hero-shadow' }),
          battleRenderer.supported
            ? el('span', { class: 'stage-hero-image stage-hero-canvas-placeholder' })
            : heroImage(heroDef, { className: 'stage-hero-image', instance: occ, style: imgStyle }),
          occ.enhanceLevel ? el('span', { class: 'enhance-badge', text: `+${occ.enhanceLevel}` }) : null,
        ]));

        // 로카는 지금 장전된 탄약 수(instance.ammo, immortal.js의 m_roka 핸들러가
        // 10초마다 1~5 재장전 + 0.5초마다 1발씩 소모)를 머리 바로 위에 숫자만
        // 표시한다(사용자 지정 - "장전 대기중 이런거 쓸데없는 말 다 빼... 숫자만
        // 적으라고"). 탄약 0이어도 그냥 0으로 보여준다(별도 문구 없음).
        if (occ.heroId === 'm_roka') {
          layer.appendChild(el('div', {
            class: 'hero-head-badge',
            style: `left:${centerX}%; top:${top + tokenHeight * HEAD_BADGE_TOP_RATIO}%; z-index:${30 + slot.row};`,
            text: `${occ.ammo ?? 0}`,
          }));
        }
        // 배트맨(승급 전 m_batman)도 같은 자리에 지금 강화 레벨을 숫자만 보여준다
        // (사용자 지정 - "몇강인지는 배트 머리 위에 로카처럼 적어줘"). 승급 후
        // (i_ace_batman)는 enhanceLevel이 0으로 리셋되고 더는 의미가 없어서 표시하지
        // 않는다.
        if (occ.heroId === 'm_batman') {
          layer.appendChild(el('div', {
            class: 'hero-head-badge',
            style: `left:${centerX}%; top:${top + tokenHeight * HEAD_BADGE_TOP_RATIO}%; z-index:${30 + slot.row};`,
            text: `${occ.enhanceLevel ?? 0}`,
          }));
        }
        // 원시 밤바도 같은 자리에 지금 쌓인 스택 수(불멸 조건 진행도, 목표 30)를
        // 숫자만 보여준다(사용자 요청 - "밤바 강화 수치도 로카처럼 머리에 적어줘").
        if (occ.heroId === 'm_bamba') {
          layer.appendChild(el('div', {
            class: 'hero-head-badge',
            style: `left:${centerX}%; top:${top + tokenHeight * HEAD_BADGE_TOP_RATIO}%; z-index:${30 + slot.row};`,
            text: `${occ.progress ?? 0}`,
          }));
        }
        // 탑 베인 궁극기 쿨타임 게이지는 캐릭터 바로 밑에 항상 표시(선택 여부와
        // 무관 - 인디 발굴 게이지와 같은 패턴). 칸(rect)이 아니라 토큰 자신의
        // 발끝(top+tokenHeight) 기준으로 그려야 신화 크기 배율과 무관하게 항상
        // 캐릭터 바로 밑에 붙는다.
        if (occ.heroId === 'm_bane') {
          layer.appendChild(renderBaneUltimateGauge(occ, centerX, top + tokenHeight + 1, tokenWidth));
        }
        // 용사 레이(신화) "검 부르기" 쿨타임 게이지도 같은 패턴으로 항상 표시
        // (선택 여부와 무관). 승급 후(i_hero_ray)는 쿨타임 개념 자체가 없어져서
        // heroId가 달라지므로 자연히 안 뜬다.
        if (occ.heroId === 'm_ray') {
          layer.appendChild(renderRayCooldownGauge(occ, centerX, top + tokenHeight + 1, tokenWidth));
        }
      });

      // 기절 사슬 아이콘 - 칸 구석의 작은 아이콘이 아니라 캐릭터 바로
      // 앞(위)을 덮는 큰 아이콘으로 표시해달라는 사용자 지적(참고 이미지: 캐릭터
      // 크기만큼 큰 사슬 X가 캐릭터 앞에 겹쳐 보임). 처음엔 실제 캐릭터 토큰과
      // 같은 좌표계(tokenWidth/tokenHeight)를 그대로 썼는데, 신화/불멸은
      // sizeScale이 훨씬 커서(캐릭터 크기 재계산 라운드 이후 특히) 사슬도 같이
      // 커져 화면을 압도했다(사용자 지적 - "신화 기절시킬 때 사슬도 너무 커.
      // 사슬 크기는 항상 동일하게 가자. 일반 기준으로 사슬 크기를 신화/불멸에도
      // 적용하는거야 위치랑") - sizeScale=1(일반 등급 기준) 고정 크기의 참조
      // 박스를 별도로 계산해서, 실제로 기절한 캐릭터의 등급/크기와 무관하게
      // 항상 같은 크기·같은 위치(칸 정중앙 기준)로 그린다.
      if (isImmobilized(state, slot)) {
        const refTokenHeight = rect.height * HERO_TOKEN_HEIGHT_RATIO;
        const refTokenWidth = rect.width * HERO_TOKEN_WIDTH_RATIO;
        const refBaseTop = rect.top + rect.height / 2 - refTokenHeight;
        const chainWidth = refTokenWidth * 1.05;
        const chainHeight = refTokenHeight * 0.9;
        layer.appendChild(el('div', {
          class: 'stage-immobilize-mark',
          style: `left:${cellCenterX}%; top:${refBaseTop + refTokenHeight / 2}%; width:${chainWidth}%; height:${chainHeight}%; z-index:${20 + slot.row};`,
        }, [el('img', { src: UI_IMAGES.immobilizeIcon, alt: '기절' })]));
      }

      // 인디 쿨타임 게이지는 칸에 다른 영웅이 같이 쌓여 있어도(보물이 이미 다른
      // 캐릭터가 있는 칸에 등장할 수 있다는 것과는 별개로, 인디 본인이 서 있는 칸
      // 기준) 항상 그린다 - 선택 여부와 무관. 인디가 여러 마리일 수 있으니(각자
      // indyTreasures에 독립된 항목을 가짐) 그 칸의 인디 개체마다 각각 그린다.
      const indyOccupantsHere = slot.occupants.filter((o) => o.heroId === 'm_indy');
      for (const indyOcc of indyOccupantsHere) {
        layer.appendChild(renderIndyTreasureGauge(state, indyOcc.instanceId, cellCenterX, baseTop + tokenHeight + 1, tokenWidth));
      }
    }
    return layer;
  }

  // 선택된 영웅의 모든 조작(이동/강화/판매/합성/영웅별 특수 액션)을 큰 팝업 패널이
  // 아니라 선택된 칸 바로 위/아래에 붙는 작은 버튼 묶음으로 띄운다(사용자 지정 UI -
  // "칸 클릭했을 때 팝업이 뜨는 게 아니라 위 아래로 버튼이 뜨는 것"). 판매/이동/강화는
  // 칸 위쪽에 쌓고, 합성과 영웅별 특수 액션은 칸 아래쪽에 쌓는다.
  function renderCellQuickActions(state) {
    if (ui.chadSellMode) return null; // 화살표 선택 모드 중엔 다른 칸 클릭을 방해하지 않게 숨김
    const found = selectedInstance(state);
    if (!found) return null;
    const { slot, instance } = found;
    const heroDef = HEROES_BY_ID[instance.heroId];
    // 마마가 만든 임프도 이제 판매(9코인/마리)/합성(3마리 -> 희귀 랜덤)이 가능하다
    // (사용자 지정) - 일반~전설과 같은 제네릭 판매/합성 블록을 그대로 타므로 여기서
    // 더 이상 막을 필요가 없다(아래 mythic/immortal 전용 분기들은 heroId/tier로
    // 따로 걸러지니 임프에는 자연히 적용 안 됨).
    const rect = fieldCellRect(slot.row, slot.col);
    const centerX = rect.left + rect.width / 2;

    const above = [];
    const below = [];

    // 선택 해제용 ✕ 버튼은 모든 캐릭터에서 일괄 제거했다(사용자 지적 - 배트맨
    // 강화 배지("+15", "강화 240G 성공 28%")와 겹쳐서 가렸음). 빈 칸 클릭이나
    // 다른 칸 클릭으로도 이미 선택이 해제되므로(PR #40 "빈 칸 탭 시 즉시 해제"
    // 참고) 기능 손실은 없다.

    // 일반~전설은 판매/합성 외에 다른 기능이 없다(이동/강화 버튼 없음). 신화~불멸은
    // 일반 판매가 안 되고, 채드의 "판매하기" 버튼으로 화살표 모드에 들어가야만 처분할
    // 수 있다(아래 renderChadArrowLayer 참고 - 신화/불멸을 선택했다고 자동으로 먹이기
    // 버튼이 뜨는 게 아니라, 채드 쪽에서 먼저 시작해야 하는 사용자 지정 순서).
    if (heroDef.tier !== 'mythic' && heroDef.tier !== 'immortal') {
      above.push(el('button', {
        class: 'cell-quick-btn cell-quick-sell', text: '판매',
        onclick: () => apply(sellHero(state, instance.instanceId)),
      }));
    }

    if (slot.occupants.length === 3 && heroDef.tier !== 'legendary') {
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-synth', text: '합성',
        onclick: () => apply(synthesize(state, slot.row, slot.col)),
      }));
    }
    // 돌파는 필드 캐릭터를 클릭했을 때 나오는 버튼으로 조작하는 게 아니다(사용자가
    // 여러 번 지적 - "캐릭터 눌렀을때 돌파 버튼 나오면 안된다고 했다") - 돌파 여부는
    // 시작 화면의 "돌파" 체크박스로만 결정되고(체크 시 7마리, 미체크 시 9마리),
    // `synthesis.js`의 `craftMythic()`이 마마를 조합하는 시점에 그 설정값을
    // `instance.breakthrough`로 그대로 박아 넣는다 - 게임 중에 필드에서 바꿀 수 있는
    // 값이 아니므로 여기엔 어떤 토글 버튼도 두지 않는다.
    // 승급 시도는 더 이상 칸 아래 버튼이 아니라, 조건 충족 시 좌측 즉시소환 아이콘 바에
    // "승급 가능!"으로 노출된다(renderFavoriteBar/favoriteBarItems 참고 - 사용자 지정
    // 규칙: 불멸이 먼저, 신화가 밑으로).
    // 채드/기가채드 전용: "판매하기"를 누르면 팝니다 버튼이 아니라 필드의 신화/불멸
    // 머리 위에 초록 화살표가 뜨는 모드로 들어간다 - 그 화살표를 눌러야 비로소
    // 판매(먹이기)가 실행된다(사용자 지정 순서: 채드 하단 버튼 → 화살표 표시 →
    // 화살표 클릭 → 판매). 일반 채드는 신화만, 기가채드는 신화/불멸 둘 다 먹일 수
    // 있다(사용자 지정 - "일반 채드는 불멸을 못 팔아. 기가채드만 신화/불멸 다 팔
    // 수 있어") - 대상 등급 필터링은 renderChadArrowLayer가 어느 채드가 눌렀는지
    // (instance.heroId)로 판정한다.
    // 기가채드는 예전에 이 "판매하기"(화살표로 다른 신화/불멸 먹이기) 버튼과
    // 별도로 "판매(+6💧)"(자기 자신을 파는 전용 버튼)가 동시에 떠 있었다 - 사용자
    // 지적("판매버튼이랑 판매 6행운석 버튼이 같이 나와... 판매 버튼 하나만 보이고,
    // 초록색 화살표 똑같이 보이는데... 이게 자기 위에도 뜨는 방식인거야")대로
    // 별도 버튼을 없애고 하나의 "판매하기"로 통합했다 - 화살표 대상 목록에
    // 기가채드 자기 자신도 포함되도록 renderChadArrowLayer를 확장했다. 보상은
    // feedMythicToChad가 대상 등급 기준(신화 5/불멸 6)으로 계산하므로(사용자
    // 정정 - "불멸은 팔면 행운석 6이라고 했다"), 자기 자신(불멸 등급)을 화살표로
    // 찍어도 같은 함수 호출만으로 자동으로 6행운석이 나온다 - 별도 함수
    // (sellGigaChad)는 완전히 제거했다.
    if (instance.heroId === 'm_chad' || instance.heroId === 'i_giga_chad') {
      const active = ui.chadSellMode === instance.instanceId;
      below.push(el('button', {
        class: `cell-quick-btn cell-quick-extra ${active ? 'active' : ''}`,
        text: active ? '취소' : '판매하기',
        onclick: () => { ui.chadSellMode = active ? null : instance.instanceId; render(state); },
      }));
    }
    if (instance.heroId === 'm_tar' && countHeroOnField(state, 'm_tar').count > 1) {
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra', text: '동족포식',
        onclick: () => apply(cannibalizeTar(state, instance.instanceId)),
      }));
    }
    if (instance.heroId === 'm_indy') {
      const t = state.indyTreasures[instance.instanceId];
      const onTreasureSlot = t?.slot && t.slot.row === slot.row && t.slot.col === slot.col;
      const digging = t?.digging;
      const isDiggingHere = digging?.instanceId === instance.instanceId;
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: isDiggingHere ? '발굴 중...' : '발굴',
        disabled: !onTreasureSlot || (!!digging && !isDiggingHere) || isDiggingHere,
        onclick: () => apply(digTreasure(state, instance.instanceId)),
      }));
    }
    if (SECOND_STAGE_IMMORTAL[instance.heroId]) {
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: `2차 변신(성공 ${Math.round(SECOND_STAGE_IMMORTAL[instance.heroId].successRate * 100)}%)`,
        onclick: () => apply(attemptSecondStageEvolution(state, instance.instanceId)),
      }));
    }
    // 개구리왕자 전용 "변신" - 사신개구리(불멸) 승급의 선행 단계(사용자 지정
    // 순서: "변신 버튼을 눌러... 35% 확률이고 실패하면 없어져. 변신에 성공하면
    // 불멸 소환이 가능해져"). 변신에 성공하기 전까진 왼쪽 즐겨찾기 바에 "승급
    // 가능!" 아이콘 자체가 안 뜨므로(isImmortalPromotionReady의 'm_frog_prince'
    // case 참고), 여기 버튼이 유일한 시작점이다. 변신 이후엔 더 이상 이 버튼이
    // 필요 없으니(승급은 왼쪽 아이콘으로) instance.frogTransformed 조건으로만
    // 숨긴다.
    if (heroDef.id === 'm_frog_prince' && !instance.frogTransformed) {
      const successRate = heroDef.immortalCondition.extra.successRate;
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: `변신(성공 ${Math.round(successRate * 100)}%)`,
        onclick: () => apply(attemptFrogTransform(state, instance.instanceId)),
      }));
    }
    // 용사 레이(신화) 전용 "검 부르기" - 마나(instance.manaReady)가 다 찼을 때만
    // 무료로 누를 수 있다(사용자 지정). 전설 검을 뽑으면 승급 자격이 생겨 왼쪽
    // 즐겨찾기 바에 "승급 가능!"이 뜨므로, 그 이후엔 마마/아이언미야옹과 같은
    // 패턴으로 이 버튼을 숨긴다.
    if (heroDef.id === 'm_ray' && !isImmortalPromotionReady(state, instance.instanceId)) {
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: '검 부르기',
        disabled: !instance.manaReady,
        onclick: () => apply(callRaySword(state, instance.instanceId)),
      }));
    }
    // 불멸 용사 레이 전용 "검 제작"(희귀 등급 아무 영웅 1마리 소모, 최대
    // RAY_SWORD_CRAFT_MAX개 누적) / "초기화"(전부 제거 후 처음부터 다시) -
    // 사용자 지정.
    if (heroDef.id === 'i_hero_ray') {
      const raySwords = instance.raySwords ?? [];
      const hasRareMaterial = state.field.some((s) => s.occupants.some((o) => HEROES_BY_ID[o.heroId]?.tier === 'rare'));
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: `검 제작(희귀 1) ${raySwords.length}/${RAY_SWORD_CRAFT_MAX}`,
        disabled: raySwords.length >= RAY_SWORD_CRAFT_MAX || !hasRareMaterial,
        onclick: () => apply(craftRaySword(state, instance.instanceId)),
      }));
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: '초기화',
        disabled: raySwords.length === 0,
        onclick: () => apply(resetRaySwords(state, instance.instanceId)),
      }));
    }
    // 이동은 이제 버튼이 아니라 칸을 직접 드래그하는 방식이라(아래 드래그 핸들러
    // 참고) 탑 베인도 별도 버튼이 필요 없다 - 드래그로 옮겨도 moveHero()가 그대로
    // 호출되어 불멸 진행도가 똑같이 쌓인다. 배트맨 전용 강화 버튼(강화 레벨
    // 자체가 승급 조건의 전제라 extra.minEnhance로 판정 - 예전엔 이 조건에 안
    // 걸려서 배트맨은 강화 버튼 자체가 아예 안 떠서 승급 조건을 영원히 만족할 수
    // 없는 버그였음)만 여기 남긴다 - 아이언미야옹은 완전히 다른 3단계 진행
    // 방식이라 아래 별도 블록으로 뺐다.
    if (heroDef.immortalCondition?.extra?.minEnhance != null) {
      const goldCost = nextEnhanceGoldCost(instance.heroId, instance.enhanceLevel);
      const luckstoneCost = nextEnhanceLuckstoneCost(instance.heroId);
      const successRate = nextEnhanceSuccessRate(instance.heroId, instance.enhanceLevel);
      const parts = [];
      if (goldCost > 0) parts.push(`${goldCost}G`);
      if (luckstoneCost > 0) parts.push(`${luckstoneCost}💎`);
      if (successRate < 1) parts.push(`성공 ${Math.round(successRate * 100)}%`);
      const costLabel = parts.length ? ` (${parts.join(' ')})` : '';
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: `강화${costLabel}`,
        disabled: state.gold < goldCost || state.luckstone < luckstoneCost,
        onclick: () => apply(enhanceHero(state, instance.instanceId)),
      }));
    }
    // 아이언미야옹 전용 3단계 진행(사용자 지정 수치) - 1차 변신(5💎) → 2차 변신
    // (10💎) → 기술 강화(1💎/회, 10% 확률로만 성공, 누적 10 성공 시 승급). 승급
    // 조건을 다 채우면(왼쪽 즉시소환 바에 "승급 가능!"으로 이미 노출) 더 눌러도
    // 의미가 없으니 마마의 "돌파" 버튼과 같은 패턴으로 숨긴다.
    if (instance.heroId === 'm_iron_meyaong' && !isImmortalPromotionReady(state, instance.instanceId)) {
      const cond = heroDef.immortalCondition;
      const stage = instance.meyaongTransformStage ?? 0;
      const cost = stage === 0 ? cond.extra.transform1LuckstoneCost
        : stage === 1 ? cond.extra.transform2LuckstoneCost
          : cond.extra.enhanceLuckstoneCost;
      const label = stage === 0 ? `1차 변신 (${cost}💎)`
        : stage === 1 ? `2차 변신 (${cost}💎)`
          : `기술 강화 (${cost}💎 성공 ${Math.round(cond.extra.enhanceSuccessRate * 100)}%)`;
      below.push(el('button', {
        class: 'cell-quick-btn cell-quick-extra',
        text: label,
        disabled: state.luckstone < cost,
        onclick: () => apply(advanceIronMeyaong(state, instance.instanceId)),
      }));
    }

    // 부가 정보는 큰 카드 대신 작은 배지 한 줄로만 보여준다. 불멸 진행도("불멸
    // N/target")는 어떤 신화 캐릭터를 클릭하든 아예 노출하지 않는다(사용자 지정 -
    // 처음엔 마마만 뺐었는데 "마마뿐만 아니라 다른것들도 다 하지마"라고 확장 지적).
    // 단, 마마는 임프가 이제 필드에 실제 캐릭터로 보이니 나머지(임프 수) 텍스트도
    // 중복 정보라 사용자 요청으로 배지 자체를 아예 안 띄운다.
    if (instance.heroId !== 'm_mama') {
      const statusText = extraStatusText(instance, heroDef);
      const displayLabel = heroDisplayLabel(instance, heroDef);
      const statusParts = [];
      if (displayLabel !== heroDef.name) statusParts.push(displayLabel);
      if (statusText) statusParts.push(statusText);
      if (statusParts.length) {
        above.unshift(el('div', { class: 'cell-status-badge', text: statusParts.join(' · ') }));
      }
    }

    const aboveWrap = el('div', {
      class: 'cell-quick-stack cell-quick-stack-above',
      style: `left:${centerX}%; top:${rect.top}%;`,
    }, above);
    const belowWrap = below.length
      ? el('div', {
          class: 'cell-quick-stack cell-quick-stack-below',
          style: `left:${centerX}%; top:${rect.top + rect.height}%;`,
        }, below)
      : null;

    // 선택된 캐릭터가 어떤 칸인지 잘 보이도록 그 칸 주변에 연한 원형 테두리를 그린다
    // (사용자 요청 - "어떤 캐릭을 선택했는지 잘 보이게 그 인근으로 원을 테두리만
    // 하나 연하게 그려줘, 버튼이랑 이어지게"). 칸 좌표 기준으로 위/아래 버튼
    // 스택과 같은 anchor(rect)를 쓰기 때문에, 링이 칸 위아래로 살짝 넘치게
    // 잡으면 자연스럽게 위/아래 버튼 스택과 맞닿아 하나로 이어져 보인다.
    const selectRing = el('div', {
      class: 'cell-select-ring',
      style: `left:${centerX}%; top:${rect.top + rect.height / 2}%; width:${rect.width * 1.35}%; height:${rect.height * 1.7}%;`,
    });

    // 에이스 배트맨(불멸) 전용 모드 선택 - 순환 버튼이 아니라 캐릭터 좌우에
    // "투수"/"타자" 버튼을 각각 띄운다(사용자 지정 - "지금처럼 하지 말고").
    // 한 번 고르면 그걸로 끝, 다시 못 바꾼다(사용자 지정 - "한번 변신하면
    // 못바꿔") - batmanMode가 이미 정해져 있으면 두 버튼 다 안 뜬다.
    let batmanModeButtons = null;
    if (instance.heroId === 'i_ace_batman' && !instance.batmanMode) {
      const sideOffset = rect.width * 0.75;
      batmanModeButtons = el('div', { class: 'batman-mode-buttons' }, [
        el('button', {
          class: 'batman-mode-btn',
          style: `left:${centerX - sideOffset}%; top:${rect.top + rect.height / 2}%;`,
          text: '투수',
          onclick: () => apply(chooseBatmanMode(state, instance.instanceId, 'pitcher')),
        }),
        el('button', {
          class: 'batman-mode-btn',
          style: `left:${centerX + sideOffset}%; top:${rect.top + rect.height / 2}%;`,
          text: '타자',
          onclick: () => apply(chooseBatmanMode(state, instance.instanceId, 'batter')),
        }),
      ]);
    }

    return el('div', { class: 'cell-quick-actions' }, [selectRing, aboveWrap, belowWrap, batmanModeButtons].filter(Boolean));
  }

  // 채드의 "판매하기" 버튼을 누르면(ui.chadSellMode) 필드의 신화/불멸(채드/기가채드
  // 본인 제외) 머리 위에 초록 화살표를 띄운다 - 화살표를 누르면 그제서야 판매(먹이기)가
  // 실행되고 모드에서 빠져나온다. 자동으로 신화 위에 판매 표시가 뜨는 게 아니라 채드
  // 쪽에서 먼저 시작해야 한다는 사용자 지정 순서를 그대로 구현한 것.
  function renderChadArrowLayer(state) {
    if (!ui.chadSellMode) return null;
    const chad = state.field.flatMap((s) => s.occupants).find((o) => o.instanceId === ui.chadSellMode);
    if (!chad) { ui.chadSellMode = null; return null; }
    // 일반 채드는 신화만, 기가채드는 신화+불멸 둘 다 대상(사용자 지정 - "일반
    // 채드는 불멸을 못 팔아. 기가채드만 신화/불멸 다 팔 수 있어"). m_chad는 신화
    // 등급이라 다른 채드 개체도 원래는 유효한 대상이어야 하는데, "채드/기가채드
    // 본인 제외"를 heroId 기준(occ.heroId !== 'm_chad' && ... !== 'i_giga_chad')으로
    // 잘못 구현해서 필드에 채드가 2마리 이상 있으면 서로를 절대 못 먹는 버그가
    // 있었다(사용자 리포트 - "채드가 채드를 못먹는 문제가 생겼는데?") - "본인
    // 제외"는 지금 판매를 시작한 그 채드 개체 하나만 스스로를 못 먹게 막으라는
    // 뜻이었지, 다른 채드 개체까지 전부 배제하라는 뜻이 아니었다. instanceId
    // 기준(occ.instanceId !== chad.instanceId)으로 바꿔서 자기 자신만 제외한다.
    const allowedTiers = chad.heroId === 'i_giga_chad' ? ['mythic', 'immortal'] : ['mythic'];
    const targets = [];
    for (const slot of state.field) {
      for (const occ of slot.occupants) {
        const def = HEROES_BY_ID[occ.heroId];
        if (!def) continue;
        // 기가채드는 자기 자신도 유효한 화살표 대상이다(사용자 지정 - 자기 자신을
        // 파는 전용 버튼을 없애고 이 화살표 하나로 통합) - 그 외(일반 채드 자기
        // 자신, 지금 판매를 시작한 채드 개체)는 여전히 제외한다.
        const isSelf = occ.instanceId === chad.instanceId;
        if (isSelf && chad.heroId !== 'i_giga_chad') continue;
        if (!isSelf && !allowedTiers.includes(def.tier)) continue;
        targets.push({ slot, occ, tier: def.tier });
      }
    }
    // 먹일 대상이 하나도 없는 상태(필드에 채드 본인 말고 신화/불멸이 없음)에서
    // 그냥 return null만 하면 ui.chadSellMode가 계속 켜진 채로 남는다 -
    // renderCellQuickActions()가 chadSellMode가 켜져 있는 동안 전체를 숨기므로
    // (line 872 근처 가드), 화살표도 안 뜨고 판매하기/취소 버튼도 다시 안 떠서
    // 이후 어떤 칸을 눌러도 퀵액션 패널 자체가 영원히 안 나타나는 먹통 상태가
    // 됐다(사용자 리포트 - "채드한테 먹이를 먹이니까 그 다음에 채드 다시
    // 클릭하면 클릭이 안돼. 판매를 할 수가 없어" - 마지막 남은 대상을 먹인
    // 뒤 "판매하기"를 한 번 더 눌렀을 때 재현됨). 위 !chad 케이스와 같은
    // 패턴으로 여기서도 명시적으로 꺼줘야 한다.
    if (targets.length === 0) { ui.chadSellMode = null; return null; }
    // 보상 표기는 자기 자신인지가 아니라 대상 등급 기준(feedMythicToChad와 동일한
    // 규칙 - 신화 +5/불멸 +6)이다 - 기가채드가 "다른" 불멸을 먹여도 자기 자신을
    // 먹이는 것과 똑같이 +6이므로, 화살표 라벨도 그 등급 그대로 보여준다.
    return el('div', { class: 'chad-arrow-layer' }, targets.map(({ slot, occ, tier }) => {
      const rect = fieldCellRect(slot.row, slot.col);
      return el('button', {
        class: 'chad-sell-arrow',
        style: `left:${rect.left + rect.width / 2}%; top:${rect.top}%;`,
        title: tier === 'immortal' ? '판매(+6💧)' : '판매(+5💧)',
        onclick: () => {
          ui.chadSellMode = null;
          apply(feedMythicToChad(state, chad.instanceId, occ.instanceId));
        },
      }, [el('span', { text: '⬇' })]);
    }));
  }

  // m_tar(단계별)/m_dragon(드레인 준비) 등, 필드에서 상태에 따라 표시가 달라지던 영웅들을
  // 위한 이름 라벨.
  function heroDisplayLabel(instance, heroDef) {
    if (heroDef.id === 'm_tar') return `${heroDef.name} ${instance.tarStage ?? 1}단계`;
    if (heroDef.id === 'm_dragon' && instance.immortalEligible) return `${heroDef.name}(드레인)`;
    return heroDef.name;
  }

  // 실제로 기절되는 건 칸 좌표가 아니라 active 전환 시점에 스냅샷 뜬 개체
  // (targetInstanceIds)다(사용자 지적 - "원을 피했으면 캐릭터가 없는 자리는
  // 기절이 안되는게 맞아... 피한애를 다시 그 칸에 들여다놓으면 피했는데도
  // 기절되어버려"). 그 칸에 지금 있는 개체 중 스냅샷에 있는 게 하나라도 있으면
  // 그 칸을 기절 상태로 표시한다 - 필링 단계에서 도망친 개체나, active 이후에
  // 새로 들어온 개체는 스냅샷에 없으므로 자연히 제외된다. 개체 단위 판정 자체는
  // waveEvents.js의 isInstanceStunned()로 통일했다 - immortal.js의 자동 진행 정지
  // (틱 스킵)도 같은 함수를 공유해서 판정이 두 곳에서 따로 어긋나지 않는다.
  function isImmobilized(state, slot) {
    return slot.occupants.some((o) => isInstanceStunned(state, o.instanceId));
  }
  function isImmobilizeFilling(state, slot) {
    const ev = state.eventLog.immobilizeEvent;
    return ev && ev.phase === 'filling' && ev.targetSlots.some((t) => t.row === slot.row && t.col === slot.col);
  }
  // 보물 위치 글로우는 상시 노출이 아니라 "새로 등장한 순간"과 "인디를 다시
  // 클릭한 순간"에만 잠깐(1초) 반짝이고 사라진다(사용자 지정 - "쿨타임 찼을때
  // 한번 1초 보여주고 사라졌다가 인디 다시 클릭하면 한 1초 보여줬다 사라지는거야.
  // 지금처럼 계속 보이는 게 아니라"). 보물 자체(indyTreasures[id].slot)와
  // "발굴 가능" 여부는 계속 유효하지만(칸 버튼 활성화 등 다른 로직은 그대로),
  // 화면에 노란 글로우로 보여주는 것만 두 트리거의 1초 플래시로 제한한다 -
  // 궁극기 링/공격 모션과 같은 이유로 고정 delay가 아니라 실제 경과 시간을
  // 매 렌더 다시 계산한다. indyTreasures가 인디 개체별 맵이 됐으므로, 이 칸이
  // "어떤 인디"의 보물 위치와 일치하는지를 전부 훑어서 판정한다(인디가 여러
  // 마리면 각자 다른 칸에 보물이 있을 수 있음).
  const INDY_TREASURE_MARK_FLASH_MS = 1000;
  function isTreasureSlot(state, slot) {
    return Object.entries(state.indyTreasures).some(([instanceId, t]) => {
      if (!t.slot || t.slot.row !== slot.row || t.slot.col !== slot.col) return false;
      const spawnedElapsedMs = t.completedAt ? Date.now() - t.completedAt : Infinity;
      const clickedAt = ui.indyMarkerFlashAt[instanceId];
      const clickedElapsedMs = clickedAt ? Date.now() - clickedAt : Infinity;
      return spawnedElapsedMs < INDY_TREASURE_MARK_FLASH_MS || clickedElapsedMs < INDY_TREASURE_MARK_FLASH_MS;
    });
  }

  function onSlotClick(state, slot) {
    // 선택 기준은 개체 하나가 아니라 칸 자체다(사용자 지정 규칙) - 판매 등 액션을
    // 눌러도 그 칸에 뭔가 남아있는 한 선택이 계속 유지된다.
    ui.selectedSlot = slot.occupants.length ? { row: slot.row, col: slot.col } : null;
    // 그 인디의 보물이 있는 칸(인디가 서 있는 칸과 다를 수 있음)의 글로우를 1초간
    // 다시 보여준다(isTreasureSlot 참고) - 인디 개체별로 독립된 트리거라 클릭한
    // 그 인디 자신의 보물만 반짝이고 다른 인디의 보물엔 영향이 없다.
    for (const o of slot.occupants) {
      if (o.heroId === 'm_indy') ui.indyMarkerFlashAt[o.instanceId] = Date.now();
    }
    // 캐릭터 선택은 endDrag()가 pointerup에서 호출하는데(즉 이 함수는 그 탭의
    // 이벤트 디스패치 도중, touchend가 완전히 끝나기도 전에 실행된다), 여기서
    // 동기 render()를 부르면 그 탭 자기 자신의 제스처 안에서 .field-slot 노드가
    // 통째로 교체된다 - "판매 버튼 겹침 오판 정정" 라운드에서 이미 확인한 바로 그
    // 패턴(터치 도중 DOM 재구성이 브라우저 네이티브 더블탭-확대 인식을 방해)인데,
    // 그 라운드에서는 "칸 바깥을 눌러 선택 해제"/"팝업 바깥 클릭으로 닫기"/
    // "채드 화살표 모드 취소" 세 곳만 deferredRender로 고치고 정작 "캐릭터를
    // 선택하는 탭 그 자체"인 이 경로는 빠뜨렸었다 - 사용자가 "룰렛 팝업이
    // 떠있을 때 캐릭터 클릭하면 확대된다"고 리포트해서 Playwright로 실측
    // 재현했더니(탭 직후 바로 .field-slot이 detach돼 있음) 팝업 유무와 무관하게
    // 캐릭터를 탭할 때마다 항상 발생하는 문제였다. deferredRender로 바꿔서
    // DOM 재구성을 이 탭의 동기 실행 구간 밖(다음 프레임)으로 미뤘다.
    deferredRender(getState());
  }

  // resource_bar.png("재화 및 맵 카운트 바.png")에는 코인/행운석/인원 아이콘과 "/" 구분자가
  // 전부 그림 안에 이미 박혀있다(빈 값 없이 장식으로만). 텍스트를 각 아이콘 자리 위에 그대로
  // 얹으면 숫자가 아이콘과 겹쳐서 안 보이는 문제가 있었다 - 실측(bbox 스캔)한 아이콘 위치
  // 기준으로 각 숫자를 아이콘 "다음" 빈 공간에 배치했다. 인원 칸은 그림에 이미 "/"가 있어서
  // 직접 만든 텍스트에 "/"를 또 넣지 않고, 그 "/" 좌우로 현재/최대값만 나눠서 배치한다.
  function renderResourceRow(state) {
    return el('div', { class: 'stage-resource-row' }, [
      el('div', { class: 'resource-bar' }, [
        el('span', { class: 'resource-value resource-gold', text: `${Math.floor(state.gold)}` }),
        el('span', { class: 'resource-value resource-luckstone', text: `${state.luckstone}` }),
        el('span', { class: 'resource-value resource-pop-current', text: `${fieldOccupantCount(state)}` }),
        el('span', { class: 'resource-value resource-pop-max', text: `${state.fieldMaxCapacity}` }),
      ]),
    ]);
  }

  function renderSideControls(state) {
    return el('div', { class: 'stage-side-controls' }, [
      el('button', {
        class: 'speed-toggle-btn',
        title: state.speed === 2 ? '배속 x2 (클릭 시 x1)' : '배속 x1 (클릭 시 x2)',
        onclick: () => {
          const next = structuredClone(state);
          next.speed = state.speed === 2 ? 1 : 2;
          dispatch(next);
        },
      }, [el('img', { src: state.speed === 2 ? UI_IMAGES.speedOn : UI_IMAGES.speedOff, alt: '배속' })]),
      el('button', {
        class: 'mission-toggle-btn',
        title: '미션',
        text: '☰',
        onclick: () => openPopup('mission', state),
      }),
    ]);
  }

  function selectedInstance(state) {
    if (!ui.selectedSlot) return null;
    const slot = state.field.find((s) => s.row === ui.selectedSlot.row && s.col === ui.selectedSlot.col);
    if (slot && slot.occupants.length) return { slot, instance: slot.occupants[0] };
    ui.selectedSlot = null;
    return null;
  }

  // 인디(보유 보물 등급) 등 진행도 텍스트 외에 추가로 보여줄 상태 한 줄. 마마는
  // 호출부(above 3줄 위)에서 아예 배지 자체를 안 띄우도록 걸러지므로 여기 없다
  // (임프가 필드에 실제 캐릭터로 보이는 지금은 "임프 N/9" 텍스트가 중복 정보라
  // 사용자 요청으로 제거됨 - impStock 필드 자체도 더는 존재하지 않는다, 이제
  // 임프 수는 항상 field에서 실시간으로 세는 전역값이다).
  function extraStatusText(instance, heroDef) {
    if (instance.heroId === 'm_indy') {
      return `보유 보물: ${instance.indyTreasureTier ? TIER_LABEL[instance.indyTreasureTier] : '없음'}`;
    }
    // 채드는 판매(먹이기)할 때마다 확률적으로 능력치가 오르는 방식이라 몇 번
    // 먹였는지가 아니라 "지금 몇 % 찼는지"가 진행 상황이다(사용자 요청 -
    // "채드 눌렀을 때 몇 % 찼는지 보여줘"). target(10)이 곧 100%에 해당하는
    // 수치라 progress를 그대로 %로 보여주면 된다.
    if (instance.heroId === 'm_chad') {
      const target = heroDef.immortalCondition?.target ?? 10;
      const pct = Math.min(target, instance.progress ?? 0);
      return `기가채드 진행도: ${pct}%`;
    }
    return null;
  }

  function renderActionRow(state) {
    const mythicBadgeCount = craftableMythicCount(state);
    return el('div', { class: 'action-row' }, [
      el('button', {
        class: 'side-btn', title: '신화',
        onclick: () => { ui.mythicSelectedId = null; openPopup('mythic', state); },
      }, [
        el('img', { src: UI_IMAGES.mythicBtn, alt: '신화' }),
        el('span', { class: 'hex-badge', text: String(mythicBadgeCount) }),
      ]),
      el('button', {
        class: 'summon-btn-wrap', title: '소환',
        // 임프가 칸을 다 채운 경우(인원수엔 안 잡히지만 물리적으로 자리가 없는
        // 상태)도 같이 막는다(사용자 지적 - "임프 포함 필드가 꽉차면 마리수가
        // 남아도 소환이 안되어야해").
        disabled: state.gold < state.normalSummonCost || fieldOccupantCount(state) >= state.fieldMaxCapacity
          || isFieldPhysicallyFull(state),
        onclick: () => apply(summonNormal(state)),
      }, [
        el('img', { src: UI_IMAGES.summonBtn, alt: '소환' }),
        el('span', { class: 'summon-cost-overlay', text: `${state.normalSummonCost}G` }),
      ]),
      el('button', {
        class: 'side-btn', title: '룰렛',
        onclick: () => openPopup('roulette', state),
      }, [el('img', { src: UI_IMAGES.rouletteBtn, alt: '룰렛' })]),
    ]);
  }

  function renderEnhanceOpenBtn(state) {
    return el('button', {
      class: 'enhance-open-btn', title: '강화',
      onclick: () => openPopup('enhance', state),
    }, [el('img', { src: UI_IMAGES.enhanceBtn, alt: '강화' })]);
  }

  // 룰렛 휠은 이미지 대신 목업처럼 CSS로 직접 그린 원 + 등급 라벨 텍스트로 표시한다
  // (문제: 이미지마다 실제 비율이 달라 화면에서 크기가 들쭉날쭉해 보였음).
  const ROULETTE_TIERS = [
    { tier: 'rare', slot: 'left', colorClass: 'blue' },
    { tier: 'hero', slot: 'left', colorClass: 'purple' },
    { tier: 'legendary', slot: 'right', colorClass: 'gold' },
  ];

  const ROULETTE_SPIN_MS = 280; // 룰렛이 도는 시간 - 정확히 0.28초
  const ROULETTE_FAIL_FLASH_MS = 500; // 다 돌아간 뒤 해골을 보여주는 시간

  function onRouletteWheelClick(r) {
    if (ui.spinningTier) return; // 이미 도는 중이면 무시
    const cost = ROULETTE_COST[r.slot];
    const state = getState();
    if (state.luckstone < cost) return;
    // 필드가 꽉 찼으면 재화 소모/결과 처리 이전에 스핀 연출 자체를 시작하지 않는다
    // (summonRoulette도 동일하게 막지만, 그건 결과 처리 시점이라 스핀 애니메이션이
    // 먼저 돌아버리는 게 어색해서 여기서도 미리 막는다).
    if (fieldOccupantCount(state) >= state.fieldMaxCapacity || isFieldPhysicallyFull(state)) return;
    ui.spinningTier = r.tier;
    render(getState());
    setTimeout(() => {
      const fresh = getState();
      const result = summonRoulette(fresh, r.tier, r.slot);
      ui.spinningTier = null;
      if (!result.success && result.reason === 'roulette-fail' && result.consolationHero) {
        // 실패 위로 보상(20% 확률)으로 하위 단계 영웅이 실제로 나온 경우 -
        // 해골 대신 그 영웅 그림을 잠깐 보여준다(성공과 같은 표시 패턴, 등급
        // 실패는 그대로 유지됐다는 걸 헷갈리지 않게 skull은 띄우지 않음).
        ui.rouletteSuccessHero = { tier: r.tier, heroId: result.consolationHero.id };
        setTimeout(() => {
          ui.rouletteSuccessHero = null;
          // 이 타이머는 룰렛을 돌린 시점에 예약되는 완전히 독립적인 백그라운드
          // 콜백이라, 발화 시점에 필드에서 캐릭터를 드래그하는 중이어도 상관없이
          // 무조건 실행된다 - pointerDown 가드(update()가 이미 쓰는 것과 동일한
          // 신호)가 없으면 이게 그 드래그 도중에 DOM을 통째로 갈아엎어버린다
          // (사용자 리포트 - "캐릭터를 잡고 슥 드래그할 때 간헐적으로 확대되는
          // 문제가 있어" - 룰렛 결과 연출 타이머와 드래그 타이밍이 우연히
          // 겹칠 때만 재현되니 "간헐적"이라는 설명과 정확히 들어맞는다). 드래그
          // 중이면 렌더만 건너뛰고 상태 변경(ui.rouletteSuccessHero=null)은 그대로
          // 반영해둔다 - 드래그가 끝나면 endDrag()가 자기 몫의 deferredRender를
          // 부르면서 이 변경사항도 같이 화면에 반영된다.
          if (root.isConnected && !pointerDown) render(getState());
        }, ROULETTE_FAIL_FLASH_MS);
      } else if (!result.success && result.reason === 'roulette-fail') {
        ui.rouletteFailTier = r.tier;
        setTimeout(() => {
          ui.rouletteFailTier = null;
          if (root.isConnected && !pointerDown) render(getState());
        }, ROULETTE_FAIL_FLASH_MS);
      } else if (result.success) {
        // 실패하면 해골이 뜨듯이, 성공하면 뽑힌 영웅 그림을 잠깐 보여준다(사용자 요청).
        ui.rouletteSuccessHero = { tier: r.tier, heroId: result.hero.id };
        setTimeout(() => {
          ui.rouletteSuccessHero = null;
          if (root.isConnected && !pointerDown) render(getState());
        }, ROULETTE_FAIL_FLASH_MS);
      }
      apply(result);
    }, ROULETTE_SPIN_MS);
  }

  function renderRoulettePopup(state) {
    const items = ROULETTE_TIERS.map((r) => {
      const cost = ROULETTE_COST[r.slot];
      const spinning = ui.spinningTier === r.tier;
      const failed = ui.rouletteFailTier === r.tier;
      const succeededHeroId = ui.rouletteSuccessHero?.tier === r.tier ? ui.rouletteSuccessHero.heroId : null;
      return el('div', { class: 'roulette-item' }, [
        el('span', { class: 'roulette-pct', text: `${Math.round(ROULETTE_SUCCESS_RATE[r.tier] * 100)}%` }),
        el('button', {
          class: `roulette-wheel-btn${spinning ? ' spinning' : ''}`,
          disabled: state.luckstone < cost || Boolean(ui.spinningTier) || fieldOccupantCount(state) >= state.fieldMaxCapacity
            || isFieldPhysicallyFull(state),
          onclick: () => onRouletteWheelClick(r),
        }, [
          el('div', { class: `roulette-wheel-circle ${r.colorClass}` }, [
            el('span', { class: 'roulette-wheel-label', text: TIER_LABEL[r.tier] }),
          ]),
          failed ? el('img', { class: 'roulette-fail-skull', src: UI_IMAGES.skullIcon, alt: '실패' }) : null,
          succeededHeroId ? heroImage(HEROES_BY_ID[succeededHeroId], { className: 'roulette-success-image' }) : null,
        ]),
        el('span', { class: 'roulette-item-cost' }, [el('img', { src: UI_IMAGES.luckstoneIcon, alt: '' }), el('span', { text: String(cost) })]),
      ]);
    });
    return el('div', { class: 'game-popup' }, [
      el('div', { class: 'popup-topbar' }, [
        el('span', { class: 'popup-stat' }, [el('img', { src: UI_IMAGES.luckstoneIcon, alt: '' }), el('span', { text: String(state.luckstone) })]),
        el('span', { class: 'popup-stat', text: `👥 ${fieldOccupantCount(state)}/${state.fieldMaxCapacity}` }),
        el('button', { class: 'popup-close', text: '✕', onclick: () => closePopup(state) }),
      ]),
      el('div', { class: 'roulette-row' }, items),
    ]);
  }

  // 강화 팝업 4칸(일반~희귀/영웅/전설~불멸/소환 확률) - 특정 선택 영웅이 아니라 계정
  // 전체에 적용되는 전역 트랙(GameState.globalEnhance, actions.js의 upgradeGlobalEnhance).
  // 데미지 계산이 범위 밖이라 레벨을 올려도 실질 효과는 없지만(소환 확률도 항상 고정),
  // 골드/보석은 실제로 차감되고 레벨도 실제로 오른다.
  const GLOBAL_ENHANCE_ICON = {
    common: UI_IMAGES.enhanceCommon,
    hero: UI_IMAGES.enhanceHero,
    legendary: UI_IMAGES.enhanceLegendary,
    rate: UI_IMAGES.enhanceRate,
  };

  function renderEnhancePopup(state) {
    const cols = GLOBAL_ENHANCE_TRACKS.map((track) => {
      const cost = nextGlobalEnhanceCost(state, track);
      const level = state.globalEnhance[track] + 1;
      const maxLevel = GLOBAL_ENHANCE_MAX_LEVEL[track];
      const atMax = maxLevel != null && level >= maxLevel;
      const canAfford = !atMax && (!cost.gold || state.gold >= cost.gold) && (!cost.luckstone || state.luckstone >= cost.luckstone);
      return el('button', {
        class: 'enhance-col', disabled: !canAfford,
        onclick: () => apply(upgradeGlobalEnhance(state, track)),
      }, [
        el('img', { class: 'enhance-col-icon', src: GLOBAL_ENHANCE_ICON[track], alt: GLOBAL_ENHANCE_LABEL[track] }),
        el('span', { class: 'enhance-col-name', text: GLOBAL_ENHANCE_LABEL[track] }),
        el('span', { class: 'enhance-col-lv', text: `Lv.${level}` }),
        atMax
          ? el('span', { class: 'enhance-col-cost', text: 'MAX' })
          : el('span', { class: 'enhance-col-cost' }, [
              el('img', { src: cost.gold ? UI_IMAGES.goldIcon : UI_IMAGES.luckstoneIcon, alt: '' }),
              el('span', { text: String(cost.gold ?? cost.luckstone) }),
            ]),
      ]);
    });
    return el('div', { class: 'game-popup' }, [
      el('div', { class: 'popup-topbar' }, [
        el('span', { class: 'popup-stat' }, [el('img', { src: UI_IMAGES.goldIcon, alt: '' }), el('span', { text: String(Math.floor(state.gold)) })]),
        el('span', { class: 'popup-stat' }, [el('img', { src: UI_IMAGES.luckstoneIcon, alt: '' }), el('span', { text: String(state.luckstone) })]),
        el('button', { class: 'popup-close', text: '✕', onclick: () => closePopup(state) }),
      ]),
      el('div', { class: 'enhance-cols' }, cols),
    ]);
  }

  // 즐겨찾기된 신화(/그 불멸)가 팝업 그리드에서도 맨 앞으로 오도록 정렬한다(사용자
  // 지적 - 왼쪽 즉시소환 바는 이미 즐겨찾기 우선으로 정렬돼 있었지만, 이 그리드는
  // heroesByTier() 원본 순서 그대로라 즐겨찾기가 전혀 반영되지 않고 있었다).
  function sortFavoriteFirst(state, defs, heroIdOf) {
    const favoriteIds = new Set(state.heroSettings.filter((h) => h.favorite).map((h) => h.heroId));
    return [...defs].sort((a, b) => Number(favoriteIds.has(heroIdOf(b))) - Number(favoriteIds.has(heroIdOf(a))));
  }

  function renderMythicPopup(state) {
    const allMythics = sortFavoriteFirst(state, heroesByTier('mythic'), (h) => h.id);
    if (!ui.mythicSelectedId) {
      ui.mythicSelectedId = allMythics.find((h) => craftMaterialsReady(state, h))?.id ?? allMythics[0]?.id ?? null;
    }
    const selectedDef = HEROES_BY_ID[ui.mythicSelectedId];

    return el('div', { class: 'mythic-popup' }, [
      renderMythicDetailCard(state, selectedDef),
      ui.mythicTab === 'mythic' ? renderMythicGrid(state, allMythics) : renderImmortalGrid(state),
      el('div', { class: 'mythic-tabs' }, [
        el('button', { class: `mythic-tab ${ui.mythicTab === 'mythic' ? 'active' : ''}`, text: '신화', onclick: () => { ui.mythicTab = 'mythic'; render(state); } }),
        el('button', { class: `mythic-tab ${ui.mythicTab === 'immortal' ? 'active' : ''}`, text: '불멸', onclick: () => { ui.mythicTab = 'immortal'; render(state); } }),
      ]),
    ]);
  }

  function craftMaterialsReady(state, heroDef) {
    return (heroDef.synthMaterials ?? []).every((m) => countHeroOnField(state, m.heroId).count >= m.count);
  }

  function renderMythicDetailCard(state, heroDef) {
    if (!heroDef) {
      return el('div', { class: 'mythic-detail-card' }, [el('div', { class: 'mythic-empty-note', text: '신화 등급 영웅이 없습니다.' })]);
    }
    const materials = (heroDef.synthMaterials ?? []).flatMap((m) => {
      const owned = countHeroOnField(state, m.heroId).count;
      const matDef = HEROES_BY_ID[m.heroId];
      return [el('div', { class: `mat ${owned >= m.count ? 'ready' : ''}` }, [
        heroImage(matDef, { className: 'mat-image' }),
        el('span', { class: 'mat-count', text: `${Math.min(owned, m.count)}/${m.count}` }),
      ])];
    });
    const ready = craftMaterialsReady(state, heroDef);
    return el('div', { class: 'mythic-detail-card' }, [
      el('button', { class: 'popup-close', text: '✕', onclick: () => closePopup(state) }),
      el('div', { class: 'mythic-detail-name', text: heroDef.name }, [el('span', { class: 'tier-label', text: TIER_LABEL[heroDef.tier] })]),
      el('div', { class: 'mythic-materials' }, [
        ...materials,
        el('span', { class: 'mat-arrow', text: '→' }),
        el('div', { class: 'mat-result' }, [heroImage(heroDef, { className: 'mat-image' })]),
      ]),
      el('button', {
        class: 'mythic-summon-btn', text: '조합', disabled: !ready,
        onclick: () => apply(craftMythic(state, heroDef.id)),
      }),
    ]);
  }

  function renderMythicGrid(state, allMythics) {
    return el('div', { class: 'mythic-grid' }, allMythics.map((heroDef) => {
      const ready = craftMaterialsReady(state, heroDef);
      const fieldCount = countHeroOnField(state, heroDef.id).count;
      return el('div', {
        class: `mythic-cell ${ready ? 'ready' : ''} ${ui.mythicSelectedId === heroDef.id ? 'selected' : ''}`,
        onclick: () => { ui.mythicSelectedId = heroDef.id; render(state); },
      }, [
        heroImage(heroDef, { className: 'mythic-cell-image' }),
        el('div', { class: 'mythic-progress', text: fieldCount > 0 ? `보유 ${fieldCount}` : (ready ? '조합 가능' : '재료 부족') }),
      ]);
    }));
  }

  // 불멸 탭: 27개 불멸 등급 + N차 변신(사신개구리변신)까지 전부 나열, 실제 승급 조건
  // 충족 여부에 따라 잠김/해금 표시. 판정은 필드에 있는 원본(신화 또는 직전 불멸) 개체의
  // 실제 progress/immortalEligible 값을 그대로 쓴다.
  function immortalUnlockStatus(state, immortalDef) {
    const baseId = immortalDef.baseHeroId;
    const onField = state.field.flatMap((s) => s.occupants).filter((o) => o.heroId === baseId);
    if (!onField.length) return false;
    if (SECOND_STAGE_IMMORTAL[baseId]) return true; // 이미 불멸이면 2차 변신은 언제든 시도 가능
    // `cond.target == null`을 곧장 "해금"으로 취급하던 예전 로직은 마마/개구리왕자
    // (둘 다 target이 null)를 실제 진행 상태와 무관하게 필드에 올라오자마자 항상
    // "해금"으로 잘못 표시했다(임프 몇 마리가 있든, 변신을 했든 안 했든) - 왼쪽 바
    // "승급 가능!" 아이콘 판정에 이미 쓰는 isImmortalPromotionReady(각 조건별 실제
    // 준비 상태를 정확히 계산)를 그대로 재사용해서 통일했다.
    return onField.some((inst) => isImmortalPromotionReady(state, inst.instanceId));
  }

  // 필드에 원본(신화) 개체가 있으면 "잠김" 대신 실제 진행도(N/목표)를 보여준다
  // (사용자 지정 - "베인이 소환되었으면 신화 탭에 있는 베인 불멸이... 현재 불멸
  // 진행 상태를 보여줘야지"). 베인 자신은 target(12)이 있고 progress가 정상
  // 누적되니 아래 범용 분기로 이미 잘 보였는데, 같은 방식으로 다시 확인해보니
  // 마마/개구리왕자/랜슬롯 셋은 진행도가 진짜로 안 보이고 있었다(사용자 지적 -
  // "다른 영웅들 중에 안보이는 것들도 있어"):
  // - 마마/개구리왕자는 cond.target 자체가 null이라(별도 상태로 진행을 관리)
  //   아래 범용 분기가 항상 null을 반환해 무조건 "잠김"만 떴다.
  // - 랜슬롯은 target=3이 있지만 실제로는 instance.progress를 어디서도 증가시키지
  //   않는다(승급 판정 자체가 "10강 달성 개체 수"를 그때그때 세는 방식 -
  //   promotionHandlers.m_lancelot/isImmortalPromotionReady 참고) - 그래서 항상
  //   "0/3"만 뜨고 실제 진행 상황을 전혀 반영하지 못했다.
  // 셋 다 실제 판정에 쓰는 것과 같은 값을 직접 계산해서 보여준다.
  function immortalProgressText(state, immortalDef) {
    const baseId = immortalDef.baseHeroId;
    const onField = state.field.flatMap((s) => s.occupants).filter((o) => o.heroId === baseId);
    if (!onField.length) return null;
    const cond = HEROES_BY_ID[baseId]?.immortalCondition;
    if (!cond) return null;
    if (baseId === 'm_mama') {
      const target = onField.some((inst) => inst.breakthrough) ? cond.extra.breakthroughCost : cond.extra.normalCost;
      const impCount = countHeroOnField(state, IMP_HERO_ID).count;
      return `임프 ${Math.min(target, impCount)}/${target}`;
    }
    if (baseId === 'm_frog_prince') {
      return onField.some((inst) => inst.frogTransformed) ? '변신 완료' : '미변신';
    }
    if (baseId === 'm_lancelot') {
      const maxEnhanced = onField.filter((inst) => (inst.enhanceLevel ?? 0) >= (cond.extra?.maxEnhance ?? 10)).length;
      return `${Math.min(cond.target, maxEnhanced)}/${cond.target}`;
    }
    if (cond.target == null) return null;
    const best = onField.reduce((max, inst) => Math.max(max, inst.progress ?? 0), 0);
    return `${Math.min(cond.target, Math.floor(best))}/${cond.target}`;
  }

  function renderImmortalGrid(state) {
    const allImmortals = sortFavoriteFirst(state, heroesByTier('immortal'), (h) => h.baseHeroId);
    return el('div', { class: 'mythic-grid' }, allImmortals.map((heroDef) => {
      const unlocked = immortalUnlockStatus(state, heroDef);
      const statusText = unlocked ? '해금' : (immortalProgressText(state, heroDef) ?? '잠김');
      return el('div', { class: `mythic-cell ${unlocked ? 'ready' : 'locked'}` }, [
        heroImage(heroDef, { className: 'mythic-cell-image' }),
        el('div', { class: 'mythic-progress', text: statusText }),
      ]);
    }));
  }

  // 미션이 새로 완료되면 화면 우측에서 슬라이드인되는 알림을 잠깐 띄운다(사용자
  // 요청 - "미션 완료되면 우측에서 팝업 띄워주면서 미션 성공 알림"). 게임 루프가
  // 0.2초마다 전체 DOM을 다시 그리는 구조라(main.js), 슬라이드인 애니메이션에
  // 고정 delay를 쓰면 매번 처음부터 재생되며 끊겨 보인다(CLAUDE.md의 반복되는
  // 함정 - 몬스터 이동/공격 모션과 동일) - missionToastQueue[0].timer(남은 시간)를
  // 거꾸로 계산해 실제 경과 시간 기준 animation-delay를 매 렌더 다시 넣는다.
  // 용사 레이(신화)/불멸 용사 레이 둘 다 검을 보유할 수 있다 - 화면 상단 고정
  // 배너로 보여주되, 그 레이를 선택했을 때만 노출한다(사용자 지정 - "화면 상단에
  // 고정하는데 레이를 눌렀을 때만 보이게 해줘"). 그림은 필요 없고 등급별 색상
  // (RAY_SWORD_TIER_COLOR - 일반 흰색/희귀 파랑/영웅 보라/전설 노랑)으로만 구분한다.
  function renderRaySwordBanner(state) {
    const found = selectedInstance(state);
    if (!found) return null;
    const { instance } = found;
    if (instance.heroId !== 'm_ray' && instance.heroId !== 'i_hero_ray') return null;
    const swords = instance.raySwords ?? [];
    if (swords.length === 0) return null;
    return el('div', { class: 'ray-sword-banner' }, swords.map((sword) => el('div', {
      class: 'ray-sword-banner-item',
      style: `color:${RAY_SWORD_TIER_COLOR[sword.tier]};`,
    }, [
      el('span', { class: 'ray-sword-tier-tag', text: RAY_SWORD_TIER_LABEL[sword.tier] }),
      el('span', { class: 'ray-sword-name', text: `[${sword.name}]` }),
      el('span', { class: 'ray-sword-effect', text: sword.effect }),
    ])));
  }

  function renderMissionToast(state) {
    const entry = state.missionToastQueue?.[0];
    if (!entry) return null;
    const def = missionDefinitions().find((m) => m.id === entry.missionId);
    if (!def) return null;
    const elapsedMs = Math.max(0, (MISSION_TOAST_SEC - entry.timer) * 1000);
    const rewardParts = [];
    if (def.reward?.gold) {
      rewardParts.push(el('span', { class: 'mission-toast-reward-item' }, [el('img', { src: UI_IMAGES.goldIcon, alt: '' }), el('span', { text: String(def.reward.gold) })]));
    }
    if (def.reward?.luckstone) {
      rewardParts.push(el('span', { class: 'mission-toast-reward-item' }, [el('img', { src: UI_IMAGES.luckstoneIcon, alt: '' }), el('span', { text: String(def.reward.luckstone) })]));
    }
    return el('div', {
      class: 'mission-toast',
      style: `animation-delay:-${elapsedMs}ms;`,
    }, [
      el('div', { class: 'mission-toast-title', text: '미션 완료!' }),
      el('div', { class: 'mission-toast-name', text: def.name }),
      el('div', { class: 'mission-toast-reward' }, rewardParts),
    ]);
  }

  // 미션은 1번씩만 완료 가능하고(사용자 지정), 완료된 항목은 체크박스가 체크되고
  // 이름에 취소선이 그어진다 - 미완료는 빈 체크박스만 뜬다.
  function renderMissionPopup(state) {
    const items = missionDefinitions().map((def) => {
      const progress = state.missions.find((m) => m.missionId === def.id);
      const completed = progress?.completed ?? false;
      const rewardParts = [];
      if (def.reward?.gold) {
        rewardParts.push(el('span', { class: 'mission-reward-item' }, [el('img', { src: UI_IMAGES.goldIcon, alt: '' }), el('span', { text: String(def.reward.gold) })]));
      }
      if (def.reward?.luckstone) {
        rewardParts.push(el('span', { class: 'mission-reward-item' }, [el('img', { src: UI_IMAGES.luckstoneIcon, alt: '' }), el('span', { text: String(def.reward.luckstone) })]));
      }
      return el('li', { class: `mission-item${completed ? ' completed' : ''}` }, [
        el('span', { class: 'mission-checkbox', text: completed ? '☑' : '☐' }),
        el('div', { class: 'mission-body' }, [
          el('div', { class: 'mission-name', text: `${def.name} (${progress?.current ?? 0}/${def.target})` }),
          el('div', { class: 'mission-desc', text: def.description }),
        ]),
        el('div', { class: 'mission-reward' }, rewardParts),
      ]);
    });
    return el('div', { class: 'popup-overlay', onclick: (e) => { if (e.target === e.currentTarget) closePopup(state); } }, [
      el('div', { class: 'popup-box mission-popup-box' }, [el('h3', { text: '미션' }), el('ul', { class: 'mission-list' }, items), el('button', { class: 'btn mission-close-btn', text: '닫기', onclick: () => closePopup(state) })]),
    ]);
  }

  function renderResultOverlay(state) {
    return el('div', { class: 'result-overlay' }, [
      el('div', { class: 'result-box' }, [
        el('h2', { text: state.result === 'win' ? '승리!' : '패배...' }),
        el('button', { class: 'btn btn-primary', text: '홈으로', onclick: onExit }),
      ]),
    ]);
  }

  // 최초 렌더링은 main.js가 root를 문서에 붙인 직후 update()로 호출한다.
  // (stageWrap이 아직 DOM에 붙기 전에 sizeStageToFit을 돌리면 clientWidth/Height가
  // 0으로 읽혀서 스테이지가 다음 tick 재렌더링 전까지 잠깐 빈 화면으로 보이는 문제가 있었다.)
  return {
    root,
    update(state) {
      if (pointerDown) return; // 클릭 도중엔 건너뛰고, 다음 tick에 반영
      render(state);
    },
    // 게임을 나갈 때(main.js의 onExit) 반드시 호출해야 한다 - 위 window 리스너
    // 4개는 root와 달리 그냥 두면 페이지가 살아있는 한 계속 쌓인다(주석 참고).
    destroy() {
      battleRenderer.destroy();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      if (resizeRenderTimer) clearTimeout(resizeRenderTimer); // 디바운스 대기 중인 렌더 예약도 같이 정리
    },
  };
}
