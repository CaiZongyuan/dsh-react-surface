# dsh-react-surface

[English](README.md) | 简体中文

`dsh-react-surface` 是一个 DSH 原生运行时，用于将独立打包的 React 应用挂载为全框架或工作区 Surface。应用隐藏时仍保留自身状态，共享 DSH 提供的 React 运行时，并渲染在相互隔离的 ShadowRoot 中。

本仓库目前面向 DeepSeek Harness `0.1.1-rc.2`。它是实验性集成包，并非稳定的公开版本。

## 架构

```text
DSH Web
├─ dsh-react-surface
│  ├─ shell.overlay -> ReactSurfaceHost
│  ├─ sidebar.footer.action -> 应用启动入口
│  └─ ctx.reactSurfaces -> register/open/close/navigate
└─ 应用 Adapter 插件
   ├─ example.basic
   ├─ ankang.his
   └─ 其他 React 应用
```

运行时不会加载任意 Vite HTML 产物。每个应用都需要编译为 DSH Client 插件，并注册一个类型化 React Surface。

仓库有三个刻意分离的职责：

- `packages/runtime` 是 DSH 插件及浏览器运行时。
- `packages/build` 是可复用的 Bun 构建 Adapter，负责生成 DSH lazy-CJS 产物。
- `examples/basic-surface` 是独立的应用插件，也是前两个包的首个消费者。

## 环境要求

- Bun `1.4.0` 或更高版本
- Node.js `22.19.0` 或更高版本
- DeepSeek Harness `0.1.1-rc.2`
- `PATH` 中可用的 `pnpm`，因为 `dsh plugin` 会把 Profile 包管理委托给 pnpm

## 开发

```powershell
bun install
bun run check
```

`bun run check` 会对整个 workspace 做类型检查，运行 registry 测试，构建两个 DSH 包，验证 lazy-CJS 产物并检查格式。

## 安装本地 PoC

先构建各个包：

```powershell
bun run build
```

把运行时和独立示例安装到 DSH Web Profile：

```powershell
dsh.cmd plugin --profile web add ./packages/runtime
dsh.cmd plugin --profile web add ./examples/basic-surface
dsh.cmd web
```

修改已安装的包依赖图后需要重启 DSH。修改 Client 代码后需要重新构建并刷新浏览器。

## 注册应用

一个应用 Adapter 包含 Host 入口、DSH Client manifest，以及负责注册 React 根组件的 Client 入口。没有 Host 行为时，Host 入口可以为空：

```tsx
import { useEffect } from "react";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  defineReactSurface,
  type ReactSurfaceProps,
} from "dsh-react-surface/client";

function Application({
  agent,
  close,
  location,
  navigate,
  portalRoot,
}: ReactSurfaceProps) {
  useEffect(
    () =>
      agent.register({
        scopeKey: "document:current",
        label: "示例应用",
        tools: [
          {
            name: "example_get_context",
            description: "读取当前应用上下文。",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            execute: () => JSON.stringify(readCurrentContext()),
          },
        ],
      }),
    [agent],
  );
  return <YourApp />;
}

const definition = defineReactSurface({
  id: "example.application",
  title: "示例应用",
  component: Application,
  styles: "/* 应用 CSS */",
  layout: "workspace",
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.reactSurfaces.register(definition));
}
```

`layout` 默认为 `"full-frame"`，会覆盖完整 DSH 框架。使用 `"workspace"` 可以保留左侧 DSH Sidebar，把应用放在中央，并保留右侧原生 Conversation/Details 区域。运行时会自动跟踪 Sidebar、Details 和视口尺寸变化；当中央应用宽度不足时，会回退为全框架模式。

Adapter 包必须同时声明 `dsh.bundle.patch` 和 `dsh.client`。它还必须在 `dsh.client.external` 中列出 `dsh-react-surface/client`，从而让 DSH 模块图提供唯一共享的运行时实现。

可选的 `agent` 注册只会在该 Surface 与一个 DSH 原生 Session 同时处于当前状态时生效。Host 通过始终启用的 `dsh-ag-ui/browser-tools` Cordis 行绑定 Tool 目录。关闭 Surface、切换 Session、修改 `scopeKey`、卸载任一插件或丢失浏览器租约，都会撤销 Agent-scoped Tools。应用上下文更适合通过即时读取 Tool 暴露，而不是复制到每一条提示词中。

使用以下命令构建 Adapter 包：

```powershell
bunx dsh-react-surface-build .
```

包约定使用 `src/index.ts` 作为 Host 入口，使用 `src/client/index.tsx` 作为 Client 入口。构建器会生成 `lib/index.js` 和一个包装后的 `lib/client.js`；应用自己的 TypeScript 配置仍负责生成声明文件。

## 运行时接口

`ctx.reactSurfaces` 刻意保持一个较小的接口：

- `register(definition)` 把应用生命周期绑定到所属插件。
- `ReactSurfaceProps.agent.register(...)` 为当前原生 Session 发布可替换的上下文和浏览器 Tools。
- `open(id, location?)` 显示应用。
- `close()` 露出 DSH 原生工作区。
- `navigate(location)` 更新当前应用保留的内部位置。
- `getSnapshot()` 和 `subscribe()` 支持 React 与非 React 消费者。

运行时负责 DSH Slot 注册、ShadowRoot 创建、应用可见性、原生 Session 租约、Tool 传输、错误隔离和共享 React。应用 Adapter 负责路由、Provider、业务状态、能力声明和后端集成。

更多生命周期与模块说明见[架构文档](docs/architecture.md)，下一阶段的实现示例见 [HIS 集成文档](docs/his-integration.md)。
