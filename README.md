# 失窃之地 · 战役地图

《拥王者》战役的桌边地图页：四图幅无缝拼接、格子详情、占据与备注、区域标注。只做地图，不跑王国与战争规则。

## 功能

- 四张图幅可任选、可全选，横向无缝拼接为一张全景
- 点格选中：侧栏显示「编号 + 区域名 + 地点名」，可勾「占据」、写备注
- 普通格自动编号：有区域归属但原模组没有编号的格，按区域编号（如 `NMN6`、`GBN1`），可直接点选或输入跳转
- 自定标记：点地图落点，按 Delete 删除
- 区域显示：区域填色、区域名称、统一深色边界线，均可单独开关；按区域多选筛选
- 跨图幅同一物理格联动：选中、占据、区域归属都按同一块地处理，一格不会属于两个区域
- 导出：图片与预览样式一致（含填色、边界、区域名、占据标记、编号点）；存档可导出 JSON
- 显示偏好（勾选项、区域筛选）记忆在本地

## 存档

地图状态写入 `localStorage` 的 `kingdom-map-v1`，只包含：

`hexClaimed`、`hexNotes`、`pins`、`mapCalib`

写入时带 400ms 防抖，另有快照、5 份滚动备份和坏档留档恢复；首次打开如果只有旧版键 `kingdom-sim-v1`，会自动挑出这四个字段迁移，旧键保留不删。

界面偏好另行存在 `kingdom-map-ui-v1`，与存档分开。

## 开发

```bash
npm install
npm run dev      # 默认 http://localhost:5173/，同时开放内网访问
npm test
npm run build
```

`index.html` 是唯一入口。接手开发前先看 [AGENTS.md](./AGENTS.md)。

## 目录

```
src/
├── mapStore.js          地图存档、备份与旧存档迁移
├── map-main.js          入口
├── style.css            设计令牌与全局样式
├── components/
│   ├── MapPage.vue      页面壳
│   └── MapView.vue      地图主体（工具栏、SVG 分层、侧栏、导出）
├── data/
│   ├── mapLabels.json   图幅布局、编号点、格网基准
│   ├── regionCells.json 内置区域归属（351 格）
│   └── hexes.json       编号格的地点条目
└── assets/map-1..4.jpg  四张地图裁片
```
