// 一天的时段：清晨 → 上午 → 中午 → 下午 → 黄昏 → 夜晚；太阳、天穹、屋里间接光、太阳面板（2026-10-30 从 index.html 拆出；主页面的变量写 shared.名字，见 web/CLAUDE.md「模块」）
import * as THREE from 'three';
import { scene, sun, hemi, renderer, camera, $, lbl } from './core.js';
import { shared, share } from './state.js';

// ===== 一天的时段：清晨 → 上午 → 中午 → 下午 → 黄昏 → 夜晚 =====
// 关键帧按小时插值（循环）：天顶色、地平线色（= 雾色）、太阳光色/强度、半球光、环境光、曝光。
// 18.6–5.6 点之间平行光改当月光用（方向换到月亮），强度由关键帧在交接处降到 0，看不出跳变。
const SKY_KEYS = [
  { h: 0,    top: 0x070d1c, hor: 0x18202f, sun: 0x9ab2dc, sunI: 0.3, hs: 0x2c3a58, hg: 0x15130f, hI: 0.22, env: 0.06, exp: 0.95 },
  { h: 4.8,  top: 0x0b1428, hor: 0x2a2f42, sun: 0x8fa6d0, sunI: 0.18, hs: 0x34405e, hg: 0x17140f, hI: 0.24, env: 0.08, exp: 0.95 },
  { h: 5.6,  top: 0x26355c, hor: 0x8a6f72, sun: 0xff8a50, sunI: 0.0,  hs: 0x6a7090, hg: 0x2a2219, hI: 0.32, env: 0.14, exp: 1.0 },
  { h: 6.4,  top: 0x5577a8, hor: 0xeeaa7c, sun: 0xff9a5a, sunI: 0.9,  hs: 0xa6a8c0, hg: 0x4a3c2c, hI: 0.5,  env: 0.28, exp: 1.0 },
  { h: 8.5,  top: 0x7ea5cb, hor: 0xdfe2d8, sun: 0xffe0b4, sunI: 1.9,  hs: 0xd6e2ee, hg: 0x65553f, hI: 0.75, env: 0.45, exp: 1.0 },
  { h: 12,   top: 0x8bb2d6, hor: 0xcfd8dc, sun: 0xfff3e0, sunI: 2.3,  hs: 0xdfeaf2, hg: 0x6b5a45, hI: 0.8,  env: 0.5,  exp: 1.0 },
  { h: 15.5, top: 0x84a6c6, hor: 0xddd6c2, sun: 0xffe2b2, sunI: 2.1,  hs: 0xe0e2e0, hg: 0x6e5a40, hI: 0.78, env: 0.46, exp: 1.0 },
  { h: 17.6, top: 0x56699a, hor: 0xf2a466, sun: 0xff8a40, sunI: 1.2,  hs: 0xb4a4a8, hg: 0x5a4430, hI: 0.55, env: 0.3,  exp: 1.0 },
  { h: 18.6, top: 0x2a3560, hor: 0xb0605a, sun: 0xff6a3a, sunI: 0.0,  hs: 0x6a6488, hg: 0x2e241b, hI: 0.36, env: 0.16, exp: 1.0 },
  { h: 19.6, top: 0x111a34, hor: 0x3a3448, sun: 0x8fa6d0, sunI: 0.12, hs: 0x3a4262, hg: 0x1a1611, hI: 0.26, env: 0.09, exp: 0.95 },
  { h: 24,   top: 0x070d1c, hor: 0x18202f, sun: 0x9ab2dc, sunI: 0.3, hs: 0x2c3a58, hg: 0x15130f, hI: 0.22, env: 0.06, exp: 0.95 },
].map((k) => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun), hs: new THREE.Color(k.hs), hg: new THREE.Color(k.hg) }));
const SKY_PRESETS = [['Dawn', 6.3], ['Forenoon', 9], ['Noon', 12], ['Afternoon', 15.5], ['Dusk', 18.1], ['Night', 22]];
const hourName = (h) => h < 5 ? 'Night' : h < 7.5 ? 'Dawn' : h < 11 ? 'Forenoon' : h < 13.5 ? 'Noon' : h < 17 ? 'Afternoon' : h < 19.6 ? 'Dusk' : 'Night';
const sky = { hour: 9, goal: null, play: true, rate: 24 / 360, bearing: 55, strength: 1, dark: null };
let sunRig = null; // 模型加载后 = { center, r }

// 天穹：跟着相机走的大球，渐变 + 太阳/月亮光晕 + 夜里星星；地平线色和雾一致，远处树和地面淡进去
const skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
  uMoonDir: { value: new THREE.Vector3() }, uNight: { value: 0 }, uSunUp: { value: 1 }, uFlash: { value: 0 }, uTime: { value: 0 } };
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHor, uSunDir, uSunCol, uMoonDir; uniform float uNight, uSunUp, uFlash, uTime; varying vec3 vDir;
    float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
    float stars(vec3 d, float n, float th) { // 方向按网格分格，每格一点；th 越小星越多；点在格里随机偏移、按离点距离画圆点
      vec3 q = d * n, c = floor(q); float h = hash3(c);
      if (h < th) return 0.0;
      vec3 o = vec3(hash3(c + 1.7), hash3(c + 3.1), hash3(c + 5.3)) * 0.6 + 0.2;
      float r = length(q - c - o);
      return smoothstep(0.42, 0.0, r) * (0.3 + 0.7 * fract(h * 97.0)) * (0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * fract(h * 53.0)) + h * 40.0));
    }
    void main() {
      vec3 d = normalize(vDir); float y = max(d.y, 0.0);
      vec3 col = mix(uHor, uTop, pow(y, 0.55));
      float above = smoothstep(-0.01, 0.02, d.y);
      float s = max(dot(d, uSunDir), 0.0);
      col += uSunCol * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6) * uSunUp;
      col += uSunCol * smoothstep(0.9993, 0.9996, s) * 4.0 * above * uSunUp;
      float m = max(dot(d, uMoonDir), 0.0);
      // 月亮：约 2° 的盘 + 两层光晕；盘面用低频噪声做一点明暗（月海）
      float disc = smoothstep(0.99925, 0.99945, m);
      float mare = 0.8 + 0.2 * hash3(floor(d * 900.0)) * hash3(floor(d * 300.0) + 2.0);
      col += vec3(0.86, 0.9, 1.0) * (disc * 2.2 * mare + pow(m, 600.0) * 0.35 + pow(m, 30.0) * 0.07) * above * uNight;
      // 星星：疏的亮星 + 密的暗星，银河一条带里暗星更密；被月盘挡住，贴地平线淡掉
      vec3 bn = normalize(vec3(0.35, 0.55, 0.76));
      float band = exp(-pow(dot(d, bn) / 0.2, 2.0));
      float st = stars(d, 170.0, 0.993) * 1.3 + stars(d, 420.0, 0.986 - 0.03 * band) * 0.45;
      vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.75, 0.85, 1.0), hash3(floor(d * 170.0) + 9.0));
      col += (tint * st + vec3(0.5, 0.55, 0.7) * band * 0.035) * uNight * smoothstep(0.0, 0.22, y) * (1.0 - disc);
      col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * y);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0; // ±0.5/255 抖动（交错梯度噪声），暗的阴天渐变不出色带（11-11 r2 art #5）
    }`,
}));
skyDome.renderOrder = -1; skyDome.frustumCulled = false;
scene.add(skyDome);
scene.background = null;

const _sd = new THREE.Vector3(), _md = new THREE.Vector3();
const dirOf = (out, elevDeg, azDeg) => { const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); };
function applySky() {
  const h = ((sky.hour % 24) + 24) % 24;
  let i = 0; while (SKY_KEYS[i + 1].h < h) i++;
  const A = SKY_KEYS[i], B = SKY_KEYS[i + 1], f = THREE.MathUtils.smoothstep(h, A.h, B.h);
  const L = (k) => A[k] + (B[k] - A[k]) * f;
  skyU.uTop.value.lerpColors(A.top, B.top, f);
  skyU.uHor.value.lerpColors(A.hor, B.hor, f);
  scene.fog.color.copy(skyU.uHor.value);
  sun.color.lerpColors(A.sun, B.sun, f);
  hemi.color.lerpColors(A.hs, B.hs, f); hemi.groundColor.lerpColors(A.hg, B.hg, f); hemi.intensity = L('hI');
  scene.environmentIntensity = L('env');
  renderer.toneMappingExposure = L('exp');
  // 太阳：6 点东升、12 点最高 62°、18 点西落；方位 = 方位角滑块 ± 80°
  const a = (h - 6) / 12, sunElev = Math.sin(Math.PI * a) * 62, sunAz = sky.bearing + (a - 0.5) * 160;
  dirOf(_sd, sunElev, sunAz);
  const ma = (((h - 18.6) % 24) + 24) % 24 / 11, moonElev = Math.sin(Math.PI * ma) * 32, moonAz = sky.bearing + 180 + (ma - 0.5) * 140;
  dirOf(_md, moonElev, moonAz);
  const day = h >= 5.6 && h < 18.6;
  sun.intensity = L('sunI') * sky.strength * (day ? 1 : THREE.MathUtils.smoothstep(moonElev, -2, 10)); // 夜里 = 月光，月亮落下就没了
  indoorU.uIndoor.value = (0.015 + 0.985 * THREE.MathUtils.smoothstep(sunElev, -5, 12)) * (sky.indoorK ?? 1); // 屋里间接光：天黑后几乎没有（见 indoorShade）
  const cp = camera.position; indoorU.uCamIn.value = Math.max(Math.abs(cp.x), Math.abs(cp.z)) < 1.74 && cp.y < 4.1 - 0.72 * Math.abs(cp.x) ? 1 : 0; // 相机在屋里：瓦顶以下全算屋内
  skyU.uSunDir.value.copy(_sd); skyU.uMoonDir.value.copy(_md);
  skyU.uSunCol.value.copy(sun.color).multiplyScalar(Math.min(1, sky.strength));
  skyU.uSunUp.value = THREE.MathUtils.smoothstep(sunElev, -6, 2);
  skyU.uNight.value = THREE.MathUtils.smoothstep(-sunElev, 4, 14);
  if (sunRig) { // 光源方向：白天跟太阳（贴地时抬到 3° 免得阴影拉到无穷长），夜里跟月亮
    const dir = day ? dirOf(new THREE.Vector3(), Math.max(sunElev, 3), sunAz) : dirOf(new THREE.Vector3(), Math.max(moonElev, 8), moonAz);
    sun.position.copy(sunRig.center).addScaledVector(dir, sunRig.r * 2.5);
  }
  // 天黑自动开灯、天亮自动关（只在跨过时切换，用户手动开关的不会被每帧覆盖）。只给通关后的自由 / 看模型：剧情里灯是书记员走过时一盏盏开的，没人去的阁楼、卫生间不亮（11-11 world #1）
  const dark = h >= 18.8 || h < 6.2;
  if (sky.dark !== null && dark !== sky.dark && shared.game?.found.has('ended')) for (const name of Object.keys(shared.LAMPS)) { const t = shared.toggles.get(name); if (t && name !== 'entry_porch_lamp') t.on = dark; } // 门廊灯一直亮（故事：他走时留着灯）
  sky.dark = dark;
}
// 屋里的间接光：半球光和环境光（RoomEnvironment）不受阴影遮挡，会穿墙把屋里照亮，夜里关灯后窗户里还发亮。
// 给小屋材质注入一个「在屋内」遮罩（墙内 ±1.74m、屋面板以下），屋内的间接漫反射/高光乘 uIndoor：白天 1（不改原样子），夜里压到很暗。
// 灯、炉火是 PointLight（直接光）、灯泡火苗是自发光，都不受影响。外面有自己 onBeforeCompile 的材质（院子、路、雪板）跳过。
const indoorU = { uIndoor: { value: 1 }, uFlashIn: { value: 1 }, uCamIn: { value: 0 } };
// 屋内灯、炉火是不投影的 PointLight，原来穿墙照亮屋外的院子、路、外墙（夜里地上一圈暖光）。改 three 的着色器块，对所有受光材质：
// 光源在墙内、片元在墙外时，只有从大门洞（南墙 z=1.8、x ±0.45、高 2.1 以下）穿出去、且门开着才算数。小屋没有窗（射线扫过四面墙，只有原木缝）。
// uWallDoor 放进各 ShaderLib 的 uniforms，值用普通对象（不是 Vector4）：各材质克隆 uniforms 时会共用这一个引用，改一处全变。
const wallU = { x: 1, y: 0, z: 1, w: 1 }, roomU = { x: 0, y: 1 }; // wallU：x = 大门开度（1 开 0 关，door_wood 开关动画里设），y = 炉门开度，z = 卫生间门开度，w = 门帘放下程度；roomU.x = 折叠餐桌放下程度，roomU.y = 有没有点亮的点光源（0 就跳过屋内遮挡计算，白天省指令）
// 屋内按房间查表（尺寸来自 glb 射线实测）：阁楼楼板 y 2.2、南隔墙 z 0.775、卫生间隔墙 x -0.575、门帘 x 0.64。0 客厅 1 大厅 2 玄关 3 卫生间 4 阁楼 5 大厅上半截（高过楼板，楼下的灯照不到）
// 行 = 灯所在房间，列 = 片元所在房间：1 通，0 隔死，2 隔着门帘（布，透一半光），-1 玄关 ↔ 卫生间只从门洞过。传 uniform 不写成着色器里的 const 数组：D3D 把 const 数组按片元现填一遍，夜里屋里显卡多约 1.3ms（11-09 报告）
const ROOM_V = new Float32Array([
  1, 1, 0, 0, 0, 0,
  1, 1, 2, 0, 1, 1,
  0, 2, 1, -1, 0, 0,
  0, 0, -1, 1, 0, 0,
  0, 1, 0, 0, 1, 1,
  1, 1, 2, 0, 1, 1]);
const roomOf = (p) => p.y >= 2.2 ? (p.x < 0.7 ? 4 : 5) : p.x >= 0.67 ? 1 : p.z < 0.775 ? 0 : p.x < -0.575 ? 3 : 2; // 灯在哪间，同着色器的 roomId；interact.js 每帧算好塞进 decay 传给着色器
for (const id of ['standard', 'physical', 'lambert', 'phong', 'toon']) { THREE.ShaderLib[id].uniforms.uWallDoor = { value: wallU }; THREE.ShaderLib[id].uniforms.uRoomK = { value: roomU }; THREE.ShaderLib[id].uniforms.uRoomV = { value: ROOM_V }; }
// 每盏灯一份的代码要跑 11 遍（11-09 起是真循环，不再按灯展开源码，编译量已降；帧时仍跟循环体指令数成正比），ANGLE/D3D 的编译时间和帧时间都跟指令数成正比：试过 9 个盒子的射线求交，冷启动 prewarm 13s → 155s、帧时 11ms → 26ms；楼板隔墙全用平面穿越判断仍要 34s。
// 所以：灯位固定的遮挡（炉身、吊灯灯罩、壁灯旁的高柜）和家具底下压暗在循环外算，每个片元一次（rFire / rShade / rCab / rU）；屋内分房间查表（ROOM_V），灯在哪间由 JS 算好（roomOf），只有卫生间门洞还做一次平面穿越。
THREE.ShaderChunk.lights_pars_begin += `
uniform vec4 uWallDoor;
uniform vec2 uRoomK;
uniform vec4 uRoomV[ 9 ];
vec3 lightW( vec3 v ) { return ( vec4( v - viewMatrix[ 3 ].xyz, 0.0 ) * viewMatrix ).xyz; }
float doorRect( vec3 E ) { return ( 1.0 - smoothstep( 0.4, 0.47, abs( E.x ) ) ) * ( 1.0 - smoothstep( 2.0, 2.12, E.y ) ); }
float wallPass( vec3 L, vec3 P, vec3 d, float outK ) {
  if ( max( abs( L.x ), abs( L.z ) ) > 1.8 ) { // 屋外的灯（门廊灯、带出门的提灯）：照屋里只能走开着的大门，照屋子另一边被整栋房子挡住
    if ( outK >= 1.0 ) { vec3 M = L + 0.5 * d; return smoothstep( 1.55, 1.8, max( abs( M.x ), abs( M.z ) ) ); }
    float door = 0.0;
    if ( L.z > 1.8 && d.z < -1e-4 ) door = uWallDoor.x * doorRect( L + d * ( 1.8 - L.z ) / d.z ) * ( L.z > 2.02 ? doorRect( L + d * ( 2.02 - L.z ) / d.z ) : 1.0 );
    return mix( door, 1.0, outK );
  }
  if ( outK <= 0.0 ) return 1.0;
  float tz = d.z > 1e-4 ? ( 1.8 - L.z ) / d.z : 1e9;
  float tx = abs( d.x ) > 1e-4 ? ( sign( d.x ) * 1.8 - L.x ) / d.x : 1e9;
  float door = tz < tx ? uWallDoor.x * doorRect( L + d * tz ) : 0.0;
  return mix( 1.0, door, outK );
}
// 炉火在铸铁炉身里面，光只能从炉门开口（南面 z=-1.19）出来；uWallDoor.y = 炉门开度，开着时门板挡住右边的光。留 5% 当墙和地反射回来的光
float stoveK( vec3 P ) {
  vec3 L = vec3( 1.4, 0.62, -1.3 ), d = P - L;
  if ( P.y > 2.35 ) return 0.0;
  if ( P.x > 1.13 && P.x < 1.67 && P.y > 0.13 && P.y < 0.87 && P.z > -1.62 && P.z < -1.22 ) return 1.0;
  if ( P.z <= -1.19 ) return 0.05; // 炉门面以后（炉底、炉身两侧、背后）光出不去；只判 d.z > 0 的话，炉底 z 在 -1.3 到 -1.19 之间的柴会算成从炉门照到
  vec3 E = L + d * ( -1.19 - L.z ) / d.z;
  float o = smoothstep( 1.28, 1.32, E.x ) * ( 1.0 - smoothstep( 1.58, 1.62, E.x ) ) * smoothstep( 0.42, 0.46, E.y ) * ( 1.0 - smoothstep( 0.77, 0.81, E.y ) );
  if ( d.x > 1e-4 ) {
    float t = ( 1.59 - L.x ) / d.x;
    vec3 H = L + d * t;
    if ( t < 1.0 && H.z > -1.21 && H.z < -0.92 && H.y > 0.43 && H.y < 0.79 ) o *= 1.0 - uWallDoor.y;
  }
  return mix( 0.05, 1.0, o );
}
// 大厅吊灯的搪瓷灯罩：灯泡在 y 2.06，上方几乎没直射光，边缘按灯泡大小过渡；灯罩内面离光源只有十来厘米，按平方反比会过曝成一片死白
float shadeK( vec3 P, float z ) {
  vec2 r = vec2( P.x - 1.12, P.z - z );
  return dot( r, r ) > 0.04 || P.y < 1.9 || P.y > 2.2 ? mix( 0.05, 1.0, smoothstep( 0.05, 0.58, ( 2.06 - P.y ) / max( length( r ), 1e-3 ) ) ) : 0.04;
}
// 壁灯贴着高柜北侧，柜子（x -1.72～-1.41，到 y 2.10）挡住往南的光
float cabK( vec3 P ) {
  if ( P.z < -0.5 || P.y > 2.1 ) return 1.0;
  return smoothstep( -1.46, -1.38, -1.38 + ( P.x + 1.38 ) * 0.1 / ( P.z + 0.6 ) );
}
// 家具底下：灯只从上面来，床底、沙发底、书桌底、放下的餐桌底、树桩茶几根部直接光几乎到不了。用线性 clamp 代替 smoothstep，少算一半
float rampUp( float a, float b, float x ) { return clamp( ( x - a ) / ( b - a ), 0.0, 1.0 ); }
float roomUnder( vec3 P ) {
  float u = 1.0;
  if ( P.y > 2.26 && P.y < 2.44 ) u = 1.0 - 0.92 * rampUp( -0.98, -0.9, P.x ) * rampUp( 0.16, 0.08, P.x ) * rampUp( 0.38, 0.3, P.z );
  else if ( P.y > 0.2 && P.y < 0.87 ) {
    if ( P.y < 0.52 ) u = 1.0 - 0.85 * rampUp( -0.95, -0.87, P.x ) * rampUp( 0.66, 0.58, P.x ) * rampUp( 0.0, 0.08, P.z ) * rampUp( 0.8, 0.76, P.z );
    u *= 1.0 - 0.8 * rampUp( -1.06, -1.14, P.x ) * rampUp( -0.46, -0.54, P.z );
    if ( P.y < 0.34 ) u *= 1.0 - 0.65 * rampUp( 1.32, 1.0, length( ( P.xz - vec2( -0.125, -0.655 ) ) / vec2( 0.385, 0.33 ) ) );
  }
  if ( uRoomK.x > 0.0 && P.y > 0.1 && P.y < 1.14 && P.x > 1.3 ) u *= 1.0 - 0.8 * uRoomK.x * rampUp( -0.6, -0.54, P.z ) * rampUp( 0.66, 0.6, P.z );
  if ( P.y < 0.36 ) u *= 1.0 - 0.9 * rampUp( 1.08, 1.16, P.x ) * rampUp( 1.72, 1.64, P.x ) * rampUp( -1.7, -1.62, P.z ) * rampUp( -1.14, -1.22, P.z ); // 铸铁炉底下：炉身挡住所有灯 放在最后，前面的分支会给 u 重新赋值
  return u;
}
float roomId( vec3 p ) { return p.y >= 2.2 ? ( p.x < 0.7 ? 4.0 : 5.0 ) : p.x >= 0.67 ? 1.0 : p.z < 0.775 ? 0.0 : p.x < -0.575 ? 3.0 : 2.0; }
float roomV( int k ) { return uRoomV[ k / 4 ][ k - k / 4 * 4 ]; }
float roomPass( vec3 L, vec3 d, float lid, vec4 ca, vec2 cb ) { // lid = 灯所在房间（JS 算好，见 roomOf）；ca、cb = 表里片元所在房间那一列（循环外取好），每盏灯只按 lid 挑一个
  if ( max( abs( L.x ), abs( L.z ) ) > 1.8 ) return 1.0;
  float v = lid < 0.5 ? ca.x : lid < 1.5 ? ca.y : lid < 2.5 ? ca.z : lid < 3.5 ? ca.w : lid < 4.5 ? cb.x : cb.y;
  if ( v < 0.0 ) { // 卫生间门洞 z 0.83–1.50、高 1.97
    float t = ( -0.575 - L.x ) / d.x, z = L.z + d.z * t;
    return uWallDoor.z * smoothstep( 0.81, 0.85, z ) * ( 1.0 - smoothstep( 1.48, 1.52, z ) ) * ( 1.0 - smoothstep( 1.93, 1.99, L.y + d.y * t ) );
  }
  return v > 1.5 ? 1.0 - 0.5 * uWallDoor.w : v;
}
`;
// 11 盏点光源一直 visible（切 visible 会重编译），关着的灯、照不到的片元原来也整套算 BRDF：小屋每个像素 11 遍，占帧时大头。现在先判断再算。
{
  const lf = THREE.ShaderChunk.lights_fragment_begin, a = lf.indexOf('pointLight = pointLights[ i ];'), b = lf.indexOf('RE_Direct(', a), e = lf.indexOf(';', b) + 1, h = lf.indexOf('#if ( NUM_POINT_LIGHTS > 0 )');
  if (a < 0 || b < 0 || h < 0) throw new Error('lights_fragment_begin 结构变了');
  // 点光源循环去掉 three 的 unroll 标记、删掉点光阴影那段，留成真循环：这里的点光源都不投影，没有 pointShadowMap[ i ] 要展开。ANGLE 给循环加 [loop]，FXC 不用把循环体编 11 遍：46 个受光程序占全部着色器编译时间 99%，冷启动 prewarm 13.8s → 3.0s，画面（夜景最多 3 个像素差 1/255）和帧时不变。以后要让点光源投影，得恢复展开。
  THREE.ShaderChunk.lights_fragment_begin = lf.slice(0, h) + `vec3 rP = lightW( geometryPosition ), rL, rD;
float rOut = smoothstep( 1.83, 1.89, max( abs( rP.x ), abs( rP.z ) ) ), rIn = 1.0 - step( 1e-4, rOut );
float rU = 1.0, rFire = 1.0, rShadeS = 1.0, rShadeN = 1.0, rCab = 1.0;
vec4 rCa = vec4( 1.0 ); vec2 rCb = vec2( 1.0 );
if ( uRoomK.y > 0.5 && rIn > 0.0 ) { // 白天灯全灭时整段跳过（uRoomK.y 由 scene.onBeforeRender 设）
  rU = roomUnder( rP ); rFire = stoveK( rP ); rShadeS = shadeK( rP, 0.71 ); rShadeN = shadeK( rP, -0.49 ); rCab = cabK( rP );
  int rk = int( roomId( rP ) + 0.5 );
  rCa = vec4( roomV( rk ), roomV( 6 + rk ), roomV( 12 + rk ), roomV( 18 + rk ) ); rCb = vec2( roomV( 24 + rk ), roomV( 30 + rk ) );
}
` + lf.slice(h, a).replace('#pragma unroll_loop_start', '') + 'pointLight = pointLights[ i ];\n\t\tfloat rLR = floor( pointLight.decay * 0.0625 ); pointLight.decay -= 16.0 * rLR;\n\t\tif ( dot( pointLight.color, vec3( 1.0 ) ) > 0.0 && ( pointLight.distance <= 0.0 || distance( pointLight.position, geometryPosition ) < pointLight.distance ) ) {'
    + lf.slice(a + 'pointLight = pointLights[ i ];'.length, b).replace(/#if defined\( USE_SHADOWMAP \) && \( UNROLLED_LOOP_INDEX[\s\S]*?#endif/, '').replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
      `getPointLightInfo( pointLight, geometryPosition, directLight );
		rL = lightW( pointLight.position ); rD = rP - rL + 1e-5;
		directLight.color *= wallPass( rL, rP, rD, rOut ) * ( abs( rL.x - 1.4 ) + abs( rL.y - 0.62 ) < 0.03 ? rFire : abs( rL.x - 1.12 ) + abs( rL.y - 1.95 ) < 0.02 ? ( rL.z > 0.0 ? rShadeS : rShadeN ) : rL.x < -1.3 && rL.z < -0.5 ? rCab : 1.0 );
		if ( rIn > 0.0 && uRoomK.y > 0.5 ) directLight.color *= rU * roomPass( rL, rD, rLR, rCa, rCb );`)
    + lf.slice(b, e) + '\n\t\t}' + lf.slice(e).replace('#pragma unroll_loop_end', '');
}
function indoorShade(model) {
  const seen = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (seen.has(m) || !m.isMeshStandardMaterial || Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) continue;
      seen.add(m);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uIndoor = indoorU.uIndoor; sh.uniforms.uFlashIn = indoorU.uFlashIn; sh.uniforms.uCamIn = indoorU.uCamIn;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vInP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvInP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uIndoor, uFlashIn, uCamIn; varying vec3 vInP;')
          // 闪电只加在半球光上：屋内把半球光乘回「没闪电时 / 闪电时」的比例，屋里不跟着亮
          // 屋内 = 墙内（原木内表面最远 1.79、关着的大门外面 1.90、墙外表面 ≥1.92；原来 1.70–1.80 过渡正好落在原木缝里，一条条漏光；平滑法线在缝里会朝外，不能按法线分）且（屋面板以下 或 屋顶里不朝上的面：椽子、望板底面离拟合坡面 -0.15～+0.05m，只按高度分不开，按法线分：瓦面朝上 ny≈0.8）
          .replace('#include <lights_fragment_begin>', `float inRoof = vInP.y - (4.25 - 0.72 * abs(vInP.x)); float inNy = inverseTransformDirection(normal, viewMatrix).y;
          float inK = (1.0 - smoothstep(1.83, 1.89, max(abs(vInP.x), abs(vInP.z)))) * max(1.0 - smoothstep(-0.16, -0.08, inRoof), (1.0 - smoothstep(0.14, 0.2, inRoof)) * max(1.0 - smoothstep(0.35, 0.55, inNy), uCamIn));
          ` + THREE.ShaderChunk.lights_fragment_begin.replace('irradiance += getHemisphereLightIrradiance(', 'irradiance += mix(1.0, uFlashIn, inK) * getHemisphereLightIrradiance('))
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          float inF = mix(1.0, uIndoor, inK);
          reflectedLight.indirectDiffuse *= inF; reflectedLight.indirectSpecular *= inF;`);
      };
      m.customProgramCacheKey = () => 'indoor';
      m.needsUpdate = true;
    }
  });
}
// 每天一套色板（r3 #11，学 Firewatch 每天换色调）：第 1 天原样（只晴 / 阴，见 gameInit）；第 2 天天和雾压暗一档、偏冷灰蓝、去饱和，太阳弱 30%；
// 第 3 天曝光 0.8、天色带一点病态的黄绿。白天才调（夜里那几张别动），颜色是线性值
const GRADE = { 2: { sky: [0.70, 0.75, 0.86], sat: 0.75, sun: 0.7, hemi: 0.85, exp: 1 }, 3: { sky: [0.80, 0.82, 0.62], sat: 0.6, sun: 0.75, hemi: 0.9, exp: 0.8 } };
const _gl = new THREE.Color();
function dayGrade() {
  const G = GRADE[shared.game?.day]; if (!G) return;
  const h = sky.hour, w = THREE.MathUtils.smoothstep(h, 5.6, 7) * (1 - THREE.MathUtils.smoothstep(h, 18.2, 19.6));
  if (!w) return;
  const tint = (c, k) => { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; _gl.setRGB(l * G.sky[0], l * G.sky[1], l * G.sky[2]); c.lerp(_gl, k * w); };
  tint(skyU.uHor.value, G.sat); tint(skyU.uTop.value, G.sat); scene.fog.color.copy(skyU.uHor.value);
  tint(hemi.color, G.sat * 0.6);
  sun.intensity *= 1 - (1 - G.sun) * w; hemi.intensity *= 1 - (1 - G.hemi) * w; scene.environmentIntensity *= 1 - (1 - G.hemi) * w;
  renderer.toneMappingExposure *= 1 - (1 - G.exp) * w;
}
function updateSky(dt) {
  skyU.uTime.value += dt;
  if (sky.goal !== null) { // 点了时段按钮：沿较短方向快速转过去
    let d = ((sky.goal - sky.hour) % 24 + 36) % 24 - 12;
    const step = Math.sign(d) * Math.min(Math.abs(d), dt * (sky.goalRate || 6)); // goalRate：游戏里天慢慢黑下来（小时/秒）
    sky.hour += step; if (Math.abs(d - step) < 1e-3) { sky.hour = sky.goal; sky.goal = null; sky.goalRate = 0; }
  } else if (sky.play) sky.hour += dt * sky.rate;
  sky.hour = ((sky.hour % 24) + 24) % 24;
  applySky();
  shared.applyWeather(dt);
  dayGrade();
  skyDome.position.copy(camera.position);
  syncSkyUI();
}

// 太阳控制面板：时刻滑块、六个时段、流逝开关与速度、太阳方位、太阳强度
const HOUR_ZH = { Dawn: '黎明', Forenoon: '上午', Noon: '正午', Afternoon: '下午', Dusk: '黄昏', Night: '夜里' };
const WX_ZH = { Fair: '晴', Overcast: '阴', Rain: '雨', Thunderstorm: '雷雨', Snow: '雪', Blizzard: '暴雪', Fog: '雾' };
const skyEl = { btn: $('skyBtn'), panel: $('skyPanel'), hour: $('skyHourIn'), clock: $('skyClock'), name: $('skyName'),
  play: $('skyPlay'), speed: $('skySpeed'), bearing: $('skyBearing'), strength: $('skyStrength') };
const presetBox = $('skyPresets');
for (const [n, h] of SKY_PRESETS) {
  const b = document.createElement('button'); b.innerHTML = lbl(n, HOUR_ZH[n]); b.dataset.n = n;
  b.onclick = () => { sky.goal = h; };
  presetBox.appendChild(b);
}
// 面板：点按钮开/关（同时只开一个），点面板和按钮以外任何地方就收起
const PANELS = [[skyEl.panel, skyEl.btn], [$('wxPanel'), $('wxBtn')]];
for (const [p, b] of PANELS) b.onclick = () => { const show = p.hidden; for (const [q] of PANELS) q.hidden = true; p.hidden = !show; };
document.addEventListener('pointerdown', (e) => {
  for (const [p, b] of PANELS) if (!p.hidden && !p.contains(e.target) && !b.contains(e.target)) p.hidden = true;
}, true);
skyEl.hour.oninput = () => { sky.goal = null; sky.hour = +skyEl.hour.value; };
skyEl.play.onclick = () => { sky.play = !sky.play; };
skyEl.speed.onchange = () => { sky.rate = 24 / +skyEl.speed.value; };
skyEl.bearing.oninput = () => { sky.bearing = +skyEl.bearing.value; };
skyEl.strength.oninput = () => { sky.strength = +skyEl.strength.value; };
skyEl.bearing.value = sky.bearing; skyEl.strength.value = sky.strength;
let skyShown = '';
function syncSkyUI() {
  const hh = Math.floor(sky.hour), mm = Math.floor((sky.hour - hh) * 60);
  const label = `${hh}:${String(mm).padStart(2, '0')}|${hourName(sky.hour)}|${sky.play}`;
  if (label === skyShown) return;
  skyShown = label;
  skyEl.clock.textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  skyEl.name.innerHTML = lbl(hourName(sky.hour), HOUR_ZH[hourName(sky.hour)]);
  skyEl.play.innerHTML = sky.play ? lbl('Stay the Hour', '停在此刻') : lbl('Let the Day Pass', '让时间走');
  if (document.activeElement !== skyEl.hour) skyEl.hour.value = sky.hour.toFixed(2);
  for (const b of presetBox.children) b.classList.toggle('on', b.dataset.n === hourName(sky.hour));
}


share({ sunRig: [() => sunRig, (v) => { sunRig = v; }] }); // 模型加载后主页面设
export { WX_ZH, sky, skyEl, skyU, indoorU, indoorShade, PANELS, wallU, roomU, roomOf, updateSky };
