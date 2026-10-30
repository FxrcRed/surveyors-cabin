// 地形：一个高度函数 terrainH(x, z)（相对院子地坪，米），同时给地面网格、树/灌木/草摆放、人物脚下（地面网格参与射线）用。
// 小屋、卵石路、林间踪迹、河、湖、✕ 那间屋周围压平（terrain.flat 由 index.html 接上），往外渐渐起伏；150–200m 外淡回平地（雾里看不到）。
// 世界平移（第 3 天 shiftWorld）后，屋外物件整体挪了 -XSHIFT，所以高度按「家的坐标」算：H(x + ox, z + oz)，平移时 ox/oz 设成 XSHIFT。
export const terrain = { ox: 0, oz: 0, flat: () => 1, pits: [] }; // pits：[x, z, 半径, 深]，陡坡洼地（走不进去），在家的坐标里
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function terrainH(x, z) {
  x += terrain.ox; z += terrain.oz;
  const far = 1 - sstep(150, 200, Math.hypot(x, z)); if (far <= 0) return 0;
  const k = terrain.flat(x, z); if (k <= 0) return 0;
  let h = 0.9 * Math.sin(x * 0.045 + 1.1) * Math.sin(z * 0.052 + 0.4) + 0.6 * Math.sin((x + z) * 0.031 + 2.0) // 大起伏：30–60m 一个坡
    + 0.3 * Math.sin(x * 0.19 + z * 0.07) * Math.sin(z * 0.17 - x * 0.05 + 1.0);                              // 小土包：15–30m
  h -= 0.7 * sstep(0.8, 1, Math.sin((x * 0.6 + z * 0.8) * 0.11 + Math.sin(z * 0.05) * 2));                    // 浅沟：弯弯曲曲的长条
  for (const [px, pz, pr, pd] of terrain.pits) { const d = Math.hypot(x - px, z - pz) / pr; if (d < 3) h -= pd * Math.exp(-d * d); }
  return h * k * far;
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
  for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)));
  p.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
}
