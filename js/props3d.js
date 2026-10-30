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
function fibres(x, W, H, R, n, light, dark) {
  for (let i = 0; i < n; i++) {
    const px = R() * W, py = R() * H, a = R() * 6.28, len = 5 + R() * 18;
    x.strokeStyle = R() < 0.5 ? light : dark; x.lineWidth = 0.6 + R() * 0.7;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (R() - 0.5) * 6, py + Math.sin(a) * len * 0.5 + (R() - 0.5) * 6, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
  }
}
function paperBase(W, H, tone, seed, rough = 1) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed);
  x.fillStyle = tone; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) { x.fillStyle = R() < 0.6 ? `rgba(120,86,44,${0.02 + R() * 0.05 * rough})` : `rgba(255,248,226,${0.03 + R() * 0.06})`; x.beginPath(); x.arc(R() * W, R() * H, 8 + R() * 60, 0, 7); x.fill(); }
  for (let i = 0; i < 6 * rough; i++) { const px = R() * W, py = R() * H, r = 6 + R() * 16; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(110,70,30,${0.18 + R() * 0.2})`); g.addColorStop(1, 'rgba(110,70,30,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); } // 霉点
  fibres(x, W, H, R, 900, 'rgba(255,250,235,.10)', 'rgba(90,64,36,.08)');
  const e = Math.min(W, H) * 0.09; // 边缘发黄、发暗
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, H], [W, 0, W - e, 0, W - e, 0, e, H], [0, 0, 0, e, 0, 0, W, e], [0, H, 0, H - e, 0, H - e, W, e]]) {
    const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(92,60,28,.30)'); g.addColorStop(1, 'rgba(92,60,28,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
  }
  grain(x, W, H, R, 14);
  return c;
}
export { paperBase as agedPaper };
function bumpCanvas(W, H, seed, amp = 70) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed + 101);
  x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
  fibres(x, W, H, R, 1400, 'rgba(255,255,255,.35)', 'rgba(0,0,0,.35)'); grain(x, W, H, R, amp);
  return c;
}

// 一张纸：纸的纹理 + 画内容的回调 draw(ctx, W, H, R)；几何带一点卷曲、折痕、翘起的角，不是平面
export function paperMesh(w, h, { seed = 1, tone = '#d9cdb0', draw, cutout = false, curl = 0.004, crease = 0 } = {}) {
  const W = 512, H = Math.round(W * h / w), c = paperBase(W, H, tone, seed), x = c.getContext('2d'), R = rngOf(seed + 7);
  if (crease) { // 折痕：中间一条竖线，一边亮一边暗
    x.fillStyle = 'rgba(40,26,12,.22)'; x.fillRect(W / 2 - 1, 0, 2, H); x.fillStyle = 'rgba(255,250,235,.28)'; x.fillRect(W / 2 + 1, 0, 2, H);
    const g = x.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0); g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(0.5, 'rgba(60,40,20,.12)'); g.addColorStop(1, 'rgba(60,40,20,0)'); x.fillStyle = g; x.fillRect(W / 2 - 40, 0, 80, H);
  }
  draw?.(x, W, H, R);
  const nx = 14, ny = Math.max(8, Math.round(14 * h / w)), geo = new THREE.PlaneGeometry(w, h, nx, ny), p = geo.attributes.position, ph = R() * 6;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w, v = p.getY(i) / h; // −0.5…0.5
    let z = curl * (1.6 * u * u - 0.3) + curl * 0.35 * Math.sin(v * 5 + ph) * Math.cos(u * 4 + ph); // 整张微微拱起 + 低频起伏
    z += curl * 1.4 * Math.pow(Math.max(0, u + v), 3) * 2; // 一只角翘起
    if (crease) z += crease * (Math.abs(u) - 0.25); // 折痕：中间凹下去，两边略抬
    p.setZ(i, z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex(c), bumpMap: tex(bumpCanvas(256, Math.round(256 * h / w), seed), false), bumpScale: 1.4, roughness: 0.93, side: THREE.DoubleSide, alphaTest: cutout ? 0.5 : 0 }));
  m.receiveShadow = true; return m;
}

// ——— 皮革：暗褐底 + 斑驳 + 磨白的边；front 压框线和标签，spine 画凸起的书脊带 ———
function leatherCanvas(W, H, seed, kind) {
  const c = mkCanvas(W, H), x = c.getContext('2d'), R = rngOf(seed);
  x.fillStyle = '#4b2c1a'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) { x.fillStyle = R() < 0.55 ? `rgba(18,8,3,${0.05 + R() * 0.12})` : `rgba(160,104,56,${0.04 + R() * 0.08})`; x.beginPath(); x.arc(R() * W, R() * H, 5 + R() * 34, 0, 7); x.fill(); }
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${R() * 0.18})`; x.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); } // 皮纹
  for (let i = 0; i < 30; i++) { x.strokeStyle = `rgba(200,150,100,${0.1 + R() * 0.2})`; x.lineWidth = 0.8; x.beginPath(); const px = R() * W, py = R() * H; x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 60, py + (R() - 0.5) * 60); x.stroke(); } // 划痕
  const ink = 'rgba(14,6,2,.55)', gold = 'rgba(176,138,70,.55)';
  if (kind === 'front') {
    x.strokeStyle = ink; x.lineWidth = 3; x.strokeRect(22, 22, W - 44, H - 44); x.lineWidth = 1.5; x.strokeRect(34, 34, W - 68, H - 68);
    x.strokeStyle = gold; for (const [cx, cy] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) { x.beginPath(); x.arc(cx, cy, 12, 0, 7); x.stroke(); }
    const lw = W * 0.6, lh = H * 0.2, lx = (W - lw) / 2, ly = H * 0.26; // 贴的纸标签
    x.fillStyle = '#cdbb8e'; x.fillRect(lx, ly, lw, lh); x.strokeStyle = 'rgba(40,24,10,.8)'; x.lineWidth = 2; x.strokeRect(lx + 5, ly + 5, lw - 10, lh - 10);
    x.fillStyle = 'rgba(38,22,10,.92)'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `${Math.round(W * 0.085)}px "IM Fell English SC", Georgia, serif`; x.fillText('FIELD LOG', W / 2, ly + lh / 2);
    x.strokeStyle = gold; x.lineWidth = 2; x.beginPath(); x.moveTo(W * 0.3, H * 0.64); x.lineTo(W * 0.7, H * 0.64); x.moveTo(W * 0.38, H * 0.67); x.lineTo(W * 0.62, H * 0.67); x.stroke();
  } else if (kind === 'spine') {
    for (const f of [0.1, 0.3, 0.7, 0.9]) { const y = H * f; x.fillStyle = 'rgba(14,6,2,.5)'; x.fillRect(0, y - 6, W, 12); x.fillStyle = 'rgba(190,140,86,.28)'; x.fillRect(0, y - 6, W, 3); x.fillStyle = gold; x.fillRect(0, y - 1, W, 2); }
    x.save(); x.translate(W / 2, H * 0.5); x.rotate(Math.PI / 2); x.fillStyle = 'rgba(205,176,108,.8)'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `${Math.round(W * 0.34)}px "IM Fell English SC", Georgia, serif`; x.fillText('FIELD LOG', 0, 0); x.restore();
  }
  const e = 14; for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, H], [W, 0, W - e, 0, W - e, 0, e, H], [0, 0, 0, e, 0, 0, W, e], [0, H, 0, H - e, 0, H - e, W, e]]) { // 边角磨白
    const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(176,128,84,.45)'); g.addColorStop(1, 'rgba(176,128,84,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
  }
  return c;
}
const leatherMat = (W, H, seed, kind) => new THREE.MeshStandardMaterial({ map: tex(leatherCanvas(W, H, seed, kind)), bumpMap: tex(bumpCanvas(128, 128, seed, 120), false), bumpScale: 2, roughness: 0.62 });
function edgeCanvas(vertical) { // 书页切口：一条条细纹，发黄
  const c = mkCanvas(128, 128), x = c.getContext('2d'), R = rngOf(5);
  x.fillStyle = '#cdb98a'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) { x.fillStyle = `rgba(80,56,28,${0.1 + R() * 0.22})`; vertical ? x.fillRect(i, 0, 1, 128) : x.fillRect(0, i, 128, 1); }
  return c;
}
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
export function makeBook() {
  if (book || !shared.layers) return;
  const root = new THREE.Group(); root.name = 'field_log'; root.position.copy(BOOK_HOME.p); root.quaternion.copy(BOOK_HOME.q);
  const front = leatherMat(256, 360, 41, 'front'), back = leatherMat(256, 360, 43, 'back'), side = leatherMat(128, 128, 47, 'plain'), spineM = leatherMat(64, 256, 49, 'spine'), endM = new THREE.MeshStandardMaterial({ map: tex(endpaper()), roughness: 0.9 });
  const board = (outer) => new THREE.BoxGeometry(BW + OV, BH + OV * 2, BD); // 面序 +x −x +y −y +z −z
  // 后封面：外面 −z 是皮革，里面 +z 是衬页
  const bb = pickable(root, new THREE.Mesh(board(), [side, side, side, side, endM, back])); bb.position.set(OV / 2, 0, -BT / 2 + BD / 2);
  const sp = pickable(root, new THREE.Mesh(new THREE.CylinderGeometry(BT / 2, BT / 2, BH + OV * 2, 14, 1, true, Math.PI, Math.PI), spineM)); sp.position.set(-BW / 2, 0, 0); sp.scale.set(0.6, 1, 1); sp.material.side = THREE.DoubleSide;
  const blockMats = [new THREE.MeshStandardMaterial({ map: tex(edgeCanvas(true)), roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: tex(edgeCanvas(true)), roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: tex(edgeCanvas(false)), roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: tex(edgeCanvas(false)), roughness: 0.95 }), new THREE.MeshStandardMaterial({ visible: false }), new THREE.MeshStandardMaterial({ color: '#bda878', roughness: 0.95 })];
  const bk = ZTOP - Z0, blk = pickable(root, new THREE.Mesh(new THREE.BoxGeometry(BW - 0.002, BH - 0.004, bk), blockMats)); blk.position.set(0.001, 0, (Z0 + ZTOP) / 2);
  // 前封面：绕书脊转。外面 +z 是压花皮革，里面 −z 是衬页
  const cover = new THREE.Group(); cover.name = 'field_log'; cover.position.set(-BW / 2, 0, ZTOP); root.add(cover);
  const fc = pickable(cover, new THREE.Mesh(board(), [side, side, side, side, front, endM])); fc.position.set((BW + OV) / 2, 0, BD / 2);
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

// ——— 飞出来 / 飞回去 ———
const tw = [], cbs = []; let clock = 0;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const go = (o, k, v, dur, delay = 0) => tw.push({ o, k, v, dur, at: clock + delay, a: null });
const after = (delay, fn) => cbs.push({ at: clock + delay, fn });
let V = null; // 正在看的：{ kind, name, g, home:{p,q}, read:{p,q}, f（0 在原位，1 在相机前）, busy, onHome }
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
function readPose(wd, ht, mQ) { // 相机前方：纸/书占画面约 60%；mQ = 网格自己的朝向（要抵消）
  const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const d = Math.max(0.3, ht / (0.6 * 2 * Math.tan(vf / 2)), wd / (0.7 * 2 * Math.tan(hf / 2)));
  const q = camera.quaternion.clone().multiply(_q.setFromEuler(_e.set(-0.22, 0, 0)));
  const fwd = _v.set(0, 0, -1).applyQuaternion(camera.quaternion).clone();
  return { p: camera.position.clone().addScaledVector(fwd, d), q: mQ ? q.multiply(mQ.clone().invert()) : q };
}
function applyView() {
  if (!V) return;
  const f = V.f, g = V.g; V.read = readPose(...V.spec); // 每帧按当前相机重算：看的时候相机还在惯性转动，书 / 纸始终在画面中央
  g.position.lerpVectors(V.home.p, V.read.p, f); g.quaternion.slerpQuaternions(V.home.q, V.read.q, f);
  g.position.y += Math.sin(Math.PI * f) * 0.08; // 飞的时候先抬一下
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
export function inspectSkip() { if (V?.busy) inspectTick(100); } // 点一下 / Esc：直接跳到这一段的结尾

// 哪些点击要飞出来：书架上的书（日志）、桌上和炉里的纸
export function inspectKind(name) { return name === 'desk_page' || name === 'stove_letter' ? 'paper' : name === 'field_log' ? 'book' : null; }
export function inspectStart(name, text, done) { // text = { en, zh }（书用）；翻完调 done()
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
    V = { kind, name, g, home: { p: g.position.clone(), q: g.quaternion.clone() }, spec: [long, short < 0.1 ? short * 1.2 : long, m.quaternion.clone()], f: 0, busy: true };
    go(V, 'f', 1, 0.9); after(1.1, () => { V.busy = false; done(); });
  }
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
function end(v) { if (V === v) V = null; v.g.position.copy(v.home.p); v.g.quaternion.copy(v.home.q); v.onHome?.(); }
