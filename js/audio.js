// 音效（2026-11-02）：环境音（风、大风、林子、雨、窗上的雨、炉火、雷）、脚步（雪 / 湿地 / 土 / 木地板）、开关和拿取的短音
// 素材全是 OpenGameArt 上的 CC0 录音，剪辑脚本 tools/sfx/make_sfx.py，出处 sfx/CREDITS.md
// 浏览器第一次点击 / 按键前不让出声：那一下才建 AudioContext、下载素材（约 870KB）。配音在念时环境音压低（duck）
// 屋里屋外：相机在小屋方框里 = 屋里，屋外那几路（风、林子、雨、雷）过低通、压小，像隔着墙；窗上的雨和炉火只在屋里响
// M 键静音（存 localStorage）
// 背景音乐（2026-11-03）：每天一首，第 3 天那首结局也用；第一次点击后才下载（只下当天那首，约 0.4–0.9MB）；比环境声低，配音念时压得更低；静音键一起关
// 乌鸦叫（birds.js 调 audioCaw）：从远处传来，走屋外那条总线，屋里隔着墙
// 屋旁小溪（11-04）：流水声按离溪中心线的距离，3m 内满、25m 外没有；水轮 15m 内隔几秒吱呀一声（复用 creak，压低音高）。都走屋外总线
import { camera } from './core.js';
import { share, shared } from './state.js';
import { wx, cover } from './weather.js';
import { fire } from './interact.js';
import { sky } from './time-of-day.js';
import { terrain, brookAt } from './terrain.js';

const LOOPS = { wind: 0.5, gale: 0.9, forest: 0.45, rain: 0.8, 'rain-window': 0.5, fire: 0.55, brook: 0.55 }; // 各路满音量
const SHOTS = ['thunder', 'fire-light', 'door-open', 'door-close', 'drawer-open', 'drawer-close', 'stove-open', 'stove-close',
  'click', 'latch', 'creak', 'paper', 'book', 'pick', 'place', 'step-snow', 'step-ice', 'step-wood', 'step-dirt', 'step-wet'];
let ctx = null, master, amb, outBus, outLP, musG, steps = null, muted = false;
const MUSIC_VOL = 0.6, MUSIC_FADE = 6; // 满音量（文件已统一到约 -28 LUFS，乘 0.6 后比林子低约 4dB）、淡入秒数
const CUT_UP = 0.65, CUT_DUCK = 0.6, CUT_FADE = 1.5; // 过场（开场飞行、被带进屋、起床、结局画面）：音乐是主角，满音量 ×1.65、旁白念时只压到 0.6（平时 0.3）、1.5 秒淡入。
// 原来过场全程有旁白，音乐一直压在 0.6 × 0.3（约 -43 LUFS，比旁白低 20dB），又要点了「进入」才下载、再淡入 6 秒，手机上等于没有（11-10 用户：过场的时候没有 bgm）
let music = null, mk = 0, mduck = 1, mcut = 0; // music = { g, src }，mk = 淡入进度 0–1，mcut = 过场程度 0–1
const buf = {}, loop = {}, lv = {}; // lv = 各路当前音量（平滑用）
try { muted = localStorage.getItem('cabinMute') === '1'; } catch { /* 无痕模式 */ }

const raw = {}; // 文件字节：加载页上就先下（audioPreload，不用等点击），点了「进入」只剩解码，音乐跟着开场一起响
const fetchRaw = (n) => raw[n] || (raw[n] = fetch(`sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
const bgmName = () => 'bgm-day' + Math.min(3, Math.max(1, shared.game?.day || 1));
export function audioPreload() { fetchRaw(bgmName()); for (const n of Object.keys(LOOPS)) fetchRaw(n); for (const n of SHOTS) fetchRaw(n); fetchRaw('crow'); }
async function load(n) {
  try { const a = await fetchRaw(n); delete raw[n]; buf[n] = await ctx.decodeAudioData(a); } catch { /* 少一个音就不响 */ }
  return buf[n];
}
function unlock() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume()?.catch?.(() => {}); return; } // iOS 切后台回来是 interrupted，也要 resume
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
  amb = ctx.createGain(); amb.connect(master); // 环境音总线：配音时压低
  outLP = ctx.createBiquadFilter(); outLP.type = 'lowpass'; outLP.frequency.value = 18000; outLP.connect(amb);
  outBus = ctx.createGain(); outBus.connect(outLP);
  musG = ctx.createGain(); musG.gain.value = 0; musG.connect(master);
  const mn = bgmName();
  load(mn).then((b) => { // 先解音乐，再解环境声和短音（解码排队，音乐排第一个）
    if (!b) return;
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = 0.05; s.loopEnd = b.duration - 0.05; // 同环境声：跳过 mp3 首尾补的静音；文件首尾已交叉淡化
    s.connect(musG); s.start(0, 0.05); music = { src: s, name: mn };
  });
  for (const n of Object.keys(LOOPS)) load(n).then((b) => {
    if (!b) return;
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true;
    s.loopStart = 0.06; s.loopEnd = b.duration - 0.06; // mp3 首尾有编码补的静音，跳过它才接得上
    g.gain.value = 0; s.connect(g).connect(n === 'rain-window' || n === 'fire' ? amb : outBus);
    s.start(0, Math.random() * (b.duration - 0.2)); loop[n] = g; lv[n] = 0;
  });
  for (const n of SHOTS) load(n);
  load('crow');
  fetch('sfx/steps.json').then((r) => r.json()).then((j) => { steps = j; }).catch(() => {});
}
for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) addEventListener(ev, unlock, true); // iOS 不把触摸的 pointerdown 当用户操作，要 touchend / click 才放得出声（r3 兼容 #1）
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  muted = !muted; try { localStorage.setItem('cabinMute', muted ? '1' : '0'); } catch { /* 无痕模式 */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
});

// 放一个短音；at/dur = 从文件哪儿开始放多久（脚步合在一个文件里），rate = 音高微调，out = 接到哪条总线
function play(n, vol = 1, { at = 0, dur, rate = 1, delay = 0, out } = {}) {
  const b = ctx && buf[n]; if (!b) return;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = vol;
  s.connect(g).connect(out || master); s.start(ctx.currentTime + delay, at, dur);
  return s;
}
const isIn = (p) => Math.abs(p.x) < 2.4 && Math.abs(p.z) < 2.4 && p.y < 7; // 同 index.html 的 outdoors()，多留 0.1m

// 每帧调：dt 秒；voice = 配音正在念
let inK = 0, duck = 1, boltSeen = -1, thunderAt = -99;
export function audioTick(dt, voice, cut) { // cut：正在过场
  if (!ctx || ctx.state !== 'running') return;
  const c = wx.cur, k = Math.min(1, dt * 1.5), h = sky.hour;
  inK += ((isIn(camera.position) ? 1 : 0) - inK) * Math.min(1, dt * 4);
  duck += ((voice ? 0.4 : 1) - duck) * Math.min(1, dt * 5);
  amb.gain.value = duck;
  mcut += ((cut ? 1 : 0) - mcut) * Math.min(1, dt * (cut ? 4 : 0.5)); // 进过场快、出过场慢慢退回平时的音量（约 4 秒）
  if (music) { mk = Math.min(1, mk + dt / (cut ? CUT_FADE : MUSIC_FADE)); mduck += ((voice ? 0.3 + (CUT_DUCK - 0.3) * mcut : 1) - mduck) * Math.min(1, dt * 3); musG.gain.value = MUSIC_VOL * (1 + CUT_UP * mcut) * mk * mk * mduck; }
  outLP.frequency.value = 18000 * Math.pow(600 / 18000, inK); // 屋里：外面的声音只剩低频
  outBus.gain.value = 1 - 0.55 * inK;
  const day = Math.min(1, Math.max(0, Math.min(h - 5, 20 - h))); // 5–6 点鸟慢慢多起来，19–20 点慢慢没了
  const goal = {
    wind: 0.3 + 0.7 * Math.min(1, c.wind / 1.5),
    gale: Math.min(1, Math.max(0, (c.wind - 1) / 8)),
    forest: day * (1 - 0.6 * c.snow) * (1 - 0.8 * c.rain) * (1 - 0.5 * Math.min(1, c.wind / 4)) * (1 - 0.6 * c.fogK), // 雾里鸟少，林子更静
    rain: c.rain,
    'rain-window': inK * c.rain,
    fire: inK * fire.k,
    brook: brookNear(),
  };
  for (const n in loop) { lv[n] += (goal[n] - lv[n]) * k; loop[n].gain.value = lv[n] * LOOPS[n]; }
  wheelCreak(dt);
  // 雷：weather.js 每打一次闪电往 wx.flashes 推一组；看到新的一组就在 0.4–2.5 秒后响（光比声快），8 秒内只响一次
  const last = wx.flashes.length ? wx.flashes[wx.flashes.length - 1][0] : -1;
  if (last > boltSeen) {
    boltSeen = last;
    if (c.bolt > 0.5 && ctx.currentTime - thunderAt > 8) { thunderAt = ctx.currentTime; play('thunder', 0.9, { delay: 0.4 + Math.random() * 2.1, at: Math.random() * 2, rate: 0.85 + Math.random() * 0.25, out: outBus }); }
  }
}

function brookNear() { // 0–1：离溪多近（家的坐标；第 3 天挪世界后溪在 ✕ 那边很远，自然没声）
  const p = camera.position, d = brookAt(p.x + terrain.ox, p.z + terrain.oz, 26).d, t = Math.min(1, Math.max(0, (d - 3) / 22));
  return (1 - t) * (1 - t);
}
let creakT = 3;
function wheelCreak(dt) {
  const w = shared.brookWheel; if (!w || (creakT -= dt) > 0) return;
  creakT = 4 + Math.random() * 4; if (shared.brookSpin < 0.3) return; // 水轮停着（第 2 天夜里叶片缠了布）：不吱呀
  const m = w.matrixWorld.elements, d = Math.hypot(camera.position.x - m[12], camera.position.z - m[14]); if (d > 15) return;
  play('creak', 0.22 * (1 - d / 15) ** 2, { rate: 0.55 + Math.random() * 0.1, out: outBus });
}

export function wheelGroan(start) { // 水轮被布卡住慢下来 / 清了布重新转起来：轮轴一声长的吱呀，声源在水轮，15m 外听不见（同 wheelCreak）
  const w = shared.brookWheel; if (!ctx || !w) return;
  const m = w.matrixWorld.elements, d = Math.hypot(camera.position.x - m[12], camera.position.z - m[14]); if (d > 15) return;
  play('creak', 0.4 * (1 - d / 15) ** 2, { rate: start ? 0.5 : 0.4, out: outBus });
  play('creak', 0.3 * (1 - d / 15) ** 2, { rate: start ? 0.6 : 0.36, delay: 0.7, out: outBus });
}

// 第一人称每帧调：bob = fp.bob（走一步涨 π），moving = 这帧在走，run = 跑
let stepN = 0;
export function audioStep(bob, moving, run) {
  const n = Math.floor(bob / Math.PI);
  if (n === stepN) return; stepN = n;
  if (!moving || !steps || !ctx) return;
  const p = camera.position, kind = onIce(p) ? 'ice' : isIn(p) ? 'wood' : cover.uSnow.value > 0.5 ? 'snow' : cover.uWet.value > 0.3 ? 'wet' : 'dirt';
  const cuts = steps[kind], [at, dur] = cuts[Math.floor(Math.random() * cuts.length)];
  play('step-' + kind, (run ? 0.55 : 0.4) * (0.85 + Math.random() * 0.3), { at, dur, rate: 0.92 + Math.random() * 0.16 });
}

// 爬梯子（第一人称）：每爬 0.32m 一档，复用木地板脚步、音高拉高、更轻；y = 脚底高度
let rungY = 0;
export function audioRung(y) {
  if (!steps || !ctx) return;
  if (Math.abs(y - rungY) < 0.32) return; rungY = y;
  const [at, dur] = steps.wood[Math.floor(Math.random() * steps.wood.length)] || [0, 0.3];
  play('step-wood', 0.25, { at, dur, rate: 1.25 + Math.random() * 0.15 });
}

// 第 2 天路上的冻溪：踏过那一条冰面才咯吱响（q = 溪中点，t = 踪迹前进方向，溪横过踪迹宽 ±7m、前后各 0.7m）
let ice = null;
export function setIce(qx, qz, tx, tz) { ice = { qx, qz, tx, tz }; }
function onIce(p) {
  if (!ice) return false;
  const dx = p.x - ice.qx, dz = p.z - ice.qz, a = dx * ice.tx + dz * ice.tz, l = dx * -ice.tz + dz * ice.tx;
  return Math.abs(a) < 0.7 && Math.abs(l) < 7;
}
// NPC 爬梯子：characters.js 的 climb 每帧调，pos = 她的位置；隔 0.07 相位一档，离相机 >7m 听不到，相机在屋外几乎听不到
const rungS = new WeakMap();
export function npcRung(p, S) {
  if (!ctx || !steps) return;
  const last = rungS.get(p); if (last != null && Math.abs(S - last) < 0.07) return; rungS.set(p, S);
  const d = camera.position.distanceTo(p.root.position), v = Math.max(0, 1 - d / 7) * (0.05 + 0.95 * inK) * 0.3; if (v < 0.01) return;
  const [at, dur] = steps.wood[Math.floor(Math.random() * steps.wood.length)];
  play('step-wood', v, { at, dur, rate: 1.1 + Math.random() * 0.15 });
}

// 远处的乌鸦叫：birds.js 每只鸟飞过时调；dist = 离相机的距离，越远越小、越闷，屋里再压一层（走 outBus）
export function audioCaw(dist, delay = 0) {
  if (!ctx || !buf.crow) return;
  const v = 0.35 * Math.max(0.15, 1 - dist / 140);
  play('crow', v, { delay, rate: 0.82 + Math.random() * 0.3, out: outBus });
}

// 开关：interact.js 的 toggle() 调（shared.sfxToggle）；on = 切换后的 t.on。大门、卫生间门、炉门的 on = 关上（k=1 关），其余 on = 开
// 关的「咔」落在合上那一刻（延迟 = 动画时长 − 声音里最响处）；快速反向时停掉还没响的上一声
const CLOSED_ON = /^(door_wood|toilet_door_|stove_door)/, pendClose = new Map();
export function sfxToggle(name, on, from) { // from：不是你动的（她开门、开灯、收梯子）就给声源的位置，按离你多远减音量：门 14m、别的 8m 外听不见（11-11 world：原来多远都是满音量）
  if (!ctx) return;
  const far = from ? Math.max(0, 1 - camera.position.distanceTo(from) / (/^door_/.test(name) ? 14 : 8)) : 1; if (far < 0.03) return;
  const prev = pendClose.get(name); if (prev && ctx.currentTime < prev.t) { try { prev.s.stop(); } catch { /* 已停 */ } } pendClose.delete(name);
  const open = CLOSED_ON.test(name) ? !on : on, r = 0.94 + Math.random() * 0.12;
  const sh = (n, v, d) => { const dl = open ? 0 : d, s = play(n, v * far, { rate: r, delay: dl }); if (s && dl) pendClose.set(name, { s, t: ctx.currentTime + dl }); };
  if (/^(door_|toilet_door_|loft_gate)/.test(name)) sh(open ? 'door-open' : 'door-close', 0.7, 0.78);
  else if (/drawer|dining_leaf/.test(name)) sh(open ? 'drawer-open' : 'drawer-close', 0.6, 0.4);
  else if (name === 'stove_door') sh(open ? 'stove-open' : 'stove-close', 0.5, 0.5);
  else if (name === 'stove_fire') { if (on) play('fire-light', 0.7 * far); }
  else if (/light|lamp|lantern|pendant/.test(name)) play('click', 0.5 * far, { rate: r });
  else if (/lid|tap|bail|faucet|kettle/.test(name)) play('latch', 0.5 * far, { rate: r });
  else if (/ladder|rocking/.test(name)) play('creak', 0.6 * far, { rate: r });
}
// 其它短音：paper 翻纸、book 开书、pick 拿起、place 放下
export function sfx(n, vol = 0.6) { play(n, vol, { rate: 0.95 + Math.random() * 0.1 }); }
share({ sfxToggle: () => sfxToggle, sfx: () => sfx, npcRung: () => npcRung });
window.cabinAudio = { get ctx() { return ctx; }, buf, lv, get inK() { return inK; }, get duck() { return duck; }, get music() { return music && { name: music.name, gain: musG.gain.value, mk, mduck, mcut, loop: music.src.loop, loopStart: music.src.loopStart, loopEnd: music.src.loopEnd, dur: music.src.buffer.duration }; }, get muted() { return muted; }, onIce, get ice() { return ice; } }; // 调试 / 无头测试读状态
