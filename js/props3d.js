// 手作质感的软物件：纸张（桌上信纸、炉内信纸）、古书（书架上的工作日志）+ 点一下飞到画面前看（2026-10-30）
// 全部程序生成（canvas 纹理 + three.js 几何），不带外部素材文件、没有授权问题；纹理 ≤512px，只在需要时才建。
// 飞出来：物体从原位飞到相机前方，书会翻开几页；卡片关掉再飞回去。index.html 的 select() 调 inspectStart / inspectRelease。
import * as THREE from 'three';
import { scene, camera, lang } from './core.js';
import { indoorShade } from './time-of-day.js';
import { shared } from './state.js';

const rngOf = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// ——— 纸：底色 + 大片色斑 + 纤维 + 边缘发黄 + 细噪点；另出一张灰度凹凸（纤维和噪点）———
function grain(x, W, H, R, amp) {
  const im = x.getImageData(0, 0, W, H), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  x.putImageData(im, 0, 0);
}
function fibres(x, W, H, R, n, light, dark, sc = 1) {
  for (let i = 0; i < n; i++) {
    const px = R() * W, py = R() * H, a = R() * 6.28, len = (5 + R() * 18) * Math.min(sc, 1.6);
    x.strokeStyle = R() < 0.5 ? light : dark; x.lineWidth = 0.6 + R() * 0.7;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (R() - 0.5) * 6, py + Math.sin(a) * len * 0.5 + (R() - 0.5) * 6, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
  }
}
function paperBase(W, H, tone, seed, rough = 1, sc = 1) { // sc：画布像素 / 逻辑像素（逻辑尺寸下的色斑、霉点、边缘大小不变，纤维和颗粒按真实像素画，放大看更细）
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed), w = W / sc, h = H / sc;
  x.save(); x.scale(sc, sc);
  x.fillStyle = tone; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { x.fillStyle = R() < 0.6 ? `rgba(120,86,44,${0.02 + R() * 0.05 * rough})` : `rgba(255,248,226,${0.03 + R() * 0.06})`; x.beginPath(); x.arc(R() * w, R() * h, 8 + R() * 60, 0, 7); x.fill(); }
  for (let i = 0; i < 6 * rough; i++) { const px = R() * w, py = R() * h, r = 6 + R() * 16; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(110,70,30,${0.18 + R() * 0.2})`); g.addColorStop(1, 'rgba(110,70,30,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); } // 霉点
  const e = Math.min(w, h) * 0.09; // 边缘发黄、发暗
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, h], [w, 0, w - e, 0, w - e, 0, e, h], [0, 0, 0, e, 0, 0, w, e], [0, h, 0, h - e, 0, h - e, w, e]]) {
    const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(92,60,28,.30)'); g.addColorStop(1, 'rgba(92,60,28,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
  }
  x.restore();
  fibres(x, W, H, R, Math.round(900 * sc * sc), 'rgba(255,250,235,.10)', 'rgba(90,64,36,.08)', sc);
  grain(x, W, H, R, 14);
  return c;
}
export const agedPaper = (W, H, tone, seed, rough = 1, sc = 1) => paperBase(W, H, tone, seed, rough, sc);
function bumpCanvas(W, H, seed, amp = 70, sc = 1) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed + 101);
  x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
  fibres(x, W, H, R, Math.round(1400 * sc * sc), 'rgba(255,255,255,.35)', 'rgba(0,0,0,.35)', sc); grain(x, W, H, R, amp);
  return c;
}
// 手写字：一个字一个字画，基线慢慢漂、字号和斜度各不同、墨色由深到浅（每个词重新蘸墨）、笔画边上洇开一点；✕ 画成两笔。lines：字符串数组
export function handwrite(x, lines, { x0, y0, size, pitch, ink = '28,26,50', R, slant = 0.1, bleed = 0.035 }) {
  x.save(); x.textBaseline = 'alphabetic'; x.shadowColor = `rgba(${ink},.55)`; x.shadowBlur = size * bleed;
  lines.forEach((ln, li) => {
    const sz = size * (0.95 + R() * 0.1), y = y0 + li * pitch, ph = R() * 6; let px = x0 + (R() - 0.3) * size * 0.4, drift = (R() - 0.5) * size * 0.12;
    x.font = `italic ${sz}px "IM Fell English", Georgia, serif`;
    for (const word of ln.split(' ')) {
      let load = 0.84 + R() * 0.14;
      for (const ch of word) {
        drift += (R() - 0.5) * size * 0.02; const w = x.measureText(ch).width, gy = y + drift + Math.sin(px * 0.011 + ph) * size * 0.035;
        x.fillStyle = `rgba(${ink},${Math.min(1, load * (0.92 + R() * 0.1)).toFixed(2)})`;
        if (ch === '✕') { x.save(); x.shadowBlur = 0; x.strokeStyle = x.fillStyle; x.lineWidth = size * 0.1; x.lineCap = 'round'; x.beginPath(); x.moveTo(px, gy - size * 0.55); x.lineTo(px + size * 0.52, gy + size * 0.02); x.moveTo(px + size * 0.55, gy - size * 0.58); x.lineTo(px + size * 0.04, gy); x.stroke(); x.restore(); px += size * 0.72; continue; }
        x.save(); x.translate(px, gy); x.transform(1, 0, -slant + (R() - 0.5) * 0.1, 1, 0, 0); x.rotate((R() - 0.5) * 0.07); x.scale(0.96 + R() * 0.08, 0.93 + R() * 0.14); x.fillText(ch, 0, 0); x.restore();
        px += w * (0.97 + R() * 0.07); load *= 0.988;
      }
      px += size * (0.26 + R() * 0.1);
    }
  });
  x.restore();
}

// 稽查的签名（2026-11-11 r2 情节 #3）：夜里签字、石堆上的炭笔字、✕ 那页页脚都是这同一笔。控制点单位宽 1、y 朝下，Catmull-Rom 连成曲线（= 一串三次贝塞尔）；
// 往下写的笔画重、往上写的轻，起笔收笔细，整体右斜。两笔：大写起笔的花体 + 一串越写越小的连笔波浪（认不出字母：稽查在故事里没有名字），底下一道往回勾的下划线。sigDraw(x, o, a, b) 只画时间进度 a…b 那一段（0…1，两笔之间抬笔停一下），一笔笔动画就是每帧接着画新的一段
const SIG = [[[0.13, 0.13], [0.075, 0.05], [0.025, 0.12], [0.075, 0.2], [0.17, 0.13], [0.15, 0.04], [0.1, 0.15], [0.085, 0.34], [0.135, 0.33], [0.19, 0.26], [0.235, 0.23], [0.27, 0.3], [0.31, 0.235], [0.345, 0.295], [0.38, 0.245], [0.41, 0.29], [0.44, 0.255], [0.465, 0.285], [0.49, 0.262], [0.51, 0.28], [0.53, 0.268], [0.6, 0.265]],
  [[0.72, 0.31], [0.66, 0.4], [0.42, 0.44], [0.18, 0.44], [0.09, 0.41], [0.115, 0.37]]];
let sigPts = null;
function sigSample() { // [[x, y, 粗细, 结束时刻], …] 每笔一组；时刻按弧长算，两笔之间空 0.15
  if (sigPts) return sigPts;
  let T = 0; sigPts = SIG.map((st, si) => {
    const P = [st[0], ...st, st[st.length - 1]], o = [];
    for (let i = 1; i < P.length - 2; i++) { const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]], n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.004));
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; o.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3))); } }
    o.push(st[st.length - 1]);
    let L = 0; for (let i = 1; i < o.length; i++) L += Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]);
    if (si) T += 0.15; let s = 0;
    const rows = o.map((p, i) => { const q = o[i - 1] || p, d = Math.hypot(p[0] - q[0], p[1] - q[1]); s += d; return [p[0], p[1], (0.45 + 0.55 * Math.max(0, d ? (p[1] - q[1]) / d : 0)) * Math.min(1, s / 0.03, (L - s) / 0.06 + 0.15), T + s]; });
    T += L; return rows;
  });
  sigPts.T = T; return sigPts;
}
export function sigDraw(x, { x0, y0, w, ink = '28,26,50', lw = 0.016, slant = 0.22 }, a = 0, b = 1) {
  const S = sigSample(), t0 = a * S.T, t1 = b >= 1 ? Infinity : b * S.T, X = (p) => x0 + (p[0] - slant * (p[1] - 0.3)) * w, Y = (p) => y0 + p[1] * w;
  x.save(); x.strokeStyle = `rgb(${ink})`; x.lineCap = 'round';
  for (const st of S) for (let i = 1; i < st.length; i++) { const p = st[i]; if (p[3] < t0 || p[3] >= t1) continue; x.lineWidth = Math.max(0.8, lw * w * p[2]); x.beginPath(); x.moveTo(X(st[i - 1]), Y(st[i - 1])); x.lineTo(X(p), Y(p)); x.stroke(); }
  x.restore();
}

// 一张纸：纸的纹理 + 画内容的回调 draw(ctx, W, H, R)；几何带一点卷曲、折痕、翘起的角，不是平面。res = 纹理宽（电脑 1024、手机 768，近看字迹才清楚；draw 回调的坐标一律按 1024 宽写）；
// folds = [['h'|'v', 0…1], …] 折痕画进颜色和凹凸；wrinkle = 皱纹条数。m.userData.repaint()：字体晚到时重画（颜色图换新画布）
export function paperMesh(w, h, { seed = 1, tone = '#d9cdb0', draw, cutout = false, curl = 0.004, crease = 0, res = matchMedia('(pointer:coarse)').matches ? 768 : 1024, folds = [], wrinkle = 0 } = {}) {
  const W = res, H = Math.round(W * h / w), sc = W / 512, BW = res / 2, BH = Math.round(BW * h / w), bump = bumpCanvas(BW, BH, seed, 70, BW / 256), R0 = rngOf(seed + 303);
  const bx = bump.getContext('2d'), X = (u) => u * BW, Y = (v) => v * BH, seg = (g, A, B, wd) => { g.lineWidth = wd; g.beginPath(); g.moveTo(X(A[0]), Y(A[1])); g.lineTo(X(B[0]), Y(B[1])); g.stroke(); };
  const mk = [], rw = []; // 折痕和皱纹的位置只算一次，颜色图每次重画都一样
  for (const [ax, p] of folds) mk.push([ax, p + (R0() - 0.5) * 0.01]);
  for (let i = 0; i < wrinkle; i++) { const a = R0() * 6.28, L = 0.06 + R0() * 0.16; rw.push([R0(), R0(), Math.cos(a) * L, Math.sin(a) * L * w / h, 0.05 + R0() * 0.07]); }
  for (const [ax, p] of mk) { const A = ax === 'h' ? [0, p] : [p, 0], B = ax === 'h' ? [1, p] : [p, 1], d = ax === 'h' ? [0, 0.004] : [0.004, 0]; // 凹凸图：折痕一道暗一道亮，皱纹一条亮一条暗
    bx.strokeStyle = 'rgba(0,0,0,.55)'; seg(bx, A, B, BW / 170); bx.strokeStyle = 'rgba(255,255,255,.5)'; seg(bx, [A[0] + d[0], A[1] + d[1]], [B[0] + d[0], B[1] + d[1]], BW / 170); }
  for (const [u, v, dx, dy, o] of rw) { bx.strokeStyle = `rgba(255,255,255,${o * 4})`; seg(bx, [u, v], [u + dx, v + dy], BW / 300); bx.strokeStyle = `rgba(0,0,0,${o * 4})`; seg(bx, [u + 0.004, v + 0.004], [u + dx + 0.004, v + dy + 0.004], BW / 300); }
  const paint = () => {
    const c = paperBase(W, H, tone, seed, 1, sc), x = c.getContext('2d'), R = rngOf(seed + 7);
    if (crease) { // 中间一条竖线折痕：一边亮一边暗
      x.fillStyle = 'rgba(40,26,12,.22)'; x.fillRect(W / 2 - 1, 0, 2, H); x.fillStyle = 'rgba(255,250,235,.28)'; x.fillRect(W / 2 + 1, 0, 2, H);
      const g = x.createLinearGradient(W / 2 - 40 * sc, 0, W / 2 + 40 * sc, 0); g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(0.5, 'rgba(60,40,20,.12)'); g.addColorStop(1, 'rgba(60,40,20,0)'); x.fillStyle = g; x.fillRect(W / 2 - 40 * sc, 0, 80 * sc, H);
    }
    for (const [ax, p] of mk) { // 折过的纸：折线两侧一道淡淡的暗带、折线上磨白一点
      const v = ax === 'v', L = (v ? W : H) * p, T = 14 * sc, g = v ? x.createLinearGradient(L - T, 0, L + T, 0) : x.createLinearGradient(0, L - T, 0, L + T);
      g.addColorStop(0, 'rgba(70,46,22,0)'); g.addColorStop(0.5, 'rgba(70,46,22,.16)'); g.addColorStop(1, 'rgba(70,46,22,0)'); x.fillStyle = g; v ? x.fillRect(L - T, 0, T * 2, H) : x.fillRect(0, L - T, W, T * 2);
      x.fillStyle = 'rgba(236,224,196,.5)'; v ? x.fillRect(L - sc * 0.6, 0, sc * 1.2, H) : x.fillRect(0, L - sc * 0.6, W, sc * 1.2);
    }
    for (const [u, v, dx, dy, o] of rw) { x.lineWidth = sc * 1.2; x.strokeStyle = `rgba(60,40,18,${o})`; x.beginPath(); x.moveTo(u * W, v * H); x.lineTo((u + dx) * W, (v + dy) * H); x.stroke(); x.strokeStyle = `rgba(255,248,226,${o * 1.2})`; x.beginPath(); x.moveTo(u * W + sc * 1.5, v * H + sc * 1.5); x.lineTo((u + dx) * W + sc * 1.5, (v + dy) * H + sc * 1.5); x.stroke(); }
    x.save(); x.scale(W / 1024, W / 1024); draw?.(x, 1024, Math.round(1024 * h / w), R); x.restore(); return c; // draw 一律按 1024 宽的坐标写，手机 768 的画布自动缩
  };
  const nx = 24, ny = Math.max(12, Math.round(24 * h / w)), geo = new THREE.PlaneGeometry(w, h, nx, ny), p = geo.attributes.position, ph = R0() * 6;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w, v = p.getY(i) / h; // −0.5…0.5
    let z = curl * (1.6 * u * u - 0.3) + curl * 0.35 * Math.sin(v * 5 + ph) * Math.cos(u * 4 + ph); // 整张微微拱起 + 低频起伏
    z += curl * 1.4 * Math.pow(Math.max(0, u + v), 3) * 2; // 一只角翘起
    if (crease) z += crease * (Math.abs(u) - 0.25); // 折痕：中间凹下去，两边略抬
    for (const [ax, q] of mk) { const d = Math.abs(ax === 'v' ? u + 0.5 - q : 0.5 - v - q); z -= 0.0004 * Math.max(0, 1 - d * 14); } // 折线处浅浅凹下去
    p.setZ(i, z);
  }
  geo.computeVertexNormals();
  const map = tex(paint()), m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, bumpMap: tex(bump, false), bumpScale: 1.4, roughness: 0.93, side: THREE.DoubleSide, alphaTest: cutout ? 0.5 : 0, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0 })); // 自发光平时是 0；飞到眼前时调高（applyView），夜里屋里暗也读得清。一开始就带着 emissiveMap，别中途加（会换着色器程序、卡一下）
  m.userData.repaint = () => { map.image = paint(); map.needsUpdate = true; };
  m.receiveShadow = true; return m;
}

// ——— 皮革：暗褐底 + 斑驳 + 细颗粒皮纹 + 磨出浅色绒面的角和边 + 水渍；front 压框线和标签，spine 画凸起的书脊带、横向细裂、掉了一半金的字 ———
// 画布按 256 宽的逻辑尺寸画（sc = W / 256），分辨率提高时框线、标签位置不变，颗粒按真实像素画（放大看更细）
function leatherCanvas(W, H, seed, kind) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed), sc = W / (kind === 'spine' ? 64 : 256), w = W / sc, h = H / sc;
  x.save(); x.scale(sc, sc);
  x.fillStyle = '#4b2c1a'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { x.fillStyle = R() < 0.55 ? `rgba(18,8,3,${0.05 + R() * 0.12})` : `rgba(160,104,56,${0.04 + R() * 0.08})`; x.beginPath(); x.arc(R() * w, R() * h, 5 + R() * 34, 0, 7); x.fill(); }
  for (let i = 0; i < 30; i++) { x.strokeStyle = `rgba(200,150,100,${0.1 + R() * 0.2})`; x.lineWidth = 0.8; x.beginPath(); const px = R() * w, py = R() * h; x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 60, py + (R() - 0.5) * 60); x.stroke(); } // 划痕
  const ink = 'rgba(14,6,2,.55)', gold = 'rgba(176,138,70,.55)';
  if (kind === 'front') {
    x.strokeStyle = ink; x.lineWidth = 3; x.strokeRect(22, 22, w - 44, h - 44); x.lineWidth = 1.5; x.strokeRect(34, 34, w - 68, h - 68);
    x.strokeStyle = gold; for (const [cx, cy] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) { x.beginPath(); x.arc(cx, cy, 12, 0, 7); x.stroke(); }
    const lw = w * 0.6, lh = h * 0.2, lx = (w - lw) / 2, ly = h * 0.26; // 贴的纸标签：旧纸色，边角翘起发暗，一角撕掉
    const lg = x.createLinearGradient(lx, ly, lx + lw, ly + lh); lg.addColorStop(0, '#cbb88a'); lg.addColorStop(1, '#b9a273'); x.fillStyle = lg;
    x.beginPath(); x.moveTo(lx, ly); x.lineTo(lx + lw - 9, ly); x.lineTo(lx + lw - 3, ly + 7); x.lineTo(lx + lw, ly + 5); x.lineTo(lx + lw, ly + lh); x.lineTo(lx, ly + lh); x.closePath(); x.fill();
    for (let i = 0; i < 18; i++) { x.fillStyle = `rgba(110,74,36,${0.05 + R() * 0.1})`; x.beginPath(); x.arc(lx + R() * lw, ly + R() * lh, 2 + R() * 9, 0, 7); x.fill(); }
    x.strokeStyle = 'rgba(70,44,20,.5)'; x.lineWidth = 1; x.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
    x.strokeStyle = 'rgba(40,24,10,.8)'; x.lineWidth = 2; x.strokeRect(lx + 5, ly + 5, lw - 10, lh - 10);
    x.fillStyle = 'rgba(38,22,10,.92)'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `${Math.round(w * 0.085)}px "IM Fell English SC", Georgia, serif`; x.fillText('FIELD LOG', w / 2, ly + lh / 2);
    x.strokeStyle = gold; x.lineWidth = 2; x.beginPath(); x.moveTo(w * 0.3, h * 0.64); x.lineTo(w * 0.7, h * 0.64); x.moveTo(w * 0.38, h * 0.67); x.lineTo(w * 0.62, h * 0.67); x.stroke();
    const rx = w * (0.55 + R() * 0.15), ry = h * (0.72 + R() * 0.1), rr = w * 0.13; // 杯底的水渍：一圈深色的环，环里稍浅
    x.strokeStyle = 'rgba(16,7,2,.22)'; x.lineWidth = 3; x.beginPath(); x.ellipse(rx, ry, rr, rr * 0.93, 0.3, 0.4, 6.0); x.stroke();
    x.fillStyle = 'rgba(150,100,62,.07)'; x.beginPath(); x.ellipse(rx, ry, rr * 0.9, rr * 0.84, 0.3, 0, 7); x.fill();
    for (let i = 0; i < 9; i++) { const y0 = R() * h; x.strokeStyle = `rgba(12,5,1,${0.2 + R() * 0.2})`; x.lineWidth = 0.7 + R(); x.beginPath(); x.moveTo(2 + R() * 4, y0); x.quadraticCurveTo(9, y0 + (R() - 0.5) * 20, 14 + R() * 6, y0 + (R() - 0.5) * 30); x.stroke(); } // 靠书脊的折痕
  } else if (kind === 'spine') {
    for (const f of [0.1, 0.3, 0.7, 0.9]) { const y = h * f; x.fillStyle = 'rgba(14,6,2,.5)'; x.fillRect(0, y - 6, w, 12); x.fillStyle = 'rgba(190,140,86,.28)'; x.fillRect(0, y - 6, w, 3); x.fillStyle = gold; x.fillRect(0, y - 1, w, 2); }
    x.save(); x.translate(w / 2, h * 0.5); x.rotate(Math.PI / 2); x.fillStyle = 'rgba(205,176,108,.8)'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `${Math.round(w * 0.34)}px "IM Fell English SC", Georgia, serif`; x.fillText('FIELD LOG', 0, 0); x.restore();
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(40,20,8,${0.4 + R() * 0.5})`; x.fillRect(w * (0.25 + R() * 0.5), h * (0.32 + R() * 0.36), 0.6 + R() * 1.6, 0.6 + R() * 2.5); } // 金字磨掉一半
    for (let i = 0; i < 26; i++) { const y = R() * h; x.strokeStyle = `rgba(10,4,1,${0.25 + R() * 0.3})`; x.lineWidth = 0.4 + R() * 0.6; x.beginPath(); x.moveTo(R() * w * 0.3, y); x.lineTo(w * (0.6 + R() * 0.4), y + (R() - 0.5) * 3); x.stroke(); } // 来回翻开的横向细裂
  }
  // 磨损：四角和边磨出浅色绒面（书口那边、下沿最重：手拿和书架上拖出拖进）
  const scuff = (px, py, r, a) => { const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(164,112,70,${a})`); g.addColorStop(0.6, `rgba(150,100,62,${a * 0.4})`); g.addColorStop(1, 'rgba(150,100,62,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); };
  if (kind !== 'spine') for (const [cx, cy, k] of [[w, 0, 1], [w, h, 1], [0, 0, 0.5], [0, h, 0.6]]) for (let i = 0; i < 5; i++) scuff(cx + (R() - 0.5) * 18, cy + (R() - 0.5) * 18, 10 + R() * 26 * k, 0.25 + R() * 0.3 * k);
  for (let i = 0; i < 40; i++) { const t = R(), side = R() * 4 | 0, p = side < 2 ? [side ? w : 0, t * h] : [t * w, side === 2 ? 0 : h]; scuff(p[0], p[1], 3 + R() * 9, 0.18 + R() * 0.25); }
  const e = 14; for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, h], [w, 0, w - e, 0, w - e, 0, e, h], [0, 0, 0, e, 0, 0, w, e], [0, h, 0, h - e, 0, h - e, w, e]]) { // 边角磨白
    const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(176,128,84,.45)'); g.addColorStop(1, 'rgba(176,128,84,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
  }
  x.restore();
  pebble(x, W, H, R, 0.16);
  return c;
}
function pebble(x, W, H, R, a) { // 皮纹：一粒粒压扁的小鼓包（上亮下暗），按真实像素画
  const n = W * H / 9;
  for (let i = 0; i < n; i++) { const px = R() * W, py = R() * H, r = 0.8 + R() * 1.6; x.fillStyle = `rgba(0,0,0,${R() * a})`; x.fillRect(px, py + r * 0.5, r * 1.4, r); x.fillStyle = `rgba(255,214,170,${R() * a * 0.4})`; x.fillRect(px, py - r * 0.4, r * 1.2, r * 0.7); }
}
let lBump = null;
function leatherBump() { // 凹凸：皮纹颗粒 + 横竖几道折痕（四块皮共用一张）
  if (lBump) return lBump;
  const c = mkCanvas(256, 256), x = c.getContext('2d'), R = rngOf(48);
  x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = R() < 0.5 ? 0 : 255; x.fillStyle = `rgba(${v},${v},${v},${0.12 + R() * 0.2})`; x.beginPath(); x.arc(R() * 256, R() * 256, 0.7 + R() * 1.5, 0, 7); x.fill(); }
  for (let i = 0; i < 14; i++) { x.strokeStyle = `rgba(0,0,0,${0.2 + R() * 0.3})`; x.lineWidth = 0.6 + R(); x.beginPath(); let px = R() * 256, py = R() * 256; x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (R() - 0.5) * 40; py += (R() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  return (lBump = tex(c, false));
}
const leatherMat = (W, H, seed, kind) => new THREE.MeshStandardMaterial({ map: tex(leatherCanvas(W, H, seed, kind)), bumpMap: leatherBump(), bumpScale: 2.4, roughness: 0.62 });
function edgeCanvas(vertical, seed, dust) { // 书页切口：一张张纸的边，疏密、深浅不一，偶尔一张探出来（亮）；两头靠封面处、顶上积灰发暗，几点霉斑。另出一张凹凸
  const S = 256, c = mkCanvas(S, S), x = c.getContext('2d'), b = mkCanvas(S, S), y = b.getContext('2d'), R = rngOf(seed);
  x.fillStyle = '#cbb688'; x.fillRect(0, 0, S, S); y.fillStyle = '#808080'; y.fillRect(0, 0, S, S);
  const line = (ctx, p, wd) => vertical ? ctx.fillRect(p, 0, wd, S) : ctx.fillRect(0, p, S, wd);
  for (let p = 0; p < S; p += 1 + R() * 2.2) {
    const lit = R() < 0.06; x.fillStyle = lit ? `rgba(240,226,190,${0.4 + R() * 0.3})` : `rgba(80,56,28,${0.08 + R() * 0.26})`; line(x, p, lit ? 1.5 : 0.8 + R() * 0.6);
    y.fillStyle = lit ? 'rgba(255,255,255,.55)' : `rgba(0,0,0,${0.15 + R() * 0.3})`; line(y, p, lit ? 1.5 : 0.8);
  }
  const G = (a0, a1, col) => { const g = vertical ? x.createLinearGradient(a0, 0, a1, 0) : x.createLinearGradient(0, a0, 0, a1); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  for (const [a0, a1] of [[0, 30], [S, S - 30]]) { x.fillStyle = G(a0, a1, 'rgba(70,46,22,.45)'); x.fillRect(0, 0, S, S); } // 靠封面两头发暗
  if (dust) { x.fillStyle = 'rgba(96,84,66,.22)'; x.fillRect(0, 0, S, S); for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(70,60,46,${R() * 0.25})`; x.beginPath(); x.arc(R() * S, R() * S, 2 + R() * 8, 0, 7); x.fill(); } } // 顶上落灰
  for (let i = 0; i < 7; i++) { const px = R() * S, py = R() * S, r = 2 + R() * 6, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(120,76,34,.45)'); g.addColorStop(1, 'rgba(120,76,34,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); } // 霉斑
  return [c, b];
}
function edgeMat(vertical, seed, dust) { const [c, b] = edgeCanvas(vertical, seed, dust); return new THREE.MeshStandardMaterial({ map: tex(c), bumpMap: tex(b, false), bumpScale: 1.5, roughness: 0.95 }); }
function slab(w, h, d, rc) { // 书板：外形圆角矩形（书口那边两个角磨圆 rc），边缘倒圆；材质组照 BoxGeometry 的面序：0 侧边、4 = +z 面、5 = −z 面
  const b = 0.0008, X0 = -w / 2 + b, X1 = w / 2 - b, Y0 = -h / 2 + b, Y1 = h / 2 - b, r = rc - b, s = new THREE.Shape();
  s.moveTo(X0, Y0); s.lineTo(X1 - r, Y0); s.quadraticCurveTo(X1, Y0, X1, Y0 + r); s.lineTo(X1, Y1 - r); s.quadraticCurveTo(X1, Y1, X1 - r, Y1); s.lineTo(X0, Y1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * b) / 2);
  const P = g.attributes.position.array, B = [[], [], []], a = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < P.length / 9; t++) { const o = t * 9; a.set(P[o], P[o + 1], P[o + 2]); e1.set(P[o + 3], P[o + 4], P[o + 5]).sub(a); e2.set(P[o + 6], P[o + 7], P[o + 8]).sub(a); const nz = e1.cross(e2).normalize().z; B[nz > 0.9 ? 1 : nz < -0.9 ? 2 : 0].push(t); }
  const pos = [], uv = [], out = new THREE.BufferGeometry(); let at = 0;
  B.forEach((list, k) => { for (const t of list) for (let v = 0; v < 3; v++) { const o = t * 9 + v * 3, px = P[o], py = P[o + 1], pz = P[o + 2]; pos.push(px, py, pz); uv.push(k ? (px + w / 2) / w : (px + py) / (w + h) + 0.5, k ? (py + h / 2) / h : pz / d + 0.5); }
    out.addGroup(at, list.length * 3, [0, 4, 5][k]); at += list.length * 3; });
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.computeVertexNormals(); g.dispose();
  return out;
}
let cornerG = null;
function cornerGeo() { // 包角的黄铜片：一个圆了角的三角，比书板厚一点包住两面；角尖在原点，往 −x、−y 伸
  if (cornerG) return cornerG;
  const L = 0.024, r = 0.0028, o = 0.0009, t = BD + 0.0011, s = new THREE.Shape();
  s.moveTo(-L, o); s.lineTo(o - r, o); s.quadraticCurveTo(o, o, o, o - r); s.lineTo(o, -L); s.quadraticCurveTo(-L * 0.42, -L * 0.42, -L, o);
  cornerG = new THREE.ExtrudeGeometry(s, { depth: t - 0.0006, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 1, curveSegments: 5 }); cornerG.translate(0, 0, -(t - 0.0006) / 2);
  return cornerG;
}
// ——— 黄铜：底色 + 氧化发暗的斑（偏褐绿、更粗糙）+ 沿一个方向的细划痕 + 磨亮的地方；另出粗糙度图（绿通道）。dark = [[v0, v1], …] 这几段 v 是缝里，更暗 ———
function brassCanvas(W, H, seed, dark = []) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), r = mkCanvas(W, H), y = r.getContext('2d'), R = rngOf(seed);
  x.fillStyle = '#b8914f'; x.fillRect(0, 0, W, H); y.fillStyle = 'rgb(96,96,96)'; y.fillRect(0, 0, W, H);
  const blob = (ctx, px, py, rr, col) => { const g = ctx.createRadialGradient(px, py, 0, px, py, rr); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); ctx.fillStyle = g; ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2); };
  for (let i = 0; i < 70; i++) { const px = R() * W, py = R() * H, rr = 3 + R() * Math.max(W, H) * 0.07, a = 0.12 + R() * 0.3; blob(x, px, py, rr, `rgba(62,48,24,${a})`); blob(y, px, py, rr, `rgba(190,190,190,${a})`); }
  for (const [v0, v1] of dark) { const y0 = (1 - v1) * H, hh = (v1 - v0) * H; x.fillStyle = 'rgba(52,38,18,.55)'; x.fillRect(0, y0, W, hh); y.fillStyle = 'rgba(200,200,200,.6)'; y.fillRect(0, y0, W, hh); }
  for (let i = 0; i < 14; i++) blob(x, R() * W, R() * H, 6 + R() * 20, `rgba(236,206,140,${0.12 + R() * 0.15})`); // 手摸得多、磨亮的地方
  for (let i = 0; i < 260; i++) { const px = R() * W, py = R() * H, l = 6 + R() * W * 0.18, a = R() * 0.25; x.strokeStyle = `rgba(240,214,150,${a})`; x.lineWidth = 0.5 + R() * 0.6; x.beginPath(); x.moveTo(px, py); x.lineTo(px + l, py + (R() - 0.5) * 2); x.stroke(); y.strokeStyle = `rgba(160,160,160,${a})`; y.beginPath(); y.moveTo(px, py); y.lineTo(px + l, py); y.stroke(); }
  grain(x, W, H, R, 10);
  return [c, r];
}
function brassMat(W, H, seed, dark, extra = {}) { const [c, r] = brassCanvas(W, H, seed, dark); return new THREE.MeshStandardMaterial({ map: tex(c), roughnessMap: tex(r, false), roughness: 1, metalness: 0.9, ...extra }); }
function endpaper() { // 衬页：旧纸色 + 墨水大理石纹（几条褐色弧线）
  const c = paperBase(256, 340, '#b9996a', 31, 1.4), x = c.getContext('2d'), R = rngOf(3);
  for (let i = 0; i < 26; i++) { x.strokeStyle = `rgba(${60 + R() * 40 | 0},${34 + R() * 20 | 0},${20},${0.1 + R() * 0.16})`; x.lineWidth = 2 + R() * 5; x.beginPath(); let px = R() * 256, py = R() * 340; x.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (R() - 0.3) * 80; py += (R() - 0.5) * 60; x.lineTo(px, py); } x.stroke(); }
  return c;
}

// ——— 书页：IM Fell 斜体手写感文字，越往后越乱 ———
function pageCanvas(lines, no, seed, zh) {
  const W = 384, H = 512, c = paperBase(W, H, '#d7c699', seed), x = c.getContext('2d'), R = rngOf(seed * 7919 + no * 104729);
  const mess = Math.min(1, no / 8); // 前面工整，后面潦草
  x.strokeStyle = 'rgba(120,90,50,.14)'; x.lineWidth = 1; for (let y = 64; y < H - 50; y += 23) { x.beginPath(); x.moveTo(30, y + 3); x.lineTo(W - 30, y + 3); x.stroke(); }
  x.fillStyle = 'rgba(36,24,14,.88)'; x.textBaseline = 'alphabetic';
  let y = 64;
  for (const ln of lines) {
    x.font = zh ? '17px "Huiwen Mincho", serif' : 'italic 17px "IM Fell English", Georgia, serif';
    let px = 34 + R() * 4 * mess; const words = zh ? [...ln] : ln.split(' ');
    for (const wd of words) {
      const t = zh ? wd : wd + ' '; x.save(); x.translate(px, y + (R() - 0.5) * (1 + mess * 4)); x.rotate((R() - 0.5) * 0.04 * (1 + mess * 2)); x.globalAlpha = 0.78 + R() * 0.2; x.fillText(t, 0, 0); x.restore(); px += x.measureText(t).width;
    }
    y += 23;
  }
  if (!lines.length) { // 空页：测绘员随手画的：等高线圈、计数的竖杠、一个指北箭头
    x.strokeStyle = 'rgba(44,30,18,.55)'; x.lineWidth = 1.2;
    const cx = 120 + R() * 140, cy = 150 + R() * 120;
    for (let k = 0; k < 4; k++) { x.beginPath(); for (let t = 0; t <= 24; t++) { const a = t / 24 * 6.283, r = (22 + k * 17) * (1 + 0.18 * Math.sin(a * 3 + no) + (R() - 0.5) * 0.06); x[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r); } x.closePath(); x.stroke(); }
    for (let g = 0; g < 3; g++) for (let i = 0; i < 5; i++) { x.beginPath(); const bx = 50 + g * 34 + i * 5, by = 400 + R() * 3; x.moveTo(bx, by); x.lineTo(bx + (R() - 0.5) * 2, by + 24); x.stroke(); }
    x.beginPath(); x.moveTo(300, 420); x.lineTo(300, 380); x.lineTo(294, 392); x.moveTo(300, 380); x.lineTo(306, 392); x.stroke();
    const g2 = x.createRadialGradient(290, 90, 0, 290, 90, 20 + R() * 10); g2.addColorStop(0, 'rgba(30,18,10,.5)'); g2.addColorStop(1, 'rgba(30,18,10,0)'); x.fillStyle = g2; x.fillRect(250, 50, 80, 80); // 墨点
  }
  x.fillStyle = 'rgba(70,48,26,.6)'; x.font = '12px "IM Fell English", serif'; x.textAlign = 'center'; x.fillText(String(no), W / 2, H - 22);
  return c;
}
function paginate(text, zh) { // 切成每页 ≤ 17 行
  const c = mkCanvas(8, 8).getContext('2d'); c.font = zh ? '17px "Huiwen Mincho", serif' : 'italic 17px "IM Fell English", Georgia, serif';
  const maxW = 384 - 70, lines = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let cur = ''; const unit = zh ? [...para] : para.split(' ');
    for (const u of unit) { const t = cur ? (zh ? cur + u : cur + ' ' + u) : u; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = u; } else cur = t; }
    if (cur) lines.push(cur);
  }
  const per = Math.min(17, Math.max(1, Math.ceil(lines.length / 2))), pages = []; // 字摊成两页：翻完停在第 6、7 页（合起的书从「他停笔的地方」翻开），前面几页是随手画的
  for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
  return pages;
}

// ——— 书：合上时立在书架上（书脊朝外）；本地坐标：书脊在 −x，封面朝 +z，向上 +y ———
const BW = 0.15, BH = 0.21, BT = 0.042, BD = 0.004, OV = 0.004, NLEAF = 4; // 页宽 / 高 / 总厚 / 板厚 / 封面探出 / 翻动的叶数
const Z0 = -BT / 2 + BD, ZTOP = BT / 2 - BD, LEAF_E = 0.0007;
const BOOK_HOME = { p: new THREE.Vector3(-0.7, 1.41 + 0.0008 + (BH + OV * 2) / 2, -1.6), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)) };
const pickable = (g, m) => { g.add(m); shared.meshes.push(m); m.receiveShadow = true; return m; };
let book = null;
function pageBlock(w, h, d) { // 书芯：书口微微凹进去（书脊鼓出来那一面的对面）、一沓沓纸的边参差不齐
  const N = 12, g = new THREE.BoxGeometry(w, h, d, 1, 6, N), p = g.attributes.position, R = rngOf(77), J = [], K = [];
  for (let i = 0; i <= N; i++) { J.push(R() * 0.0006); K.push(R() * 0.0007); }
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = z / (d / 2), k = Math.round((z / d + 0.5) * N);
    if (x > w / 2 - 1e-6) p.setX(i, x - 0.0014 * (1 - s * s) - J[k]);
    if (Math.abs(y) > h / 2 - 1e-6) p.setY(i, y - Math.sign(y) * K[k]); }
  g.computeVertexNormals(); return g;
}
export function makeBook() {
  if (book || !shared.layers) return;
  const root = new THREE.Group(); root.name = 'field_log'; root.position.copy(BOOK_HOME.p); root.quaternion.copy(BOOK_HOME.q);
  const hi = !matchMedia('(pointer:coarse)').matches; // 封面飞到眼前占小半个画面：电脑 512 宽，手机 256
  const front = leatherMat(hi ? 512 : 256, hi ? 720 : 360, 41, 'front'), back = leatherMat(256, 360, 43, 'back'), side = leatherMat(128, 128, 47, 'plain'), spineM = leatherMat(128, 512, 49, 'spine'), endM = new THREE.MeshStandardMaterial({ map: tex(endpaper()), roughness: 0.9 });
  const board = () => slab(BW + OV, BH + OV * 2, BD, 0.0045); // 材质组同 BoxGeometry：0 侧边、4 = +z、5 = −z
  const brass = brassMat(128, 128, 53, [], { metalness: 0.85 }); for (const t of [brass.map, brass.roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); } // 包角 UV 是米：2cm ≈ 一张
  const corners = (m) => { for (const sy of [1, -1]) { const k = new THREE.Mesh(cornerGeo(), brass); k.position.set((BW + OV) / 2, sy * (BH / 2 + OV), 0); k.scale.y = sy; m.add(k); } }; // 书口一侧上下两个角包铜
  // 后封面：外面 −z 是皮革，里面 +z 是衬页
  const bb = pickable(root, new THREE.Mesh(board(), [side, side, side, side, endM, back])); bb.position.set(OV / 2, 0, -BT / 2 + BD / 2); corners(bb);
  const sp = pickable(root, new THREE.Mesh(new THREE.CylinderGeometry(BT / 2, BT / 2, BH + OV * 2, 14, 1, true, Math.PI, Math.PI), spineM)); sp.position.set(-BW / 2, 0, 0); sp.scale.set(0.6, 1, 1); sp.material.side = THREE.DoubleSide;
  const band = new THREE.LatheGeometry([[-0.0002, -0.003], [0.0009, -0.0018], [0.0013, 0], [0.0009, 0.0018], [-0.0002, 0.003]].map(([dr, y]) => new THREE.Vector2(BT / 2 + dr, y)), 14, Math.PI, Math.PI);
  for (const f of [0.1, 0.3, 0.7, 0.9]) { const m = new THREE.Mesh(band, side); m.position.y = (0.5 - f) * (BH + OV * 2); sp.add(m); } // 书脊上凸起的竹节（和贴图上画的带子同位置）
  const fore = edgeMat(true, 5), top = edgeMat(false, 7, true), blockMats = [fore, fore, top, top, new THREE.MeshStandardMaterial({ visible: false }), new THREE.MeshStandardMaterial({ color: '#bda878', roughness: 0.95 })]; // 书脊那面看不见、底面贴着书架：和对面共用一张
  const bk = ZTOP - Z0, blk = pickable(root, new THREE.Mesh(pageBlock(BW - 0.002, BH - 0.004, bk), blockMats)); blk.position.set(0.001, 0, (Z0 + ZTOP) / 2);
  // 前封面：绕书脊转。外面 +z 是压花皮革，里面 −z 是衬页
  const cover = new THREE.Group(); cover.name = 'field_log'; cover.position.set(-BW / 2, 0, ZTOP); root.add(cover);
  const fc = pickable(cover, new THREE.Mesh(board(), [side, side, side, side, front, endM])); fc.position.set((BW + OV) / 2, 0, BD / 2); corners(fc);
  // 翻动的叶：正面（+z）一页，背面一页；贴图打开时才建
  const leaves = [];
  for (let i = 0; i < NLEAF; i++) {
    const g = new THREE.Group(); g.name = 'field_log'; g.position.set(-BW / 2 + 0.002, 0, ZTOP - i * LEAF_E); root.add(g);
    const geo = new THREE.PlaneGeometry(BW - 0.008, BH - 0.008, 8, 1); geo.translate((BW - 0.008) / 2, 0, 0);
    const mf = new THREE.MeshStandardMaterial({ color: '#d7c699', roughness: 0.92 }), mb = new THREE.MeshStandardMaterial({ color: '#d7c699', roughness: 0.92, side: THREE.BackSide });
    pickable(g, new THREE.Mesh(geo, mf)); pickable(g, new THREE.Mesh(geo, mb));
    leaves.push({ g, geo, mf, mb, base: geo.attributes.position.array.slice() });
  }
  scene.add(root); shared.layers.set('field_log', root); indoorShade(root);
  book = { root, cover, leaves, key: '', A: { open: 0, cover: 0, l: new Array(NLEAF).fill(0) } };
  applyBook();
}
function fillPages(txt, zh) { // 把整段文字按页贴到各叶的正反面
  const key = (zh ? 'z' : 'e') + txt.length; if (book.key === key) return; book.key = key;
  const pages = paginate(txt, zh);
  book.leaves.forEach((L, i) => {
    for (const [mat, no, flip] of [[L.mf, 2 * i + 1, false], [L.mb, 2 * i + 2, true]]) {
      const ln = no === 6 ? pages[0] || [] : no === 7 ? pages[1] || [] : [], c = pageCanvas(ln, no, 61 + i, zh);
      if (no === 7 && pages.length > 2) { const x = c.getContext('2d'); x.fillStyle = 'rgba(36,24,14,.8)'; x.font = 'italic 17px "IM Fell English", serif'; x.fillText('…', 34, 64 + 23 * 17); }
      mat.map?.dispose(); const t = tex(c); if (flip) { t.repeat.x = -1; t.offset.x = 1; } mat.map = t; mat.color.set('#ffffff'); mat.needsUpdate = true;
    }
  });
}
const sm = (t) => t * t * (3 - 2 * t);
function applyBook() {
  const { A, cover, leaves } = book;
  cover.rotation.y = -A.cover * Math.PI * 0.985; cover.position.z = ZTOP + (Z0 + BD - ZTOP) * sm(A.cover);
  leaves.forEach((L, i) => {
    const a = A.l[i], s = sm(a); L.g.rotation.y = -s * Math.PI * 0.975;
    L.g.position.z = ZTOP - i * LEAF_E + ((Z0 + BD + (i + 1) * 0.0012) - (ZTOP - i * LEAF_E)) * s;
    const bend = Math.sin(Math.PI * a) * 0.045, p = L.geo.attributes.position, w = BW - 0.008; // 翻的时候自由边落在后面、弯一点
    if (a > 0.001 && a < 0.999) { for (let k = 0; k < p.count; k++) p.setZ(k, bend * Math.pow(L.base[k * 3] / w, 2)); } else for (let k = 0; k < p.count; k++) p.setZ(k, 0);
    p.needsUpdate = true;
  });
}

// ——— 怀表（阁楼床头柜抽屉里）：带盖的猎表壳。本地坐标：表盘朝 +y、12 点朝 −z、3 点朝 +x，表壳底在 y = 0；全部车削几何 + canvas 贴图，约 5 千面 ———
// 抽屉里盖着盖；飞到眼前时盖子弹开（pose(f)），整只表侧过来一点好看见盖里。指针由 index.html 的 watchSet() 转（pivot 的 rotation.y）
const WR = 0.024, DIAL_Y = 0.008; // 表盘半径、表盘高度
function dialCanvas(S) { // 釉面表盘：罗马数字、铁轨分钟圈、6 点小秒盘；发黄的边、细碎的釉裂和一道发丝裂
  const c = mkCanvas(S, S), x = c.getContext('2d'), R = rngOf(317), m = S / 2, u = S / 256;
  const bg = x.createRadialGradient(m, m * 0.9, 0, m, m, m); bg.addColorStop(0, '#f4eedd'); bg.addColorStop(0.72, '#ede3c9'); bg.addColorStop(1, '#cdb889');
  x.fillStyle = bg; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) { const px = R() * S, py = R() * S, r = (10 + R() * 40) * u, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(160,124,70,${0.04 + R() * 0.08})`); g.addColorStop(1, 'rgba(160,124,70,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  x.strokeStyle = 'rgba(110,90,60,.16)'; x.lineWidth = 0.5 * u;
  for (let i = 0; i < 50; i++) { const a = R() * 6.283, d = Math.sqrt(R()) * 0.95 * m; let px = m + Math.cos(a) * d, py = m + Math.sin(a) * d; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (R() - 0.5) * 16 * u; py += (R() - 0.5) * 16 * u; x.lineTo(px, py); } x.stroke(); }
  x.strokeStyle = 'rgba(70,55,35,.4)'; x.lineWidth = 0.7 * u; x.beginPath(); // 发丝裂：从 8 点的边往中间
  for (let k = 0; k <= 14; k++) { const t = k / 14, a = 4.05 + Math.sin(t * 9) * 0.04 + t * 0.25, d = m * (0.99 - t * 0.6); x[k ? 'lineTo' : 'moveTo'](m + Math.cos(a) * d + (R() - 0.5) * 2 * u, m + Math.sin(a) * d + (R() - 0.5) * 2 * u); }
  x.stroke();
  x.save(); x.translate(m, m); const ink = 'rgba(26,21,16,.94)';
  x.strokeStyle = ink; x.fillStyle = ink; const r1 = 0.885 * m, r2 = 0.94 * m;
  for (const r of [r1, r2]) { x.lineWidth = 1.1 * u; x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); }
  x.lineWidth = 0.6 * u; x.beginPath(); x.arc(0, 0, 0.975 * m, 0, 7); x.stroke();
  for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283, f = i % 5 === 0; x.lineWidth = (f ? 2.2 : 0.9) * u; x.beginPath(); x.moveTo(Math.sin(a) * r1, -Math.cos(a) * r1); x.lineTo(Math.sin(a) * r2, -Math.cos(a) * r2); x.stroke();
    if (f) { x.beginPath(); x.arc(Math.sin(a) * (r2 + 0.018 * m), -Math.cos(a) * (r2 + 0.018 * m), 1.1 * u, 0, 7); x.fill(); } }
  const N = ['XII', 'I', 'II', 'III', 'IIII', 'V', '', 'VII', 'VIII', 'IX', 'X', 'XI']; // 老表 4 点写 IIII；6 点让给小秒盘
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `${Math.round(0.2 * m)}px "IM Fell English", Georgia, serif`;
  N.forEach((t, i) => { if (!t) return; x.save(); x.rotate(i / 12 * 6.283); x.translate(0, -0.7 * m); const wd = x.measureText(t).width, k = Math.min(1, 0.3 * m / wd); x.scale(k * 0.92, 1.12); x.fillText(t, 0, 0); x.restore(); });
  const sy = 0.44 * m, sr = 0.2 * m; // 小秒盘：微微下沉（内圈一圈阴影）
  const sg = x.createRadialGradient(0, sy, sr * 0.6, 0, sy, sr); sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(90,70,40,.18)'); x.fillStyle = sg; x.beginPath(); x.arc(0, sy, sr, 0, 7); x.fill();
  x.fillStyle = ink; x.lineWidth = 0.8 * u; x.beginPath(); x.arc(0, sy, sr, 0, 7); x.stroke();
  for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283, l = i % 5 ? 0.08 : 0.16; x.lineWidth = (i % 5 ? 0.5 : 1) * u; x.beginPath(); x.moveTo(Math.sin(a) * sr, sy - Math.cos(a) * sr); x.lineTo(Math.sin(a) * sr * (1 - l), sy - Math.cos(a) * sr * (1 - l)); x.stroke(); }
  x.font = `${Math.round(0.06 * m)}px "IM Fell English", Georgia, serif`;
  for (const n of [10, 20, 30, 40, 50, 60]) { const a = n / 60 * 6.283; x.fillText(String(n), Math.sin(a) * sr * 0.66, sy - Math.cos(a) * sr * 0.66); }
  x.restore();
  const eg = x.createRadialGradient(m, m, m * 0.86, m, m, m); eg.addColorStop(0, 'rgba(120,96,58,0)'); eg.addColorStop(1, 'rgba(120,96,58,.35)'); x.fillStyle = eg; x.fillRect(0, 0, S, S); // 边上积灰发暗
  grain(x, S, S, R, 6);
  return c;
}
function lidCanvas(W, H) { // 表盖车削贴图：上半张 = 盖外（v 0.5→1，往中心）机刻的麦粒纹，正中被手指磨平；下半张 = 盖里，抛光面上一圈圈细划痕
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(611), h2 = H / 2;
  x.fillStyle = '#b8914f'; x.fillRect(0, 0, W, H);
  for (let y = 4; y < h2 * 0.86; y += 2.2) for (const [col, dy] of [['rgba(250,222,160,.32)', 0], ['rgba(60,42,18,.3)', 1.1]]) { // 麦粒纹：一圈圈波浪线，相邻两圈错开半个波
    x.strokeStyle = col; x.lineWidth = 0.9; x.beginPath();
    for (let px = 0; px <= W; px += 4) { const py = y + dy + 1.6 * Math.sin(px / W * 6.283 * 28 + y * 0.9); px ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
  const wear = x.createLinearGradient(0, 0, 0, h2 * 0.35); wear.addColorStop(0, 'rgba(200,164,98,.92)'); wear.addColorStop(1, 'rgba(200,164,98,0)'); x.fillStyle = wear; x.fillRect(0, 0, W, h2 * 0.35); // 中心磨平
  x.fillStyle = 'rgba(60,44,20,.5)'; x.fillRect(0, h2 * 0.86, W, 2); // 花纹和光边之间一道刻线
  for (let i = 0; i < 70; i++) { const y = h2 + R() * h2, px = R() * W, l = 20 + R() * W * 0.4; x.strokeStyle = `rgba(${R() < 0.5 ? '240,214,150' : '70,52,24'},${R() * 0.3})`; x.lineWidth = 0.6; x.beginPath(); x.moveTo(px, y); x.lineTo(px + l, y); x.stroke(); }
  for (let i = 0; i < 40; i++) { const px = R() * W, py = R() * H, r = 3 + R() * 18, g = x.createRadialGradient(px, py, 0, px, py, r), a = 0.1 + R() * 0.3; g.addColorStop(0, `rgba(62,48,24,${a})`); g.addColorStop(1, 'rgba(62,48,24,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  grain(x, W, H, R, 10);
  return c;
}
function glassRough() { // 表蒙的粗糙度：干净处很光，几块指纹和擦痕糊一点
  const c = mkCanvas(128, 128), x = c.getContext('2d'), R = rngOf(29);
  x.fillStyle = 'rgb(10,10,10)'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9; i++) { const px = 20 + R() * 88, py = 20 + R() * 88, r = 8 + R() * 14, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(90,90,90,.7)'); g.addColorStop(1, 'rgba(90,90,90,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  x.strokeStyle = 'rgba(120,120,120,.5)'; x.lineWidth = 0.6; for (let i = 0; i < 12; i++) { const px = R() * 128, py = R() * 128; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 40, py + (R() - 0.5) * 10); x.stroke(); }
  return c;
}
function handGeo(L, w, sec) { // 指针（平放的形状，朝 −z）：时、分针是蓝钢「月牙」针（杆 + 空心圆 + 尖 + 根部圆），秒针是细针带尾
  const circ = (cx, cy, r, hole) => { const s = new THREE.Shape(); s.absarc(cx, cy, r, 0, 6.2832, false); if (hole) { const p = new THREE.Path(); p.absarc(cx, cy, hole, 0, 6.2832, true); s.holes.push(p); } return s; };
  const poly = (pts) => new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  let S;
  if (sec) S = [poly([[-w * 0.6, -L * 0.3], [w * 0.6, -L * 0.3], [w * 0.25, L], [-w * 0.25, L]]), circ(0, 0, w * 1.6)];
  else { const rc = L * 0.64, rr = w * 1.55;
    S = [poly([[-w * 0.5, -L * 0.15], [w * 0.5, -L * 0.15], [w * 0.3, rc - rr * 0.85], [-w * 0.3, rc - rr * 0.85]]), circ(0, rc, rr, rr * 0.58), poly([[-w * 0.42, rc + rr * 0.85], [w * 0.42, rc + rr * 0.85], [0, L]]), circ(0, 0, w * 1.3), circ(0, -L * 0.15, w * 0.7)]; }
  const g = new THREE.ShapeGeometry(S, 6); g.rotateX(-Math.PI / 2); return g;
}
export function watchModel() {
  const coarse = matchMedia('(pointer:coarse)').matches, V2 = (a) => a.map(([r, y]) => new THREE.Vector2(r, y));
  const w = new THREE.Group(), body = new THREE.Group(); w.add(body);
  const caseP = [[0, 0], [0.009, 0.00035], [0.016, 0.0012], [0.0215, 0.0025], [0.0252, 0.004], [0.0268, 0.0053], [0.0272, 0.0063], [0.027, 0.0073], [0.0263, 0.008], [0.0266, 0.0086], [0.0262, 0.0094], [0.0251, 0.0099], [0.0243, 0.0096], [0.0241, DIAL_Y]];
  const caseM = brassMat(coarse ? 256 : 512, coarse ? 64 : 128, 71, [[0.58, 0.66], [0.9, 1]]); // 表圈和表盘边上的缝里发暗
  body.add(new THREE.Mesh(new THREE.LatheGeometry(V2(caseP), 56), caseM));
  const S = coarse ? 512 : 1024, dc = dialCanvas(S), dt = tex(dc);
  document.fonts?.load('40px "IM Fell English"').then(() => { dc.getContext('2d').drawImage(dialCanvas(S), 0, 0); dt.needsUpdate = true; }, () => {}); // 字体到了重画罗马数字
  const dialM = new THREE.MeshStandardMaterial({ map: dt, roughness: 0.28, emissive: 0xffffff, emissiveMap: dt, emissiveIntensity: 0 });
  const dial = new THREE.Mesh(new THREE.CircleGeometry(WR, 56), dialM); dial.rotation.x = -Math.PI / 2; dial.position.y = DIAL_Y; body.add(dial);
  const steel = new THREE.MeshStandardMaterial({ color: 0x1b2340, metalness: 0.75, roughness: 0.28 }); // 烤蓝的钢针
  const hand = (g, y, cz = 0) => { const p = new THREE.Group(); p.add(new THREE.Mesh(g, steel)); p.position.set(0, DIAL_Y + y, cz); body.add(p); return p; };
  const hands = [hand(handGeo(WR * 0.52, 0.0012), 0.0005), hand(handGeo(WR * 0.8, 0.0009), 0.0009), hand(handGeo(WR * 0.19, 0.00035, true), 0.0003, WR * 0.44)]; // 时针、分针、6 点小秒盘的秒针
  const capM = brassMat(64, 32, 73); const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0009, 0.0014, 10), capM); cap.position.y = DIAL_Y + 0.0009; body.add(cap);
  const gs = 0.1649, gTop = 0.0114; // 表蒙：一片低拱的玻璃（球冠），只加反光（黑底加法混合：映出屋里的灯和窗，边上更亮）
  const glass = new THREE.Mesh(new THREE.SphereGeometry(gs, 48, 4, 0, 6.2832, 0, Math.asin(0.0243 / gs)), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, roughnessMap: tex(glassRough(), false), metalness: 0, envMapIntensity: 4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glass.position.y = gTop - gs; glass.renderOrder = 1; body.add(glass);
  // 表把：柄（车削）+ 一圈竖纹的冠 + 挂环（椭圆的弓，两头插在柄的两侧）
  const trim = brassMat(128, 64, 79, [], {});
  const pend = new THREE.Mesh(new THREE.LatheGeometry(V2([[0.0032, 0], [0.003, 0.0012], [0.0024, 0.0026], [0.0026, 0.003], [0.0026, 0.004]]), 16), trim); pend.rotation.x = -Math.PI / 2; pend.position.set(0, 0.0063, -0.0262); body.add(pend);
  const cg = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0034, 32, 1), cp = cg.attributes.position;
  for (let i = 0; i < cp.count; i++) { const px = cp.getX(i), pz = cp.getZ(i), r = Math.hypot(px, pz); if (r < 1e-5) continue; const k = (1 - 0.07 * (0.5 + 0.5 * Math.cos(Math.atan2(pz, px) * 16))); cp.setX(i, px * k); cp.setZ(i, pz * k); }
  cg.computeVertexNormals(); const crown = new THREE.Mesh(cg, trim); crown.rotation.x = Math.PI / 2; crown.position.set(0, 0.0063, -0.0319); body.add(crown);
  const ba = 0.0072, bb = 0.0088, dl = Math.asin(0.0026 / ba), bg = new THREE.TorusGeometry(ba, 0.001, 8, 40, Math.PI * 2 - 2 * dl);
  bg.rotateZ(Math.PI / 2 + dl); bg.scale(1, bb / ba, 1); bg.rotateX(Math.PI / 2); bg.translate(0, 0, -0.0367 + 0.0285);
  const bow = new THREE.Mesh(bg, trim), bowP = new THREE.Group(); bowP.position.set(0, 0.0063, -0.0285); bowP.rotation.x = -0.3; bowP.add(bow); body.add(bowP); // 平放时弓往下搭在抽屉底
  // 盖：铰链在 9 点（−x），盖外麦粒纹、盖里抛光；3 点有个指甲扣
  const lidP = [[0, 0.0036], [0.008, 0.0034], [0.015, 0.0028], [0.021, 0.0018], [0.0255, 0.0006], [0.0266, 0.0001], [0.0274, 0], [0.0272, 0.0004], [0.0255, 0.0012], [0.021, 0.0024], [0.015, 0.0034], [0.008, 0.004], [0, 0.0042]];
  const lc = lidCanvas(coarse ? 256 : 512, coarse ? 128 : 256), lidM = new THREE.MeshStandardMaterial({ map: tex(lc), bumpMap: tex(lc, false), bumpScale: 1.2, metalness: 0.9, roughness: 0.38 });
  const lid = new THREE.Group(); lid.position.set(-0.0272, 0.0099, 0); body.add(lid);
  const lm = new THREE.Mesh(new THREE.LatheGeometry(V2(lidP), 56), lidM); lm.position.x = 0.0272; lid.add(lm);
  const nail = new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.0008, 0.0032), trim); nail.position.set(0.0272 * 2 + 0.0004, 0.0003, 0); lid.add(nail);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.0075, 10), trim); hinge.rotation.x = Math.PI / 2; hinge.position.set(-0.0272, 0.0099, 0); body.add(hinge);
  const brassAll = [caseM, capM, trim, lidM];
  w.traverse((o) => { if (o.isMesh && o !== glass) o.castShadow = o.receiveShadow = true; });
  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2); }; // 弹开：略过头再回来
  w.userData.pose = (f) => { // f：0 在抽屉里（盖上），1 在眼前（盖开 105°，整只往右下挪一点让盖子也进画面）
    lid.rotation.z = 1.83 * smooth((f - 0.5) / 0.5);
    body.position.set(0.019 * f, 0, 0.007 * f);
    for (const m of brassAll) m.envMapIntensity = 1 + 0.8 * f; // 举到眼前：多映一点屋里的光
  };
  w.userData.frame = [0.088, 0.072, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.35).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))), 0.03]; // 看的时候侧过来 20°，看得见翻开的盖里；最后一项是侧过来后朝镜头凸出的半厚（近裁面要让开），看得见翻开的盖里
  return { w, hands, dial: dialM };
}

// ——— 飞出来 / 飞回去 ———
const tw = [], cbs = []; let clock = 0;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const go = (o, k, v, dur, delay = 0) => tw.push({ o, k, v, dur, at: clock + delay, a: null });
const after = (delay, fn) => cbs.push({ at: clock + delay, fn });
let V = null; // 正在看的：{ kind, name, g, home:{p,q}, read:{p,q}, f（0 在原位，1 在相机前）, busy, onHome }
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const SIDE = matchMedia('(min-aspect-ratio: 11/10)'); // 横屏（电脑、手机横屏）一套，竖屏一套；两套都是纸在上、字幕在下（index.html #card.side）
// 占画面宽、高的比例上限；中心在画面上的位置（-1…1）。纸、书居中当主角，下面留一行字幕的地方（11-11 Fable 评审 A2：原来旁边一张带框卡片比纸还抢眼）。
// book：翻开的日志；solo：一页纸；main / mate：夜里她写的那页和下午那页的淡影并排（「一字不差，只多几行」让玩家自己比）
const SHORT = matchMedia('(min-aspect-ratio: 11/10) and (max-height: 500px)'); // 手机横屏：高只有 ~340px，纸再小一点给两三行字幕让位
const LAY = { wide: { book: [0.7, 0.8, 0, 0.2], solo: [0.5, 0.86, 0, 0.2], main: [0.44, 0.82, 0.2, 0.2], mate: [0.3, 0.62, -0.42, 0.26] },
  short: { book: [0.62, 0.66, 0, 0.3], solo: [0.5, 0.74, 0, 0.24], main: [0.36, 0.66, 0.2, 0.3], mate: [0.28, 0.56, -0.42, 0.3] },
  tall: { book: [0.92, 0.42, 0, 0.42], solo: [1.0, 0.62, 0, 0.28], main: [0.9, 0.6, 0.32, 0.3], mate: [0.6, 0.46, -0.53, 0.32] } };
function readPose(wd, ht, mQ, slot = 'book', dz = 0) { // 相机前方：纸/书停在画面中上部，下面是字幕（LAY）；mQ = 网格自己的朝向（要抵消）；dz = 物体朝镜头凸出的半厚（放大前，侧着的怀表）
  const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect), tv = Math.tan(vf / 2), th = Math.tan(hf / 2);
  const [fw, fh, nx, ny] = LAY[SHORT.matches ? 'short' : SIDE.matches ? 'wide' : 'tall'][slot];
  const d0 = Math.max(slot === 'book' ? 0.3 : 0.12, ht / (fh * 2 * tv), wd / (fw * 2 * th)), d = Math.max(d0, (camera.near + 0.06) / Math.max(0.3, 1 - dz / d0)), sc = d / d0; // 纸要拉近到 ~0.16m 才够大；near 大时（不在屋里判定内）停在 near 外、按比例放大，看起来一样大
  const q = camera.quaternion.clone().multiply(_q.setFromEuler(_e.set(slot === 'book' ? -0.22 : -0.1, 0, 0))); // 纸几乎正对镜头
  const fwd = _v.set(0, 0, -1).applyQuaternion(camera.quaternion).clone();
  const p = camera.position.clone().addScaledVector(fwd, d).addScaledVector(_v.set(1, 0, 0).applyQuaternion(camera.quaternion), nx * d * th).addScaledVector(_v.set(0, 1, 0).applyQuaternion(camera.quaternion), ny * d * tv);
  return { p, q: mQ ? q.multiply(mQ.clone().invert()) : q, sc };
}
function applyView() {
  if (!V) return;
  if (V.homeOf) V.homeOf(V.home); // 怀表的原位跟着抽屉（飞的时候抽屉还在滑出来）
  const f = V.f, g = V.g; V.read = readPose(V.spec[0], V.spec[1], V.spec[2], V.slot, V.dz); // 每帧按当前相机重算：看的时候相机还在惯性转动，书 / 纸始终在画面中央
  g.position.lerpVectors(V.home.p, V.read.p, f); g.quaternion.slerpQuaternions(V.home.q, V.read.q, f);
  g.position.y += Math.sin(Math.PI * f) * 0.08; // 飞的时候先抬一下
  if (V.kind === 'paper') g.children[0].material.emissiveIntensity = 0.5 * f; // 举到灯下看
  else if (V.dial) V.dial.emissiveIntensity = 0.5 * f;
  V.onF?.(f); // 怀表：盖子跟着弹开
  V.hs ??= g.scale.x; g.scale.setScalar(V.hs * (1 + (V.read.sc - 1) * f) * (1 + ((V.big || 1) - 1) * f)); // hs：原来的缩放；big：比纸再大一圈（表只有 5cm）
  if (V.mate) { const r = readPose(...V.mspec, 'mate'), m = V.mate; m.visible = f > 0.02; m.children[0].material.opacity = 0.62 * f; // 淡影：从同一处飞出来，停在左边
    m.position.lerpVectors(V.home.p, r.p, f); m.quaternion.slerpQuaternions(V.home.q, r.q, f); m.children[0].material.emissiveIntensity = 0.5 * f; V.ms ??= m.scale.x; m.scale.setScalar(V.ms * (1 + (r.sc - 1) * f)); m.position.y += Math.sin(Math.PI * f) * 0.08; }
  if (V.kind === 'book') g.position.addScaledVector(_v.set(1, 0, 0).applyQuaternion(V.read.q), (BW / 2) * book.A.open * f);
}
export function inspectTick(dt) {
  if (!tw.length && !cbs.length) return;
  clock += dt;
  for (const w of tw) { if (clock < w.at) continue; if (w.a === null) w.a = w.o[w.k]; const u = Math.min(1, (clock - w.at) / w.dur); w.o[w.k] = w.a + (w.v - w.a) * easeIO(u); if (u >= 1) w.done = true; }
  for (let i = tw.length - 1; i >= 0; i--) if (tw[i].done) tw.splice(i, 1);
  for (let i = cbs.length - 1; i >= 0; i--) if (clock >= cbs[i].at) { const c = cbs.splice(i, 1)[0]; c.fn(); }
  if (V?.kind === 'book') applyBook();
  applyView();
}
export const inspecting = () => V?.name || null;
export const inspectBusy = () => !!V?.busy;
export const inspectDuo = () => !!V?.mate;
export function inspectSkip() { if (V?.busy) inspectTick(100); } // 点一下 / Esc：直接跳到这一段的结尾

// 哪些点击要飞出来：书架上的书（日志）、桌上和炉里的纸
export function inspectKind(name) { return name === 'desk_page' || name === 'stove_letter' || name === 'desk_notes' ? 'paper' : name === 'field_log' ? 'book' : null; }
export function inspectStart(name, text, done, mate) { // text = { en, zh }（书用）；翻完调 done()；mate = 并排飞出来的另一页（结构同 g：一个 Group 里一张纸）
  const kind = inspectKind(name), g = shared.layers.get(name); if (!kind || !g || V) return false;
  if (kind === 'book') {
    if (!book) return false;
    const zh = lang() === 'zh'; fillPages(zh ? text.zh : text.en, zh);
    V = { kind, name, g, home: { p: BOOK_HOME.p.clone(), q: BOOK_HOME.q.clone() }, spec: [BW * 2 + OV * 2, BH + OV * 2], f: 0, busy: true };
    const A = book.A; A.open = A.cover = 0; A.l.fill(0);
    go(V, 'f', 1, 0.9); go(A, 'open', 1, 0.8, 1.3); go(A, 'cover', 1, 0.8, 1.3);
    for (let i = 0; i < 3; i++) go(A.l, i, 1, 0.65, 2.25 + i * 0.75);
    after(4.7, () => { V.busy = false; done(); });
  } else {
    const m = g.children[0], b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3()), long = Math.max(s.x, s.z), short = Math.min(s.x, s.z);
    V = { kind, name, g, home: { p: g.position.clone(), q: g.quaternion.clone() }, spec: [long, short < 0.1 ? short * 1.2 : long, m.quaternion.clone()], slot: mate ? 'main' : 'solo', mate: mate || null, f: 0, busy: true };
    if (mate) { const mm = mate.children[0], ms = new THREE.Box3().setFromObject(mm).getSize(new THREE.Vector3()), ml = Math.max(ms.x, ms.z); V.mspec = [ml, Math.min(ms.x, ms.z) < 0.1 ? Math.min(ms.x, ms.z) * 1.2 : ml, mm.quaternion.clone()]; } // 淡影用自己的尺寸和朝向（下午那页斜放 0.25）
    go(V, 'f', 1, 0.9); after(1.1, () => { V.busy = false; done(); });
  }
  return true;
}
// 怀表：平时挂在抽屉图层（anchor）下；飞之前挂到场景里，表盘（本地 +y）转向镜头、12 点朝上，飞完 end() 挂回去
const _wm = new THREE.Quaternion(), _wp = new THREE.Vector3(), _ws = new THREE.Vector3(), WATCH_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
export function inspectWatch(w, anchor, dial, done) {
  if (V || !w || !anchor) return false;
  const lp = w.position.clone(), lq = w.quaternion.clone(), ls = w.scale.clone();
  const homeOf = (h) => { anchor.updateWorldMatrix(true, false); anchor.matrixWorld.decompose(_wp, _wm, _ws); h.p.copy(anchor.localToWorld(_wp.copy(lp))); h.q.copy(_wm).multiply(lq); };
  V = { kind: 'watch', name: 'watch', g: w, home: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, homeOf, spec: w.userData.frame || [0.06, 0.06, WATCH_Q], slot: 'solo', big: w.userData.frame ? 1.15 : 1.3, dz: w.userData.frame ? w.userData.frame[3] * 1.15 : 0, dial, onF: w.userData.pose, f: 0, busy: true,
    reattach: () => { anchor.add(w); w.position.copy(lp); w.quaternion.copy(lq); w.scale.copy(ls); dial.emissiveIntensity = 0; w.userData.pose?.(0); } };
  homeOf(V.home); anchor.updateWorldMatrix(true, false); V.hs = ls.x * anchor.matrixWorld.getMaxScaleOnAxis();
  scene.add(w); w.position.copy(V.home.p); w.quaternion.copy(V.home.q); w.scale.setScalar(V.hs);
  go(V, 'f', 1, 0.9); after(1.1, () => { V.busy = false; done(); });
  return true;
}
export function inspectRelease(onHome) { // 卡片关了：飞回原位（书先合上）
  if (!V) { onHome?.(); return; }
  if (V.busy) { inspectSkip(); }
  const v = V; v.busy = true; v.onHome = onHome; tw.length = 0; cbs.length = 0; clock = 0;
  if (v.kind === 'book') {
    const A = book.A; for (let i = NLEAF - 1; i >= 0; i--) go(A.l, i, 0, 0.3, (NLEAF - 1 - i) * 0.05);
    go(A, 'cover', 0, 0.35, 0.3); go(A, 'open', 0, 0.5, 0.4); go(v, 'f', 0, 0.85, 0.55); after(1.5, () => end(v));
  } else { go(v, 'f', 0, 0.8); after(0.85, () => end(v)); }
}
function end(v) { if (V === v) V = null; v.reattach?.(); v.g.position.copy(v.home.p); v.g.quaternion.copy(v.home.q); if (v.hs) v.g.scale.setScalar(v.hs); if (v.mate && v.ms) v.mate.scale.setScalar(v.ms); if (v.mate) v.mate.visible = false; v.onHome?.(); }
