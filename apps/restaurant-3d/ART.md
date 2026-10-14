# 美术素材记录

## 当前品牌海报

当前场景加载 `public/art/koala-farm-reference.png`，为用户 2026-10-04 提供的 KoalaFarm 草地与牛图片原样副本。中文招牌和店内文字依据 [BRAND.md](BRAND.md) 的已核实名称及用户图片制作。没有把生成图伪装成官方品牌资源。

## 三维部分

角色、家具、建筑、锅具、餐盘和八类菜品均在本项目的 TypeScript 源文件中构建，为可直接调整的原创几何模型；无需外部建模软件或第三方模型包。

风格基准：奶油色墙面、青绿柜台、陶红座椅、圆润轮廓、暖色灯光，固定斜俯视镜头。二维贴图仅用于表面图案、店铺文字与轻量特效。

## 初版生成海报（保留，当前不加载）

- 工具：内置 `image_gen`（非 CLI / API 回退）。
- 项目资源：`public/art/hotpot-poster.png`。
- 用途：大堂后墙装饰；同时作为食材造型和配色参考。
- 原始生成文件保留于工具默认目录，运行时只使用项目内副本。
- 人物并非图片精灵，始终以三维网格渲染。

使用的完整提示词：

> Create a square 2D illustrated wall poster texture for an original cozy conveyor hotpot restaurant game. Flat front view, no perspective, no frame. Cream paper background, warm terracotta red and forest teal palette, playful elegant Japanese/Chinese food editorial illustration. Center composition of a cute round terracotta hotpot filled with rich orange broth, mushrooms, white lotus root slices, bright green bok choy, rolled pink beef, small shrimp, steam forming three curvy plumes. Soft rounded toy-like shapes, clean thick illustrative forms, subtle paper grain, polished art direction, no text, no letters, no logo, no watermark. Keep generous cream negative space around the central hotpot. This is a decorative surface texture that will be applied to a wall in a 3D miniature restaurant with creamy walls, coral-orange chairs, teal counters and warm soft lighting.

其余表面图案、文字标识与蒸汽纹理通过 Canvas 生成；没有使用第三方游戏截图、角色模型或商标素材。

## Wall display surfaces
`src/screens.ts` owns two independent screen meshes. The left screen is a placeholder; `WallScreens.setInterfaceTexture(texture)` accepts a future app snapshot or video texture. Interactive HTML integration is not implemented yet.
The smaller rear screen renders the same live simulation through a separate camera at 15 FPS into a 768x432 render target. The monitor copies the main camera and letterboxes its exact framing. A closed, green-and-cream kitchen shell is visible only in the monitor pass, hiding all kitchen interiors. Both screens are hidden during this pass to prevent recursive feedback. Renderer target, clipping and shadow-update settings are restored afterward.
