# 开发坑位记录

## 实体图集纹理偏移 / 模型缝隙（uv59）

**症状**

实体贴图整体有轻微偏移、模型面之间出现小缝隙，UV 看起来像被缩小或移动了半格。

**根因**

`entityUvRect()` 默认把每个槽位再内缩 **0.5 texel**：
`(place.x + 0.5) / atlasWidth` 到 `(place.x + width - 0.5) / atlasWidth`。
`entitymesh` 用这个矩形做 `rect + uv * (u1-u0)`，等于把整张贴图缩小 1px 并整体右/下移半像素。
同时槽位之间没有 padding，最邻近采样在边缘会跨到相邻槽位。

**正确做法**

- 图集 uvRect **精确**指向内容矩形：`place.x / atlasWidth` 到 `(place.x + width) / atlasWidth`。
- 打包时为每个槽位保留 1px 外圈 padding；绘制时把贴图边缘像素复制到 padding。
- 内容 uvRect 不包含 padding；padding 只负责吸收采样边缘。
- 模型 UV、bundle UV、消费端 UV 都不做内缩或 clamp。

**验证**

- `node tools/entityatlas-check.mjs`：uv 反算必须原样回到内容四条边，且 `padding=1`。
- `node tools/entitybake-check.mjs`：源 UV 保持原样（sheep leg south u[0.1875,0.25] v[0.625,1]）。
- HUD 构建标记 **uv59**。

**相关规则**

- 模型生成器、geo→bundle 构建器、浏览器消费端都不应修改源 UV 元数据。
- 采样缝隙/边缘属于 sampler 或图集映射，不属于模型数据。
- geo→bundle 的骨骼旋转和 per-face UV 角序必须用显式模型逐顶点/逐面校验，不能靠猜。

---

## 栏杆 top 纹理拉伸 / fence 方块状态错误（uv60）

**症状**

栅栏（fence）的横向横杆顶面纹理沿长边被拉伸；`east=true` 的 side 出现在西侧，方块连接方向错误。

**根因**

- `rotatePoint` 的 `+y` 是数学逆时针，而 Minecraft blockstate 的 `y` 是俯视顺时针；`rotateVariant` 直接用了 `+y`，导致 east/west 互换。
- 方块路径的 `face.rotation` / `uvlock` 用了**四角循环移位**（实体 BlueMap 约定）。对非正方形的 2×9 top UV，它不会交换宽高，只重新分配角点，表现就是拉伸；方块需要真正旋转 UV 矩形。

**修复**

- `rotateVariant` 使用 `-y`。
- `faceQuad` 方块路径用 `rotateFaceUv` 旋转 UV 矩形；实体路径仍用四角循环移位。
- `bake-check` 增加 fence 回归：
  - `oak_fence(east=true)` side 必须在 +x；
  - 其 top UV 必须从 2×9 变成 9×2；
  - `oak_fence(north=true)` side 必须在 −z。

**验证**

`node tools/bake-check.mjs` 及全部静态回归通过；HUD **uv60**。
### 补正：方块 90° UV 旋转必须两步

之前只做了 `rotateFaceUv`（旋转 UV 矩形），会选到横向 crop，视觉上仍像没转；只做四角循环移位又会把非正方形面（2×9）拉成长条。正确顺序：

1. `rotateFaceUv` 旋转 UV 矩形（交换宽高）；
2. 对展开后的四个 UV 角做循环移位（交换 u/v 轴）。

fence east top 的回归同时断言：UV 是 9×2，且第一条边落在纹理 v（2），第二条边落在纹理 u（9）。方块路径这样做，实体 BlueMap 路径仍只做循环移位。