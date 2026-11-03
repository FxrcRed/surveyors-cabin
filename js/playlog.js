// 试玩记录（网址带 ?log 才开）：页面自己在本机记事件时间线，不往外发任何数据。
// 时间 = 渲染循环累加的 dt（游戏内秒数，不用墙钟）；换天 / 结局会 reload，所以记录存在 sessionStorage，t 接着累加。
// 接口：window.__log 事件数组；__logText() 可读时间线；__logOn(fn) 每条事件发生时回调（无头脚本用来截图）。
// 不带 ?log 时 LOG = null，index.html 里的 `LOG && …` 全部短路，零开销。
export const LOG = /[?&]log\b/.test(location.search) ? (() => {
  const KEY = 'cabin.playlog.v1', ev = [], subs = [];
  let t = 0, nextFps = 10, dts = [];
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) { ev.push(...s.ev); t = s.t; nextFps = Math.ceil(t / 10 + 0.01) * 10; } } catch (e) { /* 读不到就从头记 */ }
  let ctx = null; // index.html 传进来的读状态函数：{ pos, hour, clues }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ ev, t })); } catch (e) { /* 存不了就只留内存 */ } };
  const r1 = (v) => Math.round(v * 10) / 10;
  const hh = (h) => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const api = {
    bind(c) { ctx = c; },
    ev(kind, text) {
      const p = ctx ? ctx.pos() : { x: 0, z: 0, yaw: 0 };
      const e = { t: r1(t), hour: ctx ? r1(ctx.hour()) : 0, kind, text, x: r1(p.x), z: r1(p.z), yaw: Math.round(p.yaw) };
      ev.push(e); save();
      for (const f of subs) { try { f(e); } catch (err) { /* 回调出错不能连累游戏 */ } }
    },
    tick(dt) {
      t += dt; dts.push(dt);
      if (t >= nextFps) {
        dts.sort((a, b) => a - b);
        const mean = dts.reduce((a, b) => a + b, 0) / dts.length, p95 = dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.95))];
        api.ev('fps', `均值 ${Math.round(1 / mean)}fps（${r1(mean * 1000)}ms） P95 ${r1(p95 * 1000)}ms`);
        dts = []; nextFps = t + 10;
      }
    },
  };
  window.__log = ev;
  window.__logOn = (fn) => { subs.push(fn); };
  window.__logText = () => ev.map((e) => `t=${Math.round(e.t)}s ${hh(e.hour)} [${e.kind}] ${e.text} @(${e.x.toFixed(1)},${e.z.toFixed(1)}) 朝${e.yaw}°`).join('\n');
  return api;
})() : null;
