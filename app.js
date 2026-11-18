/* 뭉찍 120살 — Gemini 버전 (기록은 이 폰의 브라우저 저장소에만 보관) */
"use strict";

/* ================= 기본값 ================= */
const PIDS = ["p1", "p2"];
const SLOTS = ["아침", "점심", "저녁", "간식"];
const DEF_SHARES = { 아침: 25, 점심: 35, 저녁: 30, 간식: 10 };
const DEFAULTS = {
  p1: { label: "찍찍이", call: "찍찍아", coach: "아내", sex: "M", age: "", height: "", weight: 77, target: 75, act: "1.375", muscle: 34, fat: 21, avoid: "새우, 오이", shares: { ...DEF_SHARES } },
  p2: { label: "아내", call: "자기야", coach: "찍찍이", sex: "F", age: "", height: "", weight: "", target: "", act: "1.375", muscle: "", fat: "", avoid: "", shares: { ...DEF_SHARES } },
};
const DEFAULT_MODEL = "gemini-3.8-flash";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash"];

/* ================= 유틸 ================= */
const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const r0 = n => Math.round(n);
const fmt = n => r0(n).toLocaleString("ko-KR");
const dKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayKey = () => dKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function ls(k, d) { try { const v = localStorage.getItem("mj:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem("mj:" + k, JSON.stringify(v)); } catch (e) { toast("저장 공간이 부족해요. 백업 후 오래된 기록을 지워 주세요"); } }
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), 2800); }
function josa(word, a, b) { const c = word.charCodeAt(word.length - 1); if (c < 0xAC00 || c > 0xD7A3) return b; return (c - 0xAC00) % 28 ? a : b; }

/* ================= IndexedDB (식사 기록) ================= */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("mungjjik", 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore("meals", { keyPath: "id" }); s.createIndex("date", "date"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction("meals", mode); const req = fn(t.objectStore("meals"));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    put: m => run("readwrite", s => s.put(m)),
    del: id => run("readwrite", s => s.delete(id)),
    range: (a, b) => run("readonly", s => s.index("date").getAll(IDBKeyRange.bound(a, b))),
    all: () => run("readonly", s => s.getAll()),
    clear: () => run("readwrite", s => s.clear()),
  };
})();

/* ================= 상태 ================= */
let pid = PIDS.includes(ls("pid")) ? ls("pid") : "p1";
let profiles = (() => { const p = ls("profiles", {}); const o = {}; PIDS.forEach(k => { o[k] = { ...DEFAULTS[k], ...(p[k] || {}) }; o[k].shares = { ...DEF_SHARES, ...((p[k] || {}).shares || DEFAULTS[k].shares) }; }); return o; })();
let weights = ls("weights", { p1: {}, p2: {} });     // {pid: {date: kg}}
let activity = ls("activity", { p1: {}, p2: {} });   // {pid: {date: {steps, minutes}}}
let settings = ls("settings", { apiKey: "", model: "" });
let todayMeals = [];                                  // 현재 사람의 오늘 기록
let mealType = autoMealType();
let current = null, abortCtl = null, stream = null;
PIDS.forEach(k => { weights[k] = weights[k] || {}; activity[k] = activity[k] || {}; });

const P = () => profiles[pid];
const actToday = () => activity[pid][todayKey()] || {};
function autoMealType() { const h = new Date().getHours(); if (h < 4) return "간식"; if (h < 10) return "아침"; if (h < 15) return "점심"; if (h < 22) return "저녁"; return "간식"; }
const isLateNow = () => { const h = new Date().getHours(); return h >= 21 || h < 4; };

async function loadToday() {
  try { todayMeals = (await idb.range(todayKey(), todayKey())).filter(m => m.person === pid); }
  catch (e) { todayMeals = []; }
}
async function loadRange(from, to) {
  try { return (await idb.range(from, to)).filter(m => m.person === pid); } catch (e) { return []; }
}

/* ================= 칼로리 계산 ================= */
function shares(p) {
  const s = p.shares || DEF_SHARES; const tot = SLOTS.reduce((a, k) => a + (+s[k] || 0), 0) || 100;
  const o = {}; SLOTS.forEach(k => o[k] = (+s[k] || 0) / tot); return o;
}
function calc(p = P(), eatenList = todayMeals, act = actToday(), slot = mealType) {
  const male = p.sex !== "F";
  const w = num(p.weight) || (male ? 70 : 58);
  const fat = num(p.fat), age = num(p.age), h = num(p.height);
  let bmr, method;
  if (fat != null && fat > 2 && fat < 60) { bmr = 370 + 21.6 * w * (1 - fat / 100); method = "제지방량 기준"; }
  else if (age && h) { bmr = 10 * w + 6.25 * h - 5 * age + (male ? 5 : -161); method = "키·나이 기준"; }
  else { bmr = (male ? 22 : 20) * w; method = "체중 기준(간이)"; }

  const steps = num(act.steps), mins = num(act.minutes);
  let tdee, actNote;
  if (steps != null || mins != null) { const k = (steps || 0) * 0.04 * (w / 70) + (mins || 0) * 6; tdee = bmr * 1.2 + k; actNote = `오늘 활동 +${fmt(k)}`; }
  else { tdee = bmr * parseFloat(p.act || 1.375); actNote = "평소 활동 수준"; }

  const tgt = num(p.target) || w;
  let adj = 0, goal = "유지";
  if (tgt < w - 0.5) { adj = -400; goal = "감량"; } else if (tgt > w + 0.5) { adj = 250; goal = "증량"; }
  const daily = Math.max(male ? 1500 : 1200, tdee + adj);

  const eaten = eatenList.reduce((s, m) => s + (m.eatenKcal || 0), 0);
  const remain = daily - eaten;
  const sh = shares(p);
  const mains = ["아침", "점심", "저녁"].filter(k => sh[k] > 0);
  const lastMain = mains[mains.length - 1];
  const snackEaten = eatenList.filter(m => m.mealType === "간식").reduce((s, m) => s + (m.eatenKcal || 0), 0);
  let allowed;
  if (slot === "간식") allowed = Math.min(remain, Math.max(sh.간식, 0.08) * daily - snackEaten);
  else if (slot === lastMain) allowed = remain - Math.max(0, sh.간식 * daily - snackEaten);
  else allowed = Math.min(remain, Math.max(sh[slot], 0.15) * daily);
  allowed = Math.max(0, allowed);

  const proteinDay = w * 1.2;
  const proteinMeal = proteinDay * Math.max(0.1, sh[slot] || 0.1);
  return { bmr, method, tdee, actNote, adj, goal, daily, eaten, remain, allowed, proteinDay, proteinMeal, w, steps, male };
}

/* ================= 렌더 ================= */
function renderWho() {
  const box = $("who"); box.innerHTML = "";
  PIDS.forEach(k => {
    const b = document.createElement("button"); b.textContent = (k === "p1" ? "🐭 " : "🌸 ") + (profiles[k].label || (k === "p1" ? "찍찍이" : "아내"));
    b.className = k === pid ? "on" : ""; b.onclick = () => switchPerson(k); box.append(b);
  });
}
async function switchPerson(k) {
  if (k === pid) return;
  pid = k; lsSet("pid", k); current = null; showStage("start");
  await loadToday(); renderAll();
  const v = document.querySelector(".view.on").id;
  if (v === "v-profile") renderProfile(); if (v === "v-cal") renderCalendar(); if (v === "v-stats") renderStats();
  $("reportTxt").textContent = "";
  toast(`${P().label} 기록으로 바꿨어요`);
}
function renderHeader() {
  const c = calc(), p = P();
  $("hdrSub").textContent = `${p.label} 맞춤 · 목표 ${p.target || "-"}kg (${c.goal})`;
  $("hdrChips").innerHTML = "";
  const chip = (html) => { const s = document.createElement("span"); s.className = "chip"; s.innerHTML = html; $("hdrChips").append(s); };
  chip(`오늘 <b>${fmt(c.eaten)}</b> / ${fmt(c.daily)} kcal`);
  if (c.steps != null) chip(`걸음 <b>${fmt(c.steps)}보</b>${c.steps < 5000 ? " 😢" : ""}`);
  const lw = latestWeight(pid); if (lw) chip(`체중 <b>${lw.kg}kg</b>`);
  renderWho();
  $("keyAlert").classList.toggle("hidden", !!settings.apiKey);
  $("profAlert").classList.toggle("hidden", !!(num(p.weight) && num(p.target)));
}
function renderBudget() {
  const c = calc();
  document.querySelectorAll("#mealSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === mealType));
  $("bWho").textContent = P().label + ",";
  $("bMeal").textContent = mealType === "간식" ? "간식·야식" : mealType;
  $("bKcal").textContent = fmt(c.allowed);
  $("bRemain").textContent = fmt(Math.max(0, c.remain));
}
function mealRow(m, withDelete) {
  const row = document.createElement("div"); row.className = "meal";
  let pic;
  if (typeof m.thumb === "string" && m.thumb.startsWith("data:image/")) { pic = document.createElement("img"); pic.src = m.thumb; pic.alt = ""; }
  else { pic = document.createElement("div"); pic.className = "ph"; pic.textContent = "🍽️"; }
  const info = document.createElement("div"); info.className = "info";
  const a = document.createElement("div"); a.className = "a"; a.textContent = `${m.mealType === "간식" ? "간식·야식" : m.mealType} · ${m.title || "식사"}`;
  if (m.alcoholKcal > 0) { const t = document.createElement("span"); t.className = "tag al"; t.textContent = "🍺"; a.append(t); }
  if (m.late) { const t = document.createElement("span"); t.className = "tag lt"; t.textContent = "🌙"; a.append(t); }
  const b = document.createElement("div"); b.className = "b";
  const t = m.ts ? new Date(m.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  b.textContent = `${fmt(m.eatenKcal || 0)} kcal · ${m.portion >= 0.99 ? "전부" : "권장량(" + r0((m.portion || 0) * 100) + "%)"} · ${t}`;
  info.append(a, b); row.append(pic, info);
  if (withDelete) { const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.setAttribute("aria-label", "삭제"); del.onclick = () => deleteMeal(m.id); row.append(del); }
  return row;
}
function renderToday() {
  const c = calc();
  const pct = Math.min(1, c.eaten / c.daily);
  $("ring").style.strokeDashoffset = 289 * (1 - pct);
  $("ring").setAttribute("stroke", c.eaten > c.daily ? "#ef4444" : (pct > .85 ? "#f59e0b" : "#10b981"));
  $("ringPct").textContent = r0(c.eaten / c.daily * 100) + "%";
  $("tEaten").textContent = fmt(c.eaten); $("tTarget").textContent = fmt(c.daily);
  $("tMsg").textContent = !todayMeals.length ? "오늘 기록이 아직 없어요" : c.remain >= 0 ? `${fmt(c.remain)} kcal 더 먹을 수 있어요` : `${fmt(-c.remain)} kcal 초과했어요!`;
  const sum = k => todayMeals.reduce((s, m) => s + (m.eaten?.[k] || 0), 0);
  const C = sum("carbs"), Pr = sum("protein"), F = sum("fat");
  const cT = c.daily * .5 / 4, pT = c.proteinDay, fT = c.daily * .25 / 9;
  $("mC").textContent = `${r0(C)} / ${r0(cT)}g`; $("mCb").style.width = Math.min(100, C / cT * 100) + "%";
  $("mP").textContent = `${r0(Pr)} / ${r0(pT)}g`; $("mPb").style.width = Math.min(100, Pr / pT * 100) + "%";
  $("mF").textContent = `${r0(F)} / ${r0(fT)}g`; $("mFb").style.width = Math.min(100, F / fT * 100) + "%";
  const a = actToday(); $("actSteps").value = a.steps ?? ""; $("actMin").value = a.minutes ?? "";
  const tw = weights[pid][todayKey()]; $("wInput").value = tw ?? "";
  const lw = latestWeight(pid);
  $("wNote").textContent = tw ? `오늘 ${tw}kg 기록했어요. 목표까지 ${Math.abs(tw - (num(P().target) || tw)).toFixed(1)}kg!`
    : lw ? `마지막 기록: ${lw.date.slice(5).replace("-", "/")} ${lw.kg}kg. 아침 공복에 재면 가장 정확해요.` : "아침 공복에 재면 가장 정확해요. 기록하면 목표 칼로리가 자동으로 다시 계산돼요.";
  const list = $("mealList");
  if (!todayMeals.length) { list.innerHTML = '<p class="muted">아직 기록이 없어요. 촬영 탭에서 사진을 찍어 보세요.</p>'; return; }
  list.innerHTML = "";
  [...todayMeals].sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(m => list.append(mealRow(m, true)));
}
function renderProfile() {
  const p = P();
  $("profHd").textContent = `👤 ${p.label} 프로필`;
  $("pLabel").value = p.label || ""; $("pCall").value = p.call || ""; $("pCoach").value = p.coach || ""; $("pSex").value = p.sex || "M";
  $("pAge").value = p.age ?? ""; $("pHeight").value = p.height ?? ""; $("pWeight").value = p.weight ?? ""; $("pTarget").value = p.target ?? "";
  $("pAct").value = p.act || "1.375"; $("pMuscle").value = p.muscle ?? ""; $("pFat").value = p.fat ?? ""; $("pAvoid").value = p.avoid || "";
  SLOTS.forEach((k, i) => $("sh" + i).value = p.shares[k]);
  updShSum();
  $("apiKey").value = settings.apiKey || ""; $("apiModel").value = settings.model || "";
  renderCalc();
}
function updShSum() { const s = [0, 1, 2, 3].reduce((a, i) => a + (num($("sh" + i).value) || 0), 0); $("shSum").textContent = `합계 ${s}%` + (s !== 100 ? " (100%가 아니면 비율대로 자동 조정해요)" : " ✓"); }
function renderCalc() {
  const c = calc(), sh = shares(P());
  $("calcBox").innerHTML =
    `기초대사량 (${c.method}) <b>${fmt(c.bmr)} kcal</b><br>` +
    `하루 소모량 (${c.actNote}) <b>${fmt(c.tdee)} kcal</b><br>` +
    `목표 조정 (${c.goal}) <b>${c.adj > 0 ? "+" : ""}${fmt(c.adj)} kcal</b><br>` +
    `<span style="color:#059669;font-weight:700">하루 섭취 목표</span> <b style="color:#059669">${fmt(c.daily)} kcal</b><br>` +
    SLOTS.map(k => `${k === "간식" ? "간식·야식" : k} ${r0(sh[k] * 100)}%`).join(" · ") + ` <b></b><br>` +
    `하루 단백질 목표 <b>${r0(c.proteinDay)} g</b>`;
}
function renderAll() { renderHeader(); renderBudget(); renderToday(); }

/* ================= 탭 ================= */
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
  ({ profile: renderProfile, today: renderToday, cal: renderCalendar, stats: renderStats }[b.dataset.v] || (() => { }))();
  window.scrollTo(0, 0);
});
document.querySelectorAll("#mealSeg button").forEach(b => b.onclick = () => { mealType = b.dataset.m; renderBudget(); });

/* ================= 카메라 ================= */
$("openCam").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $("fileCam").click(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    $("video").srcObject = stream; $("camView").classList.remove("hidden");
  } catch (e) { $("fileCam").click(); }
};
function stopCam() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; $("camView").classList.add("hidden"); }
$("camClose").onclick = stopCam;
$("shutter").onclick = () => {
  const v = $("video"); if (!v.videoWidth) { toast("카메라가 아직 준비 중이에요"); return; }
  const cv = $("grab"); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext("2d").drawImage(v, 0, 0);
  stopCam(); analyzeSource(cv, cv.width, cv.height);
};
["fileCam", "fileLib"].forEach(id => $(id).addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; stopCam();
  if (!f) return;
  const url = URL.createObjectURL(f); const img = new Image();
  img.onload = () => { analyzeSource(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); };
  img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 열 수 없어요"); };
  img.src = url;
}));
function resize(src, w, h, max) {
  const s = Math.min(1, max / Math.max(w, h)); const cv = document.createElement("canvas");
  cv.width = Math.round(w * s); cv.height = Math.round(h * s); cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height); return cv;
}
function showStage(s) {
  $("scanStart").classList.toggle("hidden", s !== "start"); $("scanBusy").classList.toggle("hidden", s !== "busy"); $("scanResult").classList.toggle("hidden", s !== "result");
  window.scrollTo(0, 0);
}

/* ================= Gemini ================= */
function parseJSON(t) {
  t = t.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (e) { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); throw e; }
}
async function gemini(parts, { json = true, signal } = {}) {
  if (!settings.apiKey) throw { code: "nokey" };
  const models = [...new Set([settings.model || DEFAULT_MODEL, ...FALLBACK_MODELS])];
  let last = { code: "model" };
  for (const m of models) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: json ? { responseMimeType: "application/json" } : {} }),
      });
    } catch (e) { if (e.name === "AbortError") throw e; throw { code: "network" }; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) { last = { code: "model", message: data.error?.message }; continue; }
    if (!res.ok) {
      const msg = data.error?.message || "";
      throw { code: (res.status === 400 && /key/i.test(msg)) || res.status === 401 || res.status === 403 ? "badkey" : res.status === 429 ? "rate" : "http", message: msg };
    }
    const text = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) throw { code: "empty", message: data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason };
    if (m !== settings.model) { settings.workingModel = m; lsSet("settings", settings); }
    return json ? parseJSON(text) : text;
  }
  throw last;
}
function aiError(e) {
  const c = e && e.code;
  if (c === "nokey") return "Gemini API 키를 먼저 넣어 주세요 (프로필 탭)";
  if (c === "badkey") return "API 키가 맞지 않아요. 프로필 탭에서 확인해 주세요";
  if (c === "rate") return "무료 사용량을 잠시 초과했어요. 1분 뒤 다시 시도해 주세요";
  if (c === "network") return "인터넷 연결을 확인해 주세요";
  if (c === "model") return "모델 이름을 찾을 수 없어요. 프로필 탭에서 모델 칸을 비워 보세요";
  return "분석에 실패했어요. 다시 시도해 주세요";
}

function analysisPrompt(c, p) {
  return `당신은 한국 가정식에 정통한 임상 영양사입니다. 첨부된 사진 속 음식을 분석하세요.

[방법]
- 한식(밥, 국/찌개, 볶음, 반찬, 김치, 분식 등)을 특히 정확히 구분하세요. 섞인 요리(볶음밥, 비빔밥, 김밥, 찌개)는 주요 재료를 고려해 추정하세요.
- 부피 추정: 공기밥 그릇(지름 약 11cm, 밥 한 공기 ≈ 210g/310kcal), 국그릇, 숟가락(길이 약 19cm), 젓가락(약 21cm), 신용카드(8.56×5.4cm) 등 사진 속 기준 물체로 깊이와 부피를 가늠해 무게(g)로 환산하세요.
- 사진에 보이는 '전체 양' 기준으로 추정하세요.
- 술(소주, 맥주, 막걸리, 와인 등)이 보이면 foods에 포함하고 is_alcohol을 true로 하세요. 병·잔 크기와 남은 양으로 추정하세요.
- 음식이 아니면 is_food를 false로 하세요.

[먹는 사람]
- ${p.sex === "F" ? "성인 여성" : "성인 남성"}, 체중 ${c.w}kg, 목표 ${p.target || "미정"}kg(${c.goal}), 골격근량 ${p.muscle || "미상"}kg, 체지방률 ${p.fat || "미상"}%
- 알레르기/기피: ${p.avoid || "없음"}
- 이번 끼니(${mealType}) 단백질 목표: 약 ${r0(c.proteinMeal)}g

[추가 추천]
단백질이나 채소가 부족하면 같이 먹으면 좋은 간단한 음식 1가지를 추천하세요(예: 계란 프라이 1개, 닭가슴살 한 조각, 두부 반 모, 나물 반찬). 알레르기/기피 음식은 절대 추천 금지. 충분하면 add_on은 null.

JSON만 출력:
{
 "is_food": true,
 "title": "대표 음식 이름(짧게)",
 "foods": [{"name":"참치김밥","grams":280,"kcal":530,"carbs_g":75,"protein_g":17,"fat_g":18,"confidence":"high|medium|low","is_alcohol":false}],
 "reference_object": "추정에 쓴 기준 물체 또는 null",
 "allergens_found": ["사진에서 보이는, 기피 목록에 해당하는 재료"],
 "add_on": {"name":"삶은 계란 1개","emoji":"🥚","kcal":75,"protein_g":6,"reason":"짧은 이유"},
 "tip": "한 문장 건강 팁 (${p.coach || "가족"}가 '${p.call || "자기야"}'라고 부르며 말하듯, 다정한 반말)"
}`;
}

async function analyzeSource(src, w, h) {
  if (!settings.apiKey) { toast(aiError({ code: "nokey" })); return; }
  const big = resize(src, w, h, 1024), small = resize(src, w, h, 220);
  const preview = big.toDataURL("image/jpeg", .85);
  const thumb = small.toDataURL("image/jpeg", .6);
  current = { preview, thumb, b64: preview.split(",")[1], late: isLateNow(), mealType };
  await runAnalysis();
}
async function runAnalysis(correction) {
  const c = calc(), p = P();
  $("busyImg").src = current.preview;
  $("busyTitle").textContent = correction ? "말씀하신 대로 다시 계산 중..." : "음식 부피 스캔 중...";
  showStage("busy");
  let text = analysisPrompt(c, p);
  if (correction && current.r) {
    text += `\n\n[이전 분석 결과]\n${JSON.stringify(current.r)}\n\n[사용자 정정 — 최우선으로 반영]\n"${correction}"\n정정 내용을 반영해 음식 종류·양·칼로리를 다시 계산하고, 같은 JSON 형식으로만 출력하세요.`;
  }
  abortCtl = new AbortController();
  let r;
  try { r = await gemini([{ text }, { inline_data: { mime_type: "image/jpeg", data: current.b64 } }], { signal: abortCtl.signal }); }
  catch (e) {
    abortCtl = null;
    if (e && e.name === "AbortError") { showStage(current.r ? "result" : "start"); return; }
    toast(aiError(e)); showStage(current.r ? "result" : "start"); return;
  }
  abortCtl = null;
  if (!r || r.is_food === false || !Array.isArray(r.foods) || !r.foods.length) {
    showStage("start"); toast("음식을 찾지 못했어요. 음식이 잘 보이게 다시 찍어 주세요"); current = null; return;
  }
  current.r = r; showResult();
}
$("cancelBtn").onclick = () => { if (abortCtl) abortCtl.abort(); };

/* ================= 결과 ================= */
function showResult() {
  const { r } = current; const c = calc(), p = P();
  const foods = r.foods.map(f => ({
    name: String(f.name || "음식"), grams: +f.grams || 0, kcal: +f.kcal || 0, carbs: +f.carbs_g || 0, protein: +f.protein_g || 0, fat: +f.fat_g || 0,
    conf: String(f.confidence || "medium"), alcohol: !!f.is_alcohol
  }));
  const tot = foods.reduce((s, f) => ({ kcal: s.kcal + f.kcal, grams: s.grams + f.grams, carbs: s.carbs + f.carbs, protein: s.protein + f.protein, fat: s.fat + f.fat }), { kcal: 0, grams: 0, carbs: 0, protein: 0, fat: 0 });
  const alc = foods.filter(f => f.alcohol); const alcKcal = alc.reduce((s, f) => s + f.kcal, 0);
  const ratio = tot.kcal > 0 ? Math.max(0, Math.min(1, c.allowed / tot.kcal)) : 1;
  const allOk = ratio >= 0.95;
  const solidGrams = foods.filter(f => !f.alcohol).reduce((s, f) => s + f.grams, 0);
  const proteinLow = tot.protein * ratio < c.proteinMeal * 0.7;
  const addOn = r.add_on && r.add_on.name ? r.add_on : null;
  Object.assign(current, { foods, tot, ratio, alcKcal, title: String(r.title || foods[0].name) });

  $("resImg").src = current.preview;
  const cut = $("cut"), lbl = $("cutLabel"), shade = $("shade");
  cut.classList.remove("on"); lbl.classList.remove("on"); shade.style.height = "0";
  $("okBadge").classList.toggle("hidden", !allOk);
  if (!allOk) {
    const y = Math.max(12, Math.min(92, ratio * 100));
    cut.style.top = y + "%"; lbl.style.top = y + "%";
    lbl.textContent = ratio < 0.05 ? "✋ 오늘은 그만!" : `✂️ 딱 여기까지! (약 ${fmt(solidGrams * ratio)}g)`;
    setTimeout(() => { cut.classList.add("on"); lbl.classList.add("on"); shade.style.height = (100 - y) + "%"; }, 400);
  }
  const showAdd = addOn && (proteinLow || !allOk);
  $("addon").classList.toggle("hidden", !showAdd);
  if (showAdd) { $("addonE").textContent = addOn.emoji || "🥚"; $("addonT").textContent = "+ " + addOn.name; }

  // 말풍선
  const call = p.call || "자기야", coach = p.coach || "가족";
  const hd = $("bubHd"), tx = $("bubTxt");
  hd.className = "hd " + (allOk && !alcKcal && !current.late ? "good" : "warn");
  hd.textContent = allOk && !alcKcal && !current.late ? `💚 ${coach}의 칭찬 & 추천` : `⚠️ ${coach}의 경고 & 추천!`;
  tx.innerHTML = "";
  const add = (t, bold) => { if (bold) { const b = document.createElement("b"); b.textContent = t; tx.append(b); } else tx.append(document.createTextNode(t)); };
  const actLow = c.steps != null && c.steps < 5000, actHigh = c.steps != null && c.steps >= 10000;
  add(`${call}! `);
  if (current.late) { add("밤 9시 넘었어! ", true); add("야식은 자는 동안 그대로 살로 가. "); }
  if (allOk) { add(actHigh ? "오늘 많이 걸었으니 " : ""); add("이건 다 먹어도 괜찮아! "); }
  else if (ratio < 0.05) { add("오늘 칼로리를 이미 다 채웠어. "); add("이번엔 참자!", true); add(" "); }
  else {
    add(actLow ? "오늘 운동량도 적은데, " : `${c.goal === "감량" ? "목표 체중까지 가려면" : "지금 체중 기준으로"} `);
    add(`이 ${current.title}${josa(current.title, "은", "는")} `); add(`점선까지만(${r0(ratio * 100)}%)`, true); add(" 먹어야 해! ");
  }
  if (alcKcal) { add(`술만 ${fmt(alcKcal)}kcal`, true); add("이야. 안주는 단백질 위주로, 술은 반만! "); }
  if (showAdd) { add("대신 "); add(addOn.name, true); add(` 추가해서 먹어${addOn.reason ? " (" + addOn.reason + ")" : ""}. `); }
  if (r.tip) add(String(r.tip));

  const found = Array.isArray(r.allergens_found) ? r.allergens_found.filter(Boolean).map(String) : [];
  $("allergyAlert").classList.toggle("hidden", !found.length);
  if (found.length) $("allergyAlert").textContent = `🚫 기피/알레르기 재료가 보여요: ${found.join(", ")} — 골라내고 먹어요!`;
  $("drinkAlert").classList.toggle("hidden", !alcKcal);
  if (alcKcal) $("drinkAlert").textContent = `🍺 음주 감지: ${alc.map(f => f.name).join(", ")} 약 ${fmt(alcKcal)}kcal (밥 ${(alcKcal / 310).toFixed(1)}공기 분량). 술은 지방 분해를 멈추게 해서 안주가 더 쉽게 살로 가요.`;

  $("sTotal").textContent = fmt(tot.kcal) + "kcal";
  $("sAllow").textContent = fmt(Math.min(tot.kcal, c.allowed)) + "kcal";
  const carbHigh = tot.carbs * ratio * 4 > Math.min(tot.kcal, c.allowed) * 0.6;
  $("sCarb").textContent = carbHigh ? "초과 위험" : "적당"; $("sCarb").style.color = carbHigh ? "var(--red)" : "var(--green-d)";
  $("sProt").textContent = proteinLow ? "보충 필요" : "충분"; $("sProt").style.color = proteinLow ? "var(--amber)" : "var(--green-d)";

  const ul = $("foodList"); ul.innerHTML = "";
  foods.forEach(f => {
    const li = document.createElement("li"), L = document.createElement("div");
    const n = document.createElement("div"); n.className = "nm"; n.textContent = (f.alcohol ? "🍺 " : "") + f.name;
    const lv = f.conf === "high" ? "h" : f.conf === "low" ? "l" : "m";
    const cf = document.createElement("span"); cf.className = "conf " + lv; cf.textContent = { h: "확실", m: "추정", l: "불확실" }[lv]; n.append(cf);
    const s = document.createElement("div"); s.className = "sm"; s.textContent = `약 ${fmt(f.grams)}${f.alcohol ? "ml" : "g"} · 탄 ${r0(f.carbs)}g · 단 ${r0(f.protein)}g · 지 ${r0(f.fat)}g`;
    L.append(n, s);
    const k = document.createElement("div"); k.className = "kc"; k.textContent = fmt(f.kcal) + " kcal";
    li.append(L, k); ul.append(li);
  });
  $("aiNote").textContent = r.reference_object ? `📏 기준 물체: ${r.reference_object}` : "📏 기준 물체 없이 그릇 크기로 추정했어요. 숟가락을 옆에 두면 더 정확해져요.";
  $("eatAllowed").textContent = allOk ? "알겠어, 잘 먹을게!" : "알겠어, 여기까지만!";
  $("eatAll").classList.toggle("hidden", allOk);
  $("fixText").value = "";
  showStage("result");
}
$("retake").onclick = () => { current = null; showStage("start"); };
$("eatAllowed").onclick = () => saveMeal(current ? current.ratio : 1);
$("eatAll").onclick = () => saveMeal(1);
$("fixBtn").onclick = () => { const t = $("fixText").value.trim(); if (!t) { toast("고칠 내용을 적어 주세요"); $("fixText").focus(); return; } runAnalysis(t); };
$("fixText").addEventListener("keydown", e => { if (e.key === "Enter") $("fixBtn").click(); });

// 음성 입력 (지원하는 브라우저에서만)
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  const btn = $("micBtn"); btn.classList.remove("hidden");
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "ko-KR"; rec.interimResults = true;
    rec.onresult = e => { $("fixText").value = Array.from(e.results).map(x => x[0].transcript).join(""); };
    rec.onend = () => { rec = null; btn.classList.remove("on"); };
    rec.onerror = () => { toast("음성을 듣지 못했어요. 키보드의 마이크를 써 보세요"); };
    btn.classList.add("on"); try { rec.start(); } catch (e) { rec = null; btn.classList.remove("on"); }
  };
})();

/* ================= 저장 ================= */
async function saveMeal(portion) {
  if (!current || !current.tot) return;
  const { tot, foods, thumb, title, alcKcal, late } = current; const c = calc();
  const p = Math.max(0, Math.min(1, portion));
  const meal = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    person: pid, date: todayKey(), ts: Date.now(), mealType: current.mealType || mealType, title, thumb, portion: p,
    totalKcal: r0(tot.kcal), eatenKcal: r0(tot.kcal * p), alcoholKcal: r0(alcKcal * p), late: !!late,
    eaten: { carbs: r0(tot.carbs * p), protein: r0(tot.protein * p), fat: r0(tot.fat * p) },
    dailyTarget: r0(c.daily), tdee: r0(c.tdee),
    foods: foods.map(f => ({ name: f.name, grams: r0(f.grams), kcal: r0(f.kcal), alcohol: f.alcohol })),
  };
  try {
    await idb.put(meal);
    toast(p >= 0.99 && current.ratio < 0.95 ? "기록했어요. 다음 끼니는 가볍게! 😉" : "잘했어요! 식단 기록 저장 완료 💚");
    current = null; showStage("start"); await loadToday(); renderAll();
  } catch (e) { toast("저장에 실패했어요. 다시 눌러 주세요"); }
}
async function deleteMeal(id) {
  try { await idb.del(id); await loadToday(); renderAll(); toast("기록을 지웠어요"); } catch (e) { toast("삭제에 실패했어요"); }
}
$("saveAct").onclick = () => {
  const s = num($("actSteps").value), m = num($("actMin").value); const a = {};
  if (s != null) a.steps = s; if (m != null) a.minutes = m;
  activity[pid][todayKey()] = a; lsSet("activity", activity); renderAll(); toast("오늘 활동량을 반영했어요");
};
function latestWeight(k) { const e = Object.entries(weights[k] || {}).sort((a, b) => a[0] < b[0] ? 1 : -1)[0]; return e ? { date: e[0], kg: e[1] } : null; }
$("wSave").onclick = () => {
  const v = num($("wInput").value);
  if (v == null || v < 25 || v > 250) { toast("체중을 kg 단위로 정확히 넣어 주세요"); return; }
  weights[pid][todayKey()] = Math.round(v * 10) / 10; lsSet("weights", weights);
  profiles[pid].weight = Math.round(v * 10) / 10; lsSet("profiles", profiles);
  renderAll(); toast("체중을 기록하고 목표 칼로리를 다시 계산했어요");
};
$("saveProfile").onclick = () => {
  const old = P();
  const sh = {}; SLOTS.forEach((k, i) => sh[k] = Math.max(0, num($("sh" + i).value) || 0));
  if (SLOTS.every(k => !sh[k])) Object.assign(sh, DEF_SHARES);
  profiles[pid] = {
    label: $("pLabel").value.trim() || DEFAULTS[pid].label, call: $("pCall").value.trim() || DEFAULTS[pid].call, coach: $("pCoach").value.trim() || DEFAULTS[pid].coach,
    sex: $("pSex").value, age: num($("pAge").value) ?? "", height: num($("pHeight").value) ?? "",
    weight: num($("pWeight").value) ?? "", target: num($("pTarget").value) ?? "", act: $("pAct").value,
    muscle: num($("pMuscle").value) ?? "", fat: num($("pFat").value) ?? "", avoid: $("pAvoid").value.trim(), shares: sh,
  };
  if (num(old.weight) !== num(profiles[pid].weight) && num(profiles[pid].weight)) { weights[pid][todayKey()] = num(profiles[pid].weight); lsSet("weights", weights); }
  lsSet("profiles", profiles); renderProfile(); renderAll(); toast("프로필을 저장했어요");
};
document.querySelectorAll("#presets button").forEach(b => b.onclick = () => { b.dataset.s.split(",").forEach((v, i) => $("sh" + i).value = v); updShSum(); });
[0, 1, 2, 3].forEach(i => $("sh" + i).addEventListener("input", updShSum));
$("saveKey").onclick = () => { settings.apiKey = $("apiKey").value.trim(); settings.model = $("apiModel").value.trim(); lsSet("settings", settings); renderHeader(); toast(settings.apiKey ? "키를 저장했어요" : "키를 지웠어요"); };
$("testKey").onclick = async () => {
  $("saveKey").click(); if (!settings.apiKey) return;
  $("testKey").disabled = true; $("testKey").textContent = "확인 중...";
  try { const t = await gemini([{ text: "한 단어로만 답하세요: 연결" }], { json: false }); toast(`연결 성공! (${settings.workingModel || settings.model || DEFAULT_MODEL})`); }
  catch (e) { toast(aiError(e)); }
  finally { $("testKey").disabled = false; $("testKey").textContent = "연결 테스트"; }
};

/* ================= 백업 · 복원 ================= */
$("backupBtn").onclick = async () => {
  const data = { app: "mungjjik120", v: 1, at: new Date().toISOString(), profiles, weights, activity, meals: await idb.all() };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `뭉찍120_백업_${todayKey()}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("백업 파일을 저장했어요");
};
$("restoreFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "mungjjik120" || !Array.isArray(d.meals)) throw 0;
    PIDS.forEach(k => { if (d.profiles?.[k]) profiles[k] = { ...DEFAULTS[k], ...d.profiles[k] }; weights[k] = { ...(weights[k] || {}), ...(d.weights?.[k] || {}) }; activity[k] = { ...(activity[k] || {}), ...(d.activity?.[k] || {}) }; });
    lsSet("profiles", profiles); lsSet("weights", weights); lsSet("activity", activity);
    for (const m of d.meals) if (m && m.id && m.date) await idb.put(m);
    await loadToday(); renderAll(); renderProfile(); toast(`복원 완료! 식사 기록 ${d.meals.length}개`);
  } catch (err) { toast("뭉찍 120살 백업 파일이 아니에요"); }
});

/* ================= 기간 데이터 ================= */
function byDay(list) {
  const map = {}, c = calc();
  list.forEach(m => {
    const d = map[m.date] || (map[m.date] = { kcal: 0, carbs: 0, protein: 0, fat: 0, alcohol: 0, late: 0, lateKcal: 0, meals: [], target: 0, tdee: 0 });
    d.kcal += m.eatenKcal || 0; d.carbs += m.eaten?.carbs || 0; d.protein += m.eaten?.protein || 0; d.fat += m.eaten?.fat || 0;
    d.alcohol += m.alcoholKcal || 0; if (m.late) { d.late++; d.lateKcal += m.eatenKcal || 0; }
    d.target = Math.max(d.target, m.dailyTarget || 0); d.tdee = Math.max(d.tdee, m.tdee || 0); d.meals.push(m);
  });
  Object.values(map).forEach(d => { if (!d.target) d.target = c.daily; if (!d.tdee) d.tdee = c.tdee; });
  return map;
}
const level = (k, t) => !k ? "" : k / t < 0.9 ? "lv1" : k / t <= 1.05 ? "lv2" : k / t <= 1.2 ? "lv3" : "lv4";

/* ================= 달력 ================= */
let calMonth = new Date(); calMonth.setDate(1);
let calData = {}, calSel = todayKey(), calReq = 0;
$("calPrev").onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
$("calNext").onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };
async function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $("calTitle").textContent = `${y}년 ${m + 1}월 · ${P().label}`;
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0); const req = ++calReq;
  calData = byDay(await loadRange(dKey(first), dKey(last))); if (req !== calReq) return;
  drawCalendar(y, m, first, last); renderDay(calSel);
}
function drawCalendar(y, m, first, last) {
  const g = $("calGrid"); g.innerHTML = "";
  ["일", "월", "화", "수", "목", "금", "토"].forEach((w, i) => { const e = document.createElement("div"); e.className = "wd" + (i === 0 ? " sun" : ""); e.textContent = w; g.append(e); });
  for (let i = 0; i < first.getDay(); i++) { const e = document.createElement("div"); e.className = "cell empty"; g.append(e); }
  const today = todayKey(); let days = 0, sum = 0;
  for (let d = 1; d <= last.getDate(); d++) {
    const k = dKey(new Date(y, m, d)), info = calData[k];
    const e = document.createElement("div");
    e.className = "cell " + (info ? level(info.kcal, info.target) : "") + (k === today ? " today" : "") + (k === calSel ? " sel" : "") + (k > today ? " future" : "");
    const dn = document.createElement("div"); dn.className = "d"; dn.textContent = d + (info?.alcohol ? "🍺" : info?.late ? "🌙" : ""); e.append(dn);
    if (info && info.kcal) { const kc = document.createElement("div"); kc.className = "kc"; kc.textContent = fmt(info.kcal); e.append(kc); days++; sum += info.kcal; }
    e.onclick = () => { calSel = k; drawCalendar(y, m, first, last); renderDay(k); };
    g.append(e);
  }
  $("mDays").textContent = days + "일"; $("mAvg").textContent = days ? fmt(sum / days) + " kcal" : "-";
}
function renderDay(k) {
  const info = calData[k]; const [, mm, dd] = k.split("-").map(Number);
  $("dayTitle").textContent = `${mm}월 ${dd}일 기록`;
  const box = $("dayMeals"); box.innerHTML = "";
  const wt = weights[pid][k];
  if (!info || !info.meals.length) { $("daySum").textContent = "이 날은 식사 기록이 없어요." + (wt ? ` · 체중 ${wt}kg` : ""); return; }
  const diff = info.kcal - info.target;
  $("daySum").textContent = `총 ${fmt(info.kcal)} / 목표 ${fmt(info.target)} kcal (${diff > 0 ? "+" : ""}${fmt(diff)}) · 탄 ${r0(info.carbs)}g · 단 ${r0(info.protein)}g · 지 ${r0(info.fat)}g` + (info.alcohol ? ` · 🍺 ${fmt(info.alcohol)}kcal` : "") + (wt ? ` · 체중 ${wt}kg` : "");
  [...info.meals].sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(m => box.append(mealRow(m, false)));
}

/* ================= 분석 ================= */
let period = 7, statsCache = null, statsReq = 0;
document.querySelectorAll("#periodSeg button").forEach(b => b.onclick = () => {
  period = +b.dataset.p; document.querySelectorAll("#periodSeg button").forEach(x => x.classList.toggle("on", x === b));
  $("reportTxt").textContent = ""; renderStats();
});
async function renderStats() {
  const to = todayKey(), from = dKey(addDays(new Date(), -(period - 1))); const req = ++statsReq;
  const map = byDay(await loadRange(from, to)); if (req !== statsReq) return;
  const days = []; for (let i = period - 1; i >= 0; i--) { const k = dKey(addDays(new Date(), -i)); days.push({ k, d: map[k] }); }
  const rec = days.filter(x => x.d && x.d.kcal > 0); statsCache = { days, rec };
  const n = rec.length, c = calc(), p = P();
  $("reportHd").textContent = `💬 ${p.coach || "가족"}의 기간 리포트`;
  const avg = n ? rec.reduce((s, x) => s + x.d.kcal, 0) / n : 0, avgT = n ? rec.reduce((s, x) => s + x.d.target, 0) / n : c.daily;
  const keep = rec.filter(x => x.d.kcal <= x.d.target * 1.05).length;
  const diff = rec.reduce((s, x) => s + (x.d.kcal - x.d.target), 0);
  const wt = rec.reduce((s, x) => s + (x.d.kcal - x.d.tdee), 0) / 7700;
  $("sAvg").textContent = n ? fmt(avg) : "-"; $("sAvgS").textContent = n ? `목표 ${fmt(avgT)} kcal` : "기록이 없어요";
  $("sKeep").textContent = n ? `${keep}/${n}일` : "-"; $("sKeepS").textContent = `${period}일 중 ${n}일 기록`;
  $("sDiff").textContent = n ? (diff > 0 ? "+" : "") + fmt(diff) : "-"; $("sDiff").style.color = diff > 0 ? "var(--red)" : "var(--green-d)";
  $("sWt").textContent = n ? (wt > 0 ? "+" : "") + wt.toFixed(2) + "kg" : "-"; $("sWt").style.color = wt > 0 ? "var(--red)" : "var(--green-d)";
  drawChart(days, c.daily); drawWeight(days);

  // 음주·야식
  const aDays = rec.filter(x => x.d.alcohol > 0), aK = rec.reduce((s, x) => s + x.d.alcohol, 0);
  const lN = rec.reduce((s, x) => s + x.d.late, 0), lK = rec.reduce((s, x) => s + x.d.lateKcal, 0);
  $("aDays").textContent = `${aDays.length}일`; $("aKcal").textContent = aK ? `술로만 ${fmt(aK)} kcal` : "술 기록 없음";
  $("lCnt").textContent = `${lN}회`; $("lKcal").textContent = lK ? `야식으로 ${fmt(lK)} kcal` : "야식 기록 없음";
  $("aDays").style.color = aDays.length >= Math.max(2, period / 7 * 2) ? "var(--red)" : "var(--ink)";
  $("lCnt").style.color = lN >= Math.max(2, period / 7 * 2) ? "var(--red)" : "var(--ink)";
  const extra = aK + lK;
  $("alNote").textContent = !n ? "" : extra ? `술과 야식을 합치면 ${fmt(extra)}kcal로, 체중 약 ${(extra / 7700).toFixed(2)}kg에 해당해요.` + (aDays.length >= 2 ? " 일주일에 술은 1번 이하로 줄여 보세요." : "") + (lN >= 2 ? " 밤 9시 이후엔 물이나 차로 버텨 봐요." : "") : "이 기간엔 술도 야식도 없었어요. 최고! 👏";

  // 영양 균형
  const C = rec.reduce((s, x) => s + x.d.carbs, 0) * 4, Pr = rec.reduce((s, x) => s + x.d.protein, 0) * 4, F = rec.reduce((s, x) => s + x.d.fat, 0) * 9;
  const T = C + Pr + F, bar = $("macroBar"); bar.innerHTML = "";
  if (T > 0) {
    [["탄", C, "#f59e0b"], ["단", Pr, "#10b981"], ["지", F, "#6366f1"]].forEach(([l, v, col]) => { const pc = v / T * 100; const e = document.createElement("div"); e.style.width = pc + "%"; e.style.background = col; e.textContent = pc >= 10 ? `${l} ${r0(pc)}%` : ""; bar.append(e); });
    const avgP = n ? rec.reduce((s, x) => s + x.d.protein, 0) / n : 0;
    $("macroTxt").textContent = `권장 비율은 탄수화물 50 · 단백질 20 · 지방 30% 정도예요. ` + (C / T * 100 > 60 ? "탄수화물 비중이 높아요. 밥·면 양을 조금 줄여 보세요. " : "") +
      `하루 평균 단백질 ${r0(avgP)}g (목표 ${r0(c.proteinDay)}g)` + (avgP < c.proteinDay * 0.8 ? " → 단백질 보충이 필요해요." : " → 잘 챙기고 있어요.");
  } else { bar.innerHTML = '<div style="width:100%;background:#e5e7eb;color:#6b7280">기록이 없어요</div>'; $("macroTxt").textContent = ""; }

  // 끼니별
  const slots = { 아침: [], 점심: [], 저녁: [], 간식: [] }, sh = shares(p);
  rec.forEach(x => { const per = {}; x.d.meals.forEach(m => per[m.mealType] = (per[m.mealType] || 0) + (m.eatenKcal || 0)); Object.keys(per).forEach(k => slots[k] && slots[k].push(per[k])); });
  const sl = $("slotList"); sl.innerHTML = "";
  SLOTS.forEach(k => {
    const arr = slots[k], av = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0, tg = c.daily * sh[k];
    const w = document.createElement("div"); w.className = "macro"; w.innerHTML = `<div class="top"><span></span><span></span></div><div class="bar"><i></i></div>`;
    const sp = w.querySelectorAll(".top span"); sp[0].textContent = `${k === "간식" ? "간식·야식" : k} (${arr.length}회)`;
    sp[1].textContent = arr.length ? `${fmt(av)} / ${fmt(tg)} kcal` : "기록 없음";
    const i = w.querySelector("i"); i.style.width = tg ? Math.min(100, av / tg * 100) + "%" : (av ? "100%" : "0"); i.style.background = av > tg * 1.1 ? "#ef4444" : "#10b981";
    sl.append(w);
  });

  // 자주 먹은 음식
  const cnt = {}; rec.forEach(x => x.d.meals.forEach(m => { const t = m.title || "식사"; cnt[t] = cnt[t] || { n: 0, k: 0 }; cnt[t].n++; cnt[t].k += m.eatenKcal || 0; }));
  const top = Object.entries(cnt).sort((a, b) => b[1].n - a[1].n || b[1].k - a[1].k).slice(0, 5);
  const tf = $("topFoods"); tf.innerHTML = top.length ? "" : '<p class="muted">아직 기록이 없어요.</p>';
  top.forEach(([t, v], i) => { const r = document.createElement("div"); r.className = "rank"; const a = document.createElement("span"); a.textContent = `${["🥇", "🥈", "🥉", "4.", "5."][i]} ${t}`; const b = document.createElement("span"); b.style.color = "var(--sub)"; b.textContent = `${v.n}회 · ${fmt(v.k)} kcal`; r.append(a, b); tf.append(r); });
}
function drawChart(days, target) {
  const W = 340, H = 170, pl = 34, pb = 22, pt = 10, pr = 6;
  const maxV = Math.max(target * 1.3, ...days.map(x => x.d ? x.d.kcal : 0)), bw = (W - pl - pr) / days.length;
  const y = v => pt + (H - pt - pb) * (1 - v / maxV);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  [0, r0(target / 2), r0(target)].forEach(v => s += `<text x="${pl - 4}" y="${y(v) + 3}" font-size="9" text-anchor="end" fill="#9ca3af">${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}</text>`);
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="#e5e7eb"/>`;
  const step = days.length > 10 ? 5 : 1;
  days.forEach((x, i) => {
    const v = x.d ? x.d.kcal : 0, t = x.d ? x.d.target : target, a = x.d ? x.d.alcohol : 0;
    const col = v <= t * 1.05 ? "#10b981" : v <= t * 1.2 ? "#f59e0b" : "#ef4444";
    const bx = pl + i * bw + bw * .18, bwi = bw * .64;
    if (v) {
      s += `<rect x="${bx}" y="${y(v)}" width="${bwi}" height="${y(0) - y(v)}" rx="${Math.min(4, bwi / 2)}" fill="${col}"/>`;
      if (a) s += `<rect x="${bx}" y="${y(v)}" width="${bwi}" height="${Math.max(2, y(0) - y(a))}" fill="#92400e" opacity=".55"/>`;
    }
    if ((days.length - 1 - i) % step === 0) s += `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#6b7280">${+x.k.slice(8)}</text>`;
  });
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(target)}" y2="${y(target)}" stroke="#065f46" stroke-dasharray="4 3" stroke-width="1.2"/>`;
  s += `<text x="${W - pr}" y="${y(target) - 4}" font-size="9" text-anchor="end" fill="#065f46">목표 ${fmt(target)}</text></svg>`;
  $("chart").innerHTML = s;
}
function drawWeight(days) {
  const wmap = weights[pid] || {};
  const pts = days.map((x, i) => ({ i, k: x.k, kg: wmap[x.k] })).filter(p => p.kg);
  if (!pts.length) { $("wChart").innerHTML = ""; $("wChartNote").textContent = "오늘 탭에서 체중을 기록하면 실제 체중과 식단으로 계산한 예상 체중을 비교해 줘요."; return; }
  // 예상: 첫 체중 기록일부터 (섭취 - 소모)/7700 누적
  const start = pts[0]; const pred = []; let cur = start.kg;
  days.forEach((x, i) => { if (i < start.i) return; if (i > start.i && x.d) cur += (x.d.kcal - x.d.tdee) / 7700; pred.push({ i, kg: cur }); });
  const all = pts.map(p => p.kg).concat(pred.map(p => p.kg)); const tgt = num(P().target);
  if (tgt) all.push(tgt);
  let lo = Math.min(...all) - 0.5, hi = Math.max(...all) + 0.5;
  const W = 340, H = 160, pl = 34, pb = 22, pt = 10, pr = 6, bw = (W - pl - pr) / days.length;
  const X = i => pl + i * bw + bw / 2, Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  [lo + 0.5, (lo + hi) / 2, hi - 0.5].forEach(v => s += `<text x="${pl - 4}" y="${Y(v) + 3}" font-size="9" text-anchor="end" fill="#9ca3af">${v.toFixed(1)}</text>`);
  if (tgt) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(tgt)}" y2="${Y(tgt)}" stroke="#065f46" stroke-dasharray="4 3"/><text x="${W - pr}" y="${Y(tgt) - 4}" font-size="9" text-anchor="end" fill="#065f46">목표 ${tgt}kg</text>`;
  if (pred.length > 1) s += `<polyline points="${pred.map(p => X(p.i) + "," + Y(p.kg)).join(" ")}" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="3 3"/>`;
  if (pts.length > 1) s += `<polyline points="${pts.map(p => X(p.i) + "," + Y(p.kg)).join(" ")}" fill="none" stroke="#10b981" stroke-width="2.5"/>`;
  pts.forEach(p => s += `<circle cx="${X(p.i)}" cy="${Y(p.kg)}" r="3.5" fill="#10b981"/>`);
  const step = days.length > 10 ? 5 : 1;
  days.forEach((x, i) => { if ((days.length - 1 - i) % step === 0) s += `<text x="${X(i)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#6b7280">${+x.k.slice(8)}</text>`; });
  s += `</svg>`;
  $("wChart").innerHTML = s;
  const lastP = pred[pred.length - 1], lastA = pts[pts.length - 1];
  $("wChartNote").textContent = `초록 실선 = 실제 체중, 회색 점선 = 먹은 칼로리로 계산한 예상 체중. ` +
    (pts.length > 1 ? `실제 ${(lastA.kg - start.kg >= 0 ? "+" : "")}${(lastA.kg - start.kg).toFixed(1)}kg / 예상 ${(lastP.kg - start.kg >= 0 ? "+" : "")}${(lastP.kg - start.kg).toFixed(1)}kg` + (lastA.kg - lastP.kg > 0.7 ? " → 기록 안 한 음식이 있는지 확인해 봐요!" : "") : "체중을 이틀 이상 기록하면 비교선이 생겨요.");
}

$("reportBtn").onclick = async () => {
  if (!statsCache || !statsCache.rec.length) { toast("먼저 식사를 기록해 주세요"); return; }
  const c = calc(), p = P(), wm = weights[pid] || {};
  const lines = statsCache.days.map(x => {
    const w = wm[x.k] ? ` / 체중 ${wm[x.k]}kg` : "";
    return x.d && x.d.kcal ? `${x.k}: ${r0(x.d.kcal)}kcal (목표 ${r0(x.d.target)}) 탄${r0(x.d.carbs)}g 단${r0(x.d.protein)}g 지${r0(x.d.fat)}g${x.d.alcohol ? ` 술${r0(x.d.alcohol)}kcal` : ""}${w} / ` +
      x.d.meals.map(m => `${m.mealType}${m.late ? "(밤9시후)" : ""} ${m.title} ${r0(m.eatenKcal || 0)}kcal${m.portion < 0.99 ? "(권장량만)" : ""}`).join(", ")
      : `${x.k}: 기록 없음${w}`;
  }).join("\n");
  const prompt = `당신은 ${p.label}의 건강을 챙기는 ${p.coach || "가족"}입니다. 다정하지만 단호하게, ${p.label}를 "${p.call || "자기야"}"라고 부르며 반말로 말해요.
${p.label} 정보: ${p.sex === "F" ? "여성" : "남성"}, 체중 ${p.weight}kg, 목표 ${p.target}kg, 골격근량 ${p.muscle || "미상"}kg, 체지방률 ${p.fat || "미상"}%, 하루 목표 ${r0(c.daily)}kcal, 단백질 목표 ${r0(c.proteinDay)}g, 기피 음식 ${p.avoid || "없음"}.
최근 ${period}일 기록:
${lines}

리포트를 써 주세요.
- 첫 줄: 한 줄 총평
- 👍 잘한 점 1~2개 (날짜·음식 근거)
- ⚠️ 고칠 점 1~2개 (늦은 식사, 음주, 탄수화물 과다, 단백질 부족, 같은 음식 반복 등 패턴)
- 💡 다음 주 실천 미션 2개 (아주 구체적으로)
8~12줄, 마크다운 기호(#, **) 없이 이모지와 줄바꿈만.`;
  const btn = $("reportBtn"), out = $("reportTxt");
  btn.disabled = true; btn.textContent = "분석 중..."; out.textContent = "";
  try { out.textContent = (await gemini([{ text: prompt }], { json: false })).replace(/\*\*/g, ""); }
  catch (e) { out.textContent = aiError(e); }
  finally { btn.disabled = false; btn.textContent = "리포트 다시 받기"; }
};

/* ================= 시작 ================= */
(async () => {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  await loadToday(); renderAll();
  if (!settings.apiKey) toast("처음이시네요! 프로필 탭에서 Gemini API 키를 넣어 주세요");
})();
