# Design Lens

Export the visual language of the current web page as a portable `DESIGN.md`. Design Lens is a Manifest V3 extension for desktop Chrome 116 and newer. It captures computed styles, layout, and browser-observable motion from the tab you authorize, then prepares a document you can use with design tools and coding agents.

[简体中文](#简体中文) · [Privacy policy](PRIVACY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

## Install from a ZIP

1. Get `extension-chrome-vX.Y.Z.zip` from the Assets section of a GitHub Release, or build it locally using the commands below. GitHub's automatically generated Source code archives contain the editable project.
2. Extract the ZIP. Open `chrome://extensions` in Chrome and enable Developer mode.
3. Choose **Load unpacked** and select the extracted folder with `manifest.json` at its root. Pin Design Lens using the toolbar's Extensions menu.

For a manual update, replace the files in the installed directory with the new package contents, then click **Reload** on the extension card. A managed browser may restrict developer mode. [Chrome's local installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

## Capture and export

1. Open a regular web page and click **Design Lens** in Chrome's toolbar to grant access to that tab and open the side panel.
2. Choose **Capture page** and review its palette, typography, and layout. Adjust inferred color roles if needed. Resize the browser and choose **Add this viewport** for a responsive comparison. Opening the side panel can reduce the page viewport, so check the captured dimensions.
3. Choose **Record motion**, then hover, click, or scroll in the page. Recording ends after eight seconds or when you choose **Stop recording**. CSS declarations and observed animations can represent different evidence, and a trigger can be unknown.
4. Open the **Markdown** tab to preview `DESIGN.md`, then copy or download it. Choose **JSON** to keep detailed measurements and animation parameters.

If you switch to a tab Design Lens cannot access, click the toolbar icon on that tab to grant access. Capture a page again after navigating or resizing when you need measurements from the new state. The collector works with the rendered main document. Restricted Chrome pages, cross-origin frames, unrendered content, and motion inside Canvas or WebGL have limited coverage. Scripts that directly update styles may also produce effects the Web Animations API cannot describe.

### How color roles are inferred

Color roles are read from what the page actually paints, not from a frequency count of raw CSS strings. A browser reports the same color in several notations, so every value is resolved to sRGB before it is counted, and the palette is exported as hex.

- **primary** looks for a filled button or link first, then for a color painted behind high-contrast text, which is how most hero sections carry a brand color, and finally for the first stop of a gradient.
- **surface** is the background the page's own text is read on, preferring a background the page paints outright.
- **on-surface** and **on-primary** are the text colors actually used on those two backgrounds.

Each role in the panel shows the evidence it came from, so a wrong guess can be corrected with the color picker. Roles are inferences, not declarations, and a page that states its design tokens in CSS gives better results than one that relies on defaults.

### Use the file with a design tool

| Tool | How to provide the document |
| --- | --- |
| Google Stitch | Import `DESIGN.md` through the design system interface. For the official manage-design-system skill, follow its `.stitch/DESIGN.md` convention. [Stitch format guide](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) · [Official skill](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/manage-design-system/SKILL.md) |
| Impeccable | Place `DESIGN.md` at the project root and run the skill's context workflow. [Impeccable skill](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md) |
| Other design skills | Give the agent the file path explicitly and ask it to apply the relevant rules to the requested component. |

The first export format targets `@google/design.md@0.4.0`. Motion guidance appears in the Markdown body, where readers can use it alongside the structured visual tokens. Field support and generated output vary by consumer. [Version 0.4.0 specification](https://github.com/google-labs-code/design.md/blob/0.4.0/docs/spec.md)

The [example DESIGN.md](examples/DESIGN.md) was captured and downloaded from the synthetic Field Notes page. It passes the pinned Google CLI linter and loads in the Impeccable context workflow.

## Build from source

Use Node.js 22.18 or newer with npm. CI uses Node.js 24. Run the following commands from the repository root.

```sh
npm ci
npm run check
npm test
npm run package
```

Load `dist/chrome/` in Chrome for a local build, or use `dist/extension-chrome-vX.Y.Z.zip` for installation by ZIP. The neighboring `.sha256` file contains the checksum. To try a predictable example, run `npm run demo`, open `http://localhost:4173/fixtures/field-notes.html`, and capture the included Field Notes page.

The browser smoke test builds the extension and loads it in Chromium.

```sh
npx playwright install chromium
npm run test:browser
```

## 简体中文

Design Lens 是一款用于桌面版 Chrome 116 及更新版本的扩展。打开侧栏即可采集当前网页的颜色、字体、布局与可观测动效，预览并导出供设计工具和编码 Agent 使用的 `DESIGN.md`。网页数据在本地处理。详情见[隐私政策](PRIVACY.md)。

### 安装和更新

1. 从 GitHub Release 的 Assets 下载 `extension-chrome-vX.Y.Z.zip`，或依照下方命令自行构建。
2. 解压 ZIP。在 Chrome 打开 `chrome://extensions` 并启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择根目录含 `manifest.json` 的文件夹，再从工具栏的扩展菜单固定 Design Lens。

手动更新时将新版解压后的文件替换到原安装目录，再在扩展管理页点击「重新加载」。受管浏览器能否启用开发者模式取决于管理策略。[Chrome 本地安装说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

### 采集和导出

1. 打开网页，从 Chrome 工具栏点击 Design Lens，授权当前标签页并打开侧栏。
2. 点击「采集页面」，查看配色、字体和布局，可手动调整推断的颜色角色。改变浏览器大小后点击「补采此视口」，便于比较响应式布局。请以采集详情显示的视口为准，侧栏可能改变网页的布局。
3. 点击「录制动效」，在网页上悬停、点击或滚动。录制在八秒后结束，也可以手动点击「结束录制」。查看结果时可以结合样式声明和实际观测判断动效，触发条件可能未知。
4. 在「Markdown」中预览、复制或下载 `DESIGN.md`。需要精确测量数据及动效参数时，通过「JSON」下载 `capture.json`。

切换到尚未授权的标签页时，再次点击工具栏图标。缩放或导航后，可重新采集对应页面状态。首版主要读取已渲染的主文档，对 Chrome 受限页面、跨源 iframe、未渲染内容和 Canvas 或 WebGL 内部效果的覆盖有限。

### 颜色角色的推断方式

颜色角色来自页面实际绘制的颜色，而不是对 CSS 字符串做频次统计。浏览器会用多种写法表达同一个颜色，因此所有取值先解析为 sRGB 再统计，导出色板统一为十六进制。

- **主色**先找有填充色的按钮或链接，再找承载高对比文字的背景色（多数首屏的品牌色属于这一类），最后找渐变的第一个色标。
- **表面色**取页面正文实际所读的背景，页面自身声明的背景优先。
- **表面上的文字**和**主色上的文字**取对应背景上真正使用过的文字颜色。

面板会显示每个角色的推断依据，判断有误时可直接用取色器改写。这些角色属于推断而非声明，页面用 CSS 明确声明设计变量时，结果会比依赖浏览器默认值更准确。

### 交给设计技能

将 `DESIGN.md` 导入 Google Stitch，或放在项目根目录并由 Impeccable 的上下文流程读取。使用其他设计技能时，在任务中明确指定文件路径，例如「先读取 `DESIGN.md`，再按其中的主色、字体和动效规则实现商品卡片」。不同工具对具体字段的采纳以实测为准。[Google Stitch 导入说明](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) · [Impeccable 技能](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md)

[导出样例](examples/DESIGN.md)由扩展采集合成测试页并下载，已通过固定版本的 Google CLI 校验，也已验证 Impeccable 可以加载全文。

### 从源码构建

使用 Node.js 22.18 或更新版本和 npm。在项目根目录运行 `npm ci`、`npm run check`、`npm test` 和 `npm run package`。将 `dist/chrome/` 加载到 Chrome，或者安装 `dist/` 中的构建 ZIP。运行 `npm run demo` 后，可以访问 `http://localhost:4173/fixtures/field-notes.html` 采集合成示例页面。参与开发或准备发版时，见[贡献说明](CONTRIBUTING.md)。
