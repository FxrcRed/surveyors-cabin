// 地形：一个高度函数 terrainH(x, z)（相对院子地坪，米），同时给地面网格、树/灌木/草摆放、人物脚下（地面网格参与射线）用。
// 小屋、卵石路、林间踪迹、河、湖、✕ 那间屋周围压平（terrain.flat 由 index.html 接上），往外渐渐起伏；150–200m 外淡回平地（雾里看不到）。
// 世界平移（第 3 天 shiftWorld）后，屋外物件整体挪了 -XSHIFT，所以高度按「家的坐标」算：H(x + ox, z + oz)，平移时 ox/oz 设成 XSHIFT。
export const terrain = { ox: 0, oz: 0, flat: () => 1, pits: [] }; // pits：[x, z, 半径, 深]，陡坡洼地（走不进去），在家的坐标里
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function terrainH(x, z) {
  x += terrain.ox; z += terrain.oz;
  return hills(x, z) + (BK.n ? brookCut(x, z) : 0);
}
function hills(x, z) {
  const far = 1 - sstep(150, 200, Math.hypot(x, z)); if (far <= 0) return 0;
  const k = terrain.flat(x, z); if (k <= 0) return 0;
  let h = 0.9 * Math.sin(x * 0.045 + 1.1) * Math.sin(z * 0.052 + 0.4) + 0.6 * Math.sin((x + z) * 0.031 + 2.0) // 大起伏：30–60m 一个坡
    + 0.3 * Math.sin(x * 0.19 + z * 0.07) * Math.sin(z * 0.17 - x * 0.05 + 1.0);                              // 小土包：15–30m
  h -= 0.7 * sstep(0.8, 1, Math.sin((x * 0.6 + z * 0.8) * 0.11 + Math.sin(z * 0.05) * 2));                    // 浅沟：弯弯曲曲的长条
  for (const [px, pz, pr, pd] of terrain.pits) { const d = Math.hypot(x - px, z - pz) / pr; if (d < 3) h -= pd * Math.exp(-d * d); }
  return h * k * far;
}
// 屋旁小溪（11-04 D 批）：index.html 的 setBrook 给一条中心线（家的坐标，约 1m 一点），每点 [x, z, 沿线米数, 水面半宽, 挖深系数]；
// 截面（相对原地形）：河床 -0.5、水面 -0.3、岸坡 0.55m 升到 +0.08 的雪檐、再 0.85m 落回地面，都乘挖深系数（过踪迹处浅、两头渐出）
const BK = { n: 0, p: null, grid: new Map() }, BQ = { d: 1e9, s: 0, w: 0, k: 0 }, BC = 4;
export const BROOK_WL = -0.3, BROOK_BANK = 1.4;
export function setBrook(pts) {
  BK.p = pts; BK.n = pts.length; BK.grid.clear();
  pts.forEach(([x, z], i) => { const key = Math.floor(x / BC) * 100003 + Math.floor(z / BC), a = BK.grid.get(key); if (a) a.push(i); else BK.grid.set(key, [i]); });
}
export function brookAt(x, z, r = 8) { // 家的坐标 → BQ { d 离中心线（投影到相邻两段）, s, w, k }；r 米外 d = 1e9
  BQ.d = 1e9; if (!BK.n) return BQ;
  const cx = Math.floor(x / BC), cz = Math.floor(z / BC), m = Math.ceil(r / BC); let bi = -1, bd = r * r;
  for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) for (const k of BK.grid.get((cx + i) * 100003 + cz + j) || []) { const q = BK.p[k], e = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (e < bd) { bd = e; bi = k; } }
  if (bi < 0) return BQ;
  for (const j of [bi - 1, bi]) { if (j < 0 || j + 1 >= BK.n) continue;
    const a = BK.p[j], b = BK.p[j + 1], ux = b[0] - a[0], uz = b[1] - a[1], l2 = ux * ux + uz * uz || 1, t = Math.min(1, Math.max(0, ((x - a[0]) * ux + (z - a[1]) * uz) / l2));
    const d = Math.hypot(x - a[0] - ux * t, z - a[1] - uz * t);
    if (d < BQ.d) { BQ.d = d; BQ.s = a[2] + (b[2] - a[2]) * t; BQ.w = a[3] + (b[3] - a[3]) * t; BQ.k = a[4] + (b[4] - a[4]) * t; } }
  if (BQ.d > 1e8) { const q = BK.p[bi]; BQ.d = Math.sqrt(bd); BQ.s = q[2]; BQ.w = q[3]; BQ.k = q[4]; }
  return BQ;
}
export function brookCutD(d, w, k) { // 离中心线 d 米处比原地形低多少（负数 = 挖下去）
  if (k <= 0 || d >= w + BROOK_BANK) return 0;
  let h;
  if (d < w) h = -0.5 + 0.2 * sstep(w - 0.45, w, d); // 水下：河床中间深，到水线升到水面
  else if (d < w + 0.55) { const t = (d - w) / 0.55; h = BROOK_WL + 0.38 * (1 - (1 - t) * (1 - t)); } // 岸坡：水线处陡（水面和岸交得干脆，不闪），到雪檐变平
  else h = 0.08 * (1 - sstep(w + 0.55, w + BROOK_BANK, d));
  return h * k;
}
function brookCut(x, z) { const q = brookAt(x, z); return q.d > 9 ? 0 : brookCutD(q.d, q.w, q.k); }
// 地面网格比溪的截面粗得多（近处 3m 一圈）：溪两边一带的地面顶点再往下压（最多 0.8m），由 index.html 铺的细网格（同地面材质）盖住；
// 压的范围 = 岸外再加一个格子的对角线长（网格间距按世界半径算，手机 64 段最稀），之外 1m 渐回
export function groundSpan(R) { const ring = R < 45 ? 3 : R < 110 ? 5 : R < 200 ? 10 : 150; return Math.hypot(ring, 2 * Math.PI * R / 64); }
function under(x, z) {
  if (!BK.n) return 0;
  const q = brookAt(x + terrain.ox, z + terrain.oz, 20); if (q.k <= 0) return 0;
  const e = q.w + BROOK_BANK + groundSpan(Math.hypot(x, z));
  const u = Math.min(0.8, 0.7 * q.k + 0.15); // 挖得浅的地方（过踪迹、下游渐出）少压一点，挖深为 0 的贴地段不压
  return q.d < e ? u : q.d < e + 1 ? u * (e + 1 - q.d) : 0;
}
// 坡度（m/m）：中心差分，步长 0.6m
export function terrainSlope(x, z) {
  const e = 0.6; return Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
}
// 极坐标地面网格：近处 3m 一圈、45–110m 5m 一圈、再外 10m 一圈、再外面几大圈到 700m。顶点 y 先给 0，plantForest 里 applyTerrain 再抬。
export function makeGroundGeometry(THREE, seg) {
  const radii = [0]; for (let r = 3; r <= 45; r += 3) radii.push(r); for (let r = 50; r <= 110; r += 5) radii.push(r); for (let r = 120; r <= 200; r += 10) radii.push(r); radii.push(300, 450, 700);
  const n = radii.length, pos = new Float32Array((1 + (n - 1) * seg) * 3), uv = new Float32Array((1 + (n - 1) * seg) * 2), idx = [];
  const at = (i, j) => i === 0 ? 0 : 1 + (i - 1) * seg + (j % seg);
  for (let i = 1; i < n; i++) for (let j = 0; j < seg; j++) {
    const a = j / seg * Math.PI * 2, v = at(i, j); pos[v * 3] = Math.cos(a) * radii[i]; pos[v * 3 + 2] = Math.sin(a) * radii[i];
  }
  for (let i = 1; i < n; i++) for (let j = 0; j < seg; j++) {
    if (i === 1) idx.push(0, at(1, j + 1), at(1, j));
    else idx.push(at(i - 1, j), at(i, j + 1), at(i, j), at(i - 1, j), at(i - 1, j + 1), at(i, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(1) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
  return g;
}
export function applyTerrain(geo) { // 按 terrainH 重抬顶点（世界平移后也调一次）
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)) - under(p.getX(i), p.getZ(i)));
  p.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
  // 第一人称每帧往脚下打射线（fp.floors 含地面）：没 BVH 时逐个三角形试，地面 7584 面一条射线 2ms，比屋里 300 多个网格加起来还慢 10 倍
  if (geo.boundsTree) geo.boundsTree.refit(); else geo.computeBoundsTree();
}
