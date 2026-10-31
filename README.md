# ORBITAL · Rocket Landing Simulator 3D

[在线试玩](https://unowhatpvp-alt.github.io/rocket-landing-simulator/) · [源码仓库](https://github.com/unowhatpvp-alt/rocket-landing-simulator)

GitHub Pages 已部署成功，线上点火和资源加载已验证。推送 main 后自动执行测试、构建与部署。

在浏览器中手动控制原创 O-1 助推器，完成海上垂直回收。所有实时渲染、刚体模拟、输入和音频都在客户端执行；服务器只提供静态文件，不需要账号、数据库、云端 GPU 或游戏后端。

本次交付定位为**第一阶段可玩版本，并附带原创 Blender / GLB 场景资产**。任务文档中的高阶画面目标是后续路线，不代表所有阶段已经完成。物理参数服务于娱乐与练习，不是实际航天器的飞行控制软件。

## 启动

项目目录：`D:\CodexWorkspace\RocketLandingSimulator`。

需要 Node.js 22.12+（当前开发环境为 24.x）与 PATH 中可用的 pnpm 11（已验证 11.25.0）。依赖版本固定于 `package.json` 和 `pnpm-lock.yaml`。不需要安装 Blender 即可运行现有网页资产。

Windows 可以双击 `start.cmd`。脚本检查工具、按需安装依赖，并启动本地开发服务。如果 PATH 中没有工具，会尝试读取当前用户已有的 Codex 便携运行时（`%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies`）；仅修改脚本进程的 PATH，不安装工具或写入该运行时目录。首次安装需要联网；开发服务器启动后打开 `http://127.0.0.1:5173/`。如果提示找不到 Node.js 或 pnpm，请先使已安装工具在当前终端的 PATH 中可见；脚本不会修改系统配置或自行安装系统工具。

手动启动的 PowerShell 命令：

```powershell
Set-Location -LiteralPath 'D:\CodexWorkspace\RocketLandingSimulator'
$projectRoot = (Get-Location).Path
$env:TEMP = "$projectRoot\work"
$env:TMP = $env:TEMP
$env:PNPM_HOME = "$projectRoot\.cache\pnpm-home"
$env:PNPM_STORE_DIR = "$projectRoot\.pnpm-store"
$env:XDG_CACHE_HOME = "$projectRoot\.cache"
$env:XDG_DATA_HOME = "$projectRoot\.cache\data"
$env:XDG_STATE_HOME = "$projectRoot\.cache\state"
$env:XDG_CONFIG_HOME = "$projectRoot\.cache\config"
$env:npm_config_cache = "$projectRoot\.cache\npm"
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
pnpm install --frozen-lockfile --store-dir .pnpm-store --cache-dir .cache/pnpm --config.state-dir=.cache/state
pnpm dev
```

这些环境变量只作用于当前终端。项目、依赖、构建产物与可配置的临时文件均留在项目目录内。不要使用全局安装命令，也不要在其他目录执行依赖安装。

## 操作

| 输入 | 行为 |
| --- | --- |
| 页面「开始模拟」 | 开始下降；使用暂停按钮或 P 暂停 |
| 按住 Space | 连续增加目标油门；松开后逐渐降低 |
| 拖动右侧油门滑块 | 精细设置并保持目标油门 |
| W / S | 沿当前镜头的水平前 / 后方向调整姿态 |
| A / D | 沿当前镜头的左 / 右方向调整姿态 |
| 拖动近景跟随 / 自由轨道画面 | 绕火箭旋转镜头；滚轮缩放，触控双指缩放 |
| C | 切换摄像机 |
| R | 重新开始 |
| P | 暂停 / 继续 |
| H | 显示 / 隐藏 HUD |
| 声音按钮 | 主动开启 / 关闭合成发动机声音 |
| 移动端摇杆 | 按当前镜头方向调整姿态；右侧滑块控制油门 |

WASD 与触摸摇杆以当前镜头的水平朝向为参考：转动或切换镜头后，前后左右随视角改变。组合方向归一化，避免对角线输入增强总控制量；俯视角接近竖直时保留上一有效水平朝向。姿态输入使火箭倾斜，水平位移仍取决于推力与惯性，松键不会立即停止漂移。

窗口失去焦点或页面进入后台时，输入模块清除按键和触摸状态，目标油门归零，避免粘连输入。发动机具有响应延迟，实际推力不会瞬间跟随目标油门变化。

初始高度为甲板上方 95 m，向下速度 8 m/s。先用油门控制下降速度，再小幅修正水平偏差。悬停参考标记随当前质量变化；持续高推力会向上加速。落地前需要把下降速度和水平速度降至安全范围。

| 规则 | 街机模式 | 真实感模式 |
| --- | --- | --- |
| 允许垂直接地速度 | ≤ 3 m/s | ≤ 1.8 m/s |
| 允许水平接地速度 | ≤ 2 m/s | ≤ 1 m/s |
| 允许倾角 | ≤ 10° | ≤ 5° |
| 其他条件 | 四脚位于甲板内，着陆脚先接触平台 | 同左 |
| 姿态辅助 | 较强，可关闭 | 较弱，可关闭 |
| 无限燃料 | 可选 | 不提供 |

接触海面、撞上平台边缘、机身先接触或超出安全阈值都判定失败。接地后模拟锁定结果，使用重置重新尝试。

## 命令

```powershell
pnpm dev       # 本地开发，127.0.0.1:5173
pnpm test      # 物理、镜头相对控制与回放回归测试
pnpm build     # TypeScript 检查与静态构建，输出 dist/
pnpm preview   # 预览已有 dist/，默认 127.0.0.1:4287
```

运行上述命令前请先执行启动章节中的项目内缓存配置。`build.cmd` 提供同样的环境配置，并依次运行测试和构建；任何一步失败都会停止。

自动测试涵盖不同显示帧率下固定步长结果的一致性、重力和推力响应、油门变化率、燃料与质量、姿态控制、低速着陆、硬着陆、平台边缘、落海、两种模式阈值、长时间运行以及重复重置与释放。镜头相对控制另有多朝向、对角线、模拟量幅度和俯视退化保护测试，并使用实际刚体模拟检查映射后的加速度方向。回放测试覆盖连续量插值、反号四元数的最短路径和接地事件切换。26 项测试与 `build.cmd` 已通过；桌面浏览器已完成初步功能检查，390×844 和 844×390 视口未见布局溢出。实体手机触控与不同真实 GPU 的兼容性、功耗和性能尚未实测。

## 文件与技术选择

- `src/physics.ts`：Rapier WASM 刚体、120 Hz 固定步长、接触判定、燃料与推力。
- `src/input.ts`：键盘、滑块与触摸摇杆。
- `src/control-frame.ts`：将键盘与摇杆输入转换为镜头相对的姿态指令。
- `src/replay.ts`：回放快照的连续量插值与四元数最短路径插值。
- `src/audio.ts`：主动开启的 Web Audio 合成引擎声音。
- `src/main.ts`：应用入口、场景与 HUD 连接。
- `src/scene.ts`：渲染后端、海面与场景、镜头、粒子、画质及资源释放。
- `src/style.css`：桌面与移动端界面。
- `scripts/create_models.py`：可重复执行的 Blender 原创资产生成脚本。
- `assets/orbital_assets.blend`：模型源文件；`assets/model_metrics.json`：导出几何统计。
- `public/models/rocket.glb`、`platform.glb`：运行时模型。
- `tests/physics.test.ts`：无需浏览器的物理回归测试。
- `tests/control-frame.test.ts`：镜头方向转换与实际刚体方向回归测试。
- `tests/replay.test.ts`：回放连续插值、反号四元数和接地事件边界测试。
- `docs/IMPLEMENTATION.md`：实现边界、资源与部署说明。
- `docs/TESTING.md`：本次自动化与浏览器验收记录。

Vite + TypeScript 用于明确模块边界和静态构建；Three.js 负责实时 3D，Rapier 提供成熟的刚体与碰撞求解。采用原创程序化 Blender 模型，避免外部模型授权与下载依赖。运行时优先尝试 WebGPU，初始化失败时回退 WebGL2；页面显示实际使用的后端。此策略不意味着 WebGPU 一定更快。

## 重新生成模型

已有资产可直接使用。需要修改模型时，可使用已安装的 Blender 5.2，先配置项目内临时目录：

```powershell
Set-Location -LiteralPath 'D:\CodexWorkspace\RocketLandingSimulator'
$projectRoot = (Get-Location).Path
$env:TEMP = "$projectRoot\work\temp"
$env:TMP = $env:TEMP
$env:BLENDER_USER_CONFIG = "$projectRoot\work\blender-config"
$env:BLENDER_USER_SCRIPTS = "$projectRoot\work\blender-scripts"
$env:BLENDER_USER_DATAFILES = "$projectRoot\work\blender-data"
$env:PYTHONDONTWRITEBYTECODE = '1'
New-Item -ItemType Directory -Path $env:TEMP,$env:BLENDER_USER_CONFIG,$env:BLENDER_USER_SCRIPTS,$env:BLENDER_USER_DATAFILES -Force | Out-Null
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --factory-startup --background --python "$projectRoot\scripts\create_models.py"
```

这里的 C: 路径仅用于读取并运行已安装 Blender，资产与缓存写入 D: 项目中。脚本不下载模型、不安装软件、不保存系统偏好；它会覆盖本项目内生成的同名 `.blend`、`.glb` 与统计文件。坐标以米为单位，运行时 +Y 向上；火箭局部底面 Y=0、高约 20 m；平台尺寸 44×44 m、甲板 Y=3。

## 静态部署

执行 `pnpm build` 后，将 `dist/` 的内容完整上传到静态托管。不要直接用 `file://` 打开 HTML：模块、WASM 与模型加载需要 HTTP(S)。服务器应支持 JavaScript、GLB、WASM 对应文件类型，并为指纹化文件设置适当的长期缓存；HTML 避免永久缓存。

GitHub Pages 工作流位于 `.github/workflows/pages.yml`：推送到 `main` 或手动触发后，依次安装锁定依赖、运行测试与构建、上传 `dist/` artifact，并部署到 `github-pages` 环境。[项目仓库](https://github.com/unowhatpvp-alt/rocket-landing-simulator) 已创建，Pages 发布源已保存为 GitHub Actions；[页面地址](https://unowhatpvp-alt.github.io/rocket-landing-simulator/) 已完成首次部署与线上点火验收。配置步骤参见 [GitHub 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

`vite.config.ts` 使用 `base: './'`，可放在仓库子路径中；资源路径必须保持相对路径。采用工作流时需提交源代码与锁文件，托管内容来自构建后的 `dist/`；`node_modules/`、`.pnpm-store/` 与 `work/` 不应提交。Blender 源文件不参与网页构建。WebGPU 还取决于浏览器、驱动和安全上下文；HTTPS 或 localhost 更合适。

离线缓存与 PWA 尚未实现；首次加载后也不承诺完整离线重启。

## 本轮迭代状态

已实现并完成本地浏览器初步检查：

- 近景跟随与自由轨道的拖拽、缩放，镜头相对 WASD / 摇杆输入。
- 8 个 RCS 喷口、主喷口偏转、激波尾焰、4 片格栅翼与着陆腿的动态视觉反馈；着陆腿在甲板上方 40 m 内完全展开。
- 录制快照的连续回放插值，含四元数最短路径插值，保留正确的接地事件时刻。
- 390×844 竖屏与 844×390 横屏视口布局，无溢出。

上述检查来自当前桌面浏览器与模拟视口；实体移动设备、不同显卡、长时间 GPU 稳定性仍需分别验证。

## 当前边界

- 物理包含简化重力、阻力、质量变化、推力与刚体接触；没有真实风场、柔性结构、气动外形求解或真实航天器专用控制律。
- 碰撞体为服务游戏的近似形状，结果锁定后不模拟结构破碎、倾覆和残骸运动。
- 资产为原创程序化模型与 PBR 材质；不包含完整高模烘焙纹理或压缩纹理制作流程。
- 尚未实现 AO、Bloom、景深、热扭曲与 PWA。浏览器不支持可靠 GPU 计时时不显示 GPU 耗时；不提供伪造的显存或 GPU 利用率。
- WebGPU 与 WebGL2 的实际效果、性能与移动端触摸体验需按目标设备验证。自动画质只是启发式选择，不是硬件性能保证。

后续阶段可在保持回归测试通过的基础上，增加材质烘焙、可独立关闭的后处理，并补充实体设备与更多显卡的性能实测。


项目内 pnpm 11 配置使用 `pnpm-workspace.yaml` 的 `allowBuilds`、`storeDir` 和 `cacheDir`，并禁用全局虚拟仓库；配置格式参照 [pnpm 11 迁移说明](https://pnpm.io/migration)。




