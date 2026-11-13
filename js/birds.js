// 天上的乌鸦（2026-11-03）：每隔几分钟一小群（2–3 只）从树梢上空飞过，低多边形，扑翅膀在顶点着色器里（不占 CPU）
// 白天晴天、阴天、小雪飞（11-13 放宽：第 2、3 天一直下小雪，原来永远看不到）；雨、暴雪、雾、雷、大风和夜里不飞。阴天、下雪时飞得低（云底低，乌鸦贴着树梢飞）。挂的是 InstancedMesh，hideOutdoors 会自动把它挪进 OUT_LAYER，在屋里不画
// 偶尔配一两声远处的叫声（audio.js 的 audioCaw）
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { wx } from './weather.js';
import { sky } from './time-of-day.js';
import { audioCaw } from './audio.js';

const N = 3, SPAN = 1.7, SPEED = 10, ALT = [26, 36], REACH = 115; // 每群最多 3 只；翼展 1.7m；10m/s；高出相机 26–36m；从 115m 外飞进来
const GAP = [150, 360];  // 两次飞过之间的秒数
const R = (a, b) => a + Math.random() * (b - a);

// 一只鸟的网格（朝 +z）：身体 8 面、两片翅膀各 2 面、尾巴 1 面 = 13 个三角面；aW = 离身体中线的远近（0–1），翅尖扑得最多
function birdGeo() {
  const P = [], W = [];
  const tri = (a, b, c) => { for (const v of [a, b, c]) { P.push(v[0], v[1], v[2]); W.push(Math.abs(v[0]) * 2); } };
  const Nz = [0, 0, 0.28], T = [0, 0, -0.22], U = [0, 0.05, 0.02], D = [0, -0.05, 0.02], L = [-0.05, 0, 0.02], Rr = [0.05, 0, 0.02];
  for (const [a, b] of [[U, L], [L, D], [D, Rr], [Rr, U]]) { tri(Nz, a, b); tri(T, b, a); }
  for (const s of [-1, 1]) { // 翅膀：根部前后两点、翅尖前后两点
    const f = [0.04 * s, 0, 0.12], b = [0.04 * s, 0, -0.12], tf = [0.5 * s, 0, 0.02], tb = [0.45 * s, 0, -0.2];
    tri(f, tf, tb); tri(f, tb, b);
  }
  tri([0, 0, -0.2], [-0.07, 0, -0.38], [0.07, 0, -0.38]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 1));
  return g;
}
const geo = birdGeo();
geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(new Float32Array(N).map(() => R(0, 6.28)), 1));
const uT = { value: 0 };
const mat = new THREE.MeshBasicMaterial({ color: 0x0d0d10, side: THREE.DoubleSide });
mat.onBeforeCompile = (sh) => {
  sh.uniforms.uT = uT;
  sh.vertexShader = 'attribute float aW; attribute float aPh; uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nfloat fl = sin(uT * 8.5 + aPh); transformed.y += fl * aW * aW * 0.55 - aW * 0.12;'); // 翅尖上下，下拍时翅膀略下垂
};
const mesh = new THREE.InstancedMesh(geo, mat, N);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mesh.frustumCulled = false; mesh.visible = false; mesh.castShadow = false; mesh.count = N;
scene.add(mesh);

const birds = { next: R(100, 200), f: null, t: 0, calls: 0 }; // next = 离下一群还有几秒；f = 正在飞的这群
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(SPAN, SPAN, SPAN), _qy = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

function ok() { // 能飞的天
  const c = wx.cur, h = sky.hour;
  return h > 7 && h < 17.5 && c.rain < 0.02 && c.snow < 0.6 && c.fogK < 0.7 && c.bolt < 0.1 && c.wind < 2; // 小雪 snow 0.45、fogK 0.5 能飞；暴雪 1/1、雾 fogK 1、第 1 天薄雾 0.9 不飞
}
function launch() {
  const lowVis = scene.fog && scene.fog.far < 60; // 第 2、3 天林子里雾远约 26m：从头顶附近、贴着树梢（树约 13m）飞过，不然整段都在雾外看不见
  const a = R(0, Math.PI * 2), lat = lowVis ? R(-8, 8) : R(-35, 35), cx = camera.position.x, cz = camera.position.z;
  const dx = Math.cos(a), dz = Math.sin(a), y = camera.position.y + (lowVis ? R(11, 15) : wx.cur.snow > 0.05 || wx.cur.cloud > 0.5 ? R(14, 20) : R(...ALT)); // 低云、下雪天飞得低
  const n = 2 + Math.floor(Math.random() * 2);
  birds.f = {
    dir: new THREE.Vector3(-dx, 0, -dz), speed: R(8.5, 11.5), n,
    p0: new THREE.Vector3(cx + dx * REACH - dz * lat, y, cz + dz * REACH + dx * lat),
    offs: Array.from({ length: N }, (_, i) => new THREE.Vector3(R(-4, 4) * (i + 1) * 0.5, R(-1.5, 1.5), R(-5, 5) * (i + 1) * 0.5)),
    dur: REACH * 2 / SPEED, caw: Math.random() < 0.6 ? R(0.3, 0.55) : -1,
  };
  birds.t = 0; mesh.count = n; mesh.visible = true;
}
export function updateBirds(dt) {
  uT.value += dt;
  if (!birds.f) {
    birds.next -= dt;
    if (birds.next <= 0) { if (ok()) launch(); else birds.next = 10; }
    return;
  }
  const f = birds.f; birds.t += dt;
  const spd = f.speed, yaw = Math.atan2(f.dir.x, f.dir.z);
  for (let i = 0; i < f.n; i++) {
    const o = f.offs[i];
    _p.copy(f.dir).multiplyScalar(spd * birds.t).add(f.p0).add(o);
    _p.y += Math.sin(birds.t * 0.6 + i * 2) * 0.8;
    _qy.setFromAxisAngle(_up, yaw); _e.set(0, 0, Math.sin(birds.t * 0.5 + i) * 0.12); _q.setFromEuler(_e); _q.premultiply(_qy);
    _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
    if (i === 0 && f.caw >= 0 && birds.t > f.dur * f.caw) { // 一次叫 2–3 声，间隔不齐
      f.caw = -1; let d = 0; const k = 2 + Math.floor(Math.random() * 2), dist = camera.position.distanceTo(_p);
      for (let j = 0; j < k; j++) { audioCaw(dist, d); d += R(0.6, 1.3); }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (birds.t > f.dur) { birds.f = null; mesh.visible = false; birds.next = R(...GAP); }
}
window.cabinBirds = { birds, mesh, launch, ok, geo, get tris() { return geo.attributes.position.count / 3; } }; // 调试 / 无头测试
