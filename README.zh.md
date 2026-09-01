# dsh-react-surface

[English](README.md) | 简体中文

`dsh-react-surface` 用于把现有的客户端 React 应用接入 DeepSeek Harness，成为 DSH 原生 Surface。应用继续拥有自己的 UI、状态和业务逻辑；Runtime 统一负责 DSH 布局、生命周期、样式隔离、Shell 品牌协调、响应式降级、诊断和可选 Agent 协作。

仓库目前面向 DeepSeek Harness `0.1.2-alpha.3`，暂时通过 GitHub 源码安装，尚未发布 npm 版本。

## 核心能力

- 使用一个类型化的 `defineReactSurface(...)` 接入 Vite React 或 Next.js Client Component。
- 每个应用使用独立 ShadowRoot，并自动打包 CSS、CSS Modules、图片和字体。
- 支持 `full-frame`、`center`、`workspace`、`right-panel`、`bottom-panel` 五种布局。
- 支持键盘可访问的拖动分隔条、响应式降级和版本化的纯 UI 偏好。
- 可以只设置 Surface 样式，也可以在 Surface 激活期间协调整个可见 DSH Shell 的品牌 Token。
- 支持 lazy mount、隐藏后保留状态以及关闭时卸载。
- 通过 `ctx.reactSurfaces.inspect()` 获取不包含业务数据的本地诊断报告。
- 可选搭配 `dsh-ag-ui`，让当前 DSH Agent 感知和操作激活的 Surface。

Runtime 不加载任意 HTML、远程应用、iframe 或 Next.js 服务端产物。安装的 Surface 插件属于可信代码；ShadowRoot 只提供样式隔离，不是安全沙箱。

## 架构

```text
DSH Web
├─ dsh-react-surface Runtime
│  ├─ 小型 ctx.reactSurfaces Interface
│  ├─ Host Adapter：布局、品牌、兼容与完整清理
│  ├─ 每个已挂载应用一个 ShadowRoot
│  └─ 可选 dsh-ag-ui Session Tool Lease
└─ 应用 Adapter 插件
   ├─ 引入现有 React 根组件
   ├─ 声明布局、生命周期和品牌 Token
   └─ 按需注册浏览器 Tools
```

应用 Adapter 不需要查询 DSH DOM，也不需要直接调用 DSH Slot。Router、Provider、数据、权限和业务行为仍由应用自己负责。

## 源码安装

克隆并验证 Runtime：

```powershell
git clone https://github.com/CaiZongyuan/dsh-react-surface.git
cd dsh-react-surface
bun install
bun run check
```

在现有 Vite 或 Next.js 项目中生成 Adapter：

```powershell
bun packages/build/src/cli.ts init D:\Projects\my-react-app --framework vite
```

命令默认创建 `integrations/dsh`，不会覆盖应用文件。可以使用 `--entry`、`--id`、`--title`、`--output` 和 `--dry-run` 调整生成结果。

构建并安装到 DSH Web Profile：

```powershell
cd D:\Projects\my-react-app\integrations\dsh
bun install
bun run build

dsh.cmd plugin --profile web add D:\Projects\dsh-react-surface\packages\runtime
dsh.cmd plugin --profile web add D:\Projects\my-react-app\integrations\dsh
dsh.cmd web
```

修改安装依赖图后需要重启 DSH；修改 Client 代码后重新构建并刷新浏览器。

## Flexible Layout

```ts
layout: {
  default: "workspace",
  supported: [
    "full-frame",
    "center",
    "workspace",
    "right-panel",
    "bottom-panel",
  ],
  fallback: "full-frame",
  resizable: true,
  persist: true,
}
```

插件作者声明允许的布局，用户从统一启动器中切换。Runtime 保存的只有布局、面板尺寸和折叠状态，不保存应用业务数据。未知 DSH 结构或空间不足时会安全降级，不会盲目修改宿主 DOM。

## 品牌协调

```ts
branding: {
  shell: "surface",
  colorScheme: "light",
  identity: { name: "Acme Dashboard", mark: "AD" },
  tokens: {
    accent: "#176b4d",
    accentForeground: "#ffffff",
    background: "#f6f8f7",
    surface: "#ffffff",
    elevated: "#e9efec",
    foreground: "#202723",
    mutedForeground: "#66736c",
    border: "#d7dfdb",
    fontFamily: "Inter, system-ui, sans-serif",
    radius: "6px",
  },
}
```

`shell: "preserve"` 只影响应用 ShadowRoot；`shell: "surface"` 会在 Surface 激活期间把稳定语义 Token 映射到经过验证的 DSH Shell Token。存在官方 Sidebar 品牌槽时，`identity` 还会临时替换左上角标记和名称。关闭或卸载后按所有权恢复，不会覆盖其他插件之后写入的新值。

## 可选 dsh-ag-ui

未安装 `dsh-ag-ui` 时，挂载、布局、导航和品牌功能全部正常工作，`capabilities.agent.status` 返回 `unavailable`。

安装后，应用可以通过 `agent.register(...)` 向当前原生 DSH Session 发布浏览器 Tools。Tools 只在 Surface 和 Session 同时激活期间存在。Bridge 使用 loopback/live-pair 门禁、Web Locks、多标签 leadership、随机 capability token 和 Host TTL。

中立示例位于 [`examples/ag-ui-tools`](examples/ag-ui-tools)，不包含任何特定业务项目内容。

## Next.js

这里的 Next.js 支持是 Client Surface 支持：Client Components、Provider、Hooks 和浏览器状态可以复用；Server Components、Server Actions、Middleware 和 Next Server 继续运行在原部署中。

当前 DSH cohort 提供 React `18.3.1`。即使 React 19 项目可以完成构建，使用 React 19 专属 Runtime API 的组件仍需要未来兼容的 DSH cohort。

详细限制和接入方式见 [Next.js Client 接入](docs/next-client.md)。

## 开发验证

```powershell
bun install
bun run check
```

`bun run check` 会执行类型检查、全部测试、Runtime 和真实示例构建、DSH lazy-CJS 产物检查及格式检查。

真实 DSH 浏览器验证单独运行：

```powershell
bun run test:e2e
$env:DSH_AG_UI_DIR = "D:\Projects\Frontend\dsh-ag-ui"
bun run test:e2e
```

第一条验证未安装 `dsh-ag-ui` 时的安全降级；第二条还会打包并安装显式指定的 AG-UI 源码仓库。

更多文档：

- [应用接入](docs/application-integration.md)
- [布局与品牌](docs/layouts-and-branding.md)
- [Next.js Client 接入](docs/next-client.md)
- [可选 dsh-ag-ui 接入](docs/ag-ui.md)
- [架构](docs/architecture.md)
- [安全模型](SECURITY.md)
- [参与贡献](CONTRIBUTING.md)
