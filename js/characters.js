// 人物：两人的模型和动画、座位、女调查员的日常、爬梯子、东看西看、书记员伏案（2026-10-30 从 index.html 拆出；主页面的变量写 shared.名字，见 web/CLAUDE.md「模块」）
import * as THREE from 'three';
import { indoorShade } from './time-of-day.js';
import { scene } from './core.js';
import { toggles } from './interact.js';
import { shared, share } from './state.js';

// —— 人物：Quaternius 通用人物 + 通用动画库（CC0），在 Blender 里配好衣服和动作，导出到 characters/*.glb（工程文件 ../blender/*.blend）——
// glb 里人物脚底在原点、面朝 +Z，动作名同动画库（Idle_Loop、Sitting_Idle_Loop、Walk_Loop…）。
// mode：'sit' 坐着（隔一阵坐着聊几句），'stand' 站着（隔一阵摆弄一下手边的东西）。人物不投影（会动的投影物体要每帧重画阴影图）。
// 以后玩家操作：people.get(id) 拿到 { root, play }，改 root.position / rotation.y，play('Walk_Loop') 等。
const PEOPLE = [
  // 起居室长沙发右边那块坐垫（x -0.14…0.52，坐面 y 0.69，面朝北边的炉子）；坐姿骨盆在脚后 0.34m、离脚底 0.58m（×scale）
  // scale：原模型连头发 1.81m，偏高偏壮；缩到 0.94 ≈ 1.70m（门 1.97m、阁楼下净高 2.0m）
  { id: 'person_man', url: 'characters/man.glb', pos: [0.19, 0.25, 0.07], standY: 0.26, yaw: Math.PI, scale: 0.94, mode: 'sit', seat: 'living_sofa',
    hand: 'characters/hand.glb', handMat: { HandSkin: 'MI_Superhero_Male', HandSleeve: 'M_Shirt' } },
  // 女调查员：Rhino 模型里的 Female_Peasant（服装 + 女性基础人物的头 + Hair_Buns 盘发），Rhino 里 1.60m、scale 0.896。
  // 打开页面随机二选一：阁楼摇椅上看书（Sitting_Read_Loop + Book），或书桌前写笔记（Sitting_Write_Loop + Notebook、Pen）；这两个动作是 Blender 里用 IK 在坐姿上摆的。
  // 她的坐姿骨盆在脚后 0.324、坐面比根节点高 0.444（未缩放，男的是 0.34 / 0.468）。调试：网址带 ?woman=read / ?woman=desk 固定一种。
  // 2026-10-20 起她也能第一人称操作（手 hand_woman.glb），也会自己起来走动、爬梯子上下阁楼（见「女调查员的日常」）；坐哪张椅子就做哪件事（seatActs），别的座位是普通坐姿。
  { id: 'person_woman', url: 'characters/woman.glb', scale: 0.896, mode: 'sit', sitBack: 0.324, sitUp: 0.49,
    hand: 'characters/hand_woman.glb', handMat: { HandSleeve: 'MI_Peasant' },
    seatActs: { loft_rocking_chair: { idle: 'Sitting_Read_Loop', props: ['Book', 'Cushion'] }, loft_chair: { idle: 'Sitting_Write_Loop', props: ['Notebook', 'Pen'] } },
    // 游戏（2026-10-21 用户定）：白天站在一楼地图前、在楼下转（planWander），天黑才走去书桌坐下写调查记录；重开页面时已经天黑就直接坐在书桌前。
    pick: () => /[?&]woman=read/.test(location.search) ? { seat: 'loft_rocking_chair', area: 'Loft', desc: 'Reading the Surveyor\'s papers in the rocking chair.' }
      : /[?&]woman=desk/.test(location.search) || shared.game.night ? { seat: 'loft_chair', area: 'Parlour', desc: 'Writing up the day at the desk.' }
      : { stand: 'books', face: [-1.72, -1.1], area: 'Parlour', desc: 'Looking the house over, room by room.' } },
];
const MOODS = {
  sit: { idle: 'Sitting_Idle_Loop', extra: ['Sitting_Talking_Loop'], hit: [0, 0.85, -0.2, 0.95] },
  stand: { idle: 'Idle_Loop', extra: ['Idle_Talking_Loop', 'Interact'], hit: [0, 0.9, 0, 1.8] },
};
const moodOf = (p) => (p.mode === 'sit' && p.seatActs && p.seatActs[p.seat]?.mood) || MOODS[p.mode]; // 女调查员坐摇椅看书、坐书桌写字
const people = new Map(); // id → { root, mixer, acts, cur, mode, next, hit, tasks, play, setMode }
async function loadPeople() {
  await Promise.all(PEOPLE.map(async (P) => {
    const gltf = await shared.loader.loadAsync(P.url);
    const pk = P.pick ? P.pick() : null; if (pk) { P.seat = pk.seat || null; if (pk.stand) P.mode = 'stand'; shared.INFO[P.id][1] = pk.area; shared.INFO[P.id][2] = pk.desc; }
    const root = new THREE.Group(); root.name = P.id; // 名字 = INFO 的键，点选、高亮都按这个图层名
    root.add(gltf.scene);
    root.scale.setScalar(P.scale || 1);
    if (P.pos) { root.position.set(...P.pos); root.rotation.y = P.yaw; }
    else if (pk && pk.stand) { const [x, z] = NAV[pk.stand]; root.position.set(x, 0.25, z); root.rotation.y = Math.atan2(pk.face[0] - x, pk.face[1] - z); } // 起居室木台 0.25
    else { const a = seatPose({ root, sitBack: P.sitBack, sitUp: P.sitUp }, P.seat); root.position.set(a.x, a.y, a.z); root.rotation.y = SEATS[P.seat].yaw; }
    const props = ['Book', 'Cushion', 'Notebook', 'Pen'].map((n) => gltf.scene.getObjectByName(n)).filter(Boolean);
    const showProps = (seat) => { const want = (P.seatActs && P.seatActs[seat]?.props) || []; for (const o of props) o.visible = want.includes(o.name); }; // 道具：看书露书和背后靠垫，写字只露本子和笔，站着全收起
    if (P.seatActs) for (const s of Object.values(P.seatActs)) s.mood = { ...MOODS.sit, idle: s.idle, extra: [] };
    const cushion = gltf.scene.getObjectByName('Cushion'); // 靠垫用摇椅座垫同一块红亚麻布
    if (cushion) shared.layers.get('loft_rocking_chair')?.traverse((o) => { if (o.isMesh && o.material?.name === 'loft_mattress_linen_red') cushion.material = o.material; });
    gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } }); // 蒙皮网格包围球不跟动作，别被裁掉
    // 点选用隐形胶囊：蒙皮网格逐面射线慢，而且包围球是静止姿势的
    const hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1, 2, 8), new THREE.MeshBasicMaterial({ visible: false }));
    root.add(hit); shared.meshes.push(hit);
    const mixer = new THREE.AnimationMixer(gltf.scene), acts = {}, head = gltf.scene.getObjectByName('Head');
    for (const c of gltf.animations) acts[c.name] = mixer.clipAction(c);
    for (const n of ['Sitting_Enter', 'Sitting_Exit', 'Interact', 'PickUp_Table', 'Ladder_Top', 'Ladder_Top_Lift']) if (acts[n]) { acts[n].setLoop(THREE.LoopOnce); acts[n].clampWhenFinished = true; }
    const p = { id: P.id, root, mixer, acts, cur: null, mode: P.mode, next: 4 + Math.random() * 8, hit, head, tasks: [], sitY: root.position.y, standY: P.standY ?? root.position.y, seat: P.seat || null, roam: 70 + Math.random() * 90,
      sitBack: P.sitBack ?? 0.34, sitUp: P.sitUp ?? 0.517, seatActs: P.seatActs || null, showProps, home: P.seat,
      neck: gltf.scene.getObjectByName('neck_01'), look: null, lookK: 0, lookYaw: 0, lookPitch: 0, lookT: 0 };
    p.play = (name, fade = 0.5) => {
      const a = acts[name]; if (!a || a === p.cur) return;
      a.reset().setEffectiveWeight(1).play(); a.timeScale = 1;
      if (p.cur) p.cur.crossFadeTo(a, fade, false);
      p.cur = a;
    };
    p.setMode = (mode) => {
      p.mode = mode; const h = moodOf(p).hit;
      hit.position.set(h[0], h[1], h[2]); hit.scale.set(1, h[3] / 1.48, 1); // 胶囊原高 1 + 2×0.24
      showProps(mode === 'sit' ? p.seat : null);
      p.play(moodOf(p).idle);
    };
    p.setMode(P.mode);
    if (SEATS[p.seat]?.rock) p.ride = { x: root.position.x, y: root.position.y, z: root.position.z, yaw: root.rotation.y }; // 坐在摇椅上：跟着椅子摇
    mixer.update(Math.random() * 3); // 错开起始相位
    indoorShade(root); // 屋里压暗天光，和家具一致
    scene.add(root); shared.layers.set(P.id, root); people.set(P.id, p);
    if (P.hand) p.hand = await loadHand(P, gltf.scene);
  }));
}
async function loadHand(P, body) { // 第一人称拿东西的右手（../blender/scripts/make_hand.py / make_hand_woman.py 从人身上切的握拳右手），材质用人身上同名的
  const mats = new Map(); body.traverse((o) => { if (o.isMesh) mats.set(o.material.name, o.material); });
  const g = (await shared.loader.loadAsync(P.hand)).scene;
  g.traverse((o) => { if (o.isMesh) { o.material = mats.get(P.handMat[o.name]) || o.material; o.frustumCulled = false; o.castShadow = false; o.layers.set(shared.HELD_LAYER); } }); // glb 里没带材质（导出 PLACEHOLDER 实际是不导出），按网格名对上
  g.visible = false; scene.add(g); return g;
}
// —— 座位（2026-10-20）：人物和第一人称玩家都能坐。pelvis = 坐下时骨盆的位置（坐面中心略靠后，无头浏览器从上往下打射线量的坐面），y = 坐面高，yaw = 坐下后面朝的方向；
// 坐姿（glb）：骨盆在脚后 0.34m；sitUp = 坐面比根节点高多少（×scale）。2026-10-20 量过：屁股最低点只比骨盆骨骼低 7cm（男）/ 6.4cm（女），原来按 0.468 算硬座上悬空 3cm，现在男 0.517、女 0.49（压进坐面约 1cm）。
// pull：书桌椅要先往外拉开人才站得进去（不拉的话站的位置插进桌子），坐下后连人带椅推回去，起身时再拉开、往旁边让一步、推回。out = 拉椅子 / 起身后让开时站的地方。
// rock：摇椅，坐着时一直轻轻摇，人跟着椅子的变换一起动。
const SEATS = {
  living_sofa: { pelvis: [0.19, 0.39], y: 0.736, yaw: Math.PI, node: 'sofa' }, // 长沙发右坐垫（老人的老位置）；坐面实测 0.69，软垫坐下去陷 4.6cm，按 0.736 算正好是原来手调的根节点 0.25
  loft_chair: { pelvis: [-0.894, -1.124], y: 0.70, yaw: -Math.PI / 2, pull: [0.4, 0], out: [-0.83, -0.62], node: 'desk', shut: ['desk_drawer'] }, // shut：坐下前先关上（抽屉拉开 30cm 正顶在腿上） // 书桌椅（名字带 loft，其实在一楼起居室西北角），面朝西边的书桌
  loft_rocking_chair: { pelvis: [-0.686, 1.114], y: 2.70, yaw: Math.atan2(0.733, -0.68), rock: true, node: 'L_rocker' }, // 阁楼摇椅，顺着摇杆朝东南；骨盆比坐面中心往椅背挪 5cm（原先挪 10cm 时膝盖窝在座面前沿后面，小腿必穿前横档；背后空隙由女调查员的靠垫 Cushion 填）
  entry_toilet: { pelvis: [-1.43, 1.259], y: 0.58, yaw: Math.PI / 2, node: 'wc' }, // 卫生间马桶，面朝东边的门
};
function seatPose(p, name, k = 0) { // 坐在这个座位上时根节点的位置（k = 椅子拉出来的程度）
  const S = SEATS[name], s = p.root.scale.x, pl = S.pull || [0, 0], bk = (p.sitBack ?? 0.34) * s;
  return { x: S.pelvis[0] + pl[0] * k + Math.sin(S.yaw) * bk, z: S.pelvis[1] + pl[1] * k + Math.cos(S.yaw) * bk, y: S.y - (p.sitUp ?? 0.517) * s };
}
const seatTaken = (name, me) => [...people.values()].some((q) => q !== me && (q.seat === name || q.claim === name || (q.home === name && !q.player))); // 坐着的、正要去坐的、她的「家」座位（她出门时老人也别去坐，免得回来坐到人身上）
// 走路路线：节点 + 连通边，BFS 找最短的节点序列（屋里家具多，直线会穿过茶几、沙发、隔墙）。坐标 x 东、z 南。
// 起居室在隔墙（z 0.75）北边，东边过道 x 0.77–1.74 连到南边门厅，门厅西头的折叠门（x -0.6，z 0.83–1.5）进卫生间。
// 梯子放下（k=1）时斜着占住过道西半边 z 0.93–1.31（底脚到 x 1.19），过道 ↔ 门厅从它南边绕（hall3）。
// L_ 开头的是阁楼（地板 loft_deck y 2.29；屋脊在 x=0，x 0.3 处净空 1.7m，往西越来越矮）；两层之间只有梯子：ladder（地上站点）↔ L_land（阁楼口），见 CLIMB。
const NAV = {
  sofa: [0.19, 0.07], ne: [0.55, -0.15], hall: [1.05, -0.15], hall2: [1.42, 1.25], hall3: [0.95, 1.5], stove: [1.2, -0.72],
  entry: [0.3, 1.3], entryW: [-0.4, 1.2], wcIn: [-0.85, 1.15], wc: [-1.0, 1.25], sw: [-0.75, -0.18], desk: [-0.83, -0.62],
  books: [-0.55, -1.3], dish: [0.2, -1.25], ladder: [1.40, 1.12], push0: [0.82, 0.02],
  L_land: [0.30, 1.12], L_mid: [0.25, 0.45], L_rail: [0.35, -0.6], L_bed: [0.35, -1.1], L_hooks: [0.0, 1.30], L_rocker: [0.0, 0.85],
};
const NAV_EDGES = [['sofa', 'ne'], ['sofa', 'sw'], ['sofa', 'stove'], ['ne', 'hall'], ['ne', 'stove'], ['hall', 'stove'], ['hall', 'hall2'], ['hall2', 'hall3'], ['hall3', 'entry'],
  ['entry', 'entryW'], ['entryW', 'wcIn'], ['wcIn', 'wc'], ['sw', 'desk'], ['desk', 'books'], ['sw', 'books'], ['ne', 'dish'], ['hall', 'ladder'], ['hall2', 'ladder'], ['ne', 'push0'],
  ['L_land', 'L_mid'], ['L_mid', 'L_rail'], ['L_rail', 'L_bed'], ['L_land', 'L_hooks'], ['L_land', 'L_rocker'], ['L_mid', 'L_rocker'], ['L_hooks', 'L_rocker']];
function navPath(from, to) { // 节点名 → 节点名，返回途经的坐标（不含起点）
  const adj = {}; for (const [a, b] of NAV_EDGES) { (adj[a] ||= []).push(b); (adj[b] ||= []).push(a); }
  const prev = { [from]: null }, q = [from];
  while (q.length) { const n = q.shift(); if (n === to) break; for (const m of adj[n] || []) if (!(m in prev)) { prev[m] = n; q.push(m); } }
  const out = []; for (let n = to; n && n !== from; n = prev[n]) out.unshift(NAV[n]);
  return out;
}
function nearNode(x, z, loft = false) { // 同一层里最近的节点（push0 是推梯子的专用站点，不算）
  let best = null, bd = 1e9;
  for (const [n, [nx, nz]] of Object.entries(NAV)) { if (n.startsWith('L_') !== loft || n === 'push0') continue; const d = Math.hypot(nx - x, nz - z); if (d < bd) { bd = d; best = n; } }
  return best;
}
function sitTasks(p, name) { // 走到座位前 → （拉椅子）→ 转身 → 坐下 →（推回去）
  const S = SEATS[name], a = seatPose(p, name, S.pull ? 1 : 0), t = [];
  if (S.pull) t.push(['walk', ...S.out], ['face', S.pelvis[0], S.pelvis[1]], ['shut', name], ['chair', name, 1]);
  else if (S.shut) t.push(['shut', name]);
  t.push(['walk', a.x, a.z], ['turn', S.yaw], ['seat', name], ['anim', 'Sitting_Enter']);
  if (S.pull) t.push(['chair', name, 0]);
  return t;
}
function riseTasks(p, n = p.seat) { // 起身：（拉开椅子）→ 站起来 →（往旁边让一步、把椅子推回去）
  const S = SEATS[n], t = [];
  if (!n) return p.mode === 'sit' ? [['anim', 'Sitting_Exit']] : [];
  if (S.pull) t.push(['chair', n, 1]);
  t.push(['anim', 'Sitting_Exit'], ['unseat']);
  if (S.pull) t.push(['walk', ...S.out], ['chair', n, 0]);
  return t;
}
function fpRise(p) { // 第一人称起身：站起来后再往前迈半步。沙发坐垫网格伸到 z 0.03，Sitting_Exit 做完脚还在坐垫投影里（z 0.21），身体那几圈碰撞射线从坐垫里面往外打、四面都挡，人就关在沙发里出不去（2026-10-27 用户试玩）
  const S = SEATS[p.seat], t = riseTasks(p);
  if (S && !S.pull && S.pelvis) t.push(['walk', S.pelvis[0] + Math.sin(S.yaw) * 0.55, S.pelvis[1] + Math.cos(S.yaw) * 0.55]);
  return t;
}
function goTasks(p, x, z, toNode) { // 从现在的位置沿 NAV 走到某个节点（同一层）
  return navPath(nearNode(x, z, toNode.startsWith('L_')), toNode).map(([nx, nz]) => ['walk', nx, nz]);
}
function routeTasks(x, y, z, to) { // 从 (x,y,z) 走到节点 to；不在同一层就走梯子（梯子没放下先推过去；上去后回身把拦杆放下，下楼前先抬起来）
  const up = y > 1.5, goUp = to.startsWith('L_');
  if (up === goUp) return goTasks(null, x, z, to);
  if (goUp) {
    const d = toggles.get('loft_ladder'), t = [];
    if (d && d.on) t.push(...goTasks(null, x, z, 'ladder'), ['walk', ...NAV.ladder]);
    else t.push(...goTasks(null, x, z, 'push0'), ['walk', ...NAV.push0], ['turn', 0], ['push'], ['walk', 1.35, 0.72], ['walk', ...NAV.ladder]);
    t.push(['turn', shared.LADDER.yaw], ['mount'], ['climb', CLIMB.top], ['top'], ['face', 0.6, 1.5], ['gate', true]);
    return [...t, ...goTasks(null, ...NAV.L_land, to)];
  }
  return [...goTasks(null, x, z, 'L_land'), ['walk', ...NAV.L_land], ['face', 0.6, 1.5], ['gate', false], ['turn', shared.LADDER.yaw], ['topDown'], ['climb', 0], ['dismount'], ...goTasks(null, ...NAV.ladder, to)];
}
// 老人的日常：坐在沙发上，隔 1–2.5 分钟（或被点一下）起来去做一件事再回沙发：拨火暖手、去书桌坐一会儿、上厕所
const ACTIVITIES = {
  stove: (p) => [['face', 1.42, -1.3], ['anim', 'Interact'], ['idle', 3]],
  desk: (p) => [...sitTasks(p, 'loft_chair'), ['idle', 15 + Math.random() * 15], ...riseTasks(p, 'loft_chair')],
  wc: (p) => [...sitTasks(p, 'entry_toilet'), ['idle', 8 + Math.random() * 8], ...riseTasks(p, 'entry_toilet')],
};
const ROUTINES = { person_man: { home: 'living_sofa', acts: ['stove', 'desk', 'wc'] }, person_woman: { plan: (p, act) => (shared.game.night ? [] : planWoman(p, act)) } }; // 她的 home = 打开页面时坐的那张（p.home）；游戏里天黑后坐在书桌前不再起来
function planOuting(p, id, act) {
  const R = ROUTINES[id], home = R.home, r = p.root;
  const t = riseTasks(p); // 先从现在的座位起来
  const startX = p.seat && SEATS[p.seat].out ? SEATS[p.seat].out[0] : r.position.x, startZ = p.seat && SEATS[p.seat].out ? SEATS[p.seat].out[1] : r.position.z;
  const goal = act === 'stove' ? 'stove' : SEATS[act === 'desk' ? 'loft_chair' : 'entry_toilet'].node;
  t.push(...goTasks(p, startX, startZ, goal), ...ACTIVITIES[act](p));
  const back = act === 'stove' ? 'stove' : goal;
  t.push(...navPath(back, SEATS[home].node).map(([x, z]) => ['walk', x, z]), ...sitTasks(p, home));
  return wcDoorTasks(t);
}
function wcDoorTasks(t) { // 走 entryW ↔ wcIn 这一段要穿过折叠门门洞：前面插一个 wcDoor（执行时门开着就跳过）
  const out = []; let prev = null;
  for (const T of t) {
    if (T[0] === 'walk') {
      const at = (n) => T[1] === NAV[n][0] && T[2] === NAV[n][1];
      if ((at('wcIn') && prev === 'entryW') || (at('entryW') && prev === 'wcIn')) out.push(['wcDoor']);
      prev = at('wcIn') ? 'wcIn' : at('entryW') ? 'entryW' : null;
    }
    out.push(T);
  }
  return out;
}
// —— 女调查员的日常（2026-10-20）：坐在自己的位置（摇椅看书 / 书桌写字），隔 1–2.5 分钟（或被点一下）起来转转：
// 去 1–3 个地方东看看西看看（书架、墙上的地图、碗架、炉子、阁楼栏杆边抱着胳膊往下看、床头柜、挂钩），有时换到另一张椅子坐一阵，再回来坐下。上下楼走梯子（routeTasks）。
const SPOTS = {
  books: { node: 'books', tasks: () => [['face', -0.55, -1.72], ['look', -0.9, 1.8, -1.6, 4], ['idle', 2], ['anim', 'PickUp_Table'], ['idle', 2]] },
  map: { node: 'books', tasks: () => [['face', -1.72, -1.1], ['look', -1.7, 1.65, -1.08, 5], ['idle', 4]] },
  dish: { node: 'dish', tasks: () => [['face', 0.2, -1.72], ['anim', 'PickUp_Table'], ['idle', 2]] },
  stove: { node: 'stove', tasks: () => [['face', 1.42, -1.3], ['anim', 'Interact'], ['idle', 3]] },
  rail: { node: 'L_rail', tasks: () => { const d = 8 + Math.random() * 8; return [['face', 0.9, -0.6], ['pose', 'Idle_FoldArms_Loop', d, [0.0, 0.8, -0.5]]]; } },
  bedside: { node: 'L_bed', tasks: () => [['face', 0.35, -1.7], ['anim', 'PickUp_Table'], ['idle', 2]] },
  hooks: { node: 'L_hooks', tasks: () => [['face', 0, 1.8], ['look', 0, 3.7, 1.67, 3], ['anim', 'Interact'], ['idle', 2]] },
};
const floorY = (node) => (node.startsWith('L_') ? 2.29 : 0.2);
function planWoman(p, act) {
  const r = p.root, S0 = p.seat && SEATS[p.seat], t = riseTasks(p);
  let x = S0 && S0.out ? S0.out[0] : r.position.x, z = S0 && S0.out ? S0.out[1] : r.position.z, y = r.position.y;
  const home = p.home, other = home === 'loft_rocking_chair' ? 'loft_chair' : 'loft_rocking_chair', names = Object.keys(SPOTS), picks = [];
  if (act) picks.push(act);
  else { const n = 1 + Math.floor(Math.random() * 3); while (picks.length < n) { const s = names[Math.floor(Math.random() * names.length)]; if (!picks.includes(s) && s !== p.lastSpot) picks.push(s); }
    if (Math.random() < 0.3) picks.push('seat'); }
  for (const s of picks) {
    if (s === 'seat') { // 换到另一张椅子坐一阵（被占了就不去）
      if (seatTaken(other, p)) continue;
      p.claim = other; const node = SEATS[other].node, a = SEATS[other].out || (({ x: ax, z: az }) => [ax, az])(seatPose(p, other));
      t.push(...routeTasks(x, y, z, node), ['walk', ...NAV[node]], ...sitTasks(p, other), ['idle', 25 + Math.random() * 30], ...riseTasks(p, other));
      [x, z] = a; y = floorY(node); continue;
    }
    const node = SPOTS[s].node;
    t.push(...routeTasks(x, y, z, node), ['walk', ...NAV[node]], ...SPOTS[s].tasks());
    [x, z] = NAV[node]; y = floorY(node);
  }
  p.lastSpot = picks[picks.length - 1];
  const hn = SEATS[home].node;
  t.push(...routeTasks(x, y, z, hn), ['walk', ...NAV[hn]], ...sitTasks(p, home));
  return t;
}
function goHome(p, id) { // 玩家退出后人留在别处：（起身）走回自己的座位坐下
  const home = ROUTINES[id].home || p.home, S = p.seat && SEATS[p.seat], r = p.root;
  const sx = S && S.out ? S.out[0] : r.position.x, sz = S && S.out ? S.out[1] : r.position.z;
  p.tasks = wcDoorTasks([...riseTasks(p), ...routeTasks(sx, r.position.y, sz, SEATS[home].node), ['walk', ...NAV[SEATS[home].node]], ...sitTasks(p, home)]);
}
function wakePerson(id, act) {
  const p = people.get(id), R = ROUTINES[id];
  if (!p || !R || p.tasks.length || p.player || p.mode !== 'sit') return; // 已经在活动就不打断
  p.roam = 70 + Math.random() * 90;
  if (R.plan) { p.tasks = R.plan(p, act); return; }
  const acts = R.acts.filter((a) => a !== p.lastAct && !(a === 'desk' && seatTaken('loft_chair', p)) && !(a === 'wc' && seatTaken('entry_toilet', p)));
  act = act || acts[Math.floor(Math.random() * acts.length)];
  p.lastAct = act; p.tasks = planOuting(p, id, act);
}

// —— 爬梯子（2026-10-20，女调查员；动作 Climb_Ladder_Loop / Ladder_Top / Ladder_Top_Lift 是 Blender 里按梯子尺寸用 IK 摆的，../blender/scripts/climb.py）——
// 梯子放下（k=1）斜 0.2rad，横档间距 0.28。S = 从最底一档沿梯子往上的距离，根节点 = ladderRoot(S)（面朝西）；一个周期爬 0.56（两档、1.67s），动作时间 = 相位，所以手脚始终对着横档。
// 上：地上站点 → mount（0.6s 挪上第一档）→ climb 到 S 0.84（右脚踩第 4 档）→ top：Ladder_Top 撑上阁楼面、再上两档、迈上去站直，最后一帧人挪到阁楼口（往西 0.787、高 1.068，姿势 = Idle_Loop 第 1 帧，无缝）；
//   拦杆放着就换 Ladder_Top_Lift（多 1.5s：第 2.0s 右手把拦杆推起来）。
// 下：阁楼口面朝西（背对梯子）倒放 Ladder_Top（topDown）→ 倒着爬到 S=0 → dismount 挪回地上站点。
const CLIMB = { cyc: 0.56, top: 0.84, fwd: 0.787, up: 1.068, gateAt: 2.0 };
function ladderRoot(S, out = new THREE.Vector3()) { return out.set(1.254 - 0.1987 * S, 0.399 + 0.9801 * S, shared.ladderZ()); }
const _cv = new THREE.Vector3();
function snap(p, name, time = 0, ts = 1) { // 立刻换成这个动作（不淡入淡出）：前后两段的衔接姿势本来就一样
  const a = p.acts[name]; p.mixer.stopAllAction(); a.reset(); a.time = time; a.timeScale = ts; a.setEffectiveWeight(1).play(); p.cur = a; p.mixer.update(0); return a;
}
function climbAt(p, S) { // 停在梯子上 S 处：根节点 + 爬梯动作的相位
  const a = p.acts.Climb_Ladder_Loop, ph = ((S / CLIMB.cyc) % 1 + 1) % 1;
  a.time = ph * a.getClip().duration; ladderRoot(S, p.root.position); p.root.rotation.y = shared.LADDER.yaw; p.S = S;
}
const CLIMB_TASKS = {
  push: { // 推梯子：站在梯子北边面朝南推着它沿滑轨滑到阁楼口下（toggle 自己 0.9s 滑完），人跟着往南走、往东让开摆出来的梯脚
    start: (p, T) => { const d = toggles.get('loft_ladder'); T.skip = !d || d.on; if (!T.skip) { d.on = true; p.play('Push_Loop', 0.3); } T.x0 = p.root.position.x; T.z0 = p.root.position.z; },
    step: (p, T) => { const d = toggles.get('loft_ladder'); if (T.skip) return !d || d.k >= 1; const e = d.k * d.k * (3 - 2 * d.k); p.root.position.x = T.x0 + (1.0 - T.x0) * e; p.root.position.z = T.z0 + (0.62 - T.z0) * e; return d.k >= 1; } },
  slide: { // 在阁楼上：弯腰把挂在滑轨上的梯子拉到阁楼口（梯子顶就在阁楼边沿，x 0.72）
    start: (p, T) => { const d = toggles.get('loft_ladder'); T.skip = !d || d.on; if (!T.skip) p.play('PickUp_Table', 0.3); },
    step: (p, T) => { const d = toggles.get('loft_ladder'); if (!T.skip && !T.g && T.t > 0.6) { T.g = true; d.on = true; } return !d || (d.k >= 1 && (T.skip || p.cur.time >= p.cur.getClip().duration - 0.05)); } },
  mount: {
    need: () => shared.ladderReady(), // 梯子不在阁楼口下面（被点回去了）：先去推过去
    fix: (p) => { const r = p.root.position; return [...goTasks(null, r.x, r.z, 'push0'), ['walk', ...NAV.push0], ['turn', 0], ['push'], ['walk', 1.35, 0.72], ['walk', ...NAV.ladder], ['turn', shared.LADDER.yaw]]; },
    start: (p, T) => { T.from = p.root.position.clone(); p.play('Climb_Ladder_Loop', 0.5); p.cur.timeScale = 0; p.cur.time = 0; },
    step: (p, T) => { const e = Math.min(1, T.t / 0.6); p.root.position.lerpVectors(T.from, ladderRoot(0, _cv), e * e * (3 - 2 * e)); p.root.rotation.y = shared.LADDER.yaw; p.S = 0; return e >= 1; } },
  climb: {
    start: (p) => { const a = p.acts.Climb_Ladder_Loop; if (p.cur !== a) p.play('Climb_Ladder_Loop', 0.2); a.timeScale = 0; },
    step: (p, T, dt) => { const v = CLIMB.cyc / p.acts.Climb_Ladder_Loop.getClip().duration, d = T[1] - p.S;
      climbAt(p, p.S + Math.sign(d) * Math.min(Math.abs(d), v * dt)); return Math.abs(T[1] - p.S) < 1e-4; } },
  top: {
    start: (p, T) => { T.lift = !shared.gateOpen(); T.a = snap(p, T.lift ? 'Ladder_Top_Lift' : 'Ladder_Top'); ladderRoot(CLIMB.top, p.root.position); },
    step: (p, T) => {
      if (T.lift && !T.g && T.a.time >= CLIMB.gateAt) { T.g = true; const g = toggles.get('loft_gate'); if (g) g.on = false; } // 右手推到拦杆了：抬起来
      if (T.a.time < T.a.getClip().duration - 1e-3) return false;
      ladderRoot(CLIMB.top, p.root.position); p.root.position.x -= CLIMB.fwd; p.root.position.y += CLIMB.up; snap(p, 'Idle_Loop'); p.S = null; return true; } },
  topDown: {
    need: () => shared.ladderReady() && shared.gateOpen(), // 梯子不在：先在阁楼上拉过来；拦杆放着：先抬起来
    fix: (p) => [...(shared.ladderReady() ? [] : [['walk', ...NAV.L_mid], ['face', 0.9, 0.52], ['slide'], ['walk', ...NAV.L_land]]), ['face', 0.6, 1.5], ['gate', false], ['turn', shared.LADDER.yaw]],
    start: (p, T) => { T.a = snap(p, 'Ladder_Top', p.acts.Ladder_Top.getClip().duration - 1e-3, -1); ladderRoot(CLIMB.top, p.root.position); p.root.rotation.y = shared.LADDER.yaw; },
    step: (p, T) => { if (T.a.time > 1e-3) return false; snap(p, 'Climb_Ladder_Loop', 0, 0); climbAt(p, CLIMB.top); return true; } },
  dismount: {
    start: (p, T) => { T.from = p.root.position.clone(); p.play('Idle_Loop', 0.5); p.S = null; },
    step: (p, T) => { const e = Math.min(1, T.t / 0.6), fy = floorBelow(NAV.ladder[0], 0.3, shared.ladderZ()) ?? 0.16;
      p.root.position.lerpVectors(T.from, _cv.set(NAV.ladder[0], fy + 0.01, shared.ladderZ()), e * e * (3 - 2 * e)); return e >= 1; } },
  shut: { // 座位旁边开着的抽屉（SEATS[..].shut）：开着就先推上再坐，关着就跳过；执行时才查（玩家可能刚拉开）
    start: (p, T) => { T.ds = (SEATS[T[1]].shut || []).map((n) => toggles.get(n)).filter((d) => d && d.on); T.skip = !T.ds.length; if (!T.skip) p.play('Interact', 0.3); },
    step: (p, T) => { if (T.skip) return true; if (!T.g && T.t > 0.5) { T.g = true; T.ds.forEach((d) => { d.on = false; }); } return T.g && T.ds.every((d) => d.k < 0.05); } },
  wcDoor: { // 卫生间折叠门：关着就先拉开再走（门 0.9 秒收完才过），开着就跳过
    start: (p, T) => { const d = toggles.get('toilet_door_A'); T.skip = !d || !d.on; if (!T.skip) p.play('Interact', 0.3); },
    step: (p, T) => { const d = toggles.get('toilet_door_A'); if (T.skip) return true; if (!T.g && T.t > 0.5) { T.g = true; d.on = false; } return T.g && d.k < 0.05; } },
  gate: { // 拦杆：['gate', true] 放下、false 抬起；已经是那样就跳过
    start: (p, T) => { const g = toggles.get('loft_gate'); T.skip = !g || g.on === T[1]; if (!T.skip) p.play('Interact', 0.3); },
    step: (p, T) => { if (T.skip) return true; if (!T.g && T.t > 0.7) { T.g = true; toggles.get('loft_gate').on = T[1]; } return T.g && p.cur.time >= p.cur.getClip().duration - 0.05; } },
  pose: { // 摆一个循环动作待一会儿（阁楼栏杆边抱着胳膊），可以带一个看的地方
    start: (p, T) => { p.play(T[1], 0.5); if (T[3]) { p.look = T[3]; p.lookT = T[2]; } },
    step: (p, T) => T.t >= T[2] },
  look: { start: (p, T) => { p.look = [T[1], T[2], T[3]]; p.lookT = T[4]; }, step: () => true },
};
const WALK_SPEED = 1.0; // 米/秒，按 Walk_Loop 的步幅（一个周期 1.33s 两步、脚相对身体移 0.68m）
let npcFloors = [], npcFloorsT = 0;
const NPC_FLOOR = /^(deck_|floor_|platform_|base_box$|entry_doormat$|loft_deck$)|_rug$/; // 只认地板：站点在沙发占地里，往下打到沙发底座会把人抬高 25cm
const npcRay = new THREE.Raycaster(); npcRay.firstHitOnly = true;
function floorBelow(x, y, z) { // 人物走路贴地：起居室木台 0.25、过道 0.16、门厅 0.10 高低不一，阁楼 2.29
  if ((npcFloorsT -= 1) < 0) { const hits = new Set([...people.values()].map((q) => q.hit)); npcFloors = shared.meshes.filter((m) => !hits.has(m) && shared.isShown(m) && NPC_FLOOR.test(m.parent.name)).concat(shared.ground); npcFloorsT = 120; }
  npcRay.set(_npcO.set(x, y + 0.3, z), shared._fpDn); npcRay.far = 0.8;
  const h = npcRay.intersectObjects(npcFloors, false)[0]; return h ? h.point.y : null;
}
const _npcO = new THREE.Vector3();
function runTask(p, dt) {
  const T = p.tasks[0], k = T[0], r = p.root, C = CLIMB_TASKS[k];
  if (!T.on && C && C.need && !C.need(p)) { p.tasks.unshift(...C.fix(p)); return; } // 条件不满足：先把要做的插到前面
  if (!T.on) {
    T.on = true; T.t = 0;
    if (k === 'anim' || k === 'walk' || k === 'face' || k === 'turn' || k === 'idle') p.play(k === 'anim' ? T[1] : k === 'walk' ? 'Walk_Loop' : (p.mode === 'sit' && k === 'idle' ? moodOf(p) : MOODS.stand).idle, 0.3);
    if (k === 'anim' && T[1] === 'Sitting_Exit') p.showProps(null); // 起身时书、本子先收起来
    if (k === 'chair') { const g = shared.layers.get(T[1]); T.from = g ? g.userData.pullK || 0 : 0; }
    if (C) C.start(p, T);
  }
  T.t += dt;
  let done;
  if (C) done = C.step(p, T, dt);
  else if (k === 'anim') {
    const a = p.cur, d = a.getClip().duration, e = Math.min(1, a.time / d);
    if (T[1] === 'Sitting_Exit') r.position.y = p.sitY + (p.standY - p.sitY) * e; // 坐着压低一点贴坐垫，站起来脚踩回地板
    if (T[1] === 'Sitting_Enter') r.position.y = p.standY + (p.sitY - p.standY) * e;
    done = a.time >= d - 0.05;
  } else if (k === 'lamp') { const l = shared.toggles.get(T[1]); if (l) l.on = true; done = true; // 开灯（只改 intensity）
  } else if (k === 'idle') done = T.t >= T[1];
  else if (k === 'seat') { const a = seatPose(p, T[1], SEATS[T[1]].pull ? 1 : 0); p.seat = T[1]; p.standY = r.position.y; p.sitY = a.y; done = true; }
  else if (k === 'unseat') { p.seat = null; const f = _cv.set(0, 0, 1).applyQuaternion(r.quaternion); r.rotation.set(0, Math.atan2(f.x, f.z), 0); done = true; } // 摇椅上 quaternion 是「仰 × 朝向」，拆成 XYZ 欧拉角时朝向 >90° 会落到 x/z=±π 上，直接清 x/z 会一下转 86°；按正前方重算朝向
  else if (k === 'chair') { // 拉开 / 推回椅子；人坐在上面就一起挪
    const g = shared.layers.get(T[1]), S = SEATS[T[1]], e = Math.min(1, T.t / 0.6), kk = T.from + (T[2] - T.from) * e * e * (3 - 2 * e);
    if (g) { const dk = kk - (g.userData.pullK || 0); g.userData.pullK = kk; g.position.set(S.pull[0] * kk, 0, S.pull[1] * kk); shared.shadowDirty = true;
      if (p.seat === T[1] && p.mode === 'sit') { r.position.x += S.pull[0] * dk; r.position.z += S.pull[1] * dk; } }
    done = e >= 1;
  } else {
    const dx = T[1] - r.position.x, dz = T[2] - r.position.z, dist = Math.hypot(dx, dz);
    const da = shared.angDiff(r.rotation.y, k === 'turn' ? T[1] : Math.atan2(dx, dz)), lim = 4 * dt; // 模型面朝 +Z：朝向 = atan2(dx, dz)
    r.rotation.y += THREE.MathUtils.clamp(da, -lim, lim);
    if (k === 'walk') {
      const v = Math.min(dist, WALK_SPEED * r.scale.x * dt * (Math.abs(da) < 1 ? 1 : 0.3)); // 还没转过来先慢走
      if (dist > 1e-4) { r.position.x += dx / dist * v; r.position.z += dz / dist * v; }
      const fy = floorBelow(r.position.x, r.position.y, r.position.z); if (fy !== null) r.position.y += (fy + 0.01 - r.position.y) * Math.min(1, dt * 10);
      done = dist - v < 0.01;
    } else done = Math.abs(da) < 0.02;
  }
  if (!done) return;
  p.tasks.shift();
  if (T[1] === 'Sitting_Exit') p.setMode('stand');
  if (T[1] === 'Sitting_Enter') { p.setMode('sit'); if (p.seat === p.home) p.claim = null; p.next = 10 + Math.random() * 15; if (SEATS[p.seat]?.rock) p.ride = { x: r.position.x, y: r.position.y, z: r.position.z, yaw: r.rotation.y }; }
  if (k === 'unseat') p.ride = null;
}
function updatePeople(dt) {
  for (const [id, p] of people) { unLook(p); unDesk(p); p.mixer.update(dt); stepPerson(id, p, dt); deskFix(p); updateLook(p, dt); }
}
function stepPerson(id, p, dt) {
  if (p.tasks.length) { runTask(p, dt); return; }
  if (p.after && p.after()) p.after = null; // 排着的下一件事（天黑去书桌）：手头的一段做完再去，返回 false 就下一帧再试
  if (p.tasks.length) return;
  if (p.player) return; // 玩家在操控：动作由 updateFP 管
  if (ROUTINES[id] && (p.roam -= dt) < 0) { // 隔 1–2.5 分钟自己起来去做点事；不在自己座位上（玩家退出时留在别处）就先回去
    p.roam = 70 + Math.random() * 90;
    if (!ROUTINES[id].home && !p.home) p.tasks = shared.planWander(p); // 游戏白天的书记员：没有自己的座位，站着在楼下转
    else if (p.mode === 'sit' && p.seat === (ROUTINES[id].home || p.home)) wakePerson(id); else goHome(p, id);
    if (p.tasks.length) return;
  }
  const m = moodOf(p), a = p.cur, clip = a && a.getClip();
  if (a && a.loop === THREE.LoopOnce && a.time >= clip.duration - 0.05) { p.play(m.idle); p.next = 10 + Math.random() * 15; return; } // 一次性动作做完回到待机
  const ex = m.extra.filter((n) => p.acts[n]); // 书记员没有 Idle_Talking_Loop（游戏里她白天站着，原来去取它的 loop 每帧报错、卡住后面的天色更新）
  if ((p.next -= dt) > 0 || !ex.length) return;
  if (clip && clip.name === m.idle) { // 待机一阵后做个小动作，聊天类的做 1–2 遍
    const n = ex[Math.floor(Math.random() * ex.length)]; p.play(n, 0.6);
    p.next = p.acts[n].loop === THREE.LoopOnce ? 99 : p.acts[n].getClip().duration * (1 + Math.floor(Math.random() * 2));
  } else { p.play(m.idle, 0.6); p.next = 10 + Math.random() * 15; }
}
// —— 东看看西看看（2026-10-20，女调查员）：站着、走路时头转向附近的「看点」（墙上的东西、家具、阁楼上往下看起居室），隔 2–5 秒换一个，有时就看前面；
// 任务里的 look / pose 可以指定看哪儿。加在动作之上：mixer.update 之后把转角分给 neck_01（40%）和 Head（60%），左右限 ±65°、上下 -35°…+25°，平滑转过去。坐着、爬梯子、玩家操控时不转。
const LOOKS = [[1.42, 0.55, -1.3], [-1.0, 1.75, -1.6], [-1.7, 1.65, -1.08], [-0.56, 1.6, 0.71], [0.2, 1.7, 0.72], [0.2, 1.6, -1.6], [1.67, 1.79, 1.2], [1.1, 1.4, 1.7], [-1.47, 1.7, -0.6],
  [-0.1, 0.7, -0.65], [0.0, 0.9, 0.4], [-1.4, 1.0, -1.1], [0.6, 2.8, -0.5], // 一楼：炉火、书架、地图、挂毯、鹿角、碗架、枪、雪鞋、壁灯、茶几、沙发、书桌、阁楼栏杆
  [-0.4, 2.7, -0.8], [0.35, 2.8, -1.5], [0.0, 3.7, 1.67], [0.0, 3.3, 1.66], [-0.6, 2.8, 1.1], [-1.5, 2.6, 0.0], [-0.35, 3.85, 1.1], [0.0, 0.8, -0.5], [1.4, 0.9, -1.3]]; // 阁楼：床、床头柜、挂钩、毛巾、摇椅、矮柜、吊灯、楼下起居室、楼下炉子
const LOOK_CLIPS = new Set(['Idle_Loop', 'Walk_Loop', 'Idle_FoldArms_Loop']);
const _lp = new THREE.Vector3(), _lv = new THREE.Vector3(), _lq = new THREE.Quaternion(), _lq2 = new THREE.Quaternion(), _lpq = new THREE.Quaternion(), _lax = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0);
function pickLook(p) {
  if (Math.random() < 0.25) return null; // 看前面
  const r = p.root.position, eyeY = r.y + 1.4, ok = LOOKS.filter(([x, y, z]) => {
    const d = Math.hypot(x - r.x, z - r.z); if (d < 0.6 || d > 5 || Math.abs(y - eyeY) > 2.2) return false;
    if ((r.y > 1.5) !== (y > 2.2) && !(r.y > 1.5 && r.x > 0.1 && y < 1.5)) return false; // 楼上只能隔着栏杆往下看
    return Math.abs(shared.angDiff(p.root.rotation.y, Math.atan2(x - r.x, z - r.z))) < 1.4;
  });
  return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
}
function updateLook(p, dt) {
  if (!p.neck || !p.head || !p.acts.Climb_Ladder_Loop) return; // 只有女调查员（有爬梯动作的）东张西望
  const ok = !p.player && !p.seat && p.cur && LOOK_CLIPS.has(p.cur.getClip().name);
  if (ok && (p.lookT -= dt) < 0) { p.lookT = 2 + Math.random() * 3; p.look = pickLook(p); }
  let wy = 0, wp = 0;
  if (ok && p.look) {
    p.head.getWorldPosition(_lp); _lv.set(p.look[0], p.look[1], p.look[2]).sub(_lp);
    const yaw = shared.angDiff(p.root.rotation.y, Math.atan2(_lv.x, _lv.z));
    if (Math.abs(yaw) < 2.2) { wy = THREE.MathUtils.clamp(yaw, -1.13, 1.13); wp = THREE.MathUtils.clamp(Math.atan2(_lv.y, Math.hypot(_lv.x, _lv.z)), -0.6, 0.44); }
  }
  const e = Math.min(1, dt * 2.5); p.lookYaw += (wy - p.lookYaw) * e; p.lookPitch += (wp - p.lookPitch) * e;
  if (Math.abs(p.lookYaw) + Math.abs(p.lookPitch) < 1e-3) return;
  const fy = p.root.rotation.y + p.lookYaw; _lax.set(-Math.cos(fy), 0, Math.sin(fy)); // 抬头的转轴 = 视线 × 上
  for (const [b, f] of [[p.neck, 0.4], [p.head, 0.6]]) {
    _lq.setFromAxisAngle(_UP, p.lookYaw * f); _lq2.setFromAxisAngle(_lax, p.lookPitch * f); _lq.premultiply(_lq2); // 世界里先左右转、再抬头
    b.parent.getWorldQuaternion(_lpq); _lq.premultiply(_lpq.clone().invert()).multiply(_lpq); // 换到父骨骼空间：P⁻¹·q·P
    b.quaternion.premultiply(_lq); (b.userData.lookQ ||= new THREE.Quaternion()).copy(_lq); b.userData.lookOn = true;
  }
}
// 下一帧 mixer.update 之前把上一帧加的转角减掉。three 的 PropertyMixer 只在动画值变了时才写回骨骼：
// 头/颈轨道是常量的动作（Climb_Ladder_Loop 只有两帧一样的关键帧、坐姿看书写字也是常量）不会每帧覆盖，
// 直接在骨骼上 premultiply 会一帧帧累加 → 爬梯时头越转越歪、切到 Ladder_Top 那一帧又一下弹回 107°（2026-10-22 修）
function unLook(p) {
  for (const b of [p.neck, p.head]) if (b && b.userData.lookOn) { b.quaternion.premultiply(_lq.copy(b.userData.lookQ).invert()); b.userData.lookOn = false; }
}

// —— 书记员伏案写字：在 mixer 之后重摆双臂（2026-10-22 修「手扭曲」）——
// Sitting_Write_Loop 是 Blender 里按「桌面 = 坐面 + 0.30m」摆的，网页里书桌比那高 ~4.5cm：本子（0.779–0.791）、笔尖、指尖全插在桌面（0.83）里，
// 手臂为够那个低处几乎伸直、前臂往下斜 25–40°，左腕折 36°、右手相对前臂扭 46°，看着就是拧着的拳头戳进桌子。
// 这里按真实桌面给绝对目标（根节点局部坐标，未缩放单位，+Z 朝前、-X 是她的右边）：两骨 IK、手肘垂下让前臂搭在桌沿；
// 右手给定朝向（手指朝前下、手心朝内下、小指侧落纸），倒推手腕让笔尖落在本子上；左手手心朝下平按本子；手相对前臂的扭转 65% 挪给前臂（骨架没有 twist 骨）。
// hand 局部：+Y 指尖方向，右手 -X / 左手 +X 是手心，+Z 是食指一侧。改的是最终值，下一帧 mixer.update 前 unDesk 还原（常量轨道不会每帧覆盖，同 unLook）。
const DESK_FIX = {
  nbLift: 0.052, // 本子往上挪到桌面上
  // 右手：tip = 笔尖落点；fwd = 手指方向（往内 15°、往下 5°）；palm = 手心（朝下、往内滚 30°，小指侧落纸）。这组数是网格搜出来的：
  // 中指尖比笔尖高 ≥1cm、笔杆仰 51°、手腕在纸上 ~7cm（手指、笔、朝向一起搜，见 ../_test/probe8.js）
  r: { tip: [-0.02, 0.847, 0.2], fwd: [0.258, -0.087, 0.962], palm: [0.5, -0.866, 0], pole: [-0.5, -1, -0.5] },
  l: { wrist: [0.17, 0.885, 0.12], fwd: [-0.3, -0.06, 0.95], palm: [0, -1, 0], pole: [0.5, -1, -0.5], thumb: -0.35 }, // 左手平按本子；thumb = 大拇指绕局部 Z 往手背抬（原来插进本子）
  grip: { index: [0.45, 0.55, 0.32], middle: [0.95, 1.05, 0.57], ring: [1.35, 1.35, 0.81], pinky: [1.35, 1.35, 0.81] }, // 右手各指 01/02/03 节弯曲（弧度）：食指拇指捏笔，中指托在下面，无名指小指蜷起
  penOut: 0.045, // 笔尖伸出捏笔点（食指尖与拇指尖中点）多少；笔杆从捏笔点往后穿过虎口 PEN_K
};
const PEN_K = [-0.005, 0.05, 0.068]; // hand_r 局部：虎口（食指根和拇指根之间、靠食指外侧）。在手心手背中间会看着像笔从手背穿出来
const _dk = Array.from({ length: 9 }, () => new THREE.Vector3()), _dkq = Array.from({ length: 4 }, () => new THREE.Quaternion()), _dkm = new THREE.Matrix4();
function deskInit(p) {
  const g = (n) => p.root.getObjectByName(n), arm = (s) => ({ up: g('upperarm_' + s), lo: g('lowerarm_' + s), hand: g('hand_' + s) });
  p.desk = p.acts.Sitting_Write_Loop && g('hand_r') && g('hand_l') ? { r: arm('r'), l: arm('l'), on: false, grip: [] } : null;
  let sk = null; p.root.traverse((o) => { if (o.isSkinnedMesh && !sk && o.skeleton.bones.some((b) => b.name === 'index_01_r')) sk = o.skeleton; });
  if (p.desk && sk) { // 右手握笔的手指：从静止姿势（伸直）起绕局部 +X 弯（+X = 往手心弯，左右手都是），不在原动作上叠加
    const restW = (n) => sk.boneInverses[sk.bones.findIndex((b) => b.name === n)].clone().invert();
    for (const [f, as] of Object.entries(DESK_FIX.grip)) as.forEach((ang, j) => {
      const b = g(`${f}_0${j + 1}_r`); if (!b) return;
      const q = new THREE.Quaternion(); restW(b.parent.name).invert().multiply(restW(b.name)).decompose(_dk[0], q, _dk[1]);
      p.desk.grip.push([b, q.multiply(new THREE.Quaternion().setFromAxisAngle(_dk[0].set(1, 0, 0), ang))]);
    });
    // 笔重新放：原来笔尖在食指末节关节上，手指一弯指尖比笔尖还低（戳进纸）。按握笔手型量食指尖、拇指尖，笔夹在中间、笔尖往前下伸出 penOut
    const pen = g('Pen'), hand = g('hand_r'), it = g('index_04_leaf_r'), th = g('thumb_04_leaf_r');
    if (pen && it && th) {
      const keep = p.desk.grip.map(([b]) => b.quaternion.clone());
      for (const [b, q] of p.desk.grip) b.quaternion.copy(q);
      p.root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(hand.matrixWorld).invert(); // 从根更新：刚加载时骨骼的 matrixWorld 还是单位阵
      const G = it.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).lerp(th.getWorldPosition(_dk[0]).applyMatrix4(inv), 0.5); G.z += 0.008; // 贴食指外侧
      const ax = G.clone().sub(_dk[1].fromArray(PEN_K)).normalize(), tip = G.addScaledVector(ax, DESK_FIX.penOut);
      pen.geometry.computeBoundingBox(); const half = pen.geometry.boundingBox.max.y; // 笔是沿自身 Y 的细圆柱
      const old = _dk[5].set(-0.04, 0.12, 0.032), end = _dk[2].set(0, half, 0).applyQuaternion(pen.quaternion).add(pen.position);
      const sgn = end.distanceTo(old) < _dk[3].set(0, -half, 0).applyQuaternion(pen.quaternion).add(pen.position).distanceTo(old) ? 1 : -1; // 哪头是笔尖：原动作里笔尖在 hand_r 局部 (-0.04, 0.12, 0.032)
      pen.quaternion.setFromUnitVectors(_dk[4].set(0, sgn, 0), ax); pen.position.copy(tip).addScaledVector(ax, -half);
      p.desk.penTip = tip.toArray();
      p.desk.grip.forEach(([b], i) => b.quaternion.copy(keep[i])); hand.updateMatrixWorld(true);
    }
    p.desk.thumbL = g('thumb_01_l');
  }
  const nb = g('Notebook');
  if (p.desk && nb) { p.root.updateMatrixWorld(true); const v = nb.getWorldPosition(_dk[0]); v.y += DESK_FIX.nbLift * p.root.scale.y; nb.position.copy(nb.parent.worldToLocal(v)); }
}
function unDesk(p) {
  const d = p.desk; if (!d || !d.on) return;
  for (const s of ['r', 'l']) for (const b of [d[s].up, d[s].lo, d[s].hand]) b.quaternion.copy(b.userData.deskQ);
  for (const [b] of d.grip) b.quaternion.copy(b.userData.deskQ);
  if (d.thumbL) d.thumbL.quaternion.copy(d.thumbL.userData.deskQ);
  d.on = false;
}
function setWorldQ(b, q) { b.quaternion.copy(b.parent.getWorldQuaternion(_dkq[3]).invert().multiply(q)); b.updateMatrixWorld(true); }
function aimBone(b, from, to) { // 转骨骼，让它下面的点从 from 移到 to（世界）
  const o = b.getWorldPosition(_dk[8]), q = _dkq[2].setFromUnitVectors(_dk[6].subVectors(from, o).normalize(), _dk[7].subVectors(to, o).normalize());
  setWorldQ(b, q.multiply(b.getWorldQuaternion(_dkq[1])));
}
function deskFix(p) {
  const a = p.acts.Sitting_Write_Loop;
  if (!a || !a.isRunning()) return;
  if (p.desk === undefined) deskInit(p); // 第一次真在写字时才初始化（量拇指尖要用写字动作里的拇指）
  const d = p.desk; if (!d) return;
  const w = a.getEffectiveWeight(); if (w < 0.01) return;
  const R = p.root; R.updateMatrixWorld(true);
  const rq = R.getWorldQuaternion(_dkq[0]);
  for (const s of ['r', 'l']) {
    const A = d[s], F = DESK_FIX[s];
    for (const b of [A.up, A.lo, A.hand]) (b.userData.deskQ ||= new THREE.Quaternion()).copy(b.quaternion);
    // 手的目标朝向（根局部）：Y = 指尖方向，手心按左右手是 ∓X
    const y = _dk[0].fromArray(F.fwd).normalize(), x = _dk[1].fromArray(F.palm);
    x.addScaledVector(y, -x.dot(y)).normalize(); if (s === 'r') x.negate();
    _dkm.makeBasis(x, y, _dk[2].crossVectors(x, y));
    const W = _dk[3].fromArray(F.tip || F.wrist);
    if (s === 'r' && d.penTip) W.sub(_dk[4].fromArray(d.penTip).applyMatrix4(_dkm)); // 笔尖落点 → 手腕位置
    R.localToWorld(W);
    const qh = new THREE.Quaternion().setFromRotationMatrix(_dkm).premultiply(rq);
    // 两骨 IK：肩 S、肘 E、腕 W；肘往 pole 方向垂
    const S = A.up.getWorldPosition(_dk[4]), E0 = A.lo.getWorldPosition(_dk[5]).clone(), H0 = A.hand.getWorldPosition(_dk[0]);
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0), u = _dk[1].subVectors(W, S), dd = Math.min(u.length(), (L1 + L2) * 0.999);
    u.normalize();
    const ca = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd), hh = Math.sqrt(Math.max(0, L1 * L1 - ca * ca));
    const pole = _dk[2].fromArray(F.pole).applyQuaternion(rq); pole.addScaledVector(u, -pole.dot(u)).normalize();
    const E = S.clone().addScaledVector(u, ca).addScaledVector(pole, hh);
    W.copy(S).addScaledVector(u, dd);
    aimBone(A.up, E0, E);
    aimBone(A.lo, A.hand.getWorldPosition(_dk[0]), W);
    setWorldQ(A.hand, qh);
    // 手腕扭转的 65% 挪给前臂（绕前臂自身 Y），手的世界朝向不变
    const hq = A.hand.quaternion, tw = 2 * Math.atan2(hq.w < 0 ? -hq.y : hq.y, Math.abs(hq.w)); // 四元数 w<0 时要翻号，否则扭转算成绕远路的 ±300°
    A.lo.quaternion.multiply(_dkq[1].setFromAxisAngle(_dk[0].set(0, 1, 0), 0.65 * tw)); A.lo.updateMatrixWorld(true);
    setWorldQ(A.hand, qh);
    if (w < 0.999) for (const b of [A.up, A.lo, A.hand]) { _dkq[1].copy(b.quaternion); b.quaternion.copy(b.userData.deskQ).slerp(_dkq[1], w); }
  }
  for (const [b, q] of d.grip) { (b.userData.deskQ ||= new THREE.Quaternion()).copy(b.quaternion); b.quaternion.slerp(q, w); }
  if (d.thumbL) { const b = d.thumbL; (b.userData.deskQ ||= new THREE.Quaternion()).copy(b.quaternion); b.quaternion.multiply(_dkq[1].setFromAxisAngle(_dk[0].set(0, 0, 1), DESK_FIX.l.thumb * w)); }
  d.on = true;
}


share({ people: () => people, SEATS: () => SEATS }); // interact.js 用
export { people, SEATS, wakePerson, loadPeople, seatTaken, goHome, SPOTS, routeTasks, NAV, MOODS, fpRise, sitTasks, CLIMB, moodOf, climbAt, WALK_SPEED, ladderRoot, floorBelow, goTasks, nearNode, navPath, updatePeople };
