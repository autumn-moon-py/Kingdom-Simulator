# AGENTS.md · 失窃之地 · 战役地图

给接手这个项目的 AI / 开发者的工作说明。先读这里，再动代码。

## 项目定位

单页应用（Vue 3 + Vite），只做《拥王者》战役的桌边地图：四张裁片拼成无缝全景，点格看编号/区域/地点，标记「占据」和备注，自定义落点，按区域填色/画边界/标区域名，导出 PNG 与 JSON 存档。不实现王国经营与战争规则。

## 常用命令

```bash
npm install
npm run dev      # vite，server.host=true，局域网可访问根路径
npm run build    # 产物在 dist/（仓库里已跟踪，改完要重新构建）
npm test         # node --test tests/*.test.js
```

## 代码地图

| 文件 | 职责 |
| --- | --- |
| `index.html` | 唯一入口，挂载 `#app` |
| `src/map-main.js` | `createApp(MapPage)` |
| `src/components/MapPage.vue` | 页面壳（仅容器宽度） |
| `src/components/MapView.vue` | 全部地图逻辑与样式（工具栏、SVG 分层、侧栏、导出） |
| `src/mapStore.js` | localStorage 存档、快照、滚动备份、坏档恢复、导出存档 |
| `src/data/mapLabels.json` | `layout`（全景尺寸）、`maps`（4 图幅偏移/宽高/格网基准）、`labels`（119 个编号点） |
| `src/data/regionCells.json` | 351 个格 → 区域码（内置标注） |
| `src/data/hexes.json` | 编号格的名称与资源条目 |
| `src/assets/map-1..4.jpg` | 四张地图裁片 |

## 核心模型（改动前必读）

1. **坐标系**：每张图幅有本地像素坐标，靠 `left/top` 平移到全景；`view` 取所选图幅的横向并集、纵向 `layout.h`。
2. **格网**：尖顶六角。格心 `cellCenter(g,q,r)`，命中 `cellAt(g,x,y)`；`buildGeom` 按图幅缓存 `cells/byKey/labelCell/codeOfCell`。
3. **跨图幅同格**：`cellGroups` 并查集，把中心距离 < `W*0.46` 的两侧格合并为一个物理格。选中、占据、区域归属都按组处理，一格不能属于两个区域。
4. **区域渲染**：
   - `regionMap`：内置 `regionCells` + 组内统一。
   - `regionShapes`：全景层填色（18%），避免在图幅边缘被裁成竖条。
   - `borderPath`：物理格逐条六边形边判断，邻格在**全部图幅**里查，同一条边按中点分桶只画一次；统一深色线，不按区域上色。
   - `regionLabels`：按区域重心定位（不吸附格心），凹形/环形重心落在区域外时退回最近的格。
5. **普通格编号**：`plainInfo` 给「有区域归属但原模组没有编号」的格自动编号 `区域码N序号`（如 `NMN6`），按全景 y/x 排序；跨图幅同一物理格共用一个编号；不在图上画标签，只用于侧栏显示与「跳到编号」。
6. **显示筛选**：`scopeCodes`（区域多选）同时作用于填色、边界、区域名、编号点；`showRegions / showNames / showBorders / showPins / onlyMarked` 记忆在 `localStorage.kingdom-map-ui-v1`。
7. **点击语义**：点有编号的格选中、再点同格取消；点无归属的空白格取消；点工具栏/页面空白也取消。`onDocClick` 的排除列表只包含可交互控件、地图和侧栏，工具栏留白与页面留白都算空白。
8. **渲染层顺序**：底图 → 区域填色 → 占据/备注 → 悬浮/选中 → 边界 → 标点 → 区域名。
9. **导出**：与预览同顺序、同颜色；线宽/字号/标记大小按 `view.w ÷ mapwrap.clientWidth` 换算，导出图看起来就是预览的样子。

## 约束与坑

- 区域码前缀必须用 `regionOf` 的最长匹配，不能用 `/^[A-Z]+/`，否则自动编号 `RLN1` 会被认成 `RLN` 区域。
- 接缝两侧格网有 1–2px 偏差，邻格查找用 `0.45W` 容差、边的中点用 8px 分桶去重；改成精确匹配会重新出现断线/双线。
- 不要把随选中变化的数组塞进 `sheets` computed，否则每次点击都会重建整层 SVG（手机端表现为整图闪烁）；重层（区域/格网状态/边界）用 `v-memo`。
- 全景 SVG 层必须 `preserveAspectRatio="none"`，且容器 `aspectRatio = view.w / view.h`，否则会拉伸。
- 存档字段固定在 `MAP_FIELDS`（`hexClaimed/hexNotes/pins/mapCalib`），改动要同步 `tests/mapStore.test.js`。

## 交付前检查

1. `npm run build` 通过、`npm test` 全过。
2. 页面抽查：全选图幅后看接缝、边界是否闭合、区域名位置；点格选中/再点取消/点空白取消；勾选框刷新后是否记忆。
3. 导出图片内容与预览一致（含填色、边界、区域名、占据标记）。
4. 改了 `dist` 相关的内容记得重新构建并一起提交（仓库里跟踪了构建产物）。
