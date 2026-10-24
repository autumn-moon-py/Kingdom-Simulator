---
name: 失窃之地 · 战役地图
description: 桌边战役地图 —— 多图幅拼接、探索标记与区域标注
colors:
  paper: "#f4f1e9"
  paper-2: "#fbf9f3"
  ink: "#2b2822"
  ink-2: "#6b6558"
  ink-3: "#736d5f"
  rule: "#ddd6c7"
  rule-soft: "#e8e2d5"
  ochre: "#7a5a25"
  ochre-soft: "#b08a45"
  warn: "#9c4a2f"
  cover-old: "#efe7d6"
  wash-ochre: "#f6efe0"
  select-wash: "#e6d9bd"
  rule-hover: "#cfc6b3"
  focus: "#7a5a25"
  map-claimed: "#4d7a4d"
  map-mine: "#3f6f8f"
  map-chip: "rgba(30, 28, 24, 0.84)"
  map-label: "rgba(246, 242, 233, 0.9)"
typography:
  title:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.72
    letterSpacing: "0.04em"
  body:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.72
  section:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.72
    letterSpacing: "0.12em"
  label:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.72
    letterSpacing: "0.04em"
  micro:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.12em"
rounded:
  none: "0"
  chip: "2px"
  panel: "3px"
  control: "4px"
  circle: "50%"
spacing:
  field: "5px"
  control: "7px 9px"
  section: "34px"
  page: "26px 24px 64px"
components:
  button-act:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-act-hover:
    textColor: "{colors.ochre}"
  input:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  panel:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
  map-pin:
    textColor: "{colors.map-chip}"
    rounded: "{rounded.panel}"
  map-label:
    textColor: "{colors.ink}"
    backgroundColor: "{colors.map-label}"
    rounded: "{rounded.panel}"
---

# Design System: 失窃之地 · 战役地图

## Overview

**Creative North Star: "摊在桌上的战役地图"**

这是一张摊在跑团桌上的地图：纸边压着骰子，图上用铅笔和彩色荧光笔做过记号。页面本身不抢戏——纸色底、墨字、唯一一管赭石色印泥；所有信息都长在地图上，工具栏只是贴边的便签。

界面只做两件事：让人一眼看清地图，让人一眼找到某个格子。因此工具条保持三行以内，勾选项平铺不折叠，侧栏只在选中时出现内容；没有多余的面板、卡片和装饰。

**Key Characteristics:**
- 纸面系统：陈纸底、墨字、单一赭石强调色，零阴影
- 地图是唯一例外层：定位点、格号牌、区域色、区域名可以偏离纸面语言
- 分区靠 1px 发丝线与留白，不靠卡片和色块
- 字号阶 11–17px，层级靠字重与字距
- 工具栏分三行：常用控件 / 显示勾选 / 导出动作

## Colors

页面 UI 只有一管彩色印泥；地图图层另有自己的一小组颜色，两者不混用。

### Primary
- **赭石印泥** (#7a5a25): 唯一强调色。选中态、勾选态、可点文字、当前选项边框。任何一屏面积都应在 10% 以下。
- **淡赭石** (#b08a45): 悬停边框与「已备注」格填色。

### Neutral
- **陈纸** (#f4f1e9): 页面底色。
- **新纸** (#fbf9f3): 输入框、按钮、下拉面板的底，靠明度差浮起。
- **墨** (#2b2822): 正文、标题、数值。
- **深墨** (#6b6558): 字段标签、次级标题。
- **淡墨** (#736d5f): 补充说明、静默文字（对比度下限）。
- **发丝线** (#ddd6c7): 控件边框、分节线。
- **发丝线（浅）** (#e8e2d5): 侧栏分隔、弱分隔。
- **旧封皮** (#efe7d6): 按下态与选中按钮的底。
- **选中洗色** (#e6d9bd): 文本选区。
- **纸渍赭** (#f6efe0): 区域筛选里已选项的底。
- **悬停线** (#cfc6b3): 输入框悬停边框。
- **印泥红** (#9c4a2f): 仅用于地图上「当前选中」的定位点。

### 地图图层

- **定位点环** (#fbf9f3 描边): 圆点外的纸色环，保证在任何地形上分离。
- **己方蓝** (#3f6f8f): 自定义落点方块。
- **已占据绿** (#4d7a4d): 已占据格的填色与定位点。
- **格号牌底** (rgba(30,28,24,0.84)): 白字格号牌。
- **区域名底** (rgba(246,242,233,0.9)): 区域名标签的纸色底。
- **区域填色**: 按区域码生成色相，18% 不透明度，只做分区提示。
- **区域边界**: 统一深色线 (#2f2a1e, 62%)，不按区域上色。

### Named Rules
**The One Ochre Rule.** 页面 UI 只有一种强调色；地图上的区域色属于地图例外层，不算第二强调色。

**The No Pure White Rule.** 页面表面不用纯白，最亮是 `#fbf9f3`；纯白只出现在地图格号牌的文字上。

## Typography

**Body Font:** PingFang SC（回退 Noto Sans CJK SC / Source Han Sans SC / Microsoft YaHei），单字体系统。

### Hierarchy
- **Title** (600, 17px, +0.04em): 侧栏选中格标题。
- **Body** (400, 15px): 正文、按钮文字、输入值。
- **Section** (600, 13px, +0.12em): 工具条字段名、折叠标题。
- **Label** (400, 12px, +0.04em): 字段标签、格号牌、区域筛选按钮。
- **Micro** (400, 11px, +0.12em): 区域名标签。

### Named Rules
**The Tight Ramp Rule.** 字号只有 17 / 15 / 13 / 12 / 11 五档；想强调先调字重与字距，不靠放大。

**The Tabular Number Rule.** 编号、格号、坐标一律 `tabular-nums`，方便竖着扫。

## Layout

- 页面上限 1500px，地图列占满剩余宽度，侧栏固定 300px；窄于 1180px 时侧栏落到地图下方。
- 工具栏分三行：图幅/显示/跳转/添加标记、显示勾选、导出动作。
- 地图容器宽度固定、高度由 `aspectRatio = view.w / view.h` 决定，四张裁片按全景坐标绝对定位。
- 分节靠 `1px` 发丝线加 34px 留白，不做卡片、不叠阴影。

## Elevation & Depth

**零阴影。** 页面里没有任何 `box-shadow`；唯一的阴影在地图的定位点上，用来让点「落在」图上。层次只来自纸色差、发丝线和墨色深浅。

## Shapes

- 控件圆角 4px，面板与标签 3px，格号牌 2px，定位点是圆。
- 边框统一 `1px solid`；不做一侧加粗的彩色竖条。
- 区域筛选按钮是唯一允许的药丸形（999px）。

## Components

### Buttons
- **默认 (`button.act`)**: 4px 圆角、`1px` 发丝边框、内边距 7px 14px、底 `#fbf9f3`
- **Hover / Active**: 边框转 `--ochre-soft`、文字转 `--ochre`；按下底转 `--cover-old`
- **Toggled (`.on`)**: 边框与文字转 `--ochre`、底转 `--cover-old`
- **Disabled**: 文字 `--ink-3`、边框 `--rule-soft`、`not-allowed`

### Inputs / Fields
- **Style**: 底 `#fbf9f3`、`1px solid --rule`、4px 圆角、内边距 7px 9px
- **字段结构**: 标签在上（12px 淡墨），控件在下，间距 5px
- **Textarea**: 侧栏备注 96px 高，可纵向拉伸

### Checkbox
- 勾选框与文字同一行，间距 8px，整块可点；勾选颜色跟随 `accent-color: --ochre`。

### Map
- **格号牌**: 12px 白字、深色底 84%、圆角 3px，悬在定位点上方。
- **定位点**: 编号格赭石圆点、已占据绿、自定义落点蓝色方块，均带纸色描边。
- **区域名**: 11px、+0.12em 字距、纸色底 90%、细边框，压在编号之上。
- **区域边界**: 统一深色 2px（`non-scaling-stroke`），不随缩放变粗。

## Do's and Don'ts

### Do
- 把信息放在地图上：编号、区域名、边界直接画在原画上。
- 保持工具条三行以内，勾选项平铺，低频动作放最后一行。
- 选中态用赭石描边，不遮盖原画细节。
- 数字、编号一律等宽对齐。

### Don't
- 不用阴影、渐变、玻璃化。
- 不引入第二种页面强调色。
- 不用纯白页面底，不放大字号当强调。
- 不在工具栏里堆超过三行的控件。
