# Contributing to Design Lens

## Check a change

Use Node.js 22.18 or newer and the npm lockfile. Start with the synthetic Field Notes page to check changes without relying on a third-party website.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Run `npm run demo` and open `http://localhost:4173/fixtures/field-notes.html` for manual verification. Load `dist/chrome` using **Load unpacked** in a clean Chrome profile, capture the demo, and record a hover or click interaction. Check that a change in viewport width appears in a new capture. Download `DESIGN.md` and check it with the supported format baseline.

```sh
npx -p @google/design.md@0.4.0 designmd lint --format json DESIGN.md
```

Keep the authorization flow, capture metadata, and format baseline in sync with the documentation. When changing a capture rule, attach a synthetic reproduction or describe how to observe the affected result.

## Prepare a release

1. Align the package and extension versions. Run the checks above on the release commit and build a ZIP whose root contains `manifest.json`.
2. Load the extracted ZIP in Chrome Stable. Verify capture, recording, preview, and both exports using the demo.
3. Create a GitHub Release for the corresponding tag. Attach the ZIP and its SHA-256 file from the same build, describe user-facing changes, and list supported installation paths. [Managing GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
4. For Chrome Web Store review, upload the same ZIP. Provide a public privacy policy URL, screenshots of the actual extension, a 128×128 icon, a small promotional image, and reviewer instructions that include a public test page. Describe how each declared permission supports capturing and exporting design data from the current tab. [Store listing images](https://developer.chrome.com/docs/webstore/images) · [Submitting an extension](https://developer.chrome.com/docs/webstore/publish)
5. After a public listing is available, install it from the store in a clean profile and verify an export. The GitHub installation instructions also cover the unpacked package.

## 贡献与发版

修改后先运行上面的类型检查、单元测试和浏览器测试，再用 Chrome 的「加载已解压的扩展程序」实测采集、动效和导出。发布时将同一构建的 ZIP 和校验文件附到 GitHub Release，并用此 ZIP 提交 Chrome Web Store 审核。请在问题描述中使用合成页面或已授权的样例。
