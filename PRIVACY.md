# Design Lens Privacy Policy

Effective November 20, 2026. [简体中文](#简体中文)

## What Design Lens accesses

Design Lens processes information from the current web page when you initiate a capture or motion recording on an authorized tab. It uses the tab address to check that the page can be captured. It reads computed styles, visible element roles and measurements, viewport dimensions, theme preferences, and browser-observable animation properties. The design summary and export use those design details without including the tab address.

The extension uses temporary access to the current tab through `activeTab`. The `scripting` permission lets it run the local collector on that tab. The `sidePanel` permission opens the interface for preview and export.

## How your data is handled

Capture data is processed on your device. Design Lens keeps current results in memory. When you request an export, it saves a file to your device or copies the Markdown to your clipboard. It does not require an account or transmit capture data to Design Lens contributors or a third party. The extension does not read cookies, form values, page text, or browser history for export. It uses no analytics or advertising.

Exported files are controlled by you and can be deleted through your operating system. Review an export before sharing it with a third-party service, where that service's own privacy policy applies.

Design Lens's use of information it accesses through Chrome complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. [Chrome Web Store Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

For privacy questions, use the Issues tab in the Design Lens source repository. Describe the question without posting private page data or exports.

## 简体中文

**生效日期为 2026 年 11 月 20 日。**

Design Lens 在你主动采集或录制时处理已授权标签页的计算样式、可见元素的角色与尺寸、视口、主题偏好，以及浏览器可观测的动效属性。扩展检查标签页地址以判断当前页面是否可采集，侧栏的设计摘要和导出文件不包含该地址。扩展用 `activeTab` 获得当前标签页的临时访问权限，用 `scripting` 运行本地采集脚本，并用 `sidePanel` 展示操作界面。

数据在本机处理，当前采集结果保留在内存中。你可以将结果下载到设备或把 Markdown 复制到剪贴板，由你决定如何保留、删除和分享。扩展无需账号，不向维护者或第三方发送采集数据，也不读取 Cookie、表单值、页面正文或历史记录用于导出，不包含遥测或广告。

将导出文件分享给其他服务前，请检查文件内容。该服务的数据处理适用其自身的隐私政策。

Design Lens 对通过 Chrome 访问的信息的使用遵守 Chrome Web Store 用户数据政策及 Limited Use 要求。隐私相关问题可以通过源码仓库的 Issues 提出，避免附上含私人信息的页面数据或导出文件。[Chrome Web Store Limited Use 政策](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
