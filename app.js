/* 뭉찍 120살 — Gemini 버전 (기록은 이 폰의 브라우저 저장소에만 보관) */
"use strict";

/* ================= 기본값 ================= */
const PIDS = ["p1", "p2"];
const SLOTS = ["아침", "점심", "저녁", "간식"];
const DEF_SHARES = { 아침: 25, 점심: 35, 저녁: 30, 간식: 10 };
const DEFAULTS = {
  p1: { label: "찍찍이", call: "찍찍아", coach: "뭉뭉이", sex: "M", age: "", height: "", weight: 77, target: 75, act: "1.375", muscle: 34, fat: 21, avoid: "새우, 오이", shares: { ...DEF_SHARES } },
  p2: { label: "뭉뭉이", call: "자기야", coach: "찍찍이", sex: "F", age: "", height: "", weight: "", target: "", act: "1.375", muscle: "", fat: "", avoid: "", shares: { ...DEF_SHARES } },
};
const DEFAULT_MODEL = "gemini-3.8-flash";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

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
let activity = ls("activity", { p1: {}, p2: {} });   // {pid: {date: {steps, minutes, runKm, runMin}}}
let settings = ls("settings", { apiKey: "", model: "" });
let todayMeals = [];                                  // 현재 사람의 오늘 기록
let mealType = autoMealType();
let current = null, abortCtl = null, stream = null;
PIDS.forEach(k => { weights[k] = weights[k] || {}; activity[k] = activity[k] || {}; });
if (!ls("renamed1")) {
  if (profiles.p2.label === "아내") profiles.p2.label = "뭉뭉이";
  if (profiles.p1.coach === "아내") profiles.p1.coach = "뭉뭉이";
  lsSet("profiles", profiles); lsSet("renamed1", true);
}

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
function runBurn(w, km, min) {
  km = num(km); min = num(min);
  if (km && km > 0) return w * km;                 // 달리기 1km ≈ 체중(kg) kcal
  if (min && min > 0) return 9.8 * 3.5 * w / 200 * min; // 시속 약 10km 달리기
  return 0;
}
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
  // [추가] 달리기 소모 칼로리: 거리가 있으면 체중×거리(km), 없으면 시간(분)×체중 기준(MET 9.8)
  const run = runBurn(w, act.runKm, act.runMin);
  // [추가] 걸음 수에 달리기 걸음이 들어 있을 수 있어 그만큼 빼고 계산 (1km ≈ 1,300보, 1분 ≈ 160보)
  const runSteps = num(act.runKm) ? num(act.runKm) * 1300 : (num(act.runMin) || 0) * 160;
  const walkSteps = steps != null ? Math.max(0, steps - runSteps) : null;
  let tdee, actNote;
  if (steps != null || mins != null || run > 0) { const k = (walkSteps || 0) * 0.04 * (w / 70) + (mins || 0) * 6 + run; tdee = bmr * 1.2 + k; actNote = `오늘 활동 +${fmt(k)}` + (run > 0 ? `, 달리기 ${fmt(run)} 포함` : ""); }
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
  return { bmr, method, tdee, actNote, adj, goal, daily, eaten, remain, allowed, proteinDay, proteinMeal, w, steps, male, run };
}

/* ================= 렌더 ================= */
function renderWho() {
  const box = $("who"); box.innerHTML = "";
  PIDS.forEach(k => {
    const b = document.createElement("button"); b.textContent = (k === "p1" ? "🐭 " : "🌸 ") + (profiles[k].label || (k === "p1" ? "찍찍이" : "뭉뭉이"));
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
  if (c.run > 0) { const a = actToday(); chip(`🏃 <b>${a.runKm ? a.runKm + "km" : a.runMin + "분"}</b> −${fmt(c.run)}kcal`); }
  const lw = latestWeight(pid); if (lw) chip(`체중 <b>${lw.kg}kg</b>`);
  renderWho();
  $("keyAlert").classList.toggle("hidden", !!settings.apiKey);
  $("profAlert").classList.toggle("hidden", !!(num(p.weight) && num(p.target)));
}
function renderBudget() {
  const c = calc();
  document.querySelectorAll("#mealSeg button, #txtMealSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === mealType));
  $("bWho").textContent = P().label + ",";
  $("bMeal").textContent = mealType === "간식" ? "간식·야식" : mealType;
  $("bKcal").textContent = fmt(c.allowed);
  $("bRemain").textContent = fmt(Math.max(0, c.remain));
}
function mealRow(m, withDelete) {
  const row = document.createElement("div"); row.className = "meal";
  let pic;
  const ths = (m.thumbs || []).filter(x => typeof x === "string" && x.startsWith("data:image/"));
  if (ths.length > 1) {   // [추가] 여러 장 기록은 사진을 전부 작게 모아서 보여 줌
    pic = document.createElement("div"); pic.className = "grid n" + Math.min(4, ths.length);
    ths.slice(0, 4).forEach(t => { const im = document.createElement("img"); im.src = t; im.alt = ""; pic.append(im); });
  }
  else if (typeof m.thumb === "string" && m.thumb.startsWith("data:image/")) { pic = document.createElement("img"); pic.src = m.thumb; pic.alt = ""; }
  else { pic = document.createElement("div"); pic.className = "ph"; pic.textContent = "🍽️"; }
  const info = document.createElement("div"); info.className = "info";
  const a = document.createElement("div"); a.className = "a"; a.textContent = `${m.mealType === "간식" ? "간식·야식" : m.mealType} · ${m.title || "식사"}`;
  if (m.alcoholKcal > 0) { const t = document.createElement("span"); t.className = "tag al"; t.textContent = "🍺"; a.append(t); }
  if (m.late) { const t = document.createElement("span"); t.className = "tag lt"; t.textContent = "🌙"; a.append(t); }
  const b = document.createElement("div"); b.className = "b";
  const t = m.ts ? new Date(m.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  const shTxt = m.share && m.share < 0.999 ? `내 몫 ${shareLabel(m.share)} · ` : "";
  b.textContent = `${fmt(m.eatenKcal || 0)} kcal · ${shTxt}${m.portion >= 0.99 ? "전부" : "권장량(" + r0((m.portion || 0) * 100) + "%)"}` + (t && m.date === todayKey() ? ` · ${t}` : "");
  info.append(a, b); row.append(pic, info);
  // [추가] 사진·제목을 누르면 크게 보기
  pic.classList.add("tap"); info.classList.add("tap");
  pic.onclick = info.onclick = () => openPhoto(m);
  if (withDelete) {
    // 실수로 지우지 않게 두 번 눌러야 삭제 (첫 번째: '삭제?'로 바뀜, 3초 지나면 원래대로)
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.setAttribute("aria-label", (m.title || "식사") + " 기록 삭제");
    del.onclick = () => {
      if (!del.classList.contains("ask")) {
        del.classList.add("ask"); del.textContent = "삭제?";
        clearTimeout(del._t); del._t = setTimeout(() => { del.classList.remove("ask"); del.textContent = "✕"; }, 3000);
        return;
      }
      deleteMeal(m.id);
    };
    row.append(del);
  }
  return row;
}
const SHARE_NAMES = [[1, "혼자 다"], [0.75, "3/4"], [0.6667, "2/3"], [0.5, "1/2"], [0.3333, "1/3"], [0.25, "1/4"]];
function shareLabel(v) { const f = SHARE_NAMES.find(([x]) => Math.abs(x - v) < 0.01); return f ? f[1] : r0(v * 100) + "%"; }
/* ================= [추가] 기록 크게 보기 ================= */
let pvMeal = null;   // [추가] 크게 보기로 열린 기록 (비율 고치기용)
function openPhoto(m) {
  fillPhoto(m);
  $("pvView").classList.remove("hidden");
  try { history.pushState({ pv: 1 }, ""); } catch (e) { }
}
function fillPhoto(m) {
  pvMeal = m;
  document.querySelectorAll("#pvShareSeg button").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.s - (m.share || 1)) < 0.01));
  const big = typeof m.photo === "string" && m.photo.startsWith("data:image/") ? m.photo : (typeof m.thumb === "string" && m.thumb.startsWith("data:image/") ? m.thumb : "");
  const pics = (m.photos || []).filter(x => typeof x === "string" && x.startsWith("data:image/"));
  const gal = $("pvGal"); gal.innerHTML = "";
  if (pics.length > 1) {   // [추가] 여러 장이면 옆으로 넘겨 보기
    pics.forEach((u, i) => { const im = document.createElement("img"); im.src = u; im.alt = `${i + 1}번째 사진`; gal.append(im); });
    gal.scrollLeft = 0; $("pvCount").textContent = `1 / ${pics.length} · 옆으로 넘겨 보세요`;
    gal.onscroll = () => { const i = Math.round(gal.scrollLeft / gal.clientWidth); $("pvCount").textContent = `${i + 1} / ${pics.length} · 옆으로 넘겨 보세요`; };
  }
  gal.classList.toggle("hidden", pics.length < 2); $("pvCount").classList.toggle("hidden", pics.length < 2);
  $("pvImg").src = pics.length > 1 ? "" : big; $("pvImg").classList.toggle("hidden", !big || pics.length > 1); $("pvNo").classList.toggle("hidden", !!big);
  $("pvOld").classList.toggle("hidden", !big || big === m.photo);
  const [, mm, dd] = String(m.date || "").split("-").map(Number);
  $("pvTitle").textContent = `${mm}월 ${dd}일 ${m.mealType === "간식" ? "간식·야식" : m.mealType || ""} · ${m.title || "식사"}`;
  const shTxt = m.share && m.share < 0.999 ? ` · 내 몫 ${shareLabel(m.share)}` : "";
  $("pvSub").textContent = `먹은 양 ${fmt(m.eatenKcal || 0)} kcal${shTxt} · ${m.portion >= 0.99 ? "전부" : "권장량 " + r0((m.portion || 0) * 100) + "%"} · 탄 ${r0(m.eaten?.carbs || 0)}g · 단 ${r0(m.eaten?.protein || 0)}g · 지 ${r0(m.eaten?.fat || 0)}g`;
  const ul = $("pvFoods"); ul.innerHTML = "";
  (m.foods || []).forEach(f => { const li = document.createElement("li"); li.textContent = `${f.alcohol ? "🍺 " : ""}${f.name} · 약 ${fmt(f.grams || 0)}${f.alcohol ? "ml" : "g"} · ${fmt(f.kcal || 0)} kcal`; ul.append(li); });
}
// [추가] 저장한 기록의 '내가 먹은 비율'을 나중에 바꾸기 — 칼로리·탄단지·음식 양을 비율만큼 다시 계산
async function changeMealShare(m, v) {
  const old = m.share || 1; if (Math.abs(old - v) < 0.001) return;
  const k = v / old, sc = x => Math.round((+x || 0) * k);
  m.share = v; m.totalKcal = sc(m.totalKcal); m.eatenKcal = sc(m.eatenKcal); m.alcoholKcal = sc(m.alcoholKcal);
  if (m.eaten) m.eaten = { carbs: sc(m.eaten.carbs), protein: sc(m.eaten.protein), fat: sc(m.eaten.fat) };
  m.foods = (m.foods || []).map(f => ({ ...f, grams: sc(f.grams), kcal: sc(f.kcal) }));
  try {
    await idb.put(m); fillPhoto(m); await loadToday(); renderAll();
    if ($("v-cal").classList.contains("on")) await renderCalendar();
    toast(`내가 먹은 비율을 ${shareLabel(v)}로 바꿨어요 · ${fmt(m.eatenKcal)}kcal`);
  } catch (e) { toast("바꾸지 못했어요. 다시 눌러 주세요"); }
}
document.querySelectorAll("#pvShareSeg button").forEach(b => b.onclick = e => { e.stopPropagation(); if (pvMeal) changeMealShare(pvMeal, +b.dataset.s); });
function closePhoto(fromBack) {
  if ($("pvView").classList.contains("hidden")) return;
  $("pvView").classList.add("hidden"); $("pvImg").src = ""; $("pvGal").innerHTML = "";
  if (!fromBack && history.state && history.state.pv) history.back();
}
$("pvClose").onclick = () => closePhoto(false);
$("pvView").addEventListener("click", e => { if (e.target === $("pvView") || e.target === $("pvImg")) closePhoto(false); });
window.addEventListener("popstate", () => closePhoto(true));   // 폰 뒤로 가기로 닫기

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
  $("runKm").value = a.runKm ?? ""; $("runMin").value = a.runMin ?? ""; runPreview();
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
document.querySelectorAll("#mealSeg button, #txtMealSeg button").forEach(b => b.onclick = () => { mealType = b.dataset.m; renderBudget(); });

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
  stopCam(); openEditor(cv, cv.width, cv.height, null); // [수정] 바로 분석하지 않고 편집 화면 먼저
};
const MAX_PHOTOS = 4;   // [추가] 한 번에 같이 분석할 사진 수
function loadImage(f) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(f), img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(); }; img.src = url; });
}
["fileCam", "fileLib"].forEach(id => $(id).addEventListener("change", async e => {
  const files = Array.from(e.target.files || []); e.target.value = ""; stopCam();
  if (!files.length) return;
  // [추가] 여러 장 고르면: 같은 식사를 여러 각도로 찍은 사진으로 보고 한 번에 분석
  if (files.length > 1) {
    if (files.length > MAX_PHOTOS) toast(`사진은 ${MAX_PHOTOS}장까지만 같이 분석해요. 앞의 ${MAX_PHOTOS}장을 쓸게요`);
    const pick = files.slice(0, MAX_PHOTOS), imgs = [];
    for (const f of pick) { try { imgs.push(await loadImage(f)); } catch (err) { } }
    if (!imgs.length) { toast("이미지를 열 수 없어요"); return; }
    const f0 = pick[0]; let pd = null;
    if (id === "fileLib" && f0.lastModified) { const k = dKey(new Date(f0.lastModified)); if (k < todayKey() && Date.now() - f0.lastModified < 60 * 864e5) pd = k; }
    openEditorQueue(imgs.map(im => ({ src: im, w: im.naturalWidth, h: im.naturalHeight })), pd);
    return;
  }
  const f = files[0];
  const url = URL.createObjectURL(f); const img = new Image();
  // 앨범 사진이면 사진 파일 날짜를 기록 날짜 후보로 (최근 60일 안, 오늘 이전만)
  let photoDate = null;
  if (id === "fileLib" && f.lastModified) {
    const d = new Date(f.lastModified), k = dKey(d);
    if (k < todayKey() && Date.now() - f.lastModified < 60 * 864e5) photoDate = k;
  }
  img.onload = () => { openEditor(img, img.naturalWidth, img.naturalHeight, photoDate); URL.revokeObjectURL(url); }; // [수정] 편집 화면 먼저
  img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 열 수 없어요"); };
  img.src = url;
}));
/* ================= [추가] 사진 편집 (자르기·회전) ================= */
let ed = null;
function openEditor(src, w, h, photoDate) { openEditorQueue([{ src, w, h }], photoDate); }
// [추가] 여러 장이면 한 장씩 차례로 편집한 뒤 모아서 한 번에 분석
function openEditorQueue(list, photoDate) {
  ed = { queue: list, idx: 0, done: [], photoDate };
  editorLoad();
}
function editorLoad() {
  const it = ed.queue[ed.idx];
  Object.assign(ed, { base: resize(it.src, it.w, it.h, 2048), rot: 0, img: null, crop: null, view: null, drag: null });   // 메모리 아끼려고 긴 변 2048px까지만
  const n = ed.queue.length;
  $("edTitle").textContent = n > 1 ? `✂️ 사진 편집 (${ed.idx + 1}/${n})` : "✂️ 사진 편집";
  $("edGo").textContent = n > 1 && ed.idx < n - 1 ? "✓ 다음 사진" : n > 1 ? `✓ ${n}장 같이 분석` : "✓ 이대로 분석";
  $("edView").classList.remove("hidden");
  ed.img = rotatedImage(); ed.crop = { x: 0, y: 0, w: ed.img.width, h: ed.img.height };
  requestAnimationFrame(layoutEditor);
}
function closeEditor() { $("edView").classList.add("hidden"); ed = null; }
function rotatedImage() {
  const b = ed.base, r = ed.rot % 4, cv = document.createElement("canvas");
  cv.width = r % 2 ? b.height : b.width; cv.height = r % 2 ? b.width : b.height;
  const g = cv.getContext("2d"); g.translate(cv.width / 2, cv.height / 2); g.rotate(r * Math.PI / 2); g.drawImage(b, -b.width / 2, -b.height / 2);
  return cv;
}
function layoutEditor() {
  if (!ed) return;
  const st = $("edStage"), cv = $("edCanvas"), im = ed.img, pad = 18;
  const sw = st.clientWidth - pad * 2, sh = st.clientHeight - pad * 2;
  const sc = Math.min(sw / im.width, sh / im.height);
  const dw = Math.round(im.width * sc), dh = Math.round(im.height * sc);
  cv.width = dw; cv.height = dh; cv.getContext("2d").drawImage(im, 0, 0, dw, dh);
  const x = Math.round((st.clientWidth - dw) / 2), y = Math.round((st.clientHeight - dh) / 2);
  cv.style.left = x + "px"; cv.style.top = y + "px";
  ed.view = { x, y, s: sc };
  drawCropBox();
}
function drawCropBox() {
  const { view: v, crop: c } = ed, b = $("edBox");
  b.style.left = v.x + c.x * v.s + "px"; b.style.top = v.y + c.y * v.s + "px";
  b.style.width = c.w * v.s + "px"; b.style.height = c.h * v.s + "px";
}
$("edStage").addEventListener("pointerdown", e => {
  if (!ed) return;
  const h = e.target.dataset && e.target.dataset.h;
  if (!h && e.target !== $("edBox")) return;
  e.preventDefault(); $("edStage").setPointerCapture(e.pointerId);
  ed.drag = { mode: h || "move", sx: e.clientX, sy: e.clientY, c0: { ...ed.crop } };
});
$("edStage").addEventListener("pointermove", e => {
  if (!ed || !ed.drag) return;
  const d = ed.drag, s = ed.view.s, W = ed.img.width, H = ed.img.height, min = 60 / s;
  const dx = (e.clientX - d.sx) / s, dy = (e.clientY - d.sy) / s, c = { ...d.c0 };
  if (d.mode === "move") {
    c.x = Math.min(Math.max(0, d.c0.x + dx), W - c.w); c.y = Math.min(Math.max(0, d.c0.y + dy), H - c.h);
  } else {
    let x1 = d.c0.x, y1 = d.c0.y, x2 = d.c0.x + d.c0.w, y2 = d.c0.y + d.c0.h;
    if (d.mode.includes("w")) x1 = Math.min(Math.max(0, x1 + dx), x2 - min);
    if (d.mode.includes("e")) x2 = Math.max(Math.min(W, x2 + dx), x1 + min);
    if (d.mode.includes("n")) y1 = Math.min(Math.max(0, y1 + dy), y2 - min);
    if (d.mode.includes("s")) y2 = Math.max(Math.min(H, y2 + dy), y1 + min);
    c.x = x1; c.y = y1; c.w = x2 - x1; c.h = y2 - y1;
  }
  ed.crop = c; drawCropBox();
});
["pointerup", "pointercancel"].forEach(t => $("edStage").addEventListener(t, () => { if (ed) ed.drag = null; }));
window.addEventListener("resize", () => { if (ed) layoutEditor(); });
$("edRot").onclick = () => { ed.rot = (ed.rot + 1) % 4; ed.img = rotatedImage(); ed.crop = { x: 0, y: 0, w: ed.img.width, h: ed.img.height }; layoutEditor(); };
$("edReset").onclick = () => { ed.rot = 0; ed.img = rotatedImage(); ed.crop = { x: 0, y: 0, w: ed.img.width, h: ed.img.height }; layoutEditor(); };
$("edCancel").onclick = closeEditor;
$("edGo").onclick = () => {
  if (!ed) return;
  const c = ed.crop, cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(c.w)); cv.height = Math.max(1, Math.round(c.h));
  cv.getContext("2d").drawImage(ed.img, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
  ed.done.push(cv);
  if (ed.idx < ed.queue.length - 1) { ed.idx++; editorLoad(); return; }
  const pd = ed.photoDate, all = ed.done; closeEditor();
  analyzeSources(all, pd);
};

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
  let v;
  try { v = JSON.parse(t); }
  catch (e) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    try { v = JSON.parse(t.slice(a, b + 1)); } catch (e2) { throw { code: "parse", message: "AI 답변 형식 오류: " + t.slice(0, 60) }; }
  }
  if (Array.isArray(v)) v = v.find(x => x && typeof x === "object") || {};
  return v;
}
// 이 API 키로 실제 쓸 수 있는 모델 목록을 Google에 물어보고 가장 좋은 Flash 모델을 고름
async function discoverModel() {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": settings.apiKey } });
    if (!res.ok) return null;
    const data = await res.json();
    const ok = (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""))
      .filter(n => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|live|audio|embed|exp|preview|thinking/i.test(n));
    const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
    ok.sort((a, b) => (/lite/.test(a) - /lite/.test(b)) || ver(b) - ver(a) || a.length - b.length);
    return ok[0] || null;
  } catch (e) { return null; }
}
const THINK_LEVELS = ["minimal", "low", null];
let aiTrace = [];   // 이번 요청에서 시도한 모델들 (속도 비교용)
async function gemini(parts, opts = {}, _retry) {
  if (!settings.apiKey) throw { code: "nokey" };
  if (!_retry) aiTrace = [];
  try { return await geminiOnce(parts, opts); }
  catch (e) {
    if (e && (e.code === "busy" || (e.code === "network" && navigator.onLine !== false)) && !_retry) {
      await new Promise((r, j) => { const t = setTimeout(r, 3000); opts.signal && opts.signal.addEventListener("abort", () => { clearTimeout(t); j(new DOMException("취소", "AbortError")); }); });
      return gemini(parts, opts, true);
    }
    if (e && e.code === "model" && !_retry) {
      const m = await discoverModel();
      if (m) { settings.workingModel = m; settings.model = ""; lsSet("settings", settings); return gemini(parts, opts, true); }
    }
    throw e;
  }
}
async function geminiOnce(parts, { json = true, signal } = {}) {
  // 마지막으로 잘 됐던 모델을 먼저 시도 (붐비는 모델에서 시간 낭비 줄이기)
  const models = [...new Set([settings.workingModel, settings.model, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
  let last = { code: "model" }, busy = null, net = null;
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    aiTrace.push(m);
    const cfg = json ? { responseMimeType: "application/json" } : {};
    // 생각(thinking)을 짧게 해서 답을 빨리 받기 — 지원 안 하는 모델이면 빼고 다시 시도
    // minimal(가장 빠름) → low → 생각 설정 없음 순서로, 모델이 받아주는 가장 빠른 단계 사용
    const lvIdx = (settings.thinkIdx || {})[m] || 0;
    const think = THINK_LEVELS[lvIdx];
    if (think) cfg.thinkingConfig = { thinkingLevel: think };
    // 한 모델이 너무 오래 걸리면(30초) 다음 모델로
    const ctl = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 30000);
    const onAbort = () => ctl.abort(); if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", onAbort); }
    let res, data;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: cfg }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (timedOut) { busy = { code: "busy", message: `${m}: 30초 안에 답이 없었어요` }; continue; }
      if (e.name === "AbortError") throw e;
      net = { code: "network", message: `${m}: ${(e && e.message) || e}` }; continue;
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
    const msg = data.error?.message || "";
    if (think && res.status === 400 && /thinking/i.test(msg)) {
      settings.thinkIdx = { ...(settings.thinkIdx || {}), [m]: lvIdx + 1 }; lsSet("settings", settings); aiTrace.pop(); i--; continue;
    }
    const modelProblem = res.status === 404 || (res.status === 400 && /model|not found|not supported|unsupported/i.test(msg) && !/api key/i.test(msg));
    if (modelProblem) { last = { code: "model", status: res.status, message: `${m}: ${msg}` }; continue; }
    // 서버가 붐빔(503 등) → 다음 모델로 넘어가기
    if (res.status >= 500 || /high demand|overloaded|unavailable/i.test(msg)) { busy = { code: "busy", status: res.status, message: `${m}: ${msg}` }; continue; }
    if (!res.ok) {
      const code = (res.status === 400 && /api key/i.test(msg)) || res.status === 401 || res.status === 403 ? "badkey" : res.status === 429 ? "rate" : "http";
      if (code === "rate" && m !== models[models.length - 1] && /limit: 0|quota/i.test(msg)) { last = { code, status: 429, message: `${m}: ${msg}` }; continue; }
      throw { code, status: res.status, message: `${m}: ${msg}` };
    }
    const text = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) throw { code: "empty", message: `${m}: ` + (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || "빈 답변") };
    if (settings.workingModel !== m) { settings.workingModel = m; lsSet("settings", settings); }
    return json ? parseJSON(text) : text;
  }
  throw busy || net || last;
}
function aiError(e) {
  const c = e && e.code;
  if (c === "nokey") return "Gemini API 키를 먼저 넣어 주세요 (프로필 탭)";
  if (c === "badkey") return "API 키가 맞지 않아요. 프로필 탭에서 확인해 주세요";
  if (c === "rate") return "무료 사용량을 잠시 초과했어요. 1분 뒤 다시 시도해 주세요";
  if (c === "busy") return "지금 Gemini 서버가 붐벼요. 잠시 뒤 다시 시도해 주세요";
  if (c === "network") return navigator.onLine === false ? "인터넷이 끊겨 있어요. 와이파이나 데이터를 켜 주세요" : "Google 서버에 연결하지 못했어요. 광고 차단 앱·VPN·비공개 DNS를 끄거나, 회사·학교 와이파이 대신 데이터로 해 보세요";
  if (c === "model") return "쓸 수 있는 Gemini 모델을 찾지 못했어요. 프로필 탭 모델 칸에 gemini-flash-latest 를 넣어 보세요";
  if (c === "empty") return "Gemini가 답을 주지 않았어요. 사진을 다시 찍어 주세요";
  if (c === "parse") return "Gemini 답변을 읽지 못했어요. 한 번 더 시도해 주세요";
  if (e instanceof Error) return "앱 오류: " + e.message;
  return "분석에 실패했어요. 다시 시도해 주세요";
}
function showErr(e) {
  let box = $("errBox");
  if (!box) { box = document.createElement("div"); box.id = "errBox"; box.className = "alert"; $("scanStart").before(box); }
  const detail = e && (e.message || e.status) ? `\n\n[자세한 원인] ${e.status ? e.status + " · " : ""}${String(e.message || "").slice(0, 220)}` : "";
  box.style.whiteSpace = "pre-wrap";
  box.textContent = "⚠️ " + aiError(e) + detail;
  box.classList.remove("hidden");
}
function hideErr() { const b = $("errBox"); if (b) b.classList.add("hidden"); }

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

async function analyzeSource(src, w, h, photoDate) { return analyzeSources([src], photoDate); }
// [수정] 사진 여러 장(캔버스 목록)을 한 번에 분석 — 첫 장이 대표 사진
async function analyzeSources(list, photoDate) {
  if (!settings.apiKey) { showErr({ code: "nokey" }); toast(aiError({ code: "nokey" })); return; }
  hideErr();
  const src = list[0], w = src.width, h = src.height;
  // [수정] 여러 장이면 나머지 사진도 큰 사진·작은 사진으로 같이 보관 (오늘·달력에서 전부 보이게)
  const moreUrls = list.slice(1).map(c => resize(c, c.width, c.height, 768).toDataURL("image/jpeg", .8));
  const moreThumbs = list.slice(1).map(c => resize(c, c.width, c.height, 220).toDataURL("image/jpeg", .6));
  const more = moreUrls.map(u => u.split(",")[1]);
  const big = resize(src, w, h, 1024), small = resize(src, w, h, 220);
  const preview = big.toDataURL("image/jpeg", .85);
  const thumb = small.toDataURL("image/jpeg", .6);
  // Gemini에는 조금 더 작은 사진을 보내서 업로드·분석 시간을 줄임
  const send = resize(src, w, h, 768).toDataURL("image/jpeg", .8);
  // [추가] 달력에서 크게 볼 사진(768px)도 기록에 같이 저장
  current = { preview, thumb, photo: send, b64: send.split(",")[1], more, photos: [send, ...moreUrls], thumbs: [thumb, ...moreThumbs], late: lateFor(todayKey(), mealType), mealType, date: todayKey(), share: 1, dayMeals: null };
  if (photoDate) await setScanDate(photoDate, true);
  await runAnalysis();
}
function lateFor(date, slot) { return date === todayKey() && isLateNow() && (slot === "저녁" || slot === "간식"); }
// 기록할 날짜(지난 날짜 포함) 기준으로 계산
function scanCalc() {
  if (!current || !current.date || current.date === todayKey()) return calc(P(), todayMeals, actToday(), current ? current.mealType || mealType : mealType);
  return calc(P(), current.dayMeals || [], activity[pid][current.date] || {}, current.mealType || mealType);
}
async function setScanDate(k, auto) {
  if (!current) return;
  const t = todayKey(); if (!k || k > t) k = t;
  current.date = k;
  current.dayMeals = k === t ? null : await loadRange(k, k);
  current.late = lateFor(k, current.mealType || mealType);
  current.autoDate = !!auto;
}
// 사진 없이 글로 적은 음식 계산
async function analyzeText(foodText) {
  if (!settings.apiKey) { showErr({ code: "nokey" }); toast(aiError({ code: "nokey" })); return; }
  hideErr();
  current = { preview: null, thumb: null, b64: null, textInput: foodText, late: lateFor(todayKey(), mealType), mealType, date: todayKey(), share: 1, dayMeals: null };
  await runAnalysis();
}
async function runAnalysis(correction) {
  const c = scanCalc(), p = P();
  const noPhoto = !current.b64;
  $("busyImg").src = current.preview || ""; $("busyImg").classList.toggle("hidden", noPhoto);
  $("busyImg").closest(".scan-wrap").classList.toggle("noimg", noPhoto);
  $("busyTitle").textContent = correction ? "말씀하신 대로 다시 계산 중..." : noPhoto ? "적어 준 음식 계산 중..." : "음식 부피 스캔 중...";
  showStage("busy");
  let text = analysisPrompt(c, p);
  if (noPhoto) {
    text += `\n\n[중요: 사진은 없습니다]\n사용자가 글로 적은 음식과 양만 보고 추정하세요. 양이 적혀 있지 않으면 한국 식당·가정의 보통 1인분 기준으로 잡으세요. "반 공기", "2조각", "500cc", "한 캔" 같은 표현을 정확히 반영하세요. reference_object는 null로 하세요.\n[사용자가 적은 음식]\n"${current.textInput}"`;
  }
  if (correction && current.r) {
    text += `\n\n[이전 분석 결과]\n${JSON.stringify(current.r)}\n\n[사용자 정정 — 최우선으로 반영]\n"${correction}"\n정정 내용을 반영해 음식 종류·양·칼로리를 다시 계산하고, 같은 JSON 형식으로만 출력하세요.`;
  }
  abortCtl = new AbortController();
  const t0 = Date.now();
  $("busyTime").textContent = "0초";
  const tick = setInterval(() => { $("busyTime").textContent = Math.floor((Date.now() - t0) / 1000) + "초"; }, 1000);
  let r;
  if (!noPhoto && current.more && current.more.length) {
    text += `\n\n[중요: 사진 ${current.more.length + 1}장]\n첨부한 사진들은 모두 같은 한 끼를 여러 각도·여러 장으로 찍은 것입니다. 같은 음식이 여러 사진에 보이면 한 번만 세고, 사진마다 다른 음식만 더하세요. 여러 장을 비교해 양을 더 정확히 추정하세요.`;
  }
  const parts = noPhoto ? [{ text }] : [{ text }, ...[current.b64, ...(current.more || [])].map(d => ({ inline_data: { mime_type: "image/jpeg", data: d } }))];
  try { r = await gemini(parts, { signal: abortCtl.signal }); }
  catch (e) {
    clearInterval(tick); abortCtl = null;
    if (e && e.name === "AbortError") { showStage(current.r ? "result" : "start"); return; }
    console.error(e); showStage(current.r ? "result" : "start"); showErr(e); toast(aiError(e));
    $("errBox").textContent += `\n⏱️ ${((Date.now() - t0) / 1000).toFixed(1)}초 만에 실패 · 시도한 모델: ${aiTrace.join(" → ")}`;
    return;
  }
  clearInterval(tick); abortCtl = null;
  current.stat = { sec: (Date.now() - t0) / 1000, model: aiTrace[aiTrace.length - 1], tries: aiTrace.length };
  if (!r || r.is_food === false || !Array.isArray(r.foods) || !r.foods.length) {
    showStage(current.r ? "result" : "start");
    toast(noPhoto ? "어떤 음식인지 알아듣지 못했어요. 음식 이름과 양을 다시 적어 주세요" : "음식을 찾지 못했어요. 음식이 잘 보이게 다시 찍어 주세요");
    if (!current.r) current = null; return;
  }
  hideErr(); current.r = r; showResult();
}
// 내가 먹은 비율 · 기록할 날짜
function renderShareDate() {
  const sh = current.share || 1;
  document.querySelectorAll("#shareSeg button").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.s - sh) < 0.01));
  $("shareNote").textContent = sh < 0.999 ? `사진 속 전체의 ${shareLabel(sh)}(${r0(sh * 100)}%)만 내 몫으로 계산했어요` : "혼자 다 먹는 걸로 계산했어요";
  $("sTotalL").textContent = sh < 0.999 ? `내 몫 (${r0(sh * 100)}%)` : current.preview ? "사진 속 총량" : "적은 음식 총량";
  const t = todayKey(); $("mealDate").max = t; $("mealDate").value = current.date || t;
  document.querySelectorAll("#resMealSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === (current.mealType || mealType)));
  const d = current.date || t, [, mm, dd] = d.split("-").map(Number);
  $("dateNote").textContent = d === t ? "오늘 먹은 걸로 기록해요" : `${mm}월 ${dd}일에 먹은 걸로 기록해요` + (current.autoDate ? " (사진 날짜로 자동 선택)" : "") + ` · 그날 이미 ${fmt((current.dayMeals || []).reduce((a, m) => a + (m.eatenKcal || 0), 0))}kcal 먹었어요`;
}
function applyShare(v) {
  if (!current || !current.r) return;
  current.share = Math.max(0.05, Math.min(1, v));
  const y = window.scrollY; showResult(); window.scrollTo(0, y);
}
document.querySelectorAll("#shareSeg button").forEach(b => b.onclick = () => applyShare(+b.dataset.s));
$("shareGo").onclick = () => {
  const v = num($("shareIn").value);
  if (v == null || v <= 0 || v > 100) { toast("1~100 사이 숫자(%)로 넣어 주세요"); return; }
  applyShare(v / 100); $("shareIn").value = "";
};
// 결과 화면에서 끼니 바꾸기 — 그 끼니 기준으로 먹어도 되는 양 다시 계산
document.querySelectorAll("#resMealSeg button").forEach(b => b.onclick = () => {
  if (!current || !current.r) return;
  current.mealType = b.dataset.m;
  current.late = lateFor(current.date || todayKey(), current.mealType);
  const y = window.scrollY; showResult(); window.scrollTo(0, y);
});
$("mealDate").addEventListener("change", async e => {
  if (!current || !current.r) return;
  await setScanDate(e.target.value, false);
  const y = window.scrollY; showResult(); window.scrollTo(0, y);
});

// 잘못 읽은 음식 지우기 — 다시 묻지 않고 남은 음식으로 바로 다시 계산
function removeFood(i) {
  const list = current.r.foods;
  if (list.length <= 1) { toast("마지막 음식은 지울 수 없어요. 아니면 '다시 찍기'를 눌러 주세요"); return; }
  const [gone] = list.splice(i, 1);
  if (current.r.title && gone && current.r.title === gone.name) current.r.title = "";
  const y = window.scrollY; showResult(); window.scrollTo(0, y);
  toast(`'${gone.name}' 지웠어요`);
}
$("txtGo").onclick = () => {
  const t = $("txtFood").value.trim();
  if (!t) { toast("먹은 음식을 적어 주세요 (예: 김치찌개 1인분, 공기밥 반 공기)"); $("txtFood").focus(); return; }
  if (t.length > 300) { toast("300자 안으로 적어 주세요"); return; }
  analyzeText(t);
};
$("cancelBtn").onclick = () => { if (abortCtl) abortCtl.abort(); };

/* ================= 결과 ================= */
function showResult() {
  const { r } = current; const c = scanCalc(), p = P();
  const sh = current.share || 1;   // 여럿이 먹었을 때 내 몫 비율
  const foods = r.foods.map(f => ({
    name: String(f.name || "음식"), grams: (+f.grams || 0) * sh, kcal: (+f.kcal || 0) * sh, carbs: (+f.carbs_g || 0) * sh, protein: (+f.protein_g || 0) * sh, fat: (+f.fat_g || 0) * sh,
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

  const strip = $("resStrip"); strip.innerHTML = "";   // [추가] 여러 장 분석이면 나머지 사진도 보여 줌
  (current.thumbs || []).slice(1).forEach(t => { const im = document.createElement("img"); im.src = t; im.alt = ""; strip.append(im); });
  strip.classList.toggle("hidden", !(current.thumbs && current.thumbs.length > 1));
  $("resImg").src = current.preview || ""; $("resImg").closest(".res-img").classList.toggle("hidden", !current.preview);
  const cut = $("cut"), lbl = $("cutLabel"), shade = $("shade");
  cut.classList.remove("on"); lbl.classList.remove("on"); shade.style.height = "0";
  $("okBadge").classList.toggle("hidden", !allOk);
  if (!allOk) {
    const y = Math.max(12, Math.min(92, ratio * sh * 100));
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
    add(`이 ${current.title}${josa(current.title, "은", "는")} `); add(current.preview ? `점선까지만(${r0(ratio * 100)}%)` : `${r0(ratio * 100)}%만(약 ${fmt(c.allowed)}kcal)`, true); add(" 먹어야 해! ");
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
  foods.forEach((f, i) => {
    const li = document.createElement("li"), L = document.createElement("div");
    const n = document.createElement("div"); n.className = "nm"; n.textContent = (f.alcohol ? "🍺 " : "") + f.name;
    const lv = f.conf === "high" ? "h" : f.conf === "low" ? "l" : "m";
    const cf = document.createElement("span"); cf.className = "conf " + lv; cf.textContent = { h: "확실", m: "추정", l: "불확실" }[lv]; n.append(cf);
    const s = document.createElement("div"); s.className = "sm"; s.textContent = `약 ${fmt(f.grams)}${f.alcohol ? "ml" : "g"} · 탄 ${r0(f.carbs)}g · 단 ${r0(f.protein)}g · 지 ${r0(f.fat)}g`;
    L.append(n, s);
    const k = document.createElement("div"); k.className = "kc"; k.textContent = fmt(f.kcal) + " kcal";
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", f.name + " 지우기");
    x.onclick = () => removeFood(i);
    const R = document.createElement("div"); R.className = "rt"; R.append(k, x);
    li.append(L, R); ul.append(li);
  });
  const st = current.stat;
  $("aiStat").textContent = st ? `⏱️ ${st.sec.toFixed(1)}초 걸림 · 사용 모델: ${st.model}` + (st.tries > 1 ? ` (다른 모델 ${st.tries - 1}번 실패 후)` : "") : "";
  $("aiNote").textContent = !current.preview ? `📝 적어 준 내용으로 계산했어요: "${current.textInput}" (양이 없으면 보통 1인분 기준)` : r.reference_object ? `📏 기준 물체: ${r.reference_object}` : "📏 기준 물체 없이 그릇 크기로 추정했어요. 숟가락을 옆에 두면 더 정확해져요.";
  renderShareDate();
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

// 음성 입력 (지원하는 브라우저에서만) — 정정 칸과 글 입력 칸 둘 다
[["micBtn", "fixText"], ["txtMic", "txtFood"]].forEach(([btnId, boxId]) => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  const btn = $(btnId); btn.classList.remove("hidden");
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "ko-KR"; rec.interimResults = true;
    rec.onresult = e => { $(boxId).value = Array.from(e.results).map(x => x[0].transcript).join(""); };
    rec.onend = () => { rec = null; btn.classList.remove("on"); };
    rec.onerror = () => { toast("음성을 듣지 못했어요. 키보드의 마이크를 써 보세요"); };
    btn.classList.add("on"); try { rec.start(); } catch (e) { rec = null; btn.classList.remove("on"); }
  };
});

/* ================= 저장 ================= */
async function saveMeal(portion) {
  if (!current || !current.tot) return;
  const { tot, foods, thumb, photo, photos, thumbs, title, alcKcal, late } = current; const c = scanCalc();
  const date = current.date && current.date <= todayKey() ? current.date : todayKey();
  const p = Math.max(0, Math.min(1, portion));
  const meal = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    person: pid, date, ts: date === todayKey() ? Date.now() : new Date(date + "T12:00:00").getTime(), mealType: current.mealType || mealType, title, thumb, photo: photo || null, photos: photos && photos.length > 1 ? photos : null, thumbs: thumbs && thumbs.length > 1 ? thumbs : null, portion: p, share: current.share || 1,
    totalKcal: r0(tot.kcal), eatenKcal: r0(tot.kcal * p), alcoholKcal: r0(alcKcal * p), late: !!late,
    eaten: { carbs: r0(tot.carbs * p), protein: r0(tot.protein * p), fat: r0(tot.fat * p) },
    dailyTarget: r0(c.daily), tdee: r0(c.tdee),
    foods: foods.map(f => ({ name: f.name, grams: r0(f.grams), kcal: r0(f.kcal), alcohol: f.alcohol })),
  };
  try {
    await idb.put(meal);
    const [, mm, dd] = date.split("-").map(Number);
    toast(date !== todayKey() ? `${mm}월 ${dd}일 기록에 저장했어요 📅` : p >= 0.99 && current.ratio < 0.95 ? "기록했어요. 다음 끼니는 가볍게! 😉" : "잘했어요! 식단 기록 저장 완료 💚");
    if (current.textInput) $("txtFood").value = "";
    current = null; showStage("start"); await loadToday(); renderAll();
  } catch (e) { toast("저장에 실패했어요. 다시 눌러 주세요"); }
}
async function deleteMeal(id) {
  try {
    await idb.del(id); await loadToday(); renderAll();
    if ($("v-cal").classList.contains("on")) await renderCalendar();
    toast("기록을 지웠어요");
  } catch (e) { toast("삭제에 실패했어요"); }
}
$("saveAct").onclick = () => {
  const s = num($("actSteps").value), m = num($("actMin").value), rk = num($("runKm").value), rm = num($("runMin").value); const a = {};
  if (rk != null && (rk < 0 || rk > 100)) { toast("달린 거리는 0~100km로 넣어 주세요"); return; }
  if (rm != null && (rm < 0 || rm > 600)) { toast("달린 시간은 0~600분으로 넣어 주세요"); return; }
  if (s != null) a.steps = s; if (m != null) a.minutes = m;
  if (rk) a.runKm = Math.round(rk * 100) / 100; if (rm) a.runMin = rm;
  activity[pid][todayKey()] = a; lsSet("activity", activity); renderAll();
  const run = runBurn(calc().w, a.runKm, a.runMin);
  toast(run > 0 ? `🏃 달리기 약 ${fmt(run)}kcal 소모! 오늘 먹어도 되는 양이 늘었어요` : "오늘 활동량을 반영했어요");
};
// [추가] 달리기 입력하면 소모 칼로리 미리 보여주기
function runPreview() {
  const run = runBurn(calc().w, $("runKm").value, $("runMin").value);
  const km = num($("runKm").value), mn = num($("runMin").value);
  $("runNote").textContent = run > 0 ? `🔥 약 ${fmt(run)}kcal 소모` + (km && mn ? ` · 평균 ${(mn / km).toFixed(1)}분/km` : "") + " — '활동량 반영하기'를 눌러야 저장돼요" : "거리나 시간 중 하나만 적어도 돼요 (거리가 있으면 거리로 계산)";
}
["runKm", "runMin"].forEach(id => $(id).addEventListener("input", runPreview));
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
$("saveKey").onclick = () => { const rawKey = $("apiKey").value; settings.apiKey = rawKey.replace(/[^\x21-\x7E]/g, ""); if (settings.apiKey !== rawKey.trim()) $("apiKey").value = settings.apiKey; settings.model = $("apiModel").value.trim(); lsSet("settings", settings); renderHeader(); toast(settings.apiKey ? "키를 저장했어요" : "키를 지웠어요"); };
$("testKey").onclick = async () => {
  $("saveKey").click(); if (!settings.apiKey) return;
  $("testKey").disabled = true; $("testKey").textContent = "확인 중...";
  $("keyErr").textContent = "";
  if (settings.apiKey.length < 20) { $("keyErr").textContent = "⚠️ API 키가 너무 짧아요. Google AI Studio에서 키 전체를 다시 복사해 넣어 주세요"; $("testKey").disabled = false; $("testKey").textContent = "연결 테스트"; return; }
  const t0 = Date.now();
  try { await gemini([{ text: "한 단어로만 답하세요: 연결" }], { json: false }); const m = aiTrace[aiTrace.length - 1] || settings.workingModel || DEFAULT_MODEL; const sec = ((Date.now() - t0) / 1000).toFixed(1); toast(`연결 성공! (${m})`); $("keyErr").textContent = `✅ 연결 성공 · 사용 모델: ${m} · ${sec}초` + (aiTrace.length > 1 ? `\n(앞서 실패한 모델: ${aiTrace.slice(0, -1).join(", ")})` : ""); }
  catch (e) { toast(aiError(e)); $("keyErr").textContent = "⚠️ " + aiError(e) + (e && e.message ? "\n[자세한 원인] " + String(e.message).slice(0, 220) : ""); }
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
    const ra = (activity[pid] || {})[k] || {};
    const dn = document.createElement("div"); dn.className = "d"; dn.textContent = d + (ra.runKm || ra.runMin ? "🏃" : info?.alcohol ? "🍺" : info?.late ? "🌙" : ""); e.append(dn);
    if (info && info.kcal) {
      // 하루 적정 칼로리(키·체중·나이 기준 목표)를 넘으면 돼지, 안 넘으면 토끼
      const an = document.createElement("div"); an.className = "an"; an.textContent = info.kcal > info.target ? "🐷" : "🐰"; e.append(an);
      const kc = document.createElement("div"); kc.className = "kc"; kc.textContent = fmt(info.kcal); e.append(kc); days++; sum += info.kcal;
    }
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
  $("daySum").textContent = (info.kcal > info.target ? "🐷 적정 칼로리 초과 · " : "🐰 적정 칼로리 이하 · ") + `총 ${fmt(info.kcal)} / 목표 ${fmt(info.target)} kcal (${diff > 0 ? "+" : ""}${fmt(diff)}) · 탄 ${r0(info.carbs)}g · 단 ${r0(info.protein)}g · 지 ${r0(info.fat)}g` + (info.alcohol ? ` · 🍺 ${fmt(info.alcohol)}kcal` : "") + (wt ? ` · 체중 ${wt}kg` : "");
  [...info.meals].sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(m => box.append(mealRow(m, true)));
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
