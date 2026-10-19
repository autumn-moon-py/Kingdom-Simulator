---
name: 拥王者 · 王国模拟器
description: 桌边的王国账本 —— 把王国规则的记账搬到屏幕上
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
  wash-warn: "#f8ece7"
  wash-damage: "#f6e3d6"
  rule-hover: "#cfc6b3"
  select-wash: "#e6d9bd"
  map-ring: "#ffffff"
  map-mine: "#3f6f8f"
  map-claimed: "#4d7a4d"
  map-chip: "rgba(30, 28, 24, 0.84)"
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
  nav:
    fontFamily: "PingFang SC, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.72
    letterSpacing: "0.02em"
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
    lineHeight: 1.6
rounded:
  none: "0"
  chip: "2px"
  panel: "3px"
  control: "4px"
  block: "6px"
  circle: "50%"
spacing:
  field: "5px"
  control: "7px 9px"
  row: "22px 26px"
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
  button-act-active:
    backgroundColor: "{colors.cover-old}"
  input:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  panel:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
  section-heading:
    textColor: "{colors.ink-2}"
    typography: "{typography.section}"
  hint:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.circle}"
    size: "15px"
  notice:
    backgroundColor: "{colors.wash-ochre}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
---

# Design System: 拥王者 · 王国模拟器

## Overview

**Creative North Star: "桌边的王国账本"**

这是一本摊在跑团桌上、用了很多个会期的王国账本。纸是旧的，边线是细的，唯一的一管印泥是赭石色。它被翻过太多次，所以每一笔都要能一眼找到，每一栏都要能立刻读出数字——桌边的人只有几十秒注意力，界面不能要求他思考。

它的密度是纸质的密度，不是仪表盘的密度。分节靠一条发丝线和段落间的留白分开，不做卡片、不做阴影、不做背景块。层次只来自三件事：纸色的深浅、1px 的线、以及字号与字距。整个界面没有一处需要"看第二眼"才知道哪里可点。

**Key Characteristics:**
- 单列纵向流，视图里永远只有一件事要做
- 陈纸底 + 墨字 + 唯一强调色赭石，不用第二种彩色
- 零阴影，深度只靠发丝线与纸色
- 字号阶 10–17px，层级靠字重与字距，不靠放大
- 低频控件默认收起，规则说明收进标题旁的 `?`
- 中文优先排版，字距为正，行高宽松

## Colors

整页只有一管彩色印泥。所有颜色都在暖纸上，没有纯白、没有冷灰。

### Primary
- **赭石印泥** (#7a5a25): 唯一强调色。用于当前页签的下划线、被选中选项的边框、可点的操作文字、以及列表里的格子编号。它的面积永远很小——出现得多的地方，说明层次错了。
- **淡赭石** (#b08a45): 强调色的悬停态与描边。用于按钮悬停时的边框、圆点标记。

### Neutral
- **陈纸** (#f4f1e9): 页面底色。所有内容的底，从不被面板覆盖。
- **新纸** (#fbf9f3): 输入框、下拉、按钮的底。靠比底色略亮来"浮起"，而不是靠阴影。
- **墨** (#2b2822): 正文、数值、标题。唯一的深色。
- **深墨** (#6b6558): 分节标题、表头、字段标签。次级信息。
- **淡墨** (#736d5f): 补充说明、静默文字。对比度实算 4.56:1，是下限，不能再淡。
- **发丝线** (#ddd6c7): 分节之间的横线、表格的行线、控件的边框。
- **发丝线（浅）** (#e8e2d5): 表格内行线、分节内的弱分隔。
- **旧封皮** (#efe7d6): 选中态与按下态的底。全站出现频率最高的状态色。
- **选中洗色** (#e6d9bd): 文本选区的底。唯一一处给"被选中"上色的地方。
- **纸渍赭** (#f6efe0) / **纸渍红** (#f8ece7): 结果提示条的底，分别对应普通与警告。
- **纸渍伤** (#f6e3d6): 受损地块的底。
- **悬停线** (#cfc6b3): 输入框悬停时的边框，介于 `--rule` 与 `--ochre-soft` 之间。
- **印泥红** (#9c4a2f): 警示。只用于会伤到王国的事——无政府、领土归零、操作不可用。

### 地图图层

地图是这套系统里唯一的例外图层。定位点要压在地图原画（土黄、青绿、灰白的实测地形）上，只靠纸色阶分不开，因此它有自己的一小组颜色。这些颜色不出现在任何页面 UI 里。

- **定位点环** (#ffffff): 圆点外的白环，保证在任何地图底色上都能分离。
- **己方蓝** (#3f6f8f): 己方王国与势力的方块点。
- **已占据绿** (#4d7a4d): 已被占据的六角格。
- **格号牌底** (rgba(30,28,24,0.84)): 白字格号牌，压在地图原画上。
- **点落影** (`0 1px 2px rgba(0,0,0,.4)`、`0 1px 3px rgba(0,0,0,.5)`): 只用于地图定位点，让点"落在"图上。

### Named Rules
**The One Ochre Rule.** 全站只有一种强调色。它出现在任何一屏的面积都应在 10% 以下；如果一屏里到处都是赭石，那是层次失衡，不是风格。

**The No Pure White Rule.** 底色永不用 `#fff`。最亮的表面是 `#fbf9f3`，最暗的字是 `#2b2822`。界面里没有绝对的亮和黑——这是一张纸，不是一块屏。

**The Map Exception Rule.** 白环、深色字底、落影只允许出现在地图图层。它们是地图原画的对比手段，不是这套纸面系统的语言；页面 UI 一律不许照搬。

## Typography

**Body Font:** PingFang SC（回退 Noto Sans CJK SC / Source Han Sans SC / Microsoft YaHei），单字体系统

**Character:** 一套中文字体走完全程，不引入第二款字体，也不上等宽。中文在这个尺寸下靠字距和字重区分层级，比靠字号更稳。数字一律用 `font-variant-numeric: tabular-nums` 对齐，让用户能竖着扫一列数。

### Hierarchy
- **Title** (600, 17px, 1.72, +0.04em): 应用标题，全站唯一一处。它不需要更大。
- **Body** (400, 15px, 1.72): 正文、按钮文字、输入值。凡是要读或要改的字都是这个大小。
- **Nav** (400 / 选中时 600, 14px, 1.72, +0.02em): 页签、步骤条、选项卡。比正文小一档，选中靠字重与下划线，不靠加粗放大。
- **Section** (600, 13px, 1.72, +0.12em): 分节标题。比正文小、字距更开，用"小字大写"的方式反而比放大更醒目。
- **Label** (400, 12px, 1.72, +0.04em): 字段标签、表头、次级信息。
- **Micro** (400, 11px): 只留给 `?` 圆圈里的那一个问号。其余一切文字不得低于 12px——聚落格、地图格号牌、战争板状态行都已提到 12px。

### Named Rules
**The Tight Ramp Rule.** 正文字号只有 17 / 15 / 14 / 13 / 12 五档，最大不超过 17px；11px 是 `?` 圆圈里的单字专用，不用于任何可读内容。想强调就先看字重和字距——放大永远不是这套系统的答案。

**The Tabular Number Rule.** 任何可能被竖着比较的数字（属性、资源点、动荡、祸患、骰面）都用等宽数字，右对齐。这一条比任何视觉装饰都更服务"桌边一眼读数"。

## Layout

单列纵向流，`main` 宽度上限 1060px 居中。页面由一串 `.panel`（分节）组成，分节之间用 `--gap-section`（34px）留白加一条 `1px` 顶部发丝线——不做卡片、不做侧栏、不做多列栅格。

分节内部用 `.row` 摆控件，`flex` 换行，行列间距 22px / 26px；每个 `.field` 是"标签在上、控件在下"的两行结构，标签 12px 淡墨。控件之间有 5px 的紧凑间距，同一行的控件不要超过 8 个——超过就说明这一节该拆，或者该把低频项收起来。

密度是这套系统的功能之一，不是可以稀释的东西：一屏能看全的账，就不该分两屏。但"密"指信息密度，不指元素密度——同屏可操作控件的数量必须压住。

## Elevation & Depth

**这套系统零阴影。** 实测界面里除了地图上的定位圆点，没有任何 `box-shadow`。深度完全由三种手段交代：

- **纸色差**：输入框和按钮用 `#fbf9f3` 比底 `#f4f1e9` 亮一档，靠这一点点明度差"浮"在纸上。
- **发丝线**：`1px` 的 `#ddd6c7` 画分节边界、表格行线、控件轮廓。这是唯一的结构线。
- **字色重**：从 `#2b2822` 到 `#736d5f` 的三级墨色，替代表面上的近/远关系。

### Named Rules
**The Flat-By-Default Rule.** 表面在静止时是平的。不引入投影、发光、玻璃化、渐变来制造层次；需要区分就先问"能不能用一条发丝线说清楚"。

## Shapes

形语言是**直角加一点点圆**。控件一律 4px（`--rounded.control`），分节与提示条 3px，小标记 2px，圆形只保留给 `?` 说明点和地图上的定位点。

边框统一 `1px solid`。禁止一侧加粗的彩色竖条（侧边标签式边框）——那种装饰和这套系统的纸面逻辑冲突。圆角不超过 6px，没有任何"药丸"形控件。

## Components

### Buttons
- **Shape:** 4px 圆角，`1px` 发丝边框，内边距 7px 14px，底为 `#fbf9f3`
- **Primary（`button.act`）:** 与次级按钮同形同色——这套系统里没有"实心主按钮"。强调靠位置与文字，不靠色块。
- **Hover / Focus:** 悬停时边框转 `--ochre-soft`、文字转 `--ochre`；按下时底转 `--ochre`; 键盘聚焦用 2px `--focus` 外描边，偏移 2px。
- **Disabled:** 文字转 `--ink-3`，边框转 `--rule-soft`，光标 `not-allowed`。禁用态不做半透明。
- **间距:** 同一动作组的按钮之间 8px（用容器 `gap`，不要靠空格或逐个 `margin`）；标签 chip 之间 6px，chip 内文字与 `×` 之间 4px

**The Button Gap Rule.** 按钮之间的间距只有三档，按"它们是什么关系"选，不按页面选：同一动作组 8px、导航（一级页签／二级页签／阶段步骤）20px、表单控件之间走 `.row` 的 22/26px。聚落 48 格是网格单元而非按钮组，列间距 6px。任何"只靠一个空格分开"的按钮都算缺陷。

### Inputs / Fields
- **Style:** 底 `#fbf9f3`，`1px solid --rule`，4px 圆角，内边距 7px 9px；数字输入宽度 96px，右对齐等宽数字
- **Focus:** 2px `--focus` 外描边
- **Textarea:** 默认 88px 高（分节内 62px），允许纵向拉伸
- **Select:** 原生箭头一律替换为自绘 10×6 的 SVG 箭头，`background-position: right 10px center`——系统箭头贴边会被裁掉

### Section Heading
- **Style:** 13px / 600 / +0.12em，色 `--ink-2`；右侧常驻一条同级的静默补充（如"上限 3 项"）或一个 `?` 说明点

### Hint（`?` 说明点）
- **Style:** 15px 圆形，`1px --rule` 描边，11px 问号，`cursor: pointer`；展开时描边转 `--ochre`
- **用法:** 规则原文、公式、例外条款收进 [Hint.vue](src/components/Hint.vue)。它是真正的 `<button>`，点击后在视口底部（`bottom: 20px`、宽 `min(680px, 100vw − 32px)`）的说明条里展开全文——始终只有一个、不挤压版式、不产生横向滚动。页面上只留操作与结果
- **Why a button:** 上一版用 `title` 属性承载全文，只有鼠标悬停能展开；平板与键盘用户完全取不到。`?` 触屏要点得到、键盘 Tab 得到、读屏有可访问名

### Notice Bar（规则说明条）
- **Style:** `position: fixed` 底部居中，`4px` 圆角，`1px --ochre-soft` 描边，底 `--paper-2`，13px；右侧一枚「知道了」按钮
- **用法:** 唯一一次只承载一条规则原文；正文与 `?` 的可访问名完全一致

### Folded Block（`details.more`）
- **Style:** 摘要行与分节标题同级（13px / 600 / +0.12em），前置 `▸` / 展开后 `▾`
- **用法:** 低频入口默认收起——手动落账、需要人工裁定的参考段落。展开前不占版面

### Notice
- **Style:** 3px 圆角，`1px --ochre-soft` 描边，底 `#f6efe0`
- **Warn:** 描边与文字转 `--warn`，底 `#f8ece7`

### Table
- **Style:** 表头 12px / 500 / +0.06em 淡墨，行线 `1px --rule-soft`，单元格内边距 9px 10px；数字列右对齐等宽

## Do's and Don'ts

### Do:
- **Do** 把结果和状态留在页面上，把规则原文收进标题旁的 `?`——界面回答"现在是多少"，`?` 回答"为什么"。
- **Do** 让低频入口默认收起（`details.more`）。展开与否由用户决定，不占默认视线。
- **Do** 让一整块同屏控件归零：地图默认只画与王国有关的格（已占据／已备注），聚落可勾「自动放置」绕过"先点地块"这一步。
- **Do** 一个阶段只留一件主要动作，其余按规则顺序排下去。
- **Do** 数字一律等宽对齐，竖着能扫。
- **Do** 删掉任何"系统已经算好了却还在解释"的句子。解释只留在 `?` 里。

### Don't:
- **Don't** 在同一节里摆超过 8 个同屏可操作控件。元素密度是这套界面最难治的病——超了先收，不收就等于没设计。
- **Don't** 在页面上铺规则原文、公式推导、自我说明（"本工具不从地图推导邻接"这类）。它们属于 `?`。
- **Don't** 用阴影、渐变、玻璃化、发光。这套系统是平的。
- **Don't** 引入第二个强调色，也不用纯白或纯黑。
- **Don't** 给分节或提示条加一侧加粗的彩色竖条。
- **Don't** 把字号放大当作强调手段。
- **Don't** 让两个按钮只靠一个空格或自然行内空白分开——同组按钮之间必须是 8px。
