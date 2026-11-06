# AGENTS.md · 失窃之地 · 战役地图

给接手这个项目的 AI / 开发者的工作说明。先读这里，再动代码。

## 项目定位

单页应用（Vue 3 + Vite），做《拥王者》战役的桌边工具，分「战役地图」与「王国经营」两页。地图页把四张裁片拼成无缝全景，点格看编号/区域/地点，标记「已探索」「已占据」和备注，自定义落点，按区域填色/标区域名，导出 PNG 与 JSON 存档；王国页跑简化经营：定居点槽位、劳力骰提示、建筑与效果自定义、即时升级。战争规则不在此项目内。

## 常用命令

```bash
npm install
npm run dev      # vite，server.host=true，局域网可访问根路径
npm run build    # 产物在 dist/（仓库里已跟踪，改完要重新构建）
npm run serve    # 静态站点 + 文件存档，默认 http://localhost:8989/
npm test         # node --test tests/*.test.js
```

## 代码地图

| 文件 | 职责 |
| --- | --- |
| `index.html` | 唯一入口，挂载 `#app` |
| `src/map-main.js` | `createApp(MapPage)` |
| `src/components/MapPage.vue` | 页面壳与「地图 / 王国」视图切换（KeepAlive 缓存两页，切页不丢选中、搜索与列区域设置） |
| `src/components/MapView.vue` | 全部地图逻辑与样式（工具栏、SVG 分层、侧栏、导出） |
| `src/components/KingdomView.vue` | 王国经营界面（经营盘、建筑表、效果类型） |
| `src/kingdom/model.js` | 王国纯逻辑：定居点、建筑、效果、劳力点数、即时结算 |
| `src/kingdomStore.js` | 王国存档：文件 + localStorage、快照、滚动备份 |
| `src/mapStore.js` | 地图存档：文件 + localStorage、快照、滚动备份、坏档恢复、导出存档 |
| `src/persist.js` | 文件存档客户端：`/api/save` 读写，失败时静默退回 localStorage |
| `server.mjs` | 静态站点 + 文件存档服务：服务 `dist/`，读写项目根目录 `saves/` |
| `scripts/feishu-sync.js` | 飞书同步接口：调 lark-cli 把当前视图的地图图片写入文档「地图」章节 |
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
   - `regionLabels`：按区域重心定位（不吸附格心），凹形/环形重心落在区域外时退回最近的格。
5. **普通格编号**：`plainInfo` 给「有区域归属但原模组没有编号」的格自动编号 `区域码N序号`（如 `NMN6`），按全景 y/x 排序；跨图幅同一物理格共用一个编号；不在图上画标签，只用于侧栏显示与「跳到编号」。
6. **显示筛选**：`scopeCodes`（区域多选）同时作用于填色、区域名、编号点；`showRegions / showNames / showPins / onlyMarked / showColumns / colLeft / colRight / sheetIds / activeSheet` 记忆在 `localStorage.kingdom-map-ui-v1`，同时写入文件存档兜底。`showPins` 是「全部标点」总开关：勾选时始终显示全部编号点；未勾选时由 `onlyMarked` 决定是否只保留已标记格的编号点。
7. **点击语义**：点有编号的格选中、再点同格取消；点无归属的空白格取消；点工具栏/页面空白也取消。`onDocClick` 的排除列表只包含可交互控件、地图和侧栏，工具栏留白与页面留白都算空白。
8. **渲染层顺序**：底图 → 区域填色 → 探索/占据 → 悬浮/选中 → 标点 → 区域名。格颜色只有占据和探索两档，优先级为占据 > 探索；备注只做文字记录，不参与填色（标点上的备注描边仍保留）。状态色比区域填色更饱和并带描边，不能与区域色混淆。
9. **导出**：与预览同顺序、同颜色；线宽/字号/标记大小按 `view.w ÷ mapwrap.clientWidth` 换算，导出图看起来就是预览的样子。
10. **列区域**：`columnInfo` 从横向完整的物理格列推导列数（剔除图幅 1 左、图幅 4 右被裁掉的半格，当前为 28 列），`colLeft / colRight`（1 到列数）与所选图幅并集取交集后写入 `view`，因此预览、导出图片与飞书同步都按列裁剪；画幅顶部按 RL1 所在格的顶边、左侧按 TV1 所在格的左边裁齐；`showColumns` 只显示列号，属于预览层，不进入导出图片。

## 王国经营模型

1. **数据驱动**：`buildingDefs` 存建筑名称、别名、档位、槽位、劳力/p/物资成本、每定居点上限、临水要求与效果；`effectDefs` 存效果名称、单位与计算口径。界面改表即时影响结算，已建成建筑沿用当前定义。
2. **效果口径**：`population / labor / incomeP / incomeMaterial / slots / note` 六种；自定义效果类型只是换名称、单位与口径，`note` 只展示不计入数值。
3. **劳力**：界面只显示应掷的 d6 数量作为提示，不内置随机投掷；玩家外部掷骰后把总点数填进 `laborPoints`。
4. **立即生效**：建筑与定居点没有 `builtTurn / foundedTurn`，建成即计入人口、税收、产出与劳力。
5. **升级**：槽位使用量达到上限时立即升级，升级不花资源；已满槽的旧存档可在界面手动点升级。
6. **存档**：王国状态独立存 `kingdom-manage-v1`，与地图的 `kingdom-map-v1` 互不覆盖；正常化函数会清洗坏值并丢弃指向不存在建筑定义的实例。
7. **地图联动**：定居点的 `hexes` 数组保存关联的地图格编号，可选项来自地图存档 `hexClaimed` 的键，可多选；只读引用地图状态，不写回地图存档。若某格后来取消占据，关联保留但界面标为「含未占据」。
8. **记录字段**：定居点的 `alias`（别名）只做展示与存档；不记录王国等级，也不记录回合数。
9. **存档迁移**：王国存档可导出 JSON、粘贴导入，也可用文件输入导入；导入走 `normalizeKingdomState` 清洗，旧版的 `turn / level / laborRolled / builtTurn / foundedTurn` 会被丢弃，单值 `hex` 自动转为 `hexes` 数组。
10. **文件存档**：`npm run serve` 启动 `server.mjs` 后，地图与王国优先读写项目根目录 `saves/kingdom-map-v1.json` 和 `saves/kingdom-manage-v1.json`；`POST /api/save` 原子写入前会在 `saves/backups/` 留最多 5 份备份。localStorage 继续作为离线兜底，两者内容一致。
11. **调节旋钮**：`options` 存 `growth`（slow/normal/fast）、`compactSlots`、`singleResource`、`pressure`。成长速度同时改劳力骰除数与建筑 p 成本；建筑实际花费统一走 `buildCost(state, def)`，界面与日志不得再直接读 `def.labor / def.p / def.materials`；紧凑槽位只改 `settlementStats` 的容量，不改建筑定义。
12. **压力模式**：没有回合数，维护费由玩家在经营盘手动点结算；`settleMaintenance` 付不起时拆除建筑最多那处定居点的最后一座建筑抵账。城市满档后界面提供「原址重建」，走 `clearBuildings` 清空建筑，拆除不退款。
13. **志向**：`ambitionStatus(state)` 按当前人口、定居点档位与数量、建筑种类数、国库直接判定，不落盘；界面只读展示，不提供手动勾选。

## 约束与坑

- 区域码前缀必须用 `regionOf` 的最长匹配，不能用 `/^[A-Z]+/`，否则自动编号 `RLN1` 会被认成 `RLN` 区域。
- 不要把随选中变化的数组塞进 `sheets` computed，否则每次点击都会重建整层 SVG（手机端表现为整图闪烁）；重层（区域/格网状态）用 `v-memo`。
- 全景 SVG 层必须 `preserveAspectRatio="none"`，且容器 `aspectRatio = view.w / view.h`，否则会拉伸。
- 探索/占据的格状态必须和区域填色一样画在全景层（`stateShapes`），一个物理格只画完整的一格；不要退回逐图幅 `hexlayer`，否则图幅接缝处会被裁成矩形色块。导出也复用同一份 `stateShapes`。
- 存档字段固定在 `MAP_FIELDS`（`hexExplored/hexClaimed/hexNotes/hexAliases/pins/mapCalib`），改动要同步 `tests/mapStore.test.js`。
- 别名存 `hexAliases`，显示优先级高于编号：地图标点、侧栏标题、导出图片都读同一份 `aliases` computed。旧备注迁移只跑一次（`kingdom-map-v1.alias-migrated`），规则是单行、≤24 字、无句子标点，备注本身保留。
- 飞书同步只保留「地图」标题下的一张地图图片和一个空段落，手写内容保留。
- lark-cli 只接受工作目录内的本地图片：临时图写在项目根目录并在上传后删除，不要改用系统临时目录。
- 同步图片按当前视图（图幅、列区域与区域筛选）生成，与导出图片共用同一份画布。
- 标点文字（含别名）靠近画面边缘时会向内对齐，顶部放不下时移到圆点下方；导出图片复用同一套边界判断，避免裁剪后文字不可见。

## 交付前检查

1. `npm run build` 通过、`npm test` 全过。
2. 地图页抽查：全选图幅后看接缝与区域名位置；点格选中/再点取消/点空白取消；勾选框刷新后是否记忆。
3. 王国页抽查：填入劳力点数后建造扣资源、建筑即时生效、满槽立即升级、新建定居点费用递增；建筑表改效果后经营盘数值即时变化；刷新后自定义建筑与效果仍在。
4. 文件存档抽查：`npm run serve` 后改任一项，确认 `saves/kingdom-map-v1.json` 或 `saves/kingdom-manage-v1.json` 同步更新；换浏览器或换端口访问仍能读到同一份文件。
5. 导出图片内容与预览一致（含填色、区域名、占据标记）。
6. 改了 `dist` 相关的内容记得重新构建并一起提交（仓库里跟踪了构建产物）。
