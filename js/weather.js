// 天气：晴、阴、雨、雷雨、雪、暴雪、浓雾；降水粒子、地面积水积雪、屋顶积雪和檐口掉雪（2026-10-30 从 index.html 拆出；主页面的变量写 shared.名字，见 web/CLAUDE.md「模块」）
import { $, lbl, scene, sun, hemi, camera, renderer } from './core.js';
import { WX_ZH, sky, skyEl, skyU, indoorU } from './time-of-day.js';
import * as THREE from 'three';
import { shared, share } from './state.js';

// ===== 天气：晴、阴、雨、雷雨、雪、暴雪、浓雾 =====
// cloud 天空变灰、太阳变弱、星月隐去；fogK 把雾混到 near/far（far 至少 = 相机距离 + far×0.5，拉远也看得到小屋）；
// rain/snow 粒子密度 0–1；wind 风速 m/s（沿 +x）；bolt 有无闪电。切换时所有数值约 3 秒渐变。
const WEATHERS = [
  ['Fair',         { cloud: 0,    fogK: 0,   near: 30, far: 160, rain: 0,   snow: 0,   wind: 0,   bolt: 0 }],
  ['Overcast',     { cloud: 0.75, fogK: 0.3, near: 20, far: 120, rain: 0,   snow: 0,   wind: 0.5, bolt: 0 }],
  ['Rain',         { cloud: 0.85, fogK: 0.6, near: 10, far: 80,  rain: 0.55, snow: 0,  wind: 1.5, bolt: 0 }],
  ['Thunderstorm', { cloud: 0.97, fogK: 0.7, near: 6,  far: 60,  rain: 1,   snow: 0,   wind: 4,   bolt: 1 }],
  ['Snow',         { cloud: 0.7,  fogK: 0.5, near: 10, far: 90,  rain: 0,   snow: 0.45, wind: 0.6, bolt: 0 }],
  ['Blizzard',     { cloud: 0.9,  fogK: 1,   near: 1,  far: 32,  rain: 0,   snow: 1,   wind: 9,   bolt: 0 }],
  ['Fog',          { cloud: 0.6,  fogK: 1,   near: 0,  far: 24,  rain: 0,   snow: 0,   wind: 0.2, bolt: 0 }],
];
const wx = { name: 'Fair', goal: WEATHERS[0][1], cur: { ...WEATHERS[0][1] }, t: 0, flashes: [], nextBolt: 4, flash: 0 };
// 天气按钮前的抽象图标：20×20 细线（样式见 #wxIco）。晴 = 圆 + 八道短芒；云系 = 地平线上的半圆（DOME），下面加雨丝 / 闪电 / 雪点；雾 = 三道错开的横线
const DOME = 'M4 10a6 6 0 0 1 12 0M2.5 10h15', wxDot = (x, y) => `<circle class="f" cx="${x}" cy="${y}" r=".95"/>`;
const WX_ICON = {
  Fair: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M14.2 5.8l.9-.9M5.8 5.8l-.9-.9M14.2 14.2l.9.9M5.8 14.2l-.9.9"/>',
  Overcast: '<path d="M4 12a6 6 0 0 1 12 0M2.5 12h15M5.5 15h9"/>',
  Rain: `<path d="${DOME}M7 12.5l-1 3M10.5 12.5l-1 3M14 12.5l-1 3"/>`,
  Thunderstorm: `<path d="${DOME}M11 12l-2 3h3l-2 3.5"/>`,
  Snow: `<path d="${DOME}"/>${wxDot(6.5, 13.5)}${wxDot(10, 16)}${wxDot(13.5, 13.5)}`,
  Blizzard: `<path d="${DOME}M3 13.2h7"/>${wxDot(13.5, 13.2)}${wxDot(16.5, 15.8)}${wxDot(6, 16.5)}${wxDot(10.5, 17)}`,
  Fog: '<path d="M3 6.5h14M5.5 10h12M3 13.5h11"/>',
};
const wxPanel = $('wxPanel');
for (const [n, p] of WEATHERS) {
  const b = document.createElement('button'); b.innerHTML = lbl(n, WX_ZH[n]);
  b.onclick = () => { setWeather(n); if (n === 'Thunderstorm' && !(sky.hour >= 20 || sky.hour < 4)) sky.goal = 22; };
  wxPanel.appendChild(b); // 手动选雷雨时如果不是夜里，时间转到 22 点（自动换天气不转）
}
// 打开时随机一种天气（直接到位，不渐变），之后每 2–4 分钟自动换成另一种；手动选了就从那时重新计时
let wxTimer = 0;
function setWeather(n, now) {
  const i = WEATHERS.findIndex((w) => w[0] === n), p = WEATHERS[i][1];
  wx.name = n; wx.goal = p; if (now) wx.cur = { ...p };
  $('wxName').innerHTML = lbl(n, WX_ZH[n]); $('wxIco').innerHTML = `<svg viewBox="0 0 20 20">${WX_ICON[n]}</svg>`; [...wxPanel.children].forEach((c, k) => c.classList.toggle('on', k === i));
  clearTimeout(wxTimer);
  wxTimer = setTimeout(() => { const o = WEATHERS.filter((w) => w[0] !== wx.name); setWeather(o[Math.floor(Math.random() * o.length)][0]); }, (120 + Math.random() * 120) * 1000);
}
setWeather(WEATHERS[Math.floor(Math.random() * WEATHERS.length)][0], true);
// 底部三个按钮：天气在正中，时间、Journal 分在两边、离它一样远（CSS grid 1fr auto 1fr）；时钟按最宽的数字定宽、右对齐，
// 每分钟跳字时什么都不动；只有时段名、天气名变的那一下整排挪一次（原来按最长文字给每个按钮留宽，Snow 后面空一大截，看着不居中）
function fixClockWidth() {
  const c = skyEl.clock, keep = c.textContent; let w = 0;
  c.style.minWidth = '';
  for (let d = 0; d < 10; d++) { c.textContent = `${d}${d}:${d}${d}`; w = Math.max(w, c.getBoundingClientRect().width); }
  c.textContent = keep; if (w) c.style.minWidth = Math.ceil(w) + 'px';
}
document.fonts.ready.then(fixClockWidth);

// 降水粒子：在相机周围 2R×H 的盒子里循环（着色器里按时间下落 + 取模，不占 CPU）；小屋屋顶下面挖空，屋里看不到雨雪、窗外看得到
const P_R = 24, P_H = 22;
const precipU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: 0 }, uGround: { value: -1e4 },
  uHole: { value: new THREE.Vector4(0, 0, 0, -1e4) }, uFogN: { value: 30 }, uFogF: { value: 160 }, uScale: { value: 500 } };
function precipMat(snow, color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { ...precipU, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uFall: { value: snow ? 1.1 : 9 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `uniform float uTime, uWind, uGround, uFogN, uFogF, uScale, uFall; uniform vec3 uCam; uniform vec4 uHole;
      attribute vec4 aSeed; varying float vA;
      void main() {
        float sp = 0.75 + 0.5 * aSeed.w;
        vec3 box = vec3(${2 * P_R}.0, ${P_H}.0, ${2 * P_R}.0);
        vec3 p = aSeed.xyz * box;
        p.y -= uTime * uFall * sp;
        p.x += uTime * uWind * sp;
        ${snow ? 'p.x += sin(uTime * 1.3 + aSeed.w * 40.0) * 0.5; p.z += cos(uTime * 1.1 + aSeed.w * 23.0) * 0.5;' : ''}
        vec3 org = vec3(uCam.x - ${P_R}.0, max(uCam.y - ${P_H / 2}.0, uGround), uCam.z - ${P_R}.0);
        p = org + mod(p - org, box);
        // 屋顶下挖空、离相机太近的不画：按雨滴头部判断，一条雨丝的两个端点一起丢（只丢一端会拉出一条横穿屏幕的线）
        bool kill = abs(p.x - uHole.x) < uHole.z && abs(p.z - uHole.y) < uHole.z && p.y < uHole.w;
        float d0 = -(viewMatrix * vec4(p, 1.0)).z;
        ${snow ? '' : 'kill = kill || d0 < 0.8; p -= vec3(uWind, -uFall, 0.0) * sp * 0.035 * float(gl_VertexID % 2);'}
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = (1.0 - smoothstep(uFogN, uFogF, d)) * (1.0 - smoothstep(${P_R * 0.7}, ${P_R}.0, length(p.xz - uCam.xz)));
        if (kill) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        ${snow ? 'gl_PointSize = min(uScale * 0.05 / max(d, 0.1), 24.0);' : ''}
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main() {
        float a = uOpacity * vA;
        ${snow ? 'a *= smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));' : ''}
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
}
function precipGeo(n, verts) {
  const a = new Float32Array(n * verts * 4);
  for (let i = 0; i < n; i++) { const s = [Math.random(), Math.random(), Math.random(), Math.random()]; for (let v = 0; v < verts; v++) a.set(s, (i * verts + v) * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aSeed', new THREE.BufferAttribute(a, 4));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * verts * 3), 3)); // 占位，位置全在着色器里算
  return g;
}
const wxLite = matchMedia('(pointer: coarse)').matches; // 手机粒子减半
const RAIN_N = wxLite ? 7000 : 14000, SNOW_N = wxLite ? 6000 : 12000;
const rainFx = new THREE.LineSegments(precipGeo(RAIN_N, 2), precipMat(false, 0xb8c4d0, 0.45));
const snowFx = new THREE.Points(precipGeo(SNOW_N, 1), precipMat(true, 0xffffff, 0.9));
for (const o of [rainFx, snowFx]) { o.frustumCulled = false; o.visible = false; o.renderOrder = 2; scene.add(o); }
function precipHole(center, top) { precipU.uHole.value.set(center.x, center.z, 2.4, top); } // 模型加载后调用

// 地上积水、积雪（地面、院子、小路、路边落叶带都加）：uWet/uSnow 0–1 在 applyWeather 里随时间涨落
// 湿了整体变暗、变光滑；低洼处（低频噪声高的地方）先出水洼：很暗、几乎镜面，下雨时有细小涟漪闪光
// 积雪从零星的白斑长成整片，雪下面的颜色和粗糙度都被盖掉
// uDoor = 大门合页 (x, z)、扫过的半径、已扫到的角度（-1 没扫）；uSweep = 扫开的地方还剩几成没被新雪盖回去；uDoorOld = 上一个扇形（下沿角, 上沿角, 剩几成, 当前扇形的下沿角），新一次开关门时旧扇形不突变、继续盖回
const cover = { uWet: { value: 0 }, uSnow: { value: 0 }, uDoor: { value: new THREE.Vector4(0, 0, 0, -1) }, uSweep: { value: 0 }, uDoorOld: { value: new THREE.Vector4(0, -1, 0, 0) }, uRain: { value: 0 } }; // uRain = 当前雨量（水洼涟漪）
// 世界平移（第 3 天走到 ✕：屋外的东西和人一起挪 -X，屋子留在原点当那一间）：屋外的地面 / 路 / 落叶按世界坐标取纹理，
// 加上 WS（= X）脚下纹理就不跳；小屋自己的材质（院子、门口积雪扇形）用 ZW 恒为 0
const WS = { value: new THREE.Vector2() }, ZW = { value: new THREE.Vector2() };
function wsPos(sh) { sh.uniforms.uWShift ||= ZW; if (!sh.vertexShader.includes('uniform vec2 uWShift;')) sh.vertexShader = 'uniform vec2 uWShift;' + String.fromCharCode(10) + sh.vertexShader; }
function groundCover(sh) {
  Object.assign(sh.uniforms, cover, { uCovT: precipU.uTime });
  wsPos(sh); sh.vertexShader = 'varying vec2 vCovP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCovP = (modelMatrix * vec4(position, 1.0)).xz + uWShift;');
  sh.fragmentShader = `uniform float uWet, uSnow, uCovT, uSweep, uRain; uniform vec4 uDoor, uDoorOld; varying vec2 vCovP;
float doorFan(float da, float lo, float hi) { // 角度 [lo, hi] 的扇形；lo≈0 时往门槛下多盖一点
  return smoothstep(lo < 0.01 ? -0.12 : lo - 0.04, lo < 0.01 ? 0.0 : lo + 0.03, da) * (1.0 - smoothstep(hi - 0.03, hi + 0.04, da)); }
float ch(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + 1.0), f.x), f.y); }
// 雨点落进水洼的涟漪：三层错开的 0.3m 格子，每格每个周期（0.6–1.2s）按雨量决定落不落一滴，落了就从随机圆心扩散一圈细环（最大半径 9cm），越大越淡。
// 返回 (环的强度, 世界 xz 上的法线偏转)；远处环比像素还细时按 fwidth 淡掉，不出锯齿。原来是 12cm 方格整格闪（看起来是方块）
vec3 ripples(vec2 p, float t, float amt) {
  vec3 s = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 q = p / 0.3 + vec2(fk * 0.37, fk * 0.71), c = floor(q), f = fract(q);
    float h1 = ch(c + fk * 17.0), h2 = ch(c + 3.1 + fk * 29.0), h3 = ch(c + 7.7 + fk * 5.0);
    float per = 0.6 + 0.6 * h1, cyc = t / per + h2, a = fract(cyc);
    float on = step(1.0 - 0.75 * amt, ch(c + floor(cyc) * 1.37 + fk));
    vec2 o = 0.3 + 0.4 * vec2(h3, fract(h3 * 7.3 + h1)), v = f - o;
    float d = length(v), w = 0.03 + fwidth(d), e = (d - a * 0.3) / w, e2 = (d - a * 0.17) / w;
    float pr = exp(-e * e * 2.0) + 0.5 * exp(-e2 * e2 * 2.0) * step(0.15, a); // 外圈 + 稍后跟出的内圈
    float amp = on * (1.0 - a) * (1.0 - a) * min(1.0, 0.045 / w);
    s.x += pr * amp; s.yz += v / max(d, 1e-3) * (e * exp(-e * e * 2.0)) * amp;
  }
  return s;
}
` + sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
    float cLow = 0.55 * cn(vCovP / 2.3) + 0.3 * cn(vCovP / 0.9 + 7.0) + 0.15 * cn(vCovP / 0.3);
    diffuseColor.rgb *= 1.0 - 0.35 * uWet;
    roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uWet);
    float pud = smoothstep(1.02 - 0.42 * uWet, 1.06 - 0.42 * uWet, cLow) * step(0.05, uWet);
    vec3 rip3 = uRain > 0.01 ? ripples(vCovP, uCovT, min(uRain, 1.0)) : vec3(0.0); float rip = min(rip3.x, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35 + 0.02, pud);
    roughnessFactor = mix(roughnessFactor, 0.04 + 0.3 * rip, pud);
    vec3 ripN = (viewMatrix * vec4(rip3.y, 0.0, rip3.z, 0.0)).xyz * 0.5 * pud; // 环上法线往外/往里歪，水面倒影跟着扭
    float sn = smoothstep(0.0, 0.18, uSnow * 1.2 - 0.6 * cLow - 0.05);
    vec2 dp = vCovP - uDoor.xy; float dr = length(dp), da = atan(dp.y, dp.x); // 开门扫过的扇形里没雪，扇形外沿被推出一圈更厚的雪
    float clr = max(doorFan(da, uDoorOld.w, uDoor.w) * uSweep, doorFan(da, uDoorOld.x, uDoorOld.y) * uDoorOld.z); // 当前扇形 + 上一次开关门扫的旧扇形（继续慢慢盖回）
    sn *= 1.0 - clr * (1.0 - smoothstep(uDoor.z - 0.06, uDoor.z, dr));
    sn = clamp(sn + clr * exp(-pow((dr - uDoor.z - 0.05) / 0.05, 2.0)) * smoothstep(0.02, 0.08, uSnow), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92) * (0.93 + 0.07 * cn(vCovP / 0.2)), sn);
    roughnessFactor = mix(roughnessFactor, 0.85, sn);`).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n    normal = normalize(normal + ripN * (1.0 - sn));')
    // 水洼近镜面，直接反射 scene.environment（RoomEnvironment = 一间有方形灯箱的屋子）会照出一块块方形亮斑 → 水洼里换成模糊的环境光（irradiance/π），涟漪的环再亮一点
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n    radiance = mix(radiance, iblIrradiance * RECIPROCAL_PI * (1.0 + 1.5 * rip), pud * (1.0 - sn));');
}

const _grey = new THREE.Color();
const greyOf = (c, k) => _grey.setScalar((0.3 * c.r + 0.59 * c.g + 0.11 * c.b) * k);
function applyWeather(dt) { // 在 applySky 之后：天空/光照按天气压暗；闪电
  const c = wx.cur, g = wx.goal, k = Math.min(1, dt * 0.8);
  for (const key in c) c[key] += (g[key] - c[key]) * k;
  wx.t += dt;
  skyU.uTop.value.lerp(greyOf(skyU.uTop.value, 0.75), c.cloud);
  skyU.uHor.value.lerp(greyOf(skyU.uHor.value, 0.85), c.cloud);
  skyU.uTop.value.lerp(skyU.uHor.value, c.fogK * 0.85); // 浓雾里天顶也是雾色
  scene.fog.color.copy(skyU.uHor.value);
  sun.intensity *= 1 - 0.92 * c.cloud;
  hemi.color.lerp(greyOf(hemi.color, 1), c.cloud * 0.7);
  hemi.intensity *= 1 - 0.3 * c.cloud;
  scene.environmentIntensity *= 1 - 0.3 * c.cloud;
  skyU.uSunUp.value *= 1 - c.cloud; skyU.uNight.value *= (1 - c.cloud) ** 2 * (1 - c.fogK); // 阴天、雨雪、雾夜：星星月亮压掉
  // 闪电：雷雨时每 4–12 秒一次；每次 1 秒左右里闪 3–5 下（[开始时刻, 亮度, 衰减]），再带一段约 1.5 秒的余光
  if (g.bolt && (wx.nextBolt -= dt) <= 0) {
    wx.nextBolt = 4 + Math.random() * 8;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0, t = wx.t; i < n; i++, t += 0.08 + Math.random() * 0.3) wx.flashes.push([t, 0.6 + Math.random() * 0.6, 5 + Math.random() * 5]);
    wx.flashes.push([wx.t, 0.35, 1.6]);
  }
  let f = 0;
  wx.flashes = wx.flashes.filter(([t0]) => wx.t - t0 < 4);
  for (const [t0, a, k] of wx.flashes) if (wx.t >= t0) f += a * Math.exp(-(wx.t - t0) * k);
  f = Math.min(f, 1.4) * c.bolt;
  // 积水、积雪：下着就涨，停了干/化；下雨化雪更快
  cover.uRain.value = c.rain;
  cover.uWet.value = THREE.MathUtils.clamp(cover.uWet.value + dt * (c.rain > 0.05 ? c.rain / 14 : -1 / 10), 0, 1); // Rain 约 25 秒、雷雨约 14 秒积满，停后 10 秒干
  cover.uSnow.value = THREE.MathUtils.clamp(cover.uSnow.value + dt * (c.snow > 0.05 ? c.snow / 9 : c.rain > 0.05 ? -1 / 15 : -1 / 20), 0, 1); // Snow 约 20 秒、暴雪约 9 秒盖满，停后 20 秒化完
  skyU.uFlash.value = f * 0.9;
  indoorU.uFlashIn.value = hemi.intensity / (hemi.intensity + f * 2.2 + 1e-6); // 屋内抵消闪电（见 indoorShade）
  hemi.intensity += f * 2.2; hemi.color.lerp(_grey.setRGB(0.8, 0.85, 1), Math.min(1, f));
  // 雨雪颜色跟着天色走（夜里暗），闪电时亮一下
  const lum = 0.25 + 0.75 * Math.min(1, hemi.intensity / 0.8);
  rainFx.material.uniforms.uColor.value.setRGB(0.72, 0.77, 0.82).multiplyScalar(lum);
  snowFx.material.uniforms.uColor.value.setScalar(0.95).multiplyScalar(lum);
}
function updatePrecip(dt) { // 渲染循环里，雾算完之后
  const c = wx.cur;
  precipU.uTime.value += dt; precipU.uCam.value.copy(camera.position); precipU.uWind.value = c.wind;
  precipU.uGround.value = shared.ground.position.y; precipU.uFogN.value = scene.fog.near; precipU.uFogF.value = scene.fog.far;
  precipU.uScale.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
  rainFx.visible = c.rain > 0.01; rainFx.geometry.setDrawRange(0, 2 * Math.floor(RAIN_N * Math.min(1, c.rain)));
  snowFx.visible = c.snow > 0.01; snowFx.geometry.setDrawRange(0, Math.floor(SNOW_N * Math.min(1, c.snow)));
}

// 屋顶积雪 → 积厚了整片滑下来、从檐口落成墙边的雪堆；下雨时檐口滴水；有雪时开大门把门前的雪扫开。
// 屋顶是沿 z 的双坡、檐口在 x≈±2.6：加载后按瓦顶最高点拟合坡面 y = top − slope·|x|（setupRoofWeather），渲染循环里 updateRoofWeather
const roofWx = { sides: [], piles: [], fit: null, door: null };
const snowMat = new THREE.MeshStandardMaterial({ color: 0xe4e8ee, roughness: 0.85 });
function moundGeo() { // 雪堆：沿 z 的半圆柱（长 1、半径 1），两头收尖、顶上起伏，缩放成实际大小
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 30, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), t = Math.min(1, (0.5 - Math.abs(z)) * 5), w = 0.75 + 0.25 * Math.sin(z * 23) * Math.sin(z * 9 + 1);
    p.setX(i, p.getX(i) * (0.4 + 0.6 * t)); p.setY(i, Math.max(0, p.getY(i)) * Math.sqrt(t) * w);
  }
  g.computeVertexNormals(); return g;
}
function slabGeo(L, W) { // 坡上的一层雪：x 沿坡往下 0→L，y 底 0 / 顶 = 厚度系数（fitSlab 换成实际高度），z 沿屋脊；顶面起伏，四边圆一点
  const g = new THREE.BoxGeometry(L, 1, W, 80, 1, 40).translate(L / 2, 0.5, 0), p = g.attributes.position; // x 4cm 一格，才跟得上一排排瓦（排距 22cm）
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (p.getY(i) > 0.5) p.setY(i, (0.82 + 0.1 * Math.sin(x * 5 + z * 1.3) * Math.sin(z * 3.7) + 0.08 * Math.sin(z * 11 + x * 7))
      * Math.min(1, (L - x) * 5 + 0.35) * Math.min(1, x * 6 + 0.4) * Math.min(1, (W / 2 - Math.abs(z)) * 6 + 0.4));
  }
  g.computeVertexNormals(); return g;
}
// 雪板贴瓦（2026-10-22 修穿模）：瓦是一排排厚木瓦，每排下沿（瓦尾）比拟合坡面高 0–15cm（越近屋脊越高，拟合斜率偏缓），
// 原来平直的雪板（底面 = 坡面 −SINK）被瓦尾从雪里顶出来，看着像雪嵌在木板里。加载时沿坡每 2cm 量瓦顶离坡面多高（垂直坡面）：
// tile = 实际锯齿（每格取 ±6cm 最大，顶点 4cm 一个，中间不漏），env = 瓦尾连成的包络（±12cm 最大再平滑）。
// 雪板底面 = tile − SINK（跟着锯齿压进瓦里，山墙端看不到底下的三角空隙），顶面 = mix(tile, env, 填平) + 厚度×起伏：薄雪贴着每排瓦，厚了（15cm）填平成整片。
function roofProfile(roof, F) {
  const bin = 0.02, n = Math.ceil((F.len + 0.1) / bin), raw = new Array(n).fill(-1e9), v = new THREE.Vector3(), c = Math.cos(F.ang), s = Math.sin(F.ang);
  let meshes = []; roof.traverse((m) => { if (m.isMesh && /shingle/i.test((m.material && m.material.name) || '')) meshes.push(m); });
  if (!meshes.length) roof.traverse((m) => { if (m.isMesh) meshes.push(m); }); // 找不到瓦片材质就用整个屋顶
  for (const m of meshes) {
    m.updateMatrixWorld(); const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const dx = Math.abs(v.x), dy = v.y - F.top;
      const u = dx * c - dy * s, h = dx * s + dy * c, b = Math.round(u / bin); // u 沿坡距屋脊，h 垂直坡面高出多少
      if (b >= 0 && b < n) raw[b] = Math.max(raw[b], h);
    }
  }
  for (let b = 0; b < n; b++) if (raw[b] < -1e8) { // 空格按两边插值
    let a = b - 1, e = b + 1; while (e < n && raw[e] < -1e8) e++;
    raw[b] = a < 0 ? (e < n ? raw[e] : 0) : e >= n ? raw[a] : raw[a] + (raw[e] - raw[a]) * (b - a) / (e - a);
  }
  const win = (a, r, f) => a.map((_, b) => { let x = f === 'max' ? -1e9 : 0, k = 0; for (let j = Math.max(0, b - r); j <= Math.min(n - 1, b + r); j++) { x = f === 'max' ? Math.max(x, a[j]) : x + a[j]; k++; } return f === 'max' ? x : x / k; });
  const tile = win(raw, 3, 'max'), env = win(win(raw, 6, 'max'), 3, 'avg').map((x, b) => Math.max(x, tile[b]));
  return { bin, n, tile, env };
}
function fitSlab(S, th) { // 按厚度 th 重算这一坡雪板的顶点高度（代替原来的 scale.y）；厚度变化 <3mm 不重算
  if (Math.abs(th - S.built) < 0.003) return;
  S.built = th;
  const P = roofWx.prof, g = S.slab.geometry, p = g.attributes.position, o = S.base, f = THREE.MathUtils.smoothstep(th, 0.02, 0.15);
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(P.n - 1, Math.max(0, Math.round(o[i * 3] / P.bin))), t = P.tile[k], y = o[i * 3 + 1];
    p.setY(i, y < 1e-4 ? t - SINK : t + (P.env[k] - t) * f + th * y);
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
}
// 檐口掉雪（2026-10-22 重做；原来是 20 面硬块、3–11cm 均匀、落地直接消失，像白方块）：雪团 = 凹凸低模球，随机压扁、翻滚，
// 小的多大的少；下落途中掉粉，大块落地碎成 2–4 小块弹开，小块落地停住、缩进雪里，同时扬一小团雪粉（powder，Points 软圆点）。
// 雪粉轨迹全在着色器里按时间算，JS 只在生成那一刻写一次属性；没有雪团/雪粉时两样都不画、不更新。
const CHUNK_N = 260;
function lumpGeo() { // 半径 ~1 的凹凸雪团：80 面球按方向噪声缩放，法线用方向（看着软，不出棱角）
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, v.x, v.y, v.z);
    const r = 1 + 0.3 * Math.sin(v.x * 5 + 1) * Math.sin(v.y * 4 + 2) * Math.sin(v.z * 6) + 0.12 * Math.sin(v.x * 11 + v.z * 9) * Math.sin(v.y * 7);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  return g;
}
const chunks = new THREE.InstancedMesh(lumpGeo(), snowMat, CHUNK_N);
const chunkP = new Float32Array(CHUNK_N * 3), chunkV = new Float32Array(CHUNK_N * 3), chunkS = new Float32Array(CHUNK_N);
const chunkA = new Float32Array(CHUNK_N * 3), chunkR = new Float32Array(CHUNK_N * 3), chunkW = new Float32Array(CHUNK_N * 3);
const chunkL = new Float32Array(CHUNK_N), chunkG = new Uint8Array(CHUNK_N); // chunkL：<0 在下落，≥0 落地后经过的秒数；chunkG：1 = 碎出来的小块（不再碎）
let chunkI = 0, chunkLive = 0;
chunks.frustumCulled = false; chunks.visible = false;
const POW_N = 700; // 雪粉
const powU = { uTime: precipU.uTime, uColor: snowFx.material.uniforms.uColor, uScale: precipU.uScale, uFogN: precipU.uFogN, uFogF: precipU.uFogF, uWind: { value: 0 } };
const powA = { p: new Float32Array(POW_N * 3), v: new Float32Array(POW_N * 3), t: new Float32Array(POW_N * 4).fill(-99) };
const powder = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(powA.p, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(powA.v, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(powA.t, 4)); // 出生时刻、寿命、大小（米）、随机数
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: powU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `uniform float uTime, uScale, uFogN, uFogF, uWind; attribute vec3 aV; attribute vec4 aT; varying float vA;
      void main() {
        float t = uTime - aT.x, k = t / aT.y;
        float dr = (1.0 - exp(-3.0 * t)) / 3.0; // 空气阻力：很快慢下来、飘着
        vec3 p = position + aV * dr + vec3(uWind * t, -0.18 * t * t, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = smoothstep(0.0, 0.06, t) * pow(max(0.0, 1.0 - k), 1.6) * (0.35 + 0.25 * aT.w) * (1.0 - smoothstep(uFogN, uFogF, d));
        gl_PointSize = min(uScale * aT.z * (1.0 + 2.2 * k) / max(d, 0.1), 90.0); // 散开时越来越大、越来越淡
        if (k < 0.0 || k > 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, vA * exp(-r * r * 3.5) * (1.0 - r * r));
        #include <colorspace_fragment>
      }`,
  }));
  pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 2; pts.userData.until = -1; pts.userData.i = 0;
  return pts;
})();
function puff(x, y, z, n, spd, up, size, life) { // 扬一团雪粉：n 粒，水平散开速度 spd、向上 up（m/s），大小 size 米，寿命 life 秒
  const now = precipU.uTime.value, U = powder.userData;
  for (let j = 0; j < n; j++) {
    const i = U.i = (U.i + 1) % POW_N, a = Math.random() * 6.283, s = spd * (0.3 + 0.7 * Math.random()), L = life * (0.6 + 0.8 * Math.random());
    powA.p.set([x + (Math.random() - 0.5) * size, y + Math.random() * size * 0.5, z + (Math.random() - 0.5) * size], i * 3);
    powA.v.set([Math.cos(a) * s, up * (0.4 + 0.6 * Math.random()), Math.sin(a) * s], i * 3);
    powA.t.set([now, L, size * (0.5 + Math.random()), Math.random()], i * 4);
    U.until = Math.max(U.until, now + L);
  }
  for (const k of ['position', 'aV', 'aT']) powder.geometry.attributes[k].needsUpdate = true;
  powder.visible = true;
}
const _o = new THREE.Object3D();
const thickOf = (d) => 0.008 + 0.25 * Math.min(d, 1.2) / 1.2; // 屋面雪厚（米，从瓦片最高处算起）
const SINK = 0.025; // 雪层底面压进瓦片里多少（瓦片高低不平处不透缝；太深会从山墙端穿进挂瓦条/屋面板）
function patchySnow() { // 雪板材质：刚开始下只零星几块，uCov 0→1 时斑块长大连成一片（按坡面坐标噪声 discard，上下面同一位置一起挖）
  const m = snowMat.clone(), u = { value: 0 };
  m.userData.cov = u;
  m.customProgramCacheKey = () => 'patchySnow';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCov = u; sh.uniforms.uUnder = roofUnder;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSnowP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnowP = position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vSnowP; uniform float uCov, uUnder;
      float snH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float snN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(snH(i), snH(i + vec2(1, 0)), f.x), mix(snH(i + vec2(0, 1)), snH(i + 1.0), f.x), f.y); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float sn = 0.55 * snN(vSnowP * 1.6) + 0.3 * snN(vSnowP * 5.0 + 7.3) + 0.15 * snN(vSnowP * 17.0 + 3.1);
      if (sn > uCov * 1.15 - 0.05 || uUnder > 0.5) discard;`);
  };
  return m;
}
// 相机在屋顶下面（屋里、阁楼、屋檐下）时 =1：屋顶积雪一律不画。屋面板是一条条有缝的木板，雪板/屋脊雪底面压进瓦里，
// 在阁楼从板缝里能看到瓦片下沿下面露出的雪（穿模）；从屋顶下面本来就不该看到屋顶上的任何雪。阴影深度材质不受影响。
const roofUnder = { value: 0 };
function ridgeGeo(W, nx) { // 屋脊上的一条雪：x 横跨屋脊 -w..w，z 沿屋脊；顶点 y 每次厚度变时在 updateRidge 里重算
  return new THREE.BoxGeometry(2, 1, W, nx, 1, 40).translate(0, 0.5, 0);
}
function updateRidge(R, F) { // 按当前厚度 R.t 重算屋脊雪的截面：两坡雪面的交线 + 圆顶，盖住屋脊盖瓦（R.prof = 盖瓦/瓦片高出坡面多少）
  const p = R.mesh.geometry.attributes.position, o = R.base, w = R.w, W = F.zL - 0.05, c = 0.1;
  // 雪板顶面在屋脊雪外沿（x=w）处高出坡面多少（垂直量）：瓦尾垫高的那部分（见 fitSlab）+ 雪厚；垫高部分随 R.t 渐出，屋脊雪不会一冒出来就很厚
  const P = roofWx.prof, cs = Math.cos(F.ang), kw = Math.min(P.n - 1, Math.round(w / cs / P.bin)), fw = THREE.MathUtils.smoothstep(R.t, 0.02, 0.15);
  const T = R.t * 0.82 / cs, Hc = Math.max(0, (P.tile[kw] + (P.env[kw] - P.tile[kw]) * fw) / cs * Math.min(1, R.t / 0.05) + T), k2 = Math.min(1, T / 0.12);
  for (let i = 0; i < p.count; i++) {
    const x = o[i * 3] * w, z = o[i * 3 + 2], ax = Math.abs(x), r = Math.min(1, ax / w);
    if (o[i * 3 + 1] < 0.5) { p.setXYZ(i, x, F.top - F.slope * ax - 0.02, z); continue; }
    const pf = R.prof[Math.min(R.prof.length - 1, Math.round(ax / R.bin))];
    const h = THREE.MathUtils.lerp(Hc * 0.9, Math.max(Hc * (1 + 0.15 * (1 - r * r)), pf * k2 + 0.4 * Hc), 1 - r ** 4)
      * Math.min(1, (W / 2 - Math.abs(z)) * 6 + 0.4) * (1 + 0.05 * Math.sin(z * 3.7) + 0.03 * Math.sin(z * 11 + 1.3));
    const sa = ax < c ? x * x / (2 * c) + c / 2 : ax; // 顶上圆一点
    p.setXYZ(i, x, Math.max(F.top - F.slope * sa + h, F.top - F.slope * ax - 0.015), z);
  }
  p.needsUpdate = true; R.mesh.geometry.computeVertexNormals(); R.mesh.geometry.computeBoundingSphere();
}
function setupRoofWeather() {
  const roof = shared.layers.get('roof'); if (!roof) return;
  const rb = new THREE.Box3().setFromObject(roof, true), ex = Math.max(rb.max.x, -rb.min.x), v = new THREE.Vector3();
  const bins = new Array(16).fill(-1e9); let eaveLo = 1e9;
  roof.traverse((m) => {
    if (!m.isMesh) return;
    m.updateMatrixWorld(); const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const b = Math.min(15, Math.floor(Math.abs(v.x) / ex * 16)); bins[b] = Math.max(bins[b], v.y); if (Math.abs(v.x) > ex - 0.03) eaveLo = Math.min(eaveLo, v.y); }
  });
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; // 每段最高点在靠屋脊那头：x 取段的内沿；屋脊盖瓦那两段不算
  for (let b = 2; b < 16; b++) { const x = b / 16 * ex, y = bins[b]; sx += x; sy += y; sxx += x * x; sxy += x * y; n++; }
  const slope = -(n * sxy - sx * sy) / (n * sxx - sx * sx), top = (sy + slope * sx) / n, ang = Math.atan(slope);
  const len = ex / Math.cos(ang) + 0.04, zL = rb.max.z - rb.min.z, zc = (rb.max.z + rb.min.z) / 2, gy = shared.ground.position.y;
  roofWx.fit = { slope, top, ex, ang, len, zL, zc, eaveY: top - slope * ex, eaveLo };
  const slabG = slabGeo(len, zL - 0.05), moundG = moundGeo(), base = Float32Array.from(slabG.attributes.position.array);
  roofWx.prof = roofProfile(roof, roofWx.fit); // 瓦面沿坡的高低（雪板贴瓦用，见 fitSlab）
  for (const sg of [-1, 1]) {
    const tilt = new THREE.Group(); // 原点在屋脊、x 沿坡往下
    tilt.position.set(0, top, zc); tilt.rotation.set(0, sg > 0 ? 0 : Math.PI, -ang, 'YXZ');
    const slab = new THREE.Mesh(slabG.clone(), patchySnow()); slab.castShadow = slab.receiveShadow = true; slab.visible = false; slab.userData.side = sg; // 每坡一份几何（厚度各自算）
    tilt.add(slab); scene.add(tilt);
    const pile = new THREE.Mesh(moundG, snowMat); pile.receiveShadow = true; pile.visible = false;
    pile.position.set(sg * (ex + 0.3), gy, zc); scene.add(pile);
    roofWx.sides.push({ sg, slab, pile, base, built: -1, d: 0, s: -1, v: 0, th: 0, amt: 0 });
  }
  // 屋脊雪：两块雪板从屋脊各自往下铺，顶面在屋脊处是个 V 形缺口（加上雪板上沿收薄），屋脊盖瓦比拟合坡面高 ~11cm，
  // 原来积满了屋脊那条还是露着。单独一条雪盖住屋脊：先量盖瓦/瓦片在屋脊两侧高出坡面多少（prof），雪顶至少高过它
  const w = 0.5, bin = 0.02, prof = new Array(Math.round(w / bin) + 1).fill(-1);
  roof.traverse((m) => {
    if (!m.isMesh) return; const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const ax = Math.abs(v.x); if (ax > w + bin) continue;
      const b = Math.min(prof.length - 1, Math.round(ax / bin)); prof[b] = Math.max(prof[b], v.y - (top - slope * ax)); }
  });
  for (let b = 0; b < prof.length; b++) if (prof[b] < 0) { // 没顶点的格子按两边线性插值（盖瓦是几段直线）
    let a = b - 1, e = b + 1; while (e < prof.length && prof[e] < 0) e++;
    prof[b] = a < 0 ? (e < prof.length ? prof[e] : 0) : e >= prof.length ? Math.max(0, prof[a]) : prof[a] + (prof[e] - prof[a]) * (b - a) / (e - a);
  }
  const rMesh = new THREE.Mesh(ridgeGeo(zL - 0.05, 24), patchySnow());
  rMesh.material.userData.cov.value = 1; rMesh.position.z = zc; rMesh.visible = false; rMesh.castShadow = rMesh.receiveShadow = true; rMesh.frustumCulled = false;
  scene.add(rMesh);
  roofWx.under = roofUnder; roofWx.ridge = { mesh: rMesh, base: Float32Array.from(rMesh.geometry.attributes.position.array), w, bin, prof, t: 0, built: -1 };
  scene.add(chunks, powder); for (let i = 0; i < CHUNK_N; i++) chunks.setMatrixAt(i, _o.matrix.makeScale(0, 0, 0));
  // 檐口滴水：每坡 140 个滴点，着色器里按自由落体从檐口落到地面，循环
  const N = 140, seed = new Float32Array(N * 2 * 2 * 4);
  for (let i = 0; i < N * 2; i++) {
    const s = [i < N ? -1 : 1, zc + (Math.random() - 0.5) * (zL - 0.15), Math.random(), Math.random()];
    seed.set(s, i * 8); seed.set(s, i * 8 + 4);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3));
  roofWx.drips = new THREE.LineSegments(dg, new THREE.ShaderMaterial({
    uniforms: { uTime: precipU.uTime, uColor: rainFx.material.uniforms.uColor, uAmt: { value: 0 }, uEx: { value: ex + 0.006 }, uEy: { value: eaveLo - 0.005 }, uGy: { value: gy } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uAmt, uEx, uEy, uGy; attribute vec4 aSeed; varying float vA;
      void main() {
        float P = 0.8 + 1.6 * aSeed.w, t = mod(uTime + aSeed.z * P, P); // 每个滴点隔 0.8–2.4 秒落一滴
        float y = uEy - 4.9 * t * t, tail = min(0.3, 0.02 + 0.3 * t);
        float e = float(gl_VertexID % 2); // 0 = 水滴头（下端），1 = 拖尾（上端）
        vec3 p = vec3(aSeed.x * uEx, y + tail * e, aSeed.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vA = mix(1.0, 0.12, e) * smoothstep(0.0, 0.12, t) * (0.7 + 0.3 * aSeed.z); // 头实尾虚；刚离开檐口那一下淡入
        if (y < uGy || fract(aSeed.w * 7.13 + aSeed.z * 3.1) > uAmt) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // 两个端点按同一滴判断，一起丢
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main() {
        gl_FragColor = vec4(uColor * vec3(0.86, 0.93, 1.02), 0.42 * vA); // 偏灰蓝、半透明（原来 ×1.25 / 0.9 太白刺眼）
        #include <colorspace_fragment>
      }`,
  }));
  roofWx.drips.frustumCulled = false; roofWx.drips.visible = false; roofWx.drips.renderOrder = 2; scene.add(roofWx.drips);
  // 大门：合页 (x, z) 和门宽（门关着时包围盒最远处）
  const door = shared.layers.get('door_wood'), pv = shared.DOORS.door_wood.pivot;
  if (door) {
    const db = new THREE.Box3().setFromObject(door, true), w = Math.max(db.max.x - pv[0], db.max.z - pv[1]);
    cover.uDoor.value.set(pv[0], pv[1], w + 0.02, -1);
    const mound = new THREE.Mesh(moundG, snowMat), mound2 = new THREE.Mesh(moundG, snowMat);
    mound.visible = mound2.visible = false; scene.add(mound, mound2);
    roofWx.door = { w, mound, mound2, amt: 0, amt2: 0 };
  }
}
function spawnChunk(x, y, z, vx, vy, s, gen) { // s 不给 = 随机大小（2.5–14cm，小的多）；gen 1 = 碎块
  const i = chunkI = (chunkI + 1) % CHUNK_N, R = Math.random;
  chunkP.set([x, y, z], i * 3); chunkV.set([vx + (R() - 0.5) * 0.4, vy, (R() - 0.5) * 0.3], i * 3);
  chunkS[i] = s || 0.012 + 0.065 * R() ** 2.5; // 半径 1.2–7.7cm，大多是小团
  chunkA.set([0.8 + 0.5 * R(), 0.45 + 0.3 * R(), 0.8 + 0.5 * R()], i * 3); // 压扁、各向不一（雪是成片掉的，不是球）
  chunkR.set([R() * 6.3, R() * 6.3, R() * 6.3], i * 3); chunkW.set([(R() - 0.5) * 8, (R() - 0.5) * 8, (R() - 0.5) * 8], i * 3);
  chunkL[i] = -1; chunkG[i] = gen || 0; chunks.visible = true;
  if (!gen) puff(x, y, z, 2, 0.25, 0.05, 0.16, 1.5); // 出檐口时扬起一道粉幕
}
function slideSnow(sg) { // 这一坡的雪整片滑下去（积满了随机触发，或者鼠标点一下）
  const S = roofWx.sides.find((x) => x.sg === sg);
  if (S && S.s < 0 && S.d > 0.05) { S.s = 0; S.v = 0.15; S.th = thickOf(S.d); S.d = 0; }
}
function updateRoofWeather(dt) {
  const F = roofWx.fit; if (!F) return;
  const c = wx.cur, snowing = c.snow > 0.05, gy = shared.ground.position.y, melt = c.rain > 0.05 ? 1 / 12 : 1 / 30;
  for (const S of roofWx.sides) {
    if (S.s < 0) { // 积着：下雪就涨，积满后随时可能整片滑下
      S.d = THREE.MathUtils.clamp(S.d + dt * (snowing ? c.snow / 14 : -melt), 0, 1.2);
      if (S.d > 1 && Math.random() < dt * 0.35) slideSnow(S.sg);
      else {
        S.slab.visible = S.d > 0.02; S.slab.position.x = 0; S.slab.scale.set(1, 1, 1); if (S.slab.visible) fitSlab(S, thickOf(S.d));
        const cov = S.slab.material.userData.cov.value = THREE.MathUtils.smoothstep(S.d, 0.02, 0.4); // 积雪先成斑块，d≈0.4 连成整片
        S.slab.castShadow = cov > 0.99; // 阴影贴图不挖洞，斑块阶段不投影
      }
    } else { // 滑落：上沿往下退（下沿始终在檐口），滑出檐口的雪变成雪块掉下去、墙边雪堆长高
      S.v += dt * 9.8 * Math.sin(F.ang) * 0.5; const ds = Math.min(S.v * dt, F.len - S.s); S.s += ds;
      S.slab.position.x = S.s; S.slab.scale.set((F.len - S.s) / F.len, 1, 1); fitSlab(S, S.th);
      const nC = ds / F.len * 170 * S.th / 0.2; // 一坡滑完约 200 团（雪粉另算）
      for (let k = 0; k < nC + Math.random() - 1; k++)
        spawnChunk(S.sg * (F.ex + 0.02), F.eaveY + Math.random() * S.th, F.zc + (Math.random() - 0.5) * F.zL, S.sg * S.v * Math.cos(F.ang), -S.v * Math.sin(F.ang));
      S.amt += ds / F.len * S.th * 1.3;
      if (S.s >= F.len - 1e-4) S.s = -1;
    }
    S.amt = Math.max(0, S.amt - dt * (snowing ? 0 : melt * 0.3));
    const h = Math.min(0.55, S.amt);
    S.pile.visible = h > 0.01; S.pile.scale.set(0.2 + 1.1 * h, h, F.zL * 0.95);
  }
  const cp = camera.position, ax = Math.abs(cp.x); // 相机在屋顶下面：屋顶雪全不画（见 roofUnder）
  roofUnder.value = ax < F.ex + 0.05 && Math.abs(cp.z - F.zc) < F.zL / 2 + 0.05 && cp.y < F.top - F.slope * ax + 0.02 ? 1 : 0;
  const R = roofWx.ridge;
  if (R) { // 屋脊雪：两坡都积成整片（d>0.35）才长，厚度跟着薄的那坡；有一坡滑走就跟着很快塌掉
    const dm = Math.min(...roofWx.sides.map((S) => (S.s < 0 ? S.d : 0)));
    const tg = thickOf(dm) * THREE.MathUtils.smoothstep(dm, 0.35, 0.6);
    R.t = tg < R.t ? Math.max(tg, R.t - dt * 0.6) : tg;
    R.mesh.visible = R.t > 0.004;
    if (R.mesh.visible && Math.abs(R.t - R.built) > 0.002) { R.built = R.t; updateRidge(R, F); }
  }
  if (chunks.visible) { // 雪团：翻滚下落、掉粉；落到地面/雪堆上大块碎开，小块停住缩进雪里（雪堆已经按滑落量长了）
    let live = 0;
    for (let i = 0; i < CHUNK_N; i++) {
      const s = chunkS[i]; if (s <= 0) continue;
      const i3 = i * 3; let k = 1;
      const x = chunkP[i3], Sd = roofWx.sides[x > 0 ? 1 : 0], ph = Sd ? Sd.pile.scale : null; // 落点高度：地面 + 墙边雪堆（半圆截面）
      const q = ph && Sd.pile.visible ? (x - Sd.pile.position.x) / ph.x : 9, land = gy + (Math.abs(q) < 1 ? ph.y * Math.sqrt(1 - q * q) : 0);
      if (chunkL[i] < 0) {
        chunkV[i3 + 1] -= 9.8 * dt;
        for (let a = 0; a < 3; a++) { chunkP[i3 + a] += chunkV[i3 + a] * dt; chunkR[i3 + a] += chunkW[i3 + a] * dt; }
        if (s > 0.03 && Math.random() < dt * 8) puff(chunkP[i3], chunkP[i3 + 1], chunkP[i3 + 2], 1, 0.1, 0.05, s * 2.5, 0.9); // 下落途中掉粉
        if (chunkP[i3 + 1] < land + s * 0.3) { // 着地
          const px = chunkP[i3], pz = chunkP[i3 + 2];
          if (s > 0.035 && !chunkG[i]) { // 大块碎成 2–4 小块弹开，自己没了
            const n = 2 + Math.floor(Math.random() * 3);
            for (let j = 0; j < n; j++) { const a = Math.random() * 6.283, sp = 0.4 + Math.random() * 0.8;
              spawnChunk(px, land + s * 0.3, pz, Math.cos(a) * sp, 0.6 + Math.random() * 0.9, s * (0.3 + 0.25 * Math.random()), 1);
              chunkV[chunkI * 3 + 2] = Math.sin(a) * sp; }
            chunkS[i] = 0; _o.matrix.makeScale(0, 0, 0); chunks.setMatrixAt(i, _o.matrix);
            puff(px, land, pz, 8 + Math.round(s * 90), 0.9, 0.5, 0.18 + s, 1.3);
            continue;
          }
          chunkL[i] = 0; chunkP[i3 + 1] = land + s * 0.3; chunkV.fill(0, i3, i3 + 3);
          puff(px, land, pz, 2 + Math.round(s * 60), 0.5, 0.25, 0.1 + s, 0.9);
        }
      } else { // 落地后 0.5–1.1 秒缩进雪里
        chunkL[i] += dt; k = 1 - chunkL[i] / (0.5 + 0.6 * ((i * 0.618) % 1));
        chunkP[i3 + 1] = land + s * 0.3 * k;
        if (k <= 0) { chunkS[i] = 0; _o.matrix.makeScale(0, 0, 0); chunks.setMatrixAt(i, _o.matrix); continue; }
      }
      live++;
      _o.position.fromArray(chunkP, i3); _o.rotation.set(chunkR[i3], chunkR[i3 + 1], chunkR[i3 + 2]);
      _o.scale.set(s * chunkA[i3] * k, s * chunkA[i3 + 1] * k * k, s * chunkA[i3 + 2] * k); _o.updateMatrix(); chunks.setMatrixAt(i, _o.matrix);
    }
    chunks.instanceMatrix.needsUpdate = true; chunks.visible = live > 0;
  }
  powU.uWind.value = Math.min(c.wind, 6) * 0.25;
  if (powder.visible && precipU.uTime.value > powder.userData.until) powder.visible = false;
  const dAmt = Math.max(c.rain, cover.uWet.value * 0.35); // 雨停后屋顶还会滴一会儿
  roofWx.drips.visible = dAmt > 0.02; roofWx.drips.material.uniforms.uAmt.value = dAmt;
  // 开门扫雪：门往外转多少，门前扇形里的雪就清掉多少，被推到门板外侧堆成一小条；新雪会慢慢盖回去
  // 只有门在动时才扫（门一直开着/关着不动，扇形里照常积雪）；开门把雪推到门外侧（D.amt，堆在扇形外沿），关门把扇形里新积的雪推回门板前（D.amt2，跟着门走、最后贴在关好的门外）
  const D = roofWx.door, t = shared.toggles.get('door_wood'), U = cover.uDoor.value, sn = cover.uSnow.value;
  if (D && t) {
    const e = t.k * t.k * (3 - 2 * t.k), open = (1 - e) * Math.PI / 2; // 和 updateToggles 同一条缓动，扇形边跟着门板
    // 当前扇形 = [O.w, U.w]（O.w 是下沿：开门从 0 往外长，关门从原角度往 0 收）；上一次的扇形退到 O（O.x 下沿、O.y 上沿、O.z 剩几成）继续盖回，两个都不突变
    const O = cover.uDoorOld.value, sw = cover.uSweep.value, moving = D.last !== undefined && Math.abs(open - D.last) > 1e-5;
    if (sn < 0.03) { U.w = -1; O.set(0, -1, 0, 0); cover.uSweep.value = 0; D.amt = D.amt2 = 0; }
    else if (moving) {
      const opening = open > D.last;
      if (!D.moving) { // 新一次开/关：门要扫过的地方现在有几成雪（没扫过 = 满的，扫过的按盖回了多少）
        D.refill = U.w > 0 ? 1 - Math.max(sw, O.z) : 1; D.base = D.amt;
        if (U.w > 0 && sw > O.z) O.set(O.w, U.w, sw, 0); // 当前扇形退成旧扇形
        U.w = opening ? 0 : D.last; O.w = D.last; // 新扇形从门现在的位置开始
        if (!opening) D.amt2 += sn * D.refill * D.last / (Math.PI / 2); // 关门：把 [0, 当前角度] 里的雪推到门板前
      }
      if (opening) { D.amt += D.amt2; D.amt2 = 0; D.amt = Math.max(D.amt, D.base + sn * D.refill * open / (Math.PI / 2)); U.w = Math.max(U.w, open); O.w = Math.min(O.w, D.last, open); }
      else O.w = Math.min(O.w, open);
      cover.uSweep.value = 1;
    } else if (snowing) cover.uSweep.value = Math.max(0, sw - dt * c.snow / 12);
    if (snowing) O.z = Math.max(0, O.z - dt * c.snow / 12);
    D.moving = moving; D.last = open;
    D.amt = Math.min(D.amt, sn); D.amt2 = Math.min(D.amt2, sn);
    const bury = 0.4 + 0.6 * Math.max(cover.uSweep.value, O.z), k = Math.min(1, dt * 4);
    const place = (m, a, off, amt, key) => { // 离门板 off 米（正 = 角度增大一侧）一条小雪堆；高度平滑跟上，不跳
      const h = D[key] = (D[key] || 0) + (0.1 * amt * bury - (D[key] || 0)) * k; m.visible = U.w >= 0 && h > 0.005; if (!m.visible) return;
      m.position.set(U.x + Math.cos(a) * D.w * 0.52 - Math.sin(a) * off, gy, U.y + Math.sin(a) * D.w * 0.52 + Math.cos(a) * off);
      m.rotation.y = Math.PI / 2 - a; m.scale.set(0.08 + h * 0.5, h, D.w * 1.05);
    };
    place(D.mound, Math.max(U.w, D.base > 0.05 ? O.y : 0, 0), 0.09, D.amt, 'h1'); // 上次推出的雪堆还在原处，新推的雪堆到它那里
    // 关门推的雪在门板前（角度减小一侧）；门快关上时挪到门板外面，关好后贴着门外（角度 0 的 +z 侧）
    if (D.amt2 > 0 || D.a2 === undefined) D.a2 = Math.max(open, 0); // 开门时雪并进外沿雪堆，这一条留在原处淡掉，不跟门板穿过去
    place(D.mound2, D.a2, 0.09 * (2 * THREE.MathUtils.clamp(1 - D.a2 / 0.35, 0, 1) - 1), D.amt2, 'h2');
  }
}


{ const q = (location.search.match(/[?&]wx=(\w+)/) || [])[1], w = WEATHERS.find((e) => e[0] === q); if (w) { setWeather(q, true); if (w[1].snow) cover.uSnow.value = 1; } } // 试玩 / 无头测试：?wx=Blizzard 定天气，下雪类直接满地积雪

share({ applyWeather: () => applyWeather }); // time-of-day.js 用
export { applyWeather, wsPos, WS, groundCover, cover, precipHole, setupRoofWeather, wx, roofWx, setWeather, wxTimer, slideSnow, updatePrecip, updateRoofWeather };
