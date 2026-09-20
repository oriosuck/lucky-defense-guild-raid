# 길드레이드 연습게임 (lucky-defense-guild-raid)

서버·DB·로그인 없이 브라우저에서만 동작하는 정적 SPA 연습 게임입니다.
설계는 `길드레이드_연습게임_기획서_v4.md`, `길드레이드_연습게임_기술설계서_v2.md` 참고
(모든 유물은 항상 맥스 레벨로 고정, 모든 영웅은 기본 보유 상태로 시작하는 최신 기준).

## 개발

```bash
npm install
npm run dev       # http://localhost:5173
```

## 빌드 / 배포

```bash
npm run build      # dist/ 에 정적 파일 생성
npm run preview    # 빌드 결과 로컬 확인
```

`dist/` 폴더를 그대로 Vercel / Netlify / GitHub Pages 등 정적 호스팅에 올리면 됩니다.
서버 통신이 없으므로 환경 변수나 백엔드 설정은 필요 없습니다.

- **Vercel/Netlify**: 저장소 연결 후 build command `npm run build`, output directory `dist` 로 지정하면 push마다 자동 배포됩니다.
- **GitHub Pages**: `npm run build` 산출물을 `gh-pages` 브랜치에 올리거나, Pages 설정에서 `dist`를 소스로 지정합니다. `vite.config.js`의 `base: './'` 덕분에 서브 경로 배포에서도 정상 동작합니다.

## 디렉토리 구조

```
src/
  state/   GameState 정의·필드 배치 헬퍼, localStorage 프리셋 어댑터
  data/    영웅/미션 마스터 데이터, 고정 게임 상수(constants.js - 유물은 항상 맥스 고정이라 선택 UI 없음)
  logic/   소환·합성·불멸엔진·웨이브이벤트·미션·게임루프
  ui/      상태-뷰 분리 구조의 두 화면(HeroSelectScreen/GameScreen), 등급별 단색 블록으로
           영웅을 표시하는 hero-placeholder 컴포넌트(이미지 리소스는 이번 리팩토링 범위 밖)
```

## 참고: 불멸 승급 로직의 구현 범위

기술설계서 5-3에 정리된 27개 불멸 조건은 `src/data/heroes.js`의 `IMMORTAL_CONDITIONS`에
전부 데이터로 정의되어 있고, `src/logic/immortal.js`가 이를 해석해 시간 기반 자동 누적 /
실제 이벤트 카운트를 처리합니다. 대다수는 제네릭 엔진(`applyGenericTick`,
`recordImmortalEvent`)으로 동작하며, 재료 소모나 고유 미니게임이 필요한 일부
(마마 임프 경제, 개구리 승천, 골라조 카드게임, 닌자/초나/지지/랜슬롯 소모 등)는
`tickOverrides` / `promotionHandlers`에 개체별 함수로 구현되어 있습니다. 아직 세부
수치가 정식 확정되지 않은 항목(판매 보상, 몬스터 누적 곡선 등)은 코드 내 주석으로
플레이스홀더임을 표시해 두었으니, 밸런스 확정 시 해당 상수만 조정하면 됩니다.
