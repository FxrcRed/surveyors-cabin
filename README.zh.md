<div align="center">

# 无名测绘员的遗稿 · The Surveyor's Cabin

**北方森林里一座能走进去的原木小屋，在浏览器里打开就能看。**
主人有一天出门，再也没回来。炉子还温着，水壶还在炉上，屋里每一件东西都有自己的故事。

[**▶ 在浏览器里打开**](https://fxrcred.github.io/surveyors-cabin/) · [English](README.md) · three.js · 无需构建 · 代码 MIT

<a href="https://fxrcred.github.io/surveyors-cabin/"><img src="docs/hero.jpg" width="820" alt="针叶林中的原木小屋，木瓦屋顶，烟囱冒着烟"></a>

</div>

## 里面有什么

**时间自己在走**
- 六分钟过完一整天：日出、正午、黄昏，入夜换成月光和星星；天一黑，屋里屋外的灯自动亮起。
- 七种天气：晴、阴、雨、雷雨、雪、暴风雪、雾。每隔几分钟自己换，也可以手动选。
- 下雨地上慢慢积出水洼，雨停了屋檐还滴一会儿水；雪在屋顶和树上越积越厚，有一天整片从屋顶滑下来砸进院子。
- 烟囱的烟随风飘，闪电一次闪三五下。

**走进屋里看**
- 开场镜头从森林上空俯冲，贴着卵石小路穿过一万棵树，飞到小屋门口。
- 六个房间：玄关、卫生间、通高厅、起居室、厨房与餐桌、阁楼，镜头在房间之间飞过去。
- 几乎每样东西都能点（大衣、雪鞋、书桌上的野外记录本……），弹出卡片讲它的故事：上面是老式英文，下面是中文原文。
- 东西是活的：门能开关，灯能开关，炉火能熄灭再点着，水壶会烧开、壶盖一跳一跳，水龙头能放水，摇椅会摇，门帘会自己束起来。
- **Journal** 里是完整的《无名测绘员的遗稿》：序章、测绘员是谁、终章。

**屋里还有人**
- 长沙发上坐着一位老人，点他一下，他会站起来在屋里走动。
- 还有一位女书记员，在阁楼摇椅上看书，或在书桌前写字；隔一阵会起来东看看西看看，自己把梯子推过来、爬上爬下、抬起阁楼口的拦杆。
- 选「Take His Place」或「Take Her Place」换成第一人称自己走（WASD 走动、Shift 快走），可以爬梯子上阁楼，把墙上的锅和刀拿下来翻着看（E 拿、按住右键转）。

<table>
<tr>
<td><img src="docs/snow-night.jpg" alt="雪夜里的小屋，窗里透出灯光"></td>
<td><img src="docs/rain.jpg" alt="下午雨中的小屋"></td>
</tr>
<tr>
<td><img src="docs/parlour.jpg" alt="起居室：穿格子衬衫的老人坐在木沙发上"></td>
<td><img src="docs/loft.jpg" alt="屋顶下的阁楼，有床和摇椅"></td>
</tr>
</table>

电脑和手机都能看（手机上单指转视角，粒子和树会少一些）。页面不请求任何外网：three.js、解码器、字体都在仓库里，国内网络也能正常打开。

## 本地运行

任何静态文件服务器都行，用 Python：

```
git clone https://github.com/FxrcRed/surveyors-cabin.git
cd surveyors-cabin
python -m http.server 8765
```

然后打开 http://127.0.0.1:8765/ 。直接双击 `index.html` 打不开：浏览器不允许从 `file://` 加载 `.glb` 模型。

## 怎么做的

- **小屋**在 Rhino 里建模，家具按真实尺寸（屋内约 3.5 × 3.5 米，一层加一个阁楼），用 Draco 压缩导出成 `cabin.glb`。网页按 Rhino 图层名分组，靠这个认出哪个是门、哪个是灯、哪个是盖子。
- **老人**用的是 Quaternius 的基础人物，在 Blender 里配衣服（用身体网格做）和动作，导出成 `characters/man.glb`。
- **女书记员**穿的是 Quaternius 的服装。看书、写字、爬梯子的姿势是在 Blender 里用脚本按真实家具和梯子尺寸用 IK 摆的，导出成 `characters/woman.glb`。
- **其余全是代码**，都在一个 `index.html` 里（three.js r169，ES 模块，不打包）：天空和太阳、雨雪粒子、积雪和水洼着色器、烟、水、火、镜头飞行和第一人称操控。碰撞和点选用 [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)。
- **故事**先用中文写成，再译成老式英文，每件能点的东西都有一段。

和 Claude 一起 vibe coding 做的。

## 素材与许可

| | 来源 | 许可 |
|---|---|---|
| 树 | [Quaternius](https://quaternius.com/)，从 [poly.pizza](https://poly.pizza/) 下载 | CC0 |
| 人物和动作 | Quaternius *Universal Base Characters*、*Modular Character Outfits – Fantasy*、*Universal Animation Library* 1 和 2 | CC0 |
| 英文字体 | IM Fell English（Igino Marini） | SIL OFL 1.1 |
| 中文字体 | [汇文明朝体 改进版](https://github.com/bosswnx/huiwenmincho-improved)（子集） | CC0 |
| 音效、背景音乐、小溪 | [OpenGameArt](https://opengameart.org/)，作者和链接见 [sfx/CREDITS.md](sfx/CREDITS.md) | CC0 |
| 地面贴图 | [ambientCG](https://ambientcg.com/) Ground 037，见 [textures/README.md](textures/README.md) | CC0 |
| 配音 | 用 [Chatterbox](https://github.com/resemble-ai/chatterbox)（Resemble AI）AI 合成，音色克隆自 [LibriVox](https://librivox.org/) 上 Peter Yearsley、Ruth Golding 的朗读 | MIT（Chatterbox）；LibriVox 录音为公有领域 |
| 库 | [three.js](https://threejs.org/)、[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)、[Draco](https://github.com/google/draco) | MIT、MIT、Apache 2.0 |

代码按 [MIT 许可](LICENSE) 开放。小屋模型、故事和截图 © Fxrc，保留所有权利，转载或使用请先联系。
