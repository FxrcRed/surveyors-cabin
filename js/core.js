// 公共底座：渲染器、场景、相机、视角控制、太阳光（2026-10-30 从 index.html 拆出；主页面的变量写 shared.名字，见 web/CLAUDE.md「模块」）
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
// 合并后单个网格三角面很多，用 BVH 加速点选。先按包围球筛掉（three 自带的射线也这样，BVH 版不筛）：
// 第一人称每帧对 300 多个网格打几十条短射线，不筛的话每个网格都要求一次逆矩阵、进一次 BVH
const _rcSphere = new THREE.Sphere();
THREE.Mesh.prototype.raycast = function (raycaster, intersects) {
  const g = this.geometry, ray = raycaster.ray;
  if (g.boundsTree) {
    if (!g.boundingSphere) g.computeBoundingSphere();
    _rcSphere.copy(g.boundingSphere).applyMatrix4(this.matrixWorld);
    if (!ray.intersectsSphere(_rcSphere) || ray.origin.distanceTo(_rcSphere.center) - _rcSphere.radius > raycaster.far) return;
  }
  acceleratedRaycast.call(this, raycaster, intersects);
};

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
const PR_MAX = Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2); // 像素比上限：触屏（手机）1.5，3 倍屏上和 2 肉眼分不出、少画 44% 像素（2026-11-02 对比截图）
renderer.setPixelRatio(PR_MAX);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // 渲染循环里按需设 needsUpdate（太阳转了/门在动/积雪在变）

app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8dc);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.92; // 允许从下往上看天/天花板；不钻地由渲染循环里的离地下限管
controls.autoRotateSpeed = -0.6; // 负数 = 从上往下看相机逆时针绕小屋转（开场结尾按同一角速度衔接）

scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x6b5a45, 0.8));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const hemi = scene.children.find((o) => o.isHemisphereLight);


// 页面元素、中英切换小工具（原在太阳面板那段）
const $ = (id) => document.getElementById(id);
// 中英切换：lang() 当前语言；lbl 生成中英两份，CSS 只显示当前那份（切换时不用重画）
const lang = () => document.documentElement.dataset.lang;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lbl = (en, zh) => `<span class="en">${esc(en)}</span><span class="zh">${esc(zh)}</span>`;

const RM = matchMedia('(prefers-reduced-motion: reduce)'); // 系统开了「减少动态效果」：开场不飞、镜头不慢推、换房间直接到、走路不起伏（RM.matches 是活的，设置里改了立刻生效）

export { scene, sun, hemi, renderer, camera, controls, $, lang, esc, lbl, PR_MAX, RM };
