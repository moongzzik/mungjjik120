---
name: "mungjjik120-diet-app"
description: "'뭉찍 120살' 부부 식단조절 앱(음식 사진 → Gemini 칼로리 분석·먹어도 되는 양 점선·달력 🐷/🐰·두 사람 프로필)을 고치거나 기능을 더하고, GitHub Pages(moongzzik/mungjjik120)에 올릴 때 사용. '뭉찍', '뭉찍120', '찍찍이', '뭉뭉이', 식단 앱, 칼로리 사진 앱, Gemini 연결·스캔 속도 문제를 말하면 이 스킬을 쓴다."
---

# 💚 뭉찍 120살 (부부 식단조절 앱)

사용자(아내, 앱 안 이름 **뭉뭉이**)와 남편(**찍찍이**)이 함께 쓰는 식단 앱이다. 음식 사진을 찍으면 Gemini가 음식·양·칼로리를 추정하고, 키·체중·나이·인바디로 계산한 목표에 맞춰 "이번 끼니에 먹어도 되는 양"을 사진 위 점선으로 보여 준다. 빌드 도구 없는 정적 웹앱(PWA)이다.

## 어디에 있나 (작업 전 최신본 확보)
- 저장소 `moongzzik/mungjjik120`, GitHub Pages(`main` / root): `https://moongzzik.github.io/mungjjik120/`.
- 파일: `index.html`(화면·CSS), `app.js`(모든 로직), `sw.js`(오프라인 캐시), `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
- 작업 전에 `git fetch origin main` 후 **origin/main 기준**으로 시작한다. 사용자가 GitHub 웹에서 직접 파일을 바꿨을 수 있다.
- claude.ai에 '뭉찍 120살 파일 복사' artifact가 있다. 다운로드가 안 될 때 파일 내용을 복사해 GitHub 웹 편집기에 붙여 넣는 용도다. 별도의 '뭉찍 120살' artifact(db 기능 버전)도 있는데, 지금 작업 대상은 GitHub Pages 버전이다.

## 사용자와 일하는 원칙
- **항상 한국어**, 쉬운 말로 짧게. 개발 용어(PR, 캐시, JSON 등)는 쓰지 않거나 풀어서 말한다. 형식: 원인 → 고친 것 → 확인한 것 → 폰에서 할 일.
- 사용자는 **갤럭시 폰**으로 쓰고 스크린샷으로 상황을 보여 준다. 스크린샷의 빨간 글씨 `[자세한 원인]`, `⏱️ ○초 걸림 · 사용 모델` 줄을 근거로 판단한다.
- 두 사람은 **각자 폰, 각자 Gemini API 키**를 쓴다. 키·기록은 폰마다 따로 저장된다(같은 폰 안의 두 프로필은 키 하나 공유).
- 사용자가 고쳐 달라고 하면 **고친 뒤 main에 합치는 것까지** 한다(지금까지 매번 "main에 합쳐줘"를 원했다). 큰 결정이 아니면 묻지 않고 진행하고, 합쳤다고 알린다.
- 배포 후 "아직 안 돼"의 상당수는 **폰에 예전 버전이 남은 것**이다. "앱을 완전히 닫았다가 다시 열기(한두 번)"를 안내하고, 새 버전인지 구분할 표시(새 문구·새 버튼)를 알려 준다.
- 확인 못 한 것은 솔직히 말한다. 진짜 Gemini 호출은 이 환경에서 못 하므로 "흉내 낸 응답으로 시험했다"고 밝힌다.

## 배포 절차
1. 개발 브랜치에서 수정 → `node --check app.js`.
2. **매번 캐시 버전을 올린다**: `index.html`의 `app.js?v=N`과 `sw.js`의 `CACHE = "mj120-vN"`을 같은 N으로 +1. 안 올리면 폰이 예전 app.js를 계속 쓴다. (v17까지 사용됨)
3. 커밋 → 푸시 → PR 생성 → merge (GitHub MCP `create_pull_request`, `merge_pull_request`, `expectedHeadSha`는 40자 전체 해시).
4. Pages 배포 확인: `actions_list`(list_workflow_runs)의 "pages build and deployment"가 머지 커밋 sha로 `success`인지 본다(보통 1분 내외). 이 환경에서는 github.io에 직접 접속이 막혀 있다.
5. 다음 작업 전엔 `git fetch origin main && git reset --hard origin/main` 후 변경을 다시 얹는다(머지 커밋 위에서 시작).

## 구조 요약 (app.js)
- **저장**: localStorage 키는 `mj:` 접두어 — `pid`(현재 프로필), `profiles`, `weights`(`{pid:{date:kg}}`), `activity`(`{pid:{date:{steps,minutes}}}`), `settings`(`apiKey, model, workingModel, thinkIdx`), `renamed1`. 식사 기록은 IndexedDB `mungjjik` / store `meals`(keyPath `id`, index `date`). 키 이름은 바꾸지 않는다(기존 기록 유지).
- **프로필**: `p1` 찍찍이 🐭(부르는 말 찍찍아, 잔소리하는 사람 뭉뭉이), `p2` 뭉뭉이 🌸(부르는 말 자기야, 잔소리하는 사람 찍찍이). 예전 "아내" 이름은 `renamed1` 마이그레이션으로 한 번 뭉뭉이로 바뀐다.
- **칼로리 계산 `calc(p, meals, act, slot)`**: 체지방률 있으면 Katch-McArdle, 없으면 키·나이(Mifflin), 그것도 없으면 체중 간이식. 활동량(걸음·운동분) 반영, 감량 −400 / 증량 +250, 최소 남 1500·여 1200. 끼니 배분(아침·점심·저녁·간식 %)으로 "이번 끼니 허용량" 계산.
- **스캔 흐름**: `analyzeSource`(사진) 또는 `analyzeText`(글) → `runAnalysis` → `gemini()` → `showResult()` → `saveMeal(portion)`. 결과 화면 상태는 `current`(`r` 원본 분석, `share`, `date`, `dayMeals`, `stat`).
- **식사 기록 필드**: `person, date, ts, mealType, title, thumb, portion, share, totalKcal, eatenKcal, alcoholKcal, late, eaten{carbs,protein,fat}, dailyTarget, tdee, foods[]`.

## Gemini 연결 (여기서 문제가 가장 많았다)
- 엔드포인트 `generativelanguage.googleapis.com/v1beta/models/{m}:generateContent`, 헤더 `x-goog-api-key`. 응답은 `responseMimeType: application/json`.
- **키 형식을 제한하지 않는다.** 새 키는 `AQ.`로 시작한다(예전 `AIza`만 받게 했다가 사용자 키가 막혔다). 저장 시 공백·보이지 않는 문자만 지우고, 20자 미만이면 "너무 짧아요".
- **모델 순서**: 마지막 성공 모델(`workingModel`) → 사용자가 적은 모델 → `DEFAULT_MODEL`(gemini-3.8-flash) → `FALLBACK_MODELS`. 다음 모델로 넘어가는 경우: 404/모델 없음, **503·high demand**, **Failed to fetch(네트워크)**, **30초 타임아웃**, 할당량 0. 전부 실패하면 3초 뒤 한 번 더. 모델 없음이면 `discoverModel()`로 쓸 수 있는 Flash 모델을 찾는다.
- **속도**: `thinkingConfig.thinkingLevel`을 모델별로 `minimal → low → 없음` 순으로 시도(400에 "thinking"이 있으면 다음 단계, `settings.thinkIdx`에 기억). Gemini에는 768px·JPEG 0.8 사진을 보낸다(화면 미리보기는 1024px).
- **진단 표시**: 연결 테스트 결과 `✅ 연결 성공 · 사용 모델 · 초`, 스캔 중 경과 초, 결과 화면 `⏱️ ○초 걸림 · 사용 모델 (다른 모델 n번 실패 후)`, 실패 안내에 `[자세한 원인]`과 시도한 모델 순서. 사람마다 속도가 다르면 이 줄을 두 폰에서 비교하게 한다.
- 오류 문구 `aiError()`: network면 "Google 서버에 연결하지 못했어요(광고 차단·VPN·개인 DNS·와이파이↔데이터)", busy면 "서버가 붐벼요", badkey, rate 등. 한 폰만 안 되면 **키를 다른 폰에 넣어 보는 교차 시험**으로 키 문제/폰 문제를 가른다.

## 현재 기능 (v17)
- **촬영**: 끼니 선택(아침·점심·저녁·간식), 앱 안 카메라·앨범, 남은 칼로리 표시.
- **끼니 선택은 세 곳**: 촬영 화면 위 `#mealSeg`, 글 입력 칸 `#txtMealSeg`(둘은 같은 전역 `mealType`로 같이 움직임), 결과 화면 `#resMealSeg`(`current.mealType`만 바꾸고 재계산·그 끼니로 저장). 야식(🌙) 판단은 `lateFor(date, slot)` = 오늘 + 밤 9시~새벽 4시 + 저녁/간식.
- **⌨️ 사진 없이 글로 입력**: `#txtFood`(🎤 음성 가능) → `analyzeText()` → 같은 `runAnalysis()`에 사진 없이 글만 보냄(`current.b64` 없음 = noPhoto; 양이 없으면 보통 1인분). 결과 화면은 사진 칸을 숨기고 "적은 음식 총량", 말풍선은 "점선까지만" 대신 "○%만(약 ○kcal)". 비율·날짜·✕ 삭제·정정·저장은 사진 모드와 같다.
- **결과 화면**: 사진 위 빨간 점선 "딱 여기까지", 추가 추천 음식, 잔소리 말풍선(coach가 call로 부르며), 알레르기·음주 경고, 영양 요약, 음식 목록(**각 줄 ✕ 삭제** — 재요청 없이 바로 재계산, 마지막 1개는 못 지움), **👥 내가 먹은 비율**(혼자 다·3/4·2/3·1/2·1/3·1/4·직접 %; `SHARE_NAMES`/`shareLabel()`, 기록 줄에 "내 몫 1/2" 표시; 모든 음식 값에 곱하고 점선은 `ratio*share`), 말/음성으로 정정 후 다시 계산, **📅 언제 먹었어요?**(지난 날짜로 저장, 그날 먹은 양 기준으로 계산; 앨범 사진은 파일 날짜로 자동 선택·최근 60일), "여기까지만 / 다 먹었어" 저장.
- **오늘**: 링 그래프·탄단지, 체중 기록(목표 재계산), 활동량(걸음·다른 운동 분·🏃 달리기 km/분), 오늘 먹은 것(✕ 삭제).
- **달리기**: `activity[pid][date]`에 `runKm`, `runMin`. `runBurn(w, km, min)` = km 있으면 체중×km, 없으면 MET 9.8 시간식. `calc()`에서 걸음 수에 들어 있을 달리기 걸음(1km≈1,300보, 1분≈160보)을 빼고 더한다(이중 계산 방지). 위쪽 🏃 칩, 달력 날짜 🏃.
- **기록 삭제**: `mealRow(m, true)`의 ✕는 **두 번 눌러야 삭제**(첫 탭 "삭제?" 빨간 버튼, 3초 뒤 원래대로). 오늘 탭과 달력 날짜 상세 둘 다 있다. 삭제 후 달력이 열려 있으면 `renderCalendar()`로 칸·🐷/🐰을 다시 그린다.
- **달력**: 색 단계(목표 대비), **🐷 하루 적정 칼로리 초과 / 🐰 이하**, 🍺 음주·🌙 야식, 날짜별 상세(잘못 올린 기록 ✕ 삭제).
- **분석**: 7/30일 평균·목표 지킨 날·누적 차이·예상 체중, 체중 예상 vs 실제, 음주·야식, 영양 비율, 끼니별, 자주 먹은 음식, Gemini 기간 리포트.
- **프로필**: 이름·부르는 말·잔소리하는 사람·신체·인바디·기피 음식·끼니 배분, 계산식 설명, Gemini 설정(두 사람 공통 = 같은 폰의 두 프로필이 키 공유), 백업·복원(JSON, 키 제외).

## 시험하는 법 (Playwright, 진짜 키 없이)
- `python3 -m http.server 8765`로 저장소 폴더를 띄우고, `page.route(/fonts\./, abort)`, `page.route(/generativelanguage/, ...)`로 Gemini 응답을 흉내 낸다(503, abort, 지연, 400 thinking 등).
- `localStorage.setItem('mj:settings', JSON.stringify({apiKey:'AQ.…(20자 이상)'}))` 후 새로고침, `setInputFiles('#fileLib', 작은 PNG)`로 스캔 → `#scanResult:not(.hidden)` 기다림.
- 확인할 곳: `#keyErr`, `#errBox`, `#aiStat`, `#sTotal`, `#foodList li`, `#toast`, 달력 `.cell .an`. 화면은 390×844로 캡처해서 직접 본다.
- 이 환경에서 확인 못 하는 것: 진짜 Gemini 속도·정확도, 사용자의 폰 네트워크. 그렇다고 말한다.
