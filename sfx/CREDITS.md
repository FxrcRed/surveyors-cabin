# 音效素材出处

全部是 OpenGameArt.org 上的 **CC0 1.0**（公有领域，可商用、可改、不要求署名）录音。网页里用的 mp3 是 `tools/sfx/make_sfx.py` 从原始文件剪出来的（单声道、统一响度、循环段首尾交叉淡化）；原始文件不入库，按下面的链接重新下载、解压到同一个目录，再跑脚本。

| 网页文件 | 原始素材 | 作者 | 链接 |
|---|---|---|---|
| `wind.mp3` | wind woosh loop.ogg | SketchMan3 | https://opengameart.org/node/98839 |
| `gale.mp3` | wind.zip → Wind.ogg | IgnasD | https://opengameart.org/content/wind |
| `forest.mp3` | Forest_Ambience.mp3 | TinyWorlds | https://opengameart.org/content/forest-ambience |
| `rain.mp3`、`thunder.mp3` | rain-thunder.ogg（0–20.3s 雨，20.6–40s 雷） | WuxiaScrub | https://opengameart.org/content/rain-long-thunder |
| `rain-window.mp3` | rain_on_window_loop.wav | alxl | https://opengameart.org/content/rain-on-window-loop （CC0 / CC-BY 多授权，选 CC0） |
| `fire.mp3` | fire.wav（前 16s） | pagdev | https://opengameart.org/content/fireplace-sound-loop |
| `fire-light.mp3` | fire-1_0.ogg | antumdeluge | https://opengameart.org/node/16327 |
| `door-open/close`、`click`、`latch`、`creak`、`paper`、`book`、`pick`、`place`、`step-dirt` | RPGsounds_Kenney.zip（doorOpen_1、doorClose_4、metalClick、metalLatch、creak1、bookFlip1、bookOpen、cloth2、bookPlace1、footstep00–05） | Kenney | https://opengameart.org/content/50-rpg-sound-effects |
| `drawer-open/close`、`stove-open/close` | 100-CC0-wood-metal-SFX.zip（wood_squeak_01、wood_close_01、metal_open_01、metal_close_01） | rubberduck | https://opengameart.org/content/100-cc0-metal-and-wood-sfx |
| `step-wood`、`step-wet` | sfx_100_v2.zip（footstep_wood_01–04、footstep_wet_01–03） | rubberduck | https://opengameart.org/content/100-cc0-sfx-2 |
| `step-snow` | qubodup-wet_snow_steps.7z（snow_step_wet-01–09） | qubodup | https://opengameart.org/content/9-wet-snow-steps |
| `step-ice.mp3` | IceShatters_0.zip → LedasLuzta*.ogg（5 段碎冰，各取开头 0.28s 做踩冰「咯吱」，带通 300–5000Hz；脚本 `tools/sfx/make_ice.py`） | IgnasD | https://opengameart.org/content/ice-breakingshattering |

`steps.json`：每种脚步文件里各下的起点和长度（秒），网页随机挑一下切着放。

## 背景音乐与乌鸦叫（2026-11-03）

同样全是 OpenGameArt.org 上的 **CC0 1.0**。`bgm-day1/2/3.mp3` 由 `tools/sfx/make_music.py` 处理：单声道 64kbps、调到统一响度、首尾 4 秒等功率交叉淡化成无缝循环；`crow.mp3` 是单声道 48kbps 转码。

| 网页文件 | 原始素材 | 作者 | 链接 |
|---|---|---|---|
| `bgm-day1.mp3` | Contemplation.mp3 | Joth | https://opengameart.org/content/contemplation-0 |
| `bgm-day2.mp3` | at.mp3（4 Atmospheric ghostly loops） | qubodup | https://opengameart.org/content/4-atmospheric-ghostly-loops |
| `bgm-day3.mp3`（结局也用） | Snowfall (Looped ver.).ogg | Kistol | https://opengameart.org/content/snowfall |
| `crow.mp3` | crow_caw.wav | zeroisnotnull | https://opengameart.org/content/crow-caw |

## 屋旁小溪（2026-11-04）

同样是 OpenGameArt.org 上的 **CC0 1.0**。`brook.mp3` 由 `tools/sfx/make_brook.py` 剪出：取原录音 118–136s（全段最平稳、没有鸟叫人声的一段），首尾 1.5 秒交叉淡化成无缝循环，单声道 48kbps，响度同其它环境声（RMS −20dB）。

| 网页文件 | 原始素材 | 作者 | 链接 |
|---|---|---|---|
| `brook.mp3` | park_ambience_river.wav（「3 recordings of ambience in different parts of a public park」里的河边那段） | thimras | https://opengameart.org/content/park-ambiences |
