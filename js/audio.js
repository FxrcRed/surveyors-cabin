// 音效（2026-11-02）：环境音（风、大风、林子、雨、窗上的雨、炉火、雷）、脚步（雪 / 湿地 / 土 / 木地板）、开关和拿取的短音
// 素材全是 OpenGameArt 上的 CC0 录音，剪辑脚本 tools/sfx/make_sfx.py，出处 sfx/CREDITS.md
// 浏览器第一次点击 / 按键前不让出声：那一下才建 AudioContext、下载素材（约 770KB）。配音在念时环境音压低（duck）
// 屋里屋外：相机在小屋方框里 = 屋里，屋外那几路（风、林子、雨、雷）过低通、压小，像隔着墙；窗上的雨和炉火只在屋里响
// M 键静音（存 localStorage）
import { camera } from './core.js';
import { share } from './state.js';
import { wx, cover } from './weather.js';
import { fire } from './interact.js';
import { sky } from './time-of-day.js';

const LOOPS = { wind: 0.5, gale: 0.9, forest: 0.45, rain: 0.8, 'rain-window': 0.5, fire: 0.55 }; // 各路满音量
const SHOTS = ['thunder', 'fire-light', 'door-open', 'door-close', 'drawer-open', 'drawer-close', 'stove-open', 'stove-close',
  'click', 'latch', 'creak', 'paper', 'book', 'pick', 'place', 'step-snow', 'step-wood', 'step-dirt', 'step-wet'];
let ctx = null, master, amb, outBus, outLP, steps = null, muted = false;
const buf = {}, loop = {}, lv = {}; // lv = 各路当前音量（平滑用）
try { muted = localStorage.getItem('cabinMute') === '1'; } catch { /* 无痕模式 */ }

async function load(n) {
  try { const r = await fetch(`sfx/${n}.mp3`); buf[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* 少一个音就不响 */ }
  return buf[n];
}
function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
  amb = ctx.createGain(); amb.connect(master); // 环境音总线：配音时压低
  outLP = ctx.createBiquadFilter(); outLP.type = 'lowpass'; outLP.frequency.value = 18000; outLP.connect(amb);
  outBus = ctx.createGain(); outBus.connect(outLP);
  for (const n of Object.keys(LOOPS)) load(n).then((b) => {
    if (!b) return;
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true;
    s.loopStart = 0.06; s.loopEnd = b.duration - 0.06; // mp3 首尾有编码补的静音，跳过它才接得上
    g.gain.value = 0; s.connect(g).connect(n === 'rain-window' || n === 'fire' ? amb : outBus);
    s.start(0, Math.random() * (b.duration - 0.2)); loop[n] = g; lv[n] = 0;
  });
  for (const n of SHOTS) load(n);
  fetch('sfx/steps.json').then((r) => r.json()).then((j) => { steps = j; }).catch(() => {});
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, true);
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
}
const isIn = (p) => Math.abs(p.x) < 2.4 && Math.abs(p.z) < 2.4 && p.y < 7; // 同 index.html 的 outdoors()，多留 0.1m

// 每帧调：dt 秒；voice = 配音正在念
let inK = 0, duck = 1, boltSeen = -1, thunderAt = -99;
export function audioTick(dt, voice) {
  if (!ctx || ctx.state !== 'running') return;
  const c = wx.cur, k = Math.min(1, dt * 1.5), h = sky.hour;
  inK += ((isIn(camera.position) ? 1 : 0) - inK) * Math.min(1, dt * 4);
  duck += ((voice ? 0.4 : 1) - duck) * Math.min(1, dt * 5);
  amb.gain.value = duck;
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
  };
  for (const n in loop) { lv[n] += (goal[n] - lv[n]) * k; loop[n].gain.value = lv[n] * LOOPS[n]; }
  // 雷：weather.js 每打一次闪电往 wx.flashes 推一组；看到新的一组就在 0.4–2.5 秒后响（光比声快），8 秒内只响一次
  const last = wx.flashes.length ? wx.flashes[wx.flashes.length - 1][0] : -1;
  if (last > boltSeen) {
    boltSeen = last;
    if (c.bolt > 0.5 && ctx.currentTime - thunderAt > 8) { thunderAt = ctx.currentTime; play('thunder', 0.9, { delay: 0.4 + Math.random() * 2.1, at: Math.random() * 2, rate: 0.85 + Math.random() * 0.25, out: outBus }); }
  }
}

// 第一人称每帧调：bob = fp.bob（走一步涨 π），moving = 这帧在走，run = 跑
let stepN = 0;
export function audioStep(bob, moving, run) {
  const n = Math.floor(bob / Math.PI);
  if (n === stepN) return; stepN = n;
  if (!moving || !steps || !ctx) return;
  const p = camera.position, kind = isIn(p) ? 'wood' : cover.uSnow.value > 0.5 ? 'snow' : cover.uWet.value > 0.3 ? 'wet' : 'dirt';
  const cuts = steps[kind], [at, dur] = cuts[Math.floor(Math.random() * cuts.length)];
  play('step-' + kind, (run ? 0.55 : 0.4) * (0.85 + Math.random() * 0.3), { at, dur, rate: 0.92 + Math.random() * 0.16 });
}

// 开关：interact.js 的 toggle() 调（shared.sfxToggle）；on = 切换后的状态
export function sfxToggle(name, on) {
  if (!ctx) return;
  const r = 0.94 + Math.random() * 0.12;
  if (/^(door_|toilet_door_|loft_gate)/.test(name)) play(on ? 'door-open' : 'door-close', 0.7, { rate: r });
  else if (/drawer|dining_leaf/.test(name)) play(on ? 'drawer-open' : 'drawer-close', 0.6, { rate: r });
  else if (name === 'stove_door') play(on ? 'stove-open' : 'stove-close', 0.5, { rate: r });
  else if (name === 'stove_fire') { if (on) play('fire-light', 0.7); }
  else if (/light|lamp|lantern|pendant/.test(name)) play('click', 0.5, { rate: r });
  else if (/lid|tap|bail|faucet|kettle/.test(name)) play('latch', 0.5, { rate: r });
  else if (/ladder|rocking/.test(name)) play('creak', 0.6, { rate: r });
}
// 其它短音：paper 翻纸、book 开书、pick 拿起、place 放下
export function sfx(n, vol = 0.6) { play(n, vol, { rate: 0.95 + Math.random() * 0.1 }); }
share({ sfxToggle: () => sfxToggle, sfx: () => sfx });
window.cabinAudio = { get ctx() { return ctx; }, buf, lv, get inK() { return inK; }, get duck() { return duck; } }; // 调试 / 无头测试读状态
