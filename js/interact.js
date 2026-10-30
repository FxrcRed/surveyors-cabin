// 点一下会动的东西：门、灯、提灯火苗、水、门帘、摇椅、炉火（2026-10-30 从 index.html 拆出；主页面的变量写 shared.名字，见 web/CLAUDE.md「模块」）
import * as THREE from 'three';
import { wallU, indoorU } from './time-of-day.js';
import { scene, renderer, camera, hemi } from './core.js';
import { wx } from './weather.js';
import { shared, share } from './state.js';

// —— 门、灯：点一下开/关 ——
// 门的「开」= Rhino 里建模的样子（大门朝外开、卫生间折叠门收起、炉门半开），点了才关上。
// 合页位置是从 glb 量出来的（米），Rhino 里挪了门要跟着改 DOORS。
// 合并前先把卫生间两扇门板、炉门从所在图层里拆出来，各成一个图层，才能单独转动；灯泡/灯罩的材质每盏灯克隆一份，才能单独发光。
const GLOW = /bulb|lamp_glass|lantern_glass|flame/;
const isLamp = (n) => n === 'entry_porch_lamp' || n === 'wall_lamp' || n === 'entry_lantern' || n.startsWith('ceiling_light_') || n.startsWith('hall_pendant_');
// 软物件在 Blender 里单独做（../blender/scripts/towel_glb.py 等），加载时换掉 Rhino 导出的原物件；挂在原图层下，点选/卡片照旧。材质按名字借 cabin 里的
const SOFT_PROPS = { loft_hanging_towel: 'props/loft_towel.glb', bed_quilt: 'props/bed_quilt.glb', bed_quilt_fold: 'props/bed_quilt_fold.glb' };
async function swapSoftProps(root) {
  const mats = new Map();
  root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) mats.set(m.name, m); });
  await Promise.all(Object.entries(SOFT_PROPS).map(async ([name, url]) => {
    const layer = root.getObjectByName(name);
    const g = layer && await shared.loader.loadAsync(url).catch((e) => console.warn(url, e));
    if (!g) return; // 加载失败就留着原物件
    layer.clear();
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), mats.get(o.material.name) || o.material);
      m.name = o.name; layer.add(m);
    });
  }));
}
function splitParts(root) {
  root.updateMatrixWorld(true);
  const pull = (from, to, test) => {
    const src = root.getObjectByName(from);
    if (!src) return;
    let g = root.getObjectByName(to); // 已有的图层（大门）就并进去
    if (!g || g.parent === src) { g = new THREE.Group(); g.name = to; (src.parent === root ? src : src.parent).add(g); } // 合并时第二层才算一个图层（炉子本身就是顶层图层）
    for (const o of [...src.children]) if (test(o)) g.attach(o);
  };
  const cx = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  // 折叠门：合页片贴哪块板（A 板在 z>0.814 一侧）跟哪块走，贴门柱的不动；折页处的合页轴跟 A 板
  pull('entry_toilet_room', 'toilet_door_A', (o) => /^toilet_door_(A_|handle)/.test(o.name)
    || (/^toilet_door_hinge_leaf/.test(o.name) && cx(o).z > 0.814)
    || (/^toilet_door_hinge_knuckle/.test(o.name) && cx(o).x < -0.8));
  pull('entry_toilet_room', 'toilet_door_B', (o) => /^toilet_door_B_/.test(o.name)
    || (/^toilet_door_hinge_leaf/.test(o.name) && cx(o).x < -0.8));
  // 大门的铰链带、门闩、夜闩在 doghouse_dark 图层；门框上的铰链座（pintle）、锁扣（door_frame_*）不动
  pull('doghouse_dark', 'door_wood', (o) => /^door_(hinge|latch|night)/.test(o.name) && !/pintle/.test(o.name));
  pull('entry_umbrella_stand', 'entry_umbrella', (o) => o.name === 'umbrella'); // 墙上的黑伞、接水盘里的登山杖各自单独点（剩下接水盘 + 雪鞋）
  pull('entry_umbrella_stand', 'entry_stick', (o) => o.name === 'stick');
  pull('entry_coat_rail', 'entry_lantern', (o) => /^lantern_/.test(o.name)); // 衣帽架上挂的提灯，拆出来才能单独开关
  pull('stove_iron', 'stove_door', (o) => /^stove_(door_frame|glass|handle)/.test(o.name));
  // 其他可动件：同名部件按位置分（干洗槽两扇门按 x），其余按名字
  pull('dry_sink', 'dry_sink_door_1', (o) => /^dsink_(door|knob)/.test(o.name) && cx(o).x < 0.11);
  pull('dry_sink', 'dry_sink_door_2', (o) => /^dsink_(door|knob)/.test(o.name));
  pull('loft_desk', 'desk_drawer', (o) => /^desk_(drawer_(box|front)|knob)/.test(o.name));
  pull('loft_bedside_table', 'bedside_drawer', (o) => /^bst_(drawer|knob)/.test(o.name));
  pull('dining_wall_table', 'dining_leaf', (o) => /^dtable_(leaf|cleat)/.test(o.name));
  pull('dining_wall_table', 'dining_table_rope', (o) => /^dtable_(rope|nail)/.test(o.name)); // 桌板放下时藏起来
  pull('loft_rail', 'loft_gate', (o) => /^loft_gate_bar/.test(o.name));
  pull('entry_noren', 'entry_noren_rod', (o) => /^noren_(rod|clip|loop)/.test(o.name)); // 杆子、夹子、环留在原位，只卷布
  pull('stove_iron', 'stove_firebox', (o) => /^stove_firebox_/.test(o.name)); // 炉膛里的柴和余烬：点它等于点火
  // 炉身：stove_iron 是顶层图层，部件都是多材质（导出成 Group），合并时各成一个图层（stove_body、stove_leg…）、不在 INFO 里 → 原来炉子点不了。
  // 除拆出去的炉门、炉膛柴以外，屋里的部件（包围盒 min.x < 2；烟管穿出东墙后那截和烟囱帽不算）收进 stove_iron_body，infoOf 映射回 stove_iron
  // 烟管（从炉顶一根弯到东墙外）、墙上的法兰、墙外的卡箍/外伸管/烟囱帽并进墙上隔热板图层 stove_wall_thimble：烟囱 + 隔热板是一个物件，炉子单独一个（2026-10-22 用户定）
  pull('stove_iron', 'stove_wall_thimble', (o) => /^stove_(flue_(pipe|flange|clamp)|cap_)/.test(o.name));
  const notBody = new Set(['stove_door', 'stove_firebox', 'stove_iron_body']);
  pull('stove_iron', 'stove_iron_body', (o) => !notBody.has(o.name) && new THREE.Box3().setFromObject(o).min.x < 2);
  pull('firewood_split', 'firewood_end', () => true); // 炉子底下的柴堆：柴的侧面、端面在 glb 里是两个顶层图层（点出来是两样东西），并成一个
  pull('entry_toilet', 'entry_toilet_lid', (o) => /^toilet_lid/.test(o.name));
  pull('stove_reservoir', 'stove_reservoir_lid', (o) => /^reservoir_lid($|_hinge_leaf|_knob)/.test(o.name));
  pull('sink_slop_pail', 'slop_pail_lid', (o) => /^pail_lid/.test(o.name));
  pull('entry_washstand', 'entry_washstand_tank_lid', (o) => /^wash_tank_(lid|knob)/.test(o.name));
  splitWaterFx(pull); // 龙头手柄、阀体、壶盖（见 setupWaterFx）
  // 挂在墙上的东西：钉子、支架、挂杆、挂钩这些固定在墙上的五金件并进 wall_fixings（不在 INFO 里 = 不可选，pick 时射线直接穿过），
  // 点地图/锅/枪只描物件本身。衣帽架的钉子也算；衣帽架的木钉、挂钩是衣帽架自己的，留着
  const FIX = [['wall_shotgun', /^shotgun_bracket/], ['wall_axe', /^axe_bracket/], ['wall_map', /^map_(nail|cord)/],
    ['wall_tapestry', /^tapestry_(bracket|rod|finial)/], ['wall_snowshoes', /^snowshoe_peg/], ['wall_lamp', /^lamp_(plate|arm|ring)/],
    ['entry_porch_lamp', /^lamp_(plate|arm|ring)/], ['wall_pot_rail', /^pot_rail_/], ['wall_utensil_rack', /^utensil_(board|rail|hook|knife_bar|knife_spacer)/],
    ['entry_shelf', /^eshelf_nail/], ['entry_coat_rail', /^coat_rail_nail/], ['entry_towel_rack', /^toilet_towel_(pipe|flange)/],
    ['entry_tp_holder', /^toilet_tp_/], ['sink_water_bucket', /^dipper_nail/], ['entry_cleaning_tools', /^toilet_tool_(hook|flange)/]];
  for (const [from, re] of FIX) pull(from, 'wall_fixings', (o) => re.test(o.name));
  pull('umbrella', 'wall_fixings', (o) => /^umbrella_rack_/.test(o.name)); // 伞的墙上挂钩在 umbrella 组里面（pull 只看直接子物件）
  // 扫帚、簸箕各成一件（挂钩、墙上法兰上面已并进 wall_fixings）；挂绳按 x 分：簸箕在东边 x≈−1.355，扫帚 x≈−1.59
  pull('entry_cleaning_tools', 'entry_cleaning_tools_pan', (o) => /^toilet_pan/.test(o.name) || (/^toilet_tool_cord/.test(o.name) && cx(o).x > -1.47));
  pull('entry_cleaning_tools', 'entry_cleaning_tools_broom', (o) => /^toilet_(broom|tool_cord)/.test(o.name));
  pull('entry_coat_rail', 'entry_coat_rail_keys', (o) => /^keys_/.test(o.name)); // 衣帽架挂钩上的一串钥匙
  pull('sink_water_bucket', 'sink_water_bucket_dipper', (o) => /^dipper_(bowl|handle)/.test(o.name)); // 水桶上方钉子上挂的水瓢
  // 第一人称能拿下来看的（TAKEABLE）：锅架上两口平底锅、一口汤锅，刀架上三把刀、汤勺、两把木勺、锅铲各成一件（挂杆、挂钩上面已并进 wall_fixings）
  const byNearest = (from, keyRe, partRe, to) => { // 同名零件（刀刃、刀柄、铆钉…）按离哪个主体最近分组
    const src = root.getObjectByName(from); if (!src) return;
    const keys = src.children.filter((o) => keyRe.test(o.name)).map(cx).sort((a, b) => a.z - b.z || a.x - b.x);
    // 只按水平距离：这些都竖着挂成一排，刀把比刀刃高 10–16cm，按三维距离中间那把刀的刀把离隔壁刀刃更近（2026-10-20 用户发现刀把分错）
    const hd = (c, q) => Math.hypot(c.x - q.x, c.z - q.z);
    const near = (o) => { const c = cx(o); let bi = 0; keys.forEach((q, j) => { if (hd(c, q) < hd(c, keys[bi])) bi = j; }); return bi; };
    keys.forEach((_, i) => pull(from, to + '_' + (i + 1), (o) => partRe.test(o.name) && near(o) === i));
  };
  byNearest('wall_pot_rail', /^pot_skillet(_\d+)?$/, /^pot_skillet/, 'take_skillet');
  pull('wall_pot_rail', 'take_pot', (o) => /^pot_pot/.test(o.name));
  byNearest('wall_utensil_rack', /^utensil_knife_blade(_\d+)?$/, /^utensil_knife_(blade|edge|handle|rivet)/, 'take_knife');
  byNearest('wall_utensil_rack', /^utensil_spoon_bowl(_\d+)?$/, /^utensil_spoon_/, 'take_spoon');
  pull('wall_utensil_rack', 'take_ladle', (o) => /^utensil_ladle_/.test(o.name));
  pull('wall_utensil_rack', 'take_spatula', (o) => /^utensil_spatula_/.test(o.name));
  // 干洗槽：两只盆各自可点（右边那只有水），盘架上的盘子、杯子、擦碗布各成一组；柜子本体、锌皮内衬、盘架木框留在原图层
  pull('dry_sink', 'dry_sink_basin_2', (o) => /^dsink_basin/.test(o.name) && cx(o).x > 0.26);
  pull('dry_sink', 'dry_sink_basin_1', (o) => /^dsink_basin/.test(o.name));
  pull('wall_dish_rack', 'wall_dish_rack_plates', (o) => /^rack_plate/.test(o.name));
  pull('wall_dish_rack', 'wall_dish_rack_cups', (o) => /^rack_cup/.test(o.name));
  pull('wall_dish_rack', 'wall_dish_rack_towels', (o) => /^rack_towel($|_\d|_stripe)/.test(o.name)); // 毛巾杆留在盘架上
  // 书架上的书按格分四组（左右两格 × 上下两层，分界 x −1.077、y 1.7）；左下格平放的两本算进左下
  for (const [i, up, left] of [[1, true, true], [2, true, false], [3, false, true], [4, false, false]])
    pull('living_bookcase', 'living_bookcase_books_' + i, (o) => { if (!/^book($|_\d)/.test(o.name)) return false; const c = cx(o); return (c.y > 1.7) === up && (c.x < -1.077) === left; });
  // 柜门：门板 + 把手按包围盒中心落在哪扇门的范围里分（同名部件，只能按位置）
  for (const [name, d] of Object.entries(DOORS)) if (d.box) {
    const [x0, x1, z0, z1] = d.box;
    pull(d.from, name, (o) => { if (!/^cabinet_(door|knob|handle)/.test(o.name)) return false; const c = cx(o); return c.x > x0 && c.x < x1 && c.z > z0 && c.z < z1; });
  }
  for (const top of root.children) for (const layer of top.children) {
    if (!isLamp(layer.name)) continue;
    const clones = new Map();
    layer.traverse((o) => {
      if (!o.isMesh || !(GLOW.test(o.name) || GLOW.test(o.parent.name))) return;
      if (!clones.has(o.material)) { const m = o.material.clone(); m.userData.glow = true; clones.set(o.material, m); }
      o.material = clones.get(o.material);
    });
  }
}

const smooth01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }; // 分段动画用（壶的提梁先倒、壶盖再掀）
// 门：pivot 是合页轴（x, z），angle(k) 给出关上程度 k（0 开 → 1 关）时的转角；折叠门的 B 板挂在 A 板的折页上
const DOORS = {
  door_wood: { pivot: [-0.49, 1.9], angle: (k) => k * Math.PI / 2 },
  toilet_door_A: { pivot: [-0.636, 0.825], angle: (k) => k * Math.PI / 2 },
  // B 板反向转 2 倍：两板像手风琴一样对折，B 的外沿沿门洞滑，不往卫生间里扫大弧（同向转会撞到马桶上坐着的人）
  toilet_door_B: { pivot: [-0.978, 0.825], parent: 'toilet_door_A', angle: (k) => -k * Math.PI },
  // 炉门：Rhino 里半开 45°；第一次关上之后，再开就开到 90°（wide），之后在关 / 90° 之间切换
  stove_door: { pivot: [1.588, -1.207], angle(k) { if (k >= 1) this.wide = true; return this.wide ? Math.PI / 4 - k * Math.PI / 2 : -k * Math.PI / 4; } },
  // 柜门（box = 拆图层用的 x0,x1,z0,z1 范围；k=1 是开）。客厅柜第 3 扇 Rhino 里是开着的，k=1 是关，加载时关上
  living_cabinet_door_1: { from: 'living_cabinet', box: [-1.5, -1.36, -0.48, -0.07], pivot: [-1.415, -0.478], angle: (k) => k * Math.PI / 2 },
  living_cabinet_door_2: { from: 'living_cabinet', box: [-1.5, -1.36, -0.07, 0.31], pivot: [-1.415, 0.302], angle: (k) => -k * Math.PI / 2 },
  living_cabinet_door_3: { from: 'living_cabinet', box: [-1.42, -1.02, 0.6, 0.73], pivot: [-1.417, 0.719], angle: (k) => k * Math.PI / 2, closeOnLoad: true },
  loft_cabinet_door_1: { from: 'loft_cabinet', box: [-1.5, -1.36, -1.7, -1.29], pivot: [-1.42, -1.304], angle: (k) => -k * Math.PI / 2 },
  loft_cabinet_door_2: { from: 'loft_cabinet', box: [-1.5, -1.36, -1.29, -0.86], pivot: [-1.42, -1.276], angle: (k) => k * Math.PI / 2 },
  loft_cabinet_door_3: { from: 'loft_cabinet', box: [-1.5, -1.36, -0.86, -0.43], pivot: [-1.42, -0.444], angle: (k) => -k * Math.PI / 2 },
  loft_cabinet_door_4: { from: 'loft_cabinet', box: [-1.5, -1.36, -0.43, 0], pivot: [-1.42, -0.416], angle: (k) => k * Math.PI / 2 },
  loft_cabinet_door_5: { from: 'loft_cabinet', box: [-1.5, -1.36, 0, 0.43], pivot: [-1.42, 0.416], angle: (k) => -k * Math.PI / 2 },
  // 以下 k=1 是「动过」的样子。pivot 写三个数 = [x, y, z]；axis 是转轴（默认 y）；slide(k) 给平移（米）；also(k) 顺带改别的
  dry_sink_door_1: { pivot: [-0.375, -1.36], angle: (k) => -k * Math.PI / 2 }, // 干洗槽柜两扇门，合页在两侧外沿
  dry_sink_door_2: { pivot: [0.595, -1.36], angle: (k) => k * Math.PI / 2 },
  desk_drawer: { pivot: [-1.15, -1.115], slide: (k) => [k * 0.3, 0, 0] }, // 书桌抽屉朝 +x 拉出
  bedside_drawer: { pivot: [0.345, -1.35], slide: (k) => [0, 0, k * 0.2] }, // 床头柜抽屉朝 +z 拉出
  // 墙挂餐桌：Rhino 里桌板竖着收起（绳子挂住），合页在下沿；k=1 放平成桌面，绳子收起来
  dining_leaf: { pivot: [1.685, 1.17, 0.026], axis: 'z', angle: (k) => k * Math.PI / 2, also: (k) => { const g = shared.layers.get('dining_table_rope'); if (g) g.visible = k < 0.05; } },
  // 梯子挂在阁楼口的滑轨上：Rhino 里收在北头，k=1 沿轨道滑到栏杆开口（z 0.79–1.46）正下方，底脚往外摆一点
  loft_ladder: { pivot: [0.72, 2.35, 0.52], axis: 'z', angle: (k) => k * 0.2, slide: (k) => [0, 0, k * 0.6] },
  loft_gate: { pivot: [0.6, 2.925, 1.6], axis: 'x', angle: (k) => -k * Math.PI / 2 }, // 阁楼口的拦杆：Rhino 里竖着，k=1 放下拦住开口
  entry_toilet_lid: { pivot: [-1.564, 0.612, 1.259], axis: 'z', angle: (k) => -k * Math.PI / 2, slide: (k) => [0, k * 0.022, 0] }, // 马桶盖 Rhino 里掀着，k=1 盖上（抬 2cm 落在座圈上）
  stove_reservoir_lid: { pivot: [1.088, 0.873, -1.42], axis: 'z', angle: (k) => -k * Math.PI * 0.53 }, // 炉边水箱盖，合页在靠炉一侧
  slop_pail_lid: { pivot: [-0.59, 0.56, -1.565], slide: (k) => [0, k * 0.12, 0], axis: 'z', angle: (k) => k * 0.35 }, // 污水桶盖：提起来、歪一点
  // 洗脸架水箱盖：合页在贴墙的后沿（z 1.718），前沿翻起 80°
  entry_washstand_tank_lid: { pivot: [-0.85, 2.013, 1.718], axis: 'x', angle: (k) => k * 1.4 },
  // 水壶：提梁立着横跨壶盖，先把提梁放倒到壶嘴一侧（−n），再从另一侧（+n）的合页翻开壶盖。
  // 转轴 u 沿两个提梁耳 (1.27,−1.512)→(1.35,−1.288) 的方向（斜的，axis 给向量）；n = (0.942,0,−0.336) 水平垂直于 u
  stove_kettle_lid: { pivot: [1.3665, 1.004, -1.42], axis: [0.336, 0, 0.942], angle: (k) => -1.7 * smooth01((k - 0.35) / 0.65) },
  stove_kettle_bail: { pivot: [1.31, 0.973, -1.40], axis: [0.336, 0, 0.942], follow: 'stove_kettle_lid', angle: (k) => 1.45 * smooth01(k / 0.4) },
};
// 灯：光源放在灯泡/火苗位置（稍微往屋里挪），亮度按灯的大小给
const LAMPS = {
  entry_porch_lamp: { pos: [0.8, 1.8, 2.2], power: 2.5, range: 3.5 },
  wall_lamp: { pos: [-1.38, 1.7, -0.6], power: 1.2, range: 3 },
  entry_lantern: { pos: [-0.1, 1.56, 0.93], power: 1, range: 2.5 },
  hall_pendant_south: { pos: [1.12, 1.95, 0.71], power: 3, range: 4.5 },
  hall_pendant_north: { pos: [1.12, 1.95, -0.49], power: 3, range: 4.5 },
  ceiling_light_entry: { pos: [0.015, 2.05, 1.236], power: 3, range: 4 },
  ceiling_light_living: { pos: [-0.125, 2.05, -0.46], power: 3.5, range: 4.5 },
  ceiling_light_toilet: { pos: [-1.155, 2.05, 1.236], power: 2, range: 3 },
  ceiling_light_loft_bed: { pos: [-0.35, 3.72, -0.9], power: 3, range: 4 },
  ceiling_light_loft_rocker: { pos: [-0.35, 3.72, 1.1], power: 3, range: 4 },
};
const GLOW_COLOR = new THREE.Color(0xffc27a);
const toggles = new Map(); // 图层名 → { on, k(动画进度 0→1), apply(k) }
function setupToggles() {
  const pivots = {};
  for (const [name, d] of Object.entries(DOORS)) {
    const g = shared.layers.get(name);
    if (!g) continue;
    const pv = new THREE.Group();
    const host = pivots[d.parent] || g.parent;
    const p = d.pivot.length === 3 ? d.pivot : [d.pivot[0], 0, d.pivot[1]];
    pv.position.copy(host.worldToLocal(new THREE.Vector3(...p)));
    host.add(pv); pv.updateMatrixWorld(true);
    pv.attach(g); pivots[name] = pv; pv.userData.base = pv.position.clone();
  }
  for (const name of Object.keys(DOORS)) {
    if (!pivots[name]) continue;
    const d = DOORS[name], pv = pivots[name], key = d.parent || d.follow || name; // 折叠门两块板共用一个开关；follow = 跟着别人的开关动（壶的提梁）
    if (!toggles.has(key)) toggles.set(key, { on: false, k: 0, parts: [] });
    toggles.get(key).parts.push((k) => {
      if (d.angle) { if (Array.isArray(d.axis)) pv.quaternion.setFromAxisAngle(new THREE.Vector3(...d.axis), d.angle(k)); else pv.rotation[d.axis || 'y'] = d.angle(k); } // axis 给向量 = 斜轴
      if (d.slide) pv.position.copy(pv.userData.base).add(new THREE.Vector3(...d.slide(k))); // 父级都没旋转，世界方向 = 本地方向
      if (d.scale) pv.scale.set(...d.scale(k)); // 绕合页点缩放（门帘卷起）
      if (d.also) d.also(k);
    });
  }
  toggles.get('door_wood')?.parts.push((k) => { wallU.x = 1 - k; }); // 大门 k=1 是关上：屋内灯只从开着的门洞照到屋外（wallPass）
  toggles.get('stove_door')?.parts.push((k) => { fire.door = 1 - k; }); // 炉门 k=1 是关上：关着时炉火点光源只剩玻璃透出的微光（updateFire）
  for (const [name, l] of Object.entries(LAMPS)) {
    const g = shared.layers.get(name);
    if (!g) continue;
    const light = new THREE.PointLight(0xffb46b, 0, l.range, 2);
    light.position.set(...l.pos); // 一直 visible，只调强度：可见灯数变了会让所有材质重编译着色器（开灯卡顿）
    g.add(light); // 挂在灯的图层下：揭开屋顶藏灯时光也一起灭
    const mats = g.children.filter((m) => m.isMesh && m.material.userData.glow).map((m) => m.material);
    toggles.set(name, { on: false, k: 0, parts: [(k) => {
      light.intensity = l.power * k;
      for (const m of mats) if (m.emissive) { m.emissive.copy(GLOW_COLOR); m.emissiveIntensity = 2.5 * k; }
    }] });
  }
  setupLanternFlame();
  setupNoren();
  setupRocker();
}
// —— 提灯火苗：glb 里只有蜡烛和灯芯，没有火苗 → 在灯芯上加一个小发光水滴；开灯时长出来、轻轻跳（关灯缩到看不见，不切 visible）——
const LANTERN_WICK = [-0.099, 1.585, 0.885];
const lantern = { k: 0, t: 0, flame: null, light: null };
function setupLanternFlame() {
  const g = shared.layers.get('entry_lantern'), t = toggles.get('entry_lantern');
  if (!g || !t) return;
  const pts = []; // 水滴形轮廓：下圆上尖，高 2.6cm
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(new THREE.Vector2(0.0065 * Math.sin(Math.PI * Math.pow(u, 0.7)) * (1 - 0.3 * u), u * 0.026)); }
  const flame = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), new THREE.MeshBasicMaterial({ color: 0xffc46e, toneMapped: false }));
  flame.position.copy(g.worldToLocal(new THREE.Vector3(...LANTERN_WICK))).y -= 0.003;
  flame.scale.setScalar(1e-3);
  g.add(flame);
  lantern.flame = flame; lantern.light = g.children.find((o) => o.isPointLight);
  t.parts.push((k) => { lantern.k = k; });
}
function updateLantern(dt) {
  const f = lantern.flame; if (!f) return;
  const k = lantern.k, t = (lantern.t += dt);
  const n = 0.5 + 0.2 * Math.sin(t * 8.1) + 0.14 * Math.sin(t * 14.3 + 1.1) + 0.06 * (Math.random() - 0.5); // 比炉火轻：蜡烛只是微微晃
  const s = Math.max(1e-3, k);
  f.scale.set(s * (1 + 0.05 * Math.sin(t * 11)), s * (0.88 + 0.24 * n), s * (1 + 0.05 * Math.sin(t * 11)));
  f.rotation.z = 0.06 * Math.sin(t * 3.7) * k;
  if (lantern.light) lantern.light.intensity = LAMPS.entry_lantern.power * k * (0.8 + 0.4 * n);
}

// —— 水：炉边水箱、洗脸架的龙头点一下拧开出水，再点拧上；水壶点一下烧开——壶嘴冒白气、壶盖咔嗒跳，几秒后渐停（再点也停）——
// 位置都是浏览器里按顶点量的世界坐标：手柄转轴、出水口下沿、壶嘴口、壶盖中心。水柱落到哪里加载时从出水口往下打射线找（水箱 → 地板 0.105，洗脸架 → 盆底 0.863）
// 手柄走 DOORS（k=1 是开），龙头其余部分（阀体、出水管、软管）另成一个图层，点它也开关；卡片都映射回原家具（WATER_SUB）
const WATER_TAPS = {
  stove_reservoir_tap: { faucet: 'stove_reservoir_faucet', mouth: [0.95, 0.581, -1.163], r: 0.0032 },
  entry_washstand_tap: { faucet: 'entry_washstand_faucet', mouth: [-0.85, 1.054, 1.553], r: 0.0028 },
};
Object.assign(DOORS, {
  stove_reservoir_tap: { pivot: [0.95, 0.69, -1.189], angle: (k) => k * Math.PI / 2 }, // T 形手柄拧 90°（从上看逆时针 = 开）
  entry_washstand_tap: { pivot: [-0.85, 1.528, 1.586], angle: (k) => k * Math.PI * 0.75 }, // 十字手轮拧 135°
});
const WATER_SUB = { stove_reservoir_tap: 'stove_reservoir', stove_reservoir_faucet: 'stove_reservoir', entry_washstand_tap: 'entry_washstand', entry_washstand_faucet: 'entry_washstand', stove_kettle_lid: 'stove_kettle', stove_kettle_bail: 'stove_kettle' };
function splitWaterFx(pull) { // splitParts 里调：会转的手柄、龙头其余部分、会跳的壶盖各拆成一个图层（新名字都不是 glb 部件名）
  pull('stove_reservoir', 'stove_reservoir_tap', (o) => /^reservoir_faucet_(handle|stem)/.test(o.name));
  pull('stove_reservoir', 'stove_reservoir_faucet', (o) => /^reservoir_faucet_/.test(o.name));
  pull('entry_washstand', 'entry_washstand_tap', (o) => /^wash_tap_(handle|stem)/.test(o.name));
  pull('entry_washstand', 'entry_washstand_faucet', (o) => /^wash_tap_/.test(o.name));
  pull('stove_kettle', 'stove_kettle_lid', (o) => /^kettle_(lid|knob)/.test(o.name));
  pull('stove_kettle', 'stove_kettle_bail', (o) => /^kettle_bail/.test(o.name)); // 提梁：掀壶盖前先放倒（DOORS）
}
// 壶嘴口 [1.098, 1.033, −1.326] 朝 −x 斜上；壶盖坐在 y 1.0、半径 7cm
const KETTLE = { spout: [1.098, 1.033, -1.326], dir: [-0.52, 0.85, 0], lid: [1.31, 1.0, -1.4], lidR: 0.07, boil: 7 };
const kettle = { on: false, t: 99, amt: 0, rig: null, posed: false, fx: null };
const water = { taps: [], fxU: { uTime: { value: 0 }, uLight: { value: 1 }, uScale: { value: 1 } } };
const STEAM_N = 90, STEAM_LIFE = 2.4;
const steamU = { uAmt: { value: 0 }, uColor: { value: new THREE.Color() } };
function fxRig(name) { // 图层下的网格改成直接写 matrix（同摇椅）：点选靠 parent.name，不能加中间组
  const g = shared.layers.get(name);
  if (!g) return null;
  const ms = [];
  for (const m of g.children) if (m.isMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); ms.push({ m, base: m.matrix.clone() }); }
  return { g, ms };
}
const _fx = { inv: new THREE.Matrix4(), M: new THREE.Matrix4(), R: new THREE.Matrix4(), T: new THREE.Matrix4(), n: new THREE.Vector3() };
function fxPose(rig, M) { // M = 世界坐标里的变换
  rig.g.updateMatrixWorld();
  const L = _fx.inv.copy(rig.g.matrixWorld).invert().multiply(M).multiply(rig.g.matrixWorld);
  for (const { m, base } of rig.ms) { m.matrix.copy(L).multiply(base); m.matrixWorldNeedsUpdate = true; }
}
function setupWaterFx() {
  for (const [n, host] of Object.entries(WATER_SUB)) if (!shared.INFO[n] && shared.INFO[host]) shared.INFO[n] = shared.INFO[host];
  const U = water.fxU, rc = new THREE.Raycaster(); rc.firstHitOnly = true;
  // 水柱：开口细圆柱，顶点着色器按 s（0 出水口 → 1 落点）收细、轻微抖；片元按「已经流到多远 uHead / 尾巴落到多远 uTail」裁掉，条纹往下流
  const streamVS = `uniform float uL, uR, uFlow, uTime; varying float vS, vAng; varying vec3 vN, vV;
    void main() {
      float s = -position.y;
      float r = uR * sqrt(uFlow) * mix(1.0, 0.6, sqrt(s));
      vec3 p = vec3(position.x * r, -s * uL, position.z * r);
      p.xz += vec2(sin(s * 23.0 - uTime * 17.0), cos(s * 19.0 - uTime * 13.0)) * 0.0006 * s;
      vS = s * uL; vAng = atan(position.z, position.x);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vN = normalize(mat3(modelMatrix) * vec3(position.x, 0.0, position.z)); vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const streamFS = `uniform float uHead, uTail, uTime, uLight; varying float vS, vAng; varying vec3 vN, vV;
    void main() {
      if (vS > uHead || vS < uTail) discard;
      float f = abs(dot(normalize(vN), normalize(vV)));
      float st = 0.5 + 0.5 * sin(vS * 90.0 - uTime * 30.0 + sin(vAng * 3.0) * 2.0);
      float a = mix(0.85, 0.4, f) * (0.75 + 0.25 * st);
      vec3 c = mix(vec3(0.55, 0.64, 0.7), vec3(1.0), (1.0 - f) * 0.5 + 0.3 * pow(st, 6.0)) * uLight;
      gl_FragColor = vec4(c, a);
    }`;
  // 落点水花：Points，按 fract(时间) 循环往四周溅起再落回
  const splashVS = `uniform float uTime, uAmt, uScale; attribute vec3 seed; varying float vA;
    void main() {
      float age = fract(uTime / 0.45 + seed.x), tau = age * 0.45;
      float a = seed.y * 6.2832, sp = 0.12 + 0.3 * seed.z;
      vec3 p = position + vec3(cos(a) * sp * tau, (0.3 + 0.55 * seed.z) * tau - 4.9 * tau * tau, sin(a) * sp * tau);
      p.y = max(p.y, position.y);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.5, 0.005 * uScale / -mv.z);
      vA = uAmt * (1.0 - age) * 0.75;
    }`;
  const dropFS = `uniform vec3 uColor; varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = vA * smoothstep(1.0, 0.3, d);
      if (a < 0.004) discard;
      gl_FragColor = vec4(uColor, a);
    }`;
  const seeds = (n) => { const a = new Float32Array(n * 3); for (let i = 0; i < a.length; i++) a[i] = i % 3 === 0 ? (i / 3) / n : Math.random(); return a; };
  const points = (n, vs, uniforms) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds(n), 3));
    const p = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, vertexShader: vs, fragmentShader: dropFS }));
    p.frustumCulled = false; p.renderOrder = 2; p.visible = false; scene.add(p);
    return p;
  };
  for (const [name, d] of Object.entries(WATER_TAPS)) {
    const t = toggles.get(name);
    if (!t) continue;
    const mouth = new THREE.Vector3(...d.mouth);
    rc.set(mouth.clone().add(new THREE.Vector3(0, -0.003, 0)), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(shared.meshes.filter(shared.isShown), false)[0];
    const L = hit ? hit.distance + 0.003 : 0.5;
    const tap = { name, t, e: 0, L, run: false, ft: 0, tt: null, head: 0, tail: 0, splash: 0 };
    tap.u = { uL: { value: L }, uR: { value: d.r }, uHead: { value: 0 }, uTail: { value: 0 }, uFlow: { value: 0 }, uTime: U.uTime, uLight: U.uLight };
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 32, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({ uniforms: tap.u, transparent: true, depthWrite: false, vertexShader: streamVS, fragmentShader: streamFS }));
    stream.position.copy(mouth); stream.frustumCulled = false; stream.renderOrder = 2; stream.visible = false; stream.name = name + '_water';
    scene.add(stream); tap.stream = stream;
    tap.su = { uAmt: { value: 0 }, uColor: { value: new THREE.Color(0xc8d2d8) }, uTime: U.uTime, uScale: U.uScale };
    tap.splashFx = points(24, splashVS, tap.su); tap.splashFx.position.copy(mouth).y -= L - 0.003;
    t.parts.push((e) => { tap.e = e; });
    toggles.set(d.faucet, { on: false, k: 0, parts: [], click: () => { t.on = !t.on; } }); // 点阀体/软管 = 拧手柄
    water.taps.push(tap);
  }
  // 水壶：壶身、提梁是 click（点一下烧开，烧着时再点就停）；壶盖走 DOORS 掀开 / 盖上
  kettle.rig = fxRig('stove_kettle_lid');
  const boil = () => { if (kettle.on && kettle.t > 0.3) kettle.on = false; else { kettle.on = true; kettle.t = 0; } };
  for (const n of ['stove_kettle', 'stove_kettle_bail']) if (shared.layers.get(n)) toggles.set(n, { on: false, k: 0, parts: [], click: boil });
  // 白气：大部分从壶嘴斜着冲出来再上升散开，四分之一从壶盖缝一圈冒出来（同烟囱烟的写法）
  Object.assign(steamU, { uTime: U.uTime, uScale: U.uScale });
  kettle.fx = points(STEAM_N, `uniform float uTime, uAmt, uScale; attribute vec3 seed; varying float vA;
    void main() {
      float age = fract(uTime / ${STEAM_LIFE.toFixed(1)} + seed.x), r = seed.y;
      bool lid = seed.z < 0.25;
      vec3 p;
      if (lid) { float a = seed.z * 25.13; p = vec3(${KETTLE.lid.join(', ')}) + vec3(cos(a), 0.0, sin(a)) * ${KETTLE.lidR.toFixed(3)}; p.y += 0.005 + age * 0.22; }
      else { p = vec3(${KETTLE.spout.join(', ')}) + vec3(${KETTLE.dir.join(', ')}) * min(age, 0.2) * 0.5; p.y += age * 0.12 + age * age * 0.28; }
      float a2 = r * 6.2832 + age * 4.0;
      p.xz += vec2(cos(a2), sin(a2)) * age * (0.03 + 0.06 * r);
      p.x += sin(uTime * 1.3 + r * 7.0) * age * 0.04;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.5, (0.012 + age * 0.11) * uScale / -mv.z);
      vA = uAmt * smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.8) * (lid ? 0.22 : 0.42);
    }`, steamU);
  kettle.fx.name = 'stove_kettle_steam';
  window.cabinWater = { water, kettle }; // 调试用（window.cabin 在这之后才建）
}
const STEAM_WHITE = new THREE.Color(0xe8e6e2), DROP_BLUE = new THREE.Color(0xc8d2d8);
function updateWaterFx(dt) {
  const U = water.fxU;
  U.uTime.value += dt;
  U.uScale.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
  U.uLight.value = 0.3 + 0.7 * indoorU.uIndoor.value; // 夜里屋里暗，水和白气跟着暗（灯光照不到着色器里，给个底）
  for (const tap of water.taps) {
    const e = tap.e, flow = e < 0.35 ? 0 : (e - 0.35) / 0.65; // 手柄拧过三分之一才出水
    if (flow > 0.01 && (!tap.run || tap.tt !== null)) { tap.run = true; tap.ft = 0; tap.tt = null; tap.tail = 0; } // 拧开：水头从出水口往下落
    if (tap.run) {
      tap.ft += dt;
      tap.head = Math.min(tap.L, 0.3 * tap.ft + 4.9 * tap.ft * tap.ft);
      if (flow <= 0.01 && tap.tt === null) tap.tt = 0; // 拧上：水尾离开出水口往下落
      if (tap.tt !== null) { tap.tt += dt; tap.tail = 0.3 * tap.tt + 4.9 * tap.tt * tap.tt; if (tap.tail >= tap.L) tap.run = false; }
    }
    tap.u.uHead.value = tap.head; tap.u.uTail.value = tap.tail; tap.u.uFlow.value = Math.max(flow, 0.15);
    tap.stream.visible = tap.run;
    const goal = tap.run && tap.head >= tap.L - 0.001 && tap.tail < tap.L - 0.02 ? Math.max(0.3, flow) : 0;
    tap.splash += (goal - tap.splash) * Math.min(1, dt * 12);
    tap.su.uAmt.value = tap.splash; tap.su.uColor.value.copy(DROP_BLUE).multiplyScalar(U.uLight.value);
    tap.splashFx.visible = tap.splash > 0.01;
  }
  // 水壶：烧 KETTLE.boil 秒自己停；白气 0.8 秒冒起来、1.6 秒散完
  if (!kettle.fx) return;
  kettle.t += dt;
  if (kettle.on && kettle.t > KETTLE.boil) kettle.on = false;
  kettle.amt += ((kettle.on ? 1 : 0) - kettle.amt) * Math.min(1, dt / (kettle.on ? 0.8 : 1.6));
  steamU.uAmt.value = kettle.amt; steamU.uColor.value.copy(STEAM_WHITE).multiplyScalar(U.uLight.value);
  kettle.fx.visible = kettle.amt > 0.005;
  // 壶盖：被蒸汽顶起一边、落回去「咔嗒」——只取正弦的正半截，一跳一跳；歪的方向慢慢转。转轴过盖子中心，再抬 R·sin 让低的一边始终搭在壶口上
  if (!kettle.rig) return;
  const a = (toggles.get('stove_kettle_lid')?.k || 0) > 0.001 ? 0 : Math.max(0, (kettle.amt - 0.3) / 0.7), tt = U.uTime.value; // 壶盖掀着就不跳
  if (a > 0.001) {
    const jolt = Math.pow(Math.max(0, Math.sin(tt * 27)), 3) * (0.6 + 0.4 * Math.sin(tt * 4.3)) * a;
    const tilt = 0.07 * jolt, lift = 0.0012 * jolt, C = KETTLE.lid, n = _fx.n.set(Math.cos(tt * 1.7), 0, Math.sin(tt * 1.7));
    _fx.M.makeTranslation(C[0], C[1] + lift + KETTLE.lidR * Math.sin(tilt), C[2]).multiply(_fx.R.makeRotationAxis(n, tilt)).multiply(_fx.T.makeTranslation(-C[0], -C[1], -C[2]));
    fxPose(kettle.rig, _fx.M); kettle.posed = true; shared.shadowDirty = true;
  } else if (kettle.posed) { fxPose(kettle.rig, _fx.M.identity()); kettle.posed = false; shared.shadowDirty = true; }
}

// —— 门帘收起：像系带窗帘那样，左右两片各自往门洞两侧收拢，在半高略下用绑带束成一束 ——
// 两片布（L z 0.81–1.25、R z 1.26–1.70，x≈0.64，y 0.877–2.08）。加载时把布焊成带索引的网格（法线平滑），记下原始顶点；
// k 变化时 CPU 逐顶点变形：按 s（0 墙边 → 1 中缝）收到束口宽 wb，收拢程度 g 随高度变——杆子处 0（顶边仍沿杆子铺开）→
// 绑带处 1（中缝斜垂成弧线）→ 下摆 hem（略散开）；再加竖向褶皱（沿 x 正弦，振幅 ∝ g，褶数固定，收得越紧越密越深），绑带处勒细一点
const NOREN = { y0: 0.877, y1: 2.08, tie: 1.565, wb: 0.07, pow: 1.1, hem: 0.8, folds: 7, depth: 0.018 }; // 绑带在布下沿以上 0.69m（约布高 57%）；pow≈1 上半段中缝接近直的斜线
const noren = { cloths: [], ties: [] };
function setupNoren() {
  const g = shared.layers.get('entry_noren');
  if (!g) return;
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85 });
  for (const m of [...g.children]) if (m.isMesh) {
    // 焊接：位置 + UV 相同的顶点合成一个（合并后的网格是非索引的，直接算法线会一面一面的）
    const src = m.geometry, P = src.attributes.position, U = src.attributes.uv, map = new Map(), pos = [], uv = [], index = [];
    for (let i = 0; i < P.count; i++) {
      const key = [P.getX(i), P.getY(i), P.getZ(i)].map((x) => x.toFixed(5)).join() + '|' + U.getX(i).toFixed(4) + ',' + U.getY(i).toFixed(4);
      let j = map.get(key);
      if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); uv.push(U.getX(i), U.getY(i)); }
      index.push(j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(index);
    geo.computeVertexNormals(); geo.computeBoundingBox();
    m.geometry = geo; src.dispose();
    const bb = geo.boundingBox, left = bb.min.z + bb.max.z < 2 * 1.255, sgn = left ? 1 : -1; // L 片墙边在 min z，R 片在 max z
    const zo = left ? bb.min.z : bb.max.z, zi = left ? bb.max.z : bb.min.z, zc = zo + sgn * (NOREN.wb / 2 + 0.012), xc = (bb.min.x + bb.max.x) / 2;
    noren.cloths.push({ m, base: Float32Array.from(pos), zo, zi, zc, sgn });
    // 绑带：压扁的环（扁圆环面，竖向缩成 1.4cm 宽的带子），围在束口外；放下时缩到 1e-3（不切 visible）
    const tie = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 40).rotateX(Math.PI / 2), tieMat);
    tie.position.set(xc, NOREN.tie, zc); tie.castShadow = tie.receiveShadow = true;
    tie.userData.half = Math.abs(zi - zo) / 2;
    g.add(tie); shared.meshes.push(tie); // 挂在图层下，点它也能放下门帘
    noren.ties.push(tie);
  }
  const apply = (k) => {
    const { y0, y1, tie: yt, wb, pow, hem, folds, depth } = NOREN;
    for (const c of noren.cloths) {
      const a = c.m.geometry.attributes.position, p = a.array, b = c.base;
      for (let i = 0; i < p.length; i += 3) {
        const x = b[i], y = b[i + 1], z = b[i + 2], s = THREE.MathUtils.clamp((z - c.zo) / (c.zi - c.zo), 0, 1);
        const gy = y >= yt ? Math.pow(Math.max(0, (y1 - y) / (y1 - yt)), pow) : 1 - (1 - hem) * Math.pow(Math.min(1, (yt - y) / (yt - y0)), 0.8); // 布实际略超 y0/y1，底数夹住免得 pow 出 NaN
        const q = Math.min(1, Math.max(0, gy)) * k, pinch = Math.exp(-(((y - yt) / 0.035) ** 2)); // q：这个顶点收拢了多少
        p[i] = x + depth * q * (1 - 0.4 * pinch) * Math.sin(2 * Math.PI * folds * s);
        p[i + 1] = y;
        p[i + 2] = z + (c.zc + c.sgn * (s - 0.5) * wb * (1 - 0.3 * pinch * k) - z) * q;
      }
      a.needsUpdate = true;
      c.m.geometry.computeVertexNormals(); c.m.geometry.computeBoundingBox(); c.m.geometry.computeBoundingSphere(); // 包围球给点选、视锥裁剪用
    }
    for (const t of noren.ties) { // 带子跟着束口宽度收紧，后半程才长出来
      const v = THREE.MathUtils.smoothstep(k, 0.35, 1), hz = t.userData.half + (wb * 0.35 + 0.004 - t.userData.half) * k;
      if (v <= 0) { t.scale.setScalar(1e-3); continue; }
      t.scale.set(depth * 0.6 + 0.012, 0.07 * v, hz);
    }
  };
  apply(0);
  toggles.set('entry_noren', { on: false, k: 0, parts: [apply] });
}

// —— 摇椅：点一下摇几下。在弧形摇杆上滚动（不是原地转）：绕摇杆曲率中心转 θ，同时沿摇杆方向平移 R·θ，接地点不打滑 ——
// 摇杆（glb 量的）：最低点 (−0.477, 2.290, 1.279)，沿 (0.733, −0.680) 方向，弧半径约 2.4m（离中点 ±0.3m 抬 1.8cm）
const ROCKER = { at: [-0.477, 2.29, 1.279], dir: [0.733, -0.68], R: 2.4, amp: 0.13, period: 1.5, decay: 2.2 };
const rocker = { t: 99, amp: 0, meshes: [] };
function setupRocker() {
  const g = shared.layers.get('loft_rocking_chair');
  if (!g) return;
  for (const m of g.children) if (m.isMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); rocker.meshes.push({ m, base: m.matrix.clone() }); }
  rocker.g = g;
  toggles.set('loft_rocking_chair', { on: false, k: 0, parts: [], click: () => { rocker.amp = Math.min(ROCKER.amp, rocker.amp * Math.exp(-rocker.t / ROCKER.decay) + ROCKER.amp * 0.8); rocker.t = 0; } });
}
const _rk = { T: new THREE.Matrix4(), R: new THREE.Matrix4(), M: new THREE.Matrix4(), inv: new THREE.Matrix4(), n: new THREE.Vector3(), q: new THREE.Quaternion() };
function updateRocker(dt) {
  const rider = [...shared.people.values()].find((q) => q.ride && !q.tasks.length);
  if (!rocker.g || (rocker.t > 12 && !rider)) return;
  rocker.t += dt; if (!rider && !shared.x3.on) shared.shadowDirty = true; // 有人坐着的轻摇不重画阴影（否则一直每帧重画阴影图）
  const { at, dir, R, period, decay } = ROCKER, t = rocker.t;
  if (rider) { rocker.rt = (rocker.rt || 0) + dt; rocker.t = 13; } // 有人坐着：慢慢地一直摇（人走了就停，下次点再摇）
  const th = rider ? 0.045 * Math.sin(2 * Math.PI * rocker.rt / 1.9) : rocker.t > 12 ? 0 : rocker.amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * t / period);
  rocker.th = th;
  const n = _rk.n.set(-dir[1], 0, dir[0]); // 转轴：水平、垂直于摇杆
  const C = [at[0], at[1] + R, at[2]], s = R * th; // 曲率中心；滚动时它沿摇杆方向走 R·θ（n × 上 = (−n.z, 0, n.x)）
  _rk.M.makeTranslation(C[0] - n.z * s, C[1], C[2] + n.x * s).multiply(_rk.R.makeRotationAxis(n, th)).multiply(_rk.T.makeTranslation(-C[0], -C[1], -C[2]));
  const g = rocker.g; g.updateMatrixWorld(); _rk.inv.copy(g.matrixWorld).invert();
  const local = _rk.inv.multiply(_rk.M).multiply(g.matrixWorld);
  for (const { m, base } of rocker.meshes) { m.matrix.copy(local).multiply(base); m.matrixWorldNeedsUpdate = true; }
  if (rider) { const r = rider.root, B = rider.ride; // 坐着的人：同一个世界变换，外加跟着往后仰
    r.position.set(B.x, B.y, B.z).applyMatrix4(_rk.M);
    r.quaternion.setFromAxisAngle(n, th).multiply(_rk.q.setFromAxisAngle(shared._fpU, B.yaw)); }
}
const toggleOf = (name) => toggles.get(name === 'stove_firebox' ? 'stove_fire' : name) || toggles.get(DOORS[name]?.parent);
// 有人坐在马桶上时折叠门不动（像从里面闩上了）：坐着的人脚伸到 x −0.82~−0.93，门折到一半（k 0.4–0.5）会扫到脚；改成往玄关那边折也不行：打开时两块板贴在隔墙上，会撞衣帽架挂杆（y 1.65–1.75）
const wcBusy = () => [...shared.people.values()].some((q) => q.seat === 'entry_toilet' && q.mode === 'sit');
const shutBusy = (name) => Object.entries(shared.SEATS).some(([n, S]) => S.shut?.includes(name) && [...shared.people.values()].some((q) => q.seat === n || q.claim === n)); // 有人坐着 / 正要坐的座位旁，抽屉点了不动
function toggle(name) { const t = toggleOf(name); if (t.click) return t.click(); if (/^toilet_door_/.test(name) && wcBusy()) return; if (!t.on && shutBusy(name)) return; t.ajar = 0; t.on = !t.on; shared.chgTouch(name); } // click：不是开/关，点一下触发一次动作（摇椅）
let toggleT = 0;
function updateToggles() {
  const now = performance.now(), dt = Math.min(0.1, (now - (toggleT || now)) / 1000); toggleT = now;
  for (const t of toggles.values()) {
    const goal = t.on ? t.ajar || 1 : 0; // ajar：关着但没关严（第 1 天大门虚掩，0.75 缓动后 ≈ 留 14° 的缝）
    if (t.k === goal) continue;
    shared.shadowDirty = true;
    t.k = goal > t.k ? Math.min(goal, t.k + dt / 0.9) : Math.max(goal, t.k - dt / 0.9); // 门 0.9 秒转完
    const e = t.k * t.k * (3 - 2 * t.k);
    for (const f of t.parts) f(e);
  }
}

// —— 炉火：火苗一跳一跳（自发光、点光源按噪声闪，火苗网格轻微缩放抖动），点一下熄灭/燃起；燃着时烟囱口冒烟 ——
// 火苗绕炉膛底部中心 FIRE_BASE 缩放（网格要直接挂在图层下，点选靠 parent.name，不能加中间组）；烟从烟囱帽下沿 SMOKE_AT 出来（从 glb 量的）
const FIRE_BASE = [1.4, 0.53, -1.39], FIRE_LIGHT = [1.4, 0.62, -1.3], SMOKE_AT = [2.42, 3.42, -1.52];
const fire = { k: 1, smoke: 1, t: 0, light: null, mats: [], meshes: [], door: 1 }; // door = 炉门开度（1 开 0 关）
// 炉火点光源不投影，炉门关着也从铸铁炉身四面照出去 → 按炉门开度调强度，关着只留熏黑玻璃透出的一点（STOVE_GLASS）
const STOVE_GLASS = 0.07;
const SMOKE_N = 140, SMOKE_LIFE = 7;
const smokeU = { uTime: { value: 0 }, uWind: { value: 0 }, uAmt: { value: 1 }, uScale: { value: 1 }, uColor: { value: new THREE.Color() },
  uFogN: { value: 30 }, uFogF: { value: 160 }, uFogC: { value: new THREE.Color() } }; // 自定义着色器不吃 scene.fog，雾自己算
function setupFire() {
  const g = shared.layers.get('stove_fire');
  if (g) {
    const P = g.worldToLocal(new THREE.Vector3(...FIRE_BASE)), clones = new Map();
    for (const m of g.children) if (m.isMesh) {
      if (!clones.has(m.material)) { const c = m.material.clone(); c.userData.base = { e: c.emissive.getHex() ? c.emissive.clone() : c.color.clone(), ei: c.emissive.getHex() ? c.emissiveIntensity : 0.4, col: c.color.clone() }; clones.set(m.material, c); } // Rhino 导出的火苗没有自发光：拿底色当发光色
      m.material = clones.get(m.material);
      fire.meshes.push({ m, p0: m.position.clone(), s0: m.scale.clone(), P, ph: Math.random() * 10 });
    }
    fire.mats = [...clones.values()];
    fire.light = new THREE.PointLight(0xff8a3c, 0, 4.5, 2);
    fire.light.position.copy(g.worldToLocal(new THREE.Vector3(...FIRE_LIGHT))); g.add(fire.light); // 一直 visible，只调强度
    toggles.set('stove_fire', { on: true, k: 1, parts: [(k) => { fire.k = k; }] });
    shared.layers.get('stove_firebox')?.traverse((o) => { if (o.isMesh && o.material.name === 'stove_embers_glow') { fire.embers = o.material; fire.emberCol = o.material.color.clone(); } }); // 炉膛底的余烬板：火灭了变炉灰
  }
  // 烟：Points，位置全在顶点着色器里按「出生后多久」算：上升、散开、随风往 +x 偏、变大变淡
  const geo = new THREE.BufferGeometry(), seed = new Float32Array(SMOKE_N * 2);
  for (let i = 0; i < SMOKE_N; i++) { seed[i * 2] = i / SMOKE_N; seed[i * 2 + 1] = Math.random(); }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE_N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 2));
  const mat = new THREE.ShaderMaterial({ uniforms: smokeU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uWind, uAmt, uScale, uFogN, uFogF; attribute vec2 seed; varying float vA, vFog;
      void main() {
        float age = fract(uTime / ${SMOKE_LIFE.toFixed(1)} + seed.x), r = seed.y;
        float w = min(uWind, 6.0), a = r * 6.2832 + age * 3.0;
        vec3 p = vec3(${SMOKE_AT.join(', ')});
        p.y += age * (2.6 + r) / (1.0 + w * 0.08);
        p.x += w / (1.0 + w * 0.25) * pow(age, 1.3) * 1.6 + (r - 0.5) * 0.1; // 大风不再拉成十米长的横条
        p.xz += vec2(cos(a), sin(a)) * age * (0.35 + 0.4 * r);
        p.x += sin(uTime * 0.7 + r * 9.0) * age * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.18 + age * 1.3) * uScale / -mv.z;
        vFog = smoothstep(uFogN, uFogF, -mv.z);
        vA = uAmt * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.6) * 0.38 / (1.0 + w * 0.2) * (1.0 - vFog); // 风大吹散得快
      }`,
    fragmentShader: `uniform vec3 uColor, uFogC; varying float vA, vFog;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = vA * smoothstep(1.0, 0.2, d);
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uColor, uFogC, vFog), a);
      }` });
  const smoke = new THREE.Points(geo, mat);
  smoke.frustumCulled = false; smoke.renderOrder = 2; smoke.name = 'stove_smoke';
  scene.add(smoke); fire.smokeFx = smoke;
}
const SMOKE_GRAY = new THREE.Color(0xc4c0b8), ASH_GRAY = new THREE.Color(0x4a4744);
function updateFire(dt) {
  fire.t += dt;
  const t = fire.t, k = fire.k;
  // 几个不成倍数的正弦叠起来当噪声，再加一点快的抖动
  const out = k < 0.02; // 熄了就静止：不抖、不闪
  const n = out ? 0.5 : 0.5 + 0.22 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 13.1 + 1.7) + 0.1 * Math.sin(t * 23.7 + 0.4) + 0.08 * (Math.random() - 0.5);
  if (fire.light) fire.light.intensity = 2.2 * k * (0.7 + 0.6 * n) * (STOVE_GLASS + (1 - STOVE_GLASS) * fire.door);
  for (const m of fire.mats) {
    const b = m.userData.base;
    if (b.e) { m.emissive.copy(b.e); m.emissive.g *= 0.85 + 0.25 * n; m.emissiveIntensity = b.ei * k * (0.65 + 0.7 * n); } // 暗时偏红、亮时偏黄
    m.color.copy(b.col).multiplyScalar(0.15 + 0.85 * k);
  }
  if (fire.embers) fire.embers.color.copy(ASH_GRAY).lerp(fire.emberCol, k);
  for (const f of fire.meshes) { // 绕炉膛底部缩放；熄了藏起来（2026-10-21 游戏第 1 天「冷透了」：原来缩成暗红的火苗尖还看得见），点炉膛里的柴照样点得着
    f.m.visible = !out;
    const sy = (0.35 + 0.65 * k) * (out ? 1 : 0.85 + 0.3 * Math.sin(t * 9 + f.ph) * Math.sin(t * 5.3 + f.ph * 2)), sx = out ? 1 : 1 + 0.06 * Math.sin(t * 11 + f.ph);
    f.m.scale.set(f.s0.x * sx, f.s0.y * sy, f.s0.z * sx);
    f.m.position.set(f.P.x + sx * (f.p0.x - f.P.x), f.P.y + sy * (f.p0.y - f.P.y), f.P.z + sx * (f.p0.z - f.P.z));
  }
  fire.smoke += ((k > 0.5 ? 1 : 0) - fire.smoke) * Math.min(1, dt / (k > 0.5 ? 3 : 2.5)); // 熄火后烟慢慢停
  if (!fire.smokeFx) return;
  smokeU.uTime.value += dt; smokeU.uWind.value = wx.cur.wind; smokeU.uAmt.value = fire.smoke;
  smokeU.uScale.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
  smokeU.uColor.value.copy(SMOKE_GRAY).multiplyScalar(0.25 + 0.75 * Math.min(1, hemi.intensity / 0.8)).lerp(scene.fog.color, 0.45); // 夜里跟天色一起暗
  smokeU.uFogN.value = scene.fog.near; smokeU.uFogF.value = scene.fog.far; smokeU.uFogC.value.copy(scene.fog.color);
  fire.smokeFx.visible = fire.smoke > 0.01;
}


share({ LAMPS: () => LAMPS, toggles: () => toggles, DOORS: () => DOORS }); // time-of-day.js、weather.js 用
export { LAMPS, toggles, DOORS, swapSoftProps, splitParts, setupToggles, setupFire, setupWaterFx, toggle, fire, rocker, toggleOf, updateToggles, updateFire, updateLantern, updateRocker, updateWaterFx };
