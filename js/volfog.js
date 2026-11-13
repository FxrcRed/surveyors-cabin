// 体积雾（2026-11-11，只给电脑开；试验和实测见 git 分支 claude/volumetric-fog-trial-b0f556 的 FOG-TRIAL.md）
// 树林间的低雾 + 逆光时树缝里的光束：主画面画进离屏缓冲 → 半分辨率光线步进 → 按深度模糊、升采样 → 叠回画布。
// 离屏缓冲标成 isXRRenderTarget：three.js 对它照样做色调映射和 sRGB 输出，材质的着色器和直接画到画布时是同一个（不多编译一套），
// 开关雾、进出屋、降档都只是换画法，不重编译；代价是雾叠在显示空间里（three 自带的 Fog 也是在色调映射之后混的）。升级 three.js 要复查这个标记。
// 手机、平板、触屏为主的设备不开（isDesktop），连模块里的缓冲和着色器都不建；?vol=1 / ?vol=0 强制开关（测试用）。
import * as THREE from 'three';
import { scene, renderer, camera, sun, hemi } from './core.js';

export const FOG_LAYER = 9; // 雾专用太阳深度图只画这一层（森林的树，index.html 的 plant 里加）
function isDesktop() {
  const ua = navigator.userAgent, touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS 的 Safari 自称 Macintosh
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touchMac;
  return !mobile && matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches; // 主指针是鼠标/触控板、能悬停
}
const q = new URLSearchParams(location.search).get('vol');
// tier：0 = 1/2 分辨率 16 步（试验实测 2560×1440 雾本身 +0.4–0.7ms，低档有颗粒），1 = 1/4 分辨率 8 步，2 = 关（帧间隔撑不住时一档档降，只降不升）
export const volfog = { on: q === '1' || (q !== '0' && isDesktop()), tier: 0, active: false, built: false, sunDirty: true, ema: 0.016, at: 0 };
window.__vol = volfog; // 调试、无头测试

const TIERS = [{ res: 0.5, steps: 16 }, { res: 0.25, steps: 8 }];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let rt, fogA, fogB, march, blurM, compM, fsScene, fsTri, fsCam, sunRT, sunCam, shadowOnly, waterRT, waterTry = 0;
const U = {
  tDepth: { value: null }, tSun: { value: null }, tNoise: { value: null }, uInvP: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() }, uSunVP: { value: new THREE.Matrix4() },
  uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
  uD: { value: 0 }, uW: { value: 0 }, uBase: { value: 0 }, uFall: { value: 0.11 }, uTop: { value: 22 }, uMax: { value: 100 }, uG: { value: 0.72 }, uT: { value: 0 },
  tWater: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uWO: { value: new THREE.Vector2() }, uWS: { value: new THREE.Vector2(1, 1) },
  uBoxMin: { value: new THREE.Vector3(1e9, 1e9, 1e9) }, uBoxMax: { value: new THREE.Vector3(-1e9, -1e9, -1e9) },
}; volfog.U = U; // 调试 / 无头测试读 uWO
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }';
const FOG_FRAG = `precision highp float; precision highp sampler3D;
uniform sampler2D tDepth, tSun, tWater; uniform sampler3D tNoise; uniform mat4 uInvP, uCamW, uSunVP; uniform vec3 uCam, uSunDir, uSunC, uAmb, uBoxMin, uBoxMax; uniform vec2 uWO, uWS; uniform float uD, uW, uBase, uFall, uTop, uMax, uG, uT; varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float dens(vec3 p){
  if (all(greaterThan(p, uBoxMin)) && all(lessThan(p, uBoxMax))) return 0.0; // 小屋里没有雾（门开着时从屋里看出去照样有）
  float h = max(p.y - uBase, 0.0);                          // 世界高度。林间雾：贴地最浓、往上慢慢淡（树干中段还在，树冠高度只剩薄薄一层），雾顶 uTop 在树冠上沿
  vec2 wu = vec2((p.x - uWO.x) * uWS.x, (uWO.y - p.z) * uWS.y);
  float wm = (wu.x > 0.0 && wu.y > 0.0 && wu.x < 1.0 && wu.y < 1.0) ? textureLod(tWater, wu, 2.5).r : 0.0; // 水面遮罩（湖、河），取模糊的一级：晨雾从岸上漂出去一点，边缘是软的
  float nA = texture(tNoise, p * 0.005 + vec3(uT * 0.0012, 0.0, uT * 0.0006)).r;   // 大尺度低频（雾块几十米），慢慢漂
  float nB = texture(tNoise, p * 0.022 - vec3(uT * 0.0020, 0.0, uT * 0.0008)).r - 0.5; // 只给边缘一点起伏，不出细碎团块
  float land = uD * exp(-h * uFall) * (1.0 - smoothstep(0.5 * uTop, uTop, h)) * smoothstep(0.28, 0.68, nA + nB * 0.35)
    * mix(0.4, 1.0, smoothstep(6.0, 36.0, length(p.xz - (uBoxMin.xz + uBoxMax.xz) * 0.5))) * (1.0 - 0.85 * wm); // 小屋四周的雾淡一些，开场落地时小屋看得清
  float wat = uW * wm * exp(-h * 0.5) * (1.0 - smoothstep(3.0, 7.0, h)) * smoothstep(0.30, 0.74, nA + nB * 0.15);   // 水面晨雾：贴水一层，大片、边缘宽而软
  return land + wat;
}
float sunVis(vec3 p){ vec3 s = (uSunVP * vec4(p, 1.0)).xyz * 0.5 + 0.5; if (min(s.x, s.y) < 0.0 || max(s.x, s.y) > 1.0) return 1.0; return s.z <= texture(tSun, s.xy).r + 0.0015 ? 1.0 : 0.0; }
void main(){
  vec4 v = uInvP * vec4(vUv * 2.0 - 1.0, texture(tDepth, vUv).r * 2.0 - 1.0, 1.0);
  vec3 o = uCam, rd = (uCamW * vec4(v.xyz / v.w, 1.0)).xyz - o; float L = length(rd); rd /= L;
  float top = uBase + uTop, a = 0.0, b = L;                   // 只走雾层这一段；相机在雾层上方时从进入点开始，uMax 从进入点算
  if (o.y > top) { if (rd.y >= -1e-4) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } a = (top - o.y) / rd.y; } else if (rd.y > 1e-4) b = min(b, (top - o.y) / rd.y);
  b = min(b, a + uMax);
  vec3 sum = vec3(0.0); float T = 1.0;
  if (b > a) { float seg = b - a, j = ign(gl_FragCoord.xy), c = dot(rd, uSunDir), g2 = uG * uG, d = 1.0 + g2 - 2.0 * uG * c, ph = (1.0 - g2) / (12.566 * d * sqrt(d));
    for (int i = 0; i < STEPS; i++) { float x0 = (float(i) + j) / float(STEPS), t = a + seg * x0 * x0, dt = seg * 2.0 * x0 / float(STEPS) + seg / float(STEPS * STEPS); // 平方分布：近处步子密，树缝里的光束才分得开
      vec3 p = o + rd * t; float D = dens(p) * (1.0 - smoothstep(uMax * 0.7, uMax, t - a)); if (D < 1e-3) continue;
      float e = exp(-D * dt); sum += T * (1.0 - e) * (uAmb + uSunC * ph * sunVis(p)); T *= e; } }
  gl_FragColor = vec4(sum, T);
}`;
const BLUR_FRAG = `precision highp float; uniform sampler2D tFog, tDepth; uniform vec2 uDir, uClip; varying vec2 vUv;
float lin(float z){ return uClip.x * uClip.y / (uClip.y - z * (uClip.y - uClip.x)); }
void main(){ float z0 = lin(texture(tDepth, vUv).r); vec4 s = texture(tFog, vUv) * 0.34; float W = 0.34;
  for (float i = 1.0; i < 3.0; i += 1.0) for (float k = -1.0; k < 2.0; k += 2.0) { vec2 u = vUv + uDir * i * k; float zz = lin(texture(tDepth, u).r), w = (i < 1.5 ? 0.24 : 0.09) / (1.0 + abs(z0 - zz) * 4.0 / (0.1 + z0 * 0.05)); s += texture(tFog, u) * w; W += w; }
  gl_FragColor = s / W; }`;
// 合成：画面已是显示值（sRGB），转回线性 × 透过率 + 色调映射过的散射光，再转回 sRGB；按深度升采样，雾不渗到树干边上
const COMP_FRAG = `precision highp float; uniform sampler2D tColor, tFog, tDepth; uniform vec2 uFogSize, uClip; varying vec2 vUv;
float lin(float z){ return uClip.x * uClip.y / (uClip.y - z * (uClip.y - uClip.x)); }
vec3 srgbDec(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main(){ vec3 c = srgbDec(texture(tColor, vUv).rgb);
  vec2 p = vUv * uFogSize - 0.5, f = fract(p), b = (floor(p) + 0.5) / uFogSize, s = 1.0 / uFogSize; float z0 = lin(texture(tDepth, vUv).r); vec4 F = vec4(0.0); float W = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) { vec2 u = b + s * vec2(x, y); float zz = lin(texture(tDepth, u).r), w = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y) / (0.02 + abs(z0 - zz) / (0.1 + z0 * 0.05)); F += texture(tFog, u) * w; W += w; }
  F /= W; gl_FragColor = vec4(min(c * F.a + toneMapping(F.rgb), vec3(1.0)), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0; // ±0.5/255 抖动，雾的渐变不出色带
}`;
const clip = { value: new THREE.Vector2() }, blurU = { tFog: { value: null }, tDepth: U.tDepth, uDir: { value: new THREE.Vector2() }, uClip: clip };
const compU = { tColor: { value: null }, tFog: { value: null }, tDepth: U.tDepth, uFogSize: { value: new THREE.Vector2() }, uClip: clip };

function noise3D(N) { // 可平铺的三层值噪声，雾只采它，不在着色器里现算
  const data = new Uint8Array(N * N * N); let s = 19; const lat = new Float32Array(N * N * N).map(() => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const at = (x, y, z, p) => lat[(x % p) * (N / p | 0) + ((y % p) * (N / p | 0)) * N + ((z % p) * (N / p | 0)) * N * N];
  const f = (t) => t * t * (3 - 2 * t), l = (a, b, t) => a + (b - a) * t, vn = (x, y, z, p) => { const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = f(x - X), v = f(y - Y), w = f(z - Z);
    return l(l(l(at(X, Y, Z, p), at(X + 1, Y, Z, p), u), l(at(X, Y + 1, Z, p), at(X + 1, Y + 1, Z, p), u), v), l(l(at(X, Y, Z + 1, p), at(X + 1, Y, Z + 1, p), u), l(at(X, Y + 1, Z + 1, p), at(X + 1, Y + 1, Z + 1, p), u), v), w); };
  for (let k = 0, i = 0; k < N; k++) for (let j = 0; j < N; j++) for (let h = 0; h < N; h++, i++) {
    let v = 0, a = 0.55, p = 6, A = 0; for (let o = 0; o < 3; o++) { v += a * vn(h / N * p, j / N * p, k / N * p, p); A += a; a *= 0.5; p = Math.min(N, p * 2); } data[i] = Math.min(255, v / A * 255); }
  const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
function build() {
  const fs = (name, fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ name, vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, ...extra });
  march = TIERS.map((t) => fs('volfog-march', FOG_FRAG, U, { defines: { STEPS: t.steps } }));
  blurM = fs('volfog-blur', BLUR_FRAG, blurU); compM = fs('volfog-comp', COMP_FRAG, compU, { toneMapped: true }); // toneMapped：要 toneMapping() 这个函数（散射光自己做色调映射）
  fsScene = new THREE.Scene(); fsCam = new THREE.Camera(); fsTri = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))); fsTri.frustumCulled = false; fsScene.add(fsTri);
  rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType) });
  rt.isXRRenderTarget = true; rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; // 见文件头：材质照常色调映射、输出 sRGB，存成普通 8 位
  U.tDepth.value = rt.depthTexture; compU.tColor.value = rt.texture;
  const o = { type: THREE.HalfFloatType, depthBuffer: false }; fogA = new THREE.WebGLRenderTarget(4, 4, o); fogB = new THREE.WebGLRenderTarget(4, 4, o);
  const S = 1024; sunRT = new THREE.WebGLRenderTarget(S, S, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: new THREE.DepthTexture(S, S, THREE.UnsignedIntType) }); U.tSun.value = sunRT.depthTexture;
  sunCam = new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 400); sunCam.layers.set(FOG_LAYER); shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  U.tNoise.value = noise3D(48); volfog.built = true;
}
// 水面遮罩：湖和河的网格从正上方画一张白色俯视图（2m 一格，带 mipmap），雾按它在水面上放晨雾。找不到水就重试几次（开了没水的场景不会白画）
function buildWater() {
  const lake = scene.getObjectByName('lake'), river = scene.getObjectByName('river'); if (++waterTry > 5 || !lake || !river) return;
  const box = new THREE.Box3().setFromObject(lake).union(new THREE.Box3().setFromObject(river)).expandByScalar(30), sx = box.max.x - box.min.x, sz = box.max.z - box.min.z, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const W = Math.min(2048, Math.ceil(sx / 2)), H = Math.min(2048, Math.ceil(sz / 2)), WL = FOG_LAYER + 1;
  waterRT = new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const cam = new THREE.OrthographicCamera(-sx / 2, sx / 2, sz / 2, -sz / 2, 1, 200); cam.up.set(0, 0, -1); cam.position.set(cx, 100, cz); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(); cam.layers.set(WL);
  lake.layers.enable(WL); river.layers.enable(WL);
  const bg = scene.background, fog = scene.fog, sm = renderer.shadowMap.enabled, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  scene.background = null; scene.fog = null; scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false }); renderer.shadowMap.enabled = false; renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(waterRT); renderer.clear(); renderer.render(scene, cam);
  scene.overrideMaterial.dispose(); scene.overrideMaterial = null; scene.background = bg; scene.fog = fog; renderer.shadowMap.enabled = sm; renderer.setClearColor(cc, ca);
  U.tWater.value = waterRT.texture; U.uWO.value.set(box.min.x, box.max.z); U.uWS.value.set(1 / sx, 1 / sz);
}
export function volShift(dx, dz) { if (waterRT) { U.uWO.value.x += dx; U.uWO.value.y += dz; } volfog.sunDirty = true; } // 第 3 天世界平移（shiftWorld）：湖河跟着挪了，水面遮罩的原点同挪；树也挪了，太阳深度图要重画
const blit = (mat, target) => { fsTri.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };
const _c = new THREE.Vector3(), _sz = new THREE.Vector2(), shC = new THREE.Vector3(1e9, 0, 0); let shAt = -1e9;
function fogShadow(now) { // 雾专用太阳深度图：只有树（主页面的树不投影，阴影贴图里没有它们，光束就穿不出树缝）；太阳转了、人走远了才重画，最多半秒一次
  const cp = camera.position; if (!volfog.sunDirty && Math.hypot(cp.x - shC.x, cp.z - shC.z) < 25) return; if (now - shAt < 500) return;
  shAt = now; volfog.sunDirty = false; shC.set(Math.round(cp.x / 10) * 10, U.uBase.value, Math.round(cp.z / 10) * 10);
  sunCam.position.copy(shC).addScaledVector(U.uSunDir.value, 200); sunCam.lookAt(shC); sunCam.updateMatrixWorld();
  const bg = scene.background, sm = renderer.shadowMap.enabled; scene.background = null; scene.overrideMaterial = shadowOnly; renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(sunRT); renderer.clear(); renderer.render(scene, sunCam);
  scene.overrideMaterial = null; scene.background = bg; renderer.shadowMap.enabled = sm;
  U.uSunVP.value.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
}
// 主画面：代替 renderer.render(scene, camera)，返回主画面的三角面数（?fps 角标用）。outdoors = 主相机开着屋外那层（屋里看不到屋外时不走雾）
export function volDraw(outdoors, groundY, sunD, now, force) {
  const far = scene.fog ? scene.fog.far : 1e9, k = volfog.on && volfog.tier < 2 && (outdoors || force) ? (force ? 1 : sstep(55, 110, far)) : 0; // 浓雾天、第 2 天林子里（雾远 26m）本来就看不远，不叠
  volfog.active = k > 0;
  if (!volfog.active) { renderer.setRenderTarget(null); renderer.render(scene, camera); return renderer.info.render.triangles; }
  if (!volfog.built) build();
  if (!waterRT && waterTry <= 5) buildWater();
  renderer.getDrawingBufferSize(_sz); const T = TIERS[volfog.tier];
  if (rt.width !== _sz.x || rt.height !== _sz.y) rt.setSize(_sz.x, _sz.y);
  const fw = Math.max(2, Math.round(_sz.x * T.res)), fh = Math.max(2, Math.round(_sz.y * T.res)); if (fogA.width !== fw || fogA.height !== fh) { fogA.setSize(fw, fh); fogB.setSize(fw, fh); }
  renderer.setRenderTarget(rt); renderer.render(scene, camera); const tris = renderer.info.render.triangles;
  U.uSunDir.value.copy(sunD); U.uBase.value = groundY - 0.3; U.uT.value = now / 1000; U.uD.value = 0.05 * k; U.uW.value = 0.22 * k;
  U.uSunC.value.copy(sun.color).multiplyScalar(sun.intensity * 1.4 * sstep(-0.02, 0.08, sunD.y)); U.uAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.45);
  const box = window.cabin && window.cabin.box; if (box && !box.isEmpty()) { U.uBoxMin.value.copy(box.min).subScalar(0.3); U.uBoxMax.value.copy(box.max).addScalar(0.3); }
  fogShadow(now);
  U.uInvP.value.copy(camera.projectionMatrixInverse); U.uCamW.value.copy(camera.matrixWorld); U.uCam.value.setFromMatrixPosition(camera.matrixWorld); clip.value.set(camera.near, camera.far);
  blit(march[volfog.tier], fogA);
  blurU.tFog.value = fogA.texture; blurU.uDir.value.set(1.5 / fw, 0); blit(blurM, fogB);
  blurU.tFog.value = fogB.texture; blurU.uDir.value.set(0, 1.5 / fh); blit(blurM, fogA);
  compU.tFog.value = fogA.texture; compU.uFogSize.value.set(fw, fh); blit(compM, null);
  return tris;
}
// 帧间隔均值持续 >24ms（同 adaptRes 的门槛）就降一档：高 → 低 → 关。只在雾真的在画时量
export function volTick(now, dt) {
  if (!volfog.active || dt <= 0 || dt > 0.25 || document.hidden) { volfog.at = now; volfog.ema = 0.016; return; }
  volfog.ema += (dt - volfog.ema) * 0.05;
  if (now - volfog.at > 2500 && volfog.ema > 0.024) { volfog.tier++; volfog.at = now; volfog.ema = 0.016; }
}
