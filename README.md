# AI Image Tavern

AI Image Tavern 是一个 SillyTavern 生图扩展，用于根据当前聊天上下文、角色卡、缓存表格和上一张图状态生成 OpenAI 兼容图片接口可用的生图提示词，并把生成结果插入聊天。

## 主要功能

- 支持 OpenAI 兼容图片接口：`/v1/images/generations`。
- 支持 `url` 和 `b64_json` 图片返回格式。
- 支持可选后端代理，用于解决 CORS、HTTPS 调 HTTP、API Key 存储和远程图片转发。
- 支持独立图片密钥和补全密钥。
- 普通聊天不经过插件代理，不改变 SillyTavern 原有聊天请求。
- 插件补全优先级：插件补全代理、SillyTavern `generateQuietPrompt`、浏览器直连兜底。
- 支持当前场景、上一条回复、输入框补充、关键词、标签和自动间隔触发生图。
- 上一条回复触发时，图片会追加回对应助手消息楼层。
- 其他触发方式会插入独立插件消息。
- 生成图片以正文 HTML 图片形式显示，不写入 SillyTavern `extra.media`，避免普通聊天识别成多模态附件。
- 支持安全模式，将不适合主流图片 API 的内容改写成安全的视觉描述。
- 支持画风预设、尺寸、返回格式、连贯性模式和自动转场识别。
- 支持按用户、角色卡、聊天 ID 和触发轨道隔离缓存。
- 支持缓存表格：角色外貌、角色状态、场景。
- 缓存表格入口位于 SillyTavern 扩展魔杖菜单。
- 缓存表格字段以中文回显，最终生图 `finalPrompt` 仍要求英文。
- 支持清除当前角色外貌缓存和当前聊天缓存。

## 文件结构

```text
.
├── manifest.json
├── index.js
├── style.css
├── modules/
│   ├── constants.js
│   ├── utils.js
│   └── cache-utils.js
├── server-plugin/
│   └── openai-image-proxy/
│       └── index.js
├── SCHEMA.md
└── README.md
```

## 安装

### 前端扩展

通过 SillyTavern 扩展安装器安装本仓库，或把仓库根目录复制到第三方扩展目录。

Docker 常见路径：

```text
SillyTavern/docker/extensions/openai-image-tavern
```

容器内路径：

```text
/home/node/app/public/scripts/extensions/third-party/openai-image-tavern
```

安装后刷新或重启 SillyTavern。

### 后端代理

后端代理是可选组件。需要代理、密钥库保存、跨域或远程图片转发时安装。

复制：

```text
server-plugin/openai-image-proxy
```

到 SillyTavern 插件目录：

```text
SillyTavern/plugins/openai-image-proxy
```

Docker 常见路径：

```text
SillyTavern/docker/plugins/openai-image-proxy
```

启用 server plugins：

```yaml
enableServerPlugins: true
```

重启 SillyTavern 后可用接口：

```text
GET  /api/plugins/openai-image-proxy/health
POST /api/plugins/openai-image-proxy/models
POST /api/plugins/openai-image-proxy/chat/completions
POST /api/plugins/openai-image-proxy/images/generations
GET  /api/plugins/openai-image-proxy/file?url=...
```

## 补全调用优先级

插件只在需要生成图片提示词、识别角色外貌、规划场景或更新缓存时调用补全。普通聊天不走插件补全。

补全调用顺序：

1. 如果保存了插件补全密钥，并且后端代理可用，走插件代理 `/chat/completions`。
2. 否则走 SillyTavern 当前聊天配置的 `generateQuietPrompt`。
3. 如果 SillyTavern 静默补全失败，并且浏览器本地保存了补全密钥，才走浏览器直连 `/v1/chat/completions`。

## 配置项

- `启用插件`：总开关。
- `读取角色卡`：把当前角色卡作为生图规划上下文。
- `使用上下文`：读取最近聊天消息作为生图规划上下文。
- `图片接口地址`：OpenAI 兼容图片接口根地址。
- `补全接口地址`：可留空；通常由 SillyTavern 当前聊天配置提供。
- `图片 API 密钥`：图片接口密钥。
- `补全 API 密钥`：插件专用补全密钥，可不填。
- `图片模型`：图片生成模型名称。
- `补全模型`：插件规划用模型；可留空读取 SillyTavern 当前模型。
- `图片尺寸`：例如 `1024x1024`。
- `返回格式`：`url` 或 `b64_json`。
- `安全模式`：生成非露骨、适合主流图片 API 的视觉提示词。
- `连贯性模式`：智能判断、强制继承上一张、关闭连贯性。
- `状态缓存`：生成后是否更新角色、场景和上一张图缓存。
- `自动识别转场`：判断是否切换地点、时间、目标或可见角色。
- `自动触发间隔`：每隔 N 条角色回复自动生图。
- `画风预设`：每次生图附加的风格描述。

密钥输入框不会回显已保存密钥。后端代理可用时密钥保存到 SillyTavern 用户密钥库；纯前端模式下保存到当前浏览器 `localStorage`。

## 使用方式

聊天菜单提供：

- `AI 生图：当前场景`
- `AI 生图：上一条回复`
- `AI 生图：输入框补充`

扩展设置页提供：

- `当前场景`
- `上一条回复`
- `按补充内容生图`

关键词触发：

```text
文生图：a red apple on a wooden table
/image a red apple on a wooden table
/image
```

助手消息标签触发：

```text
<image_prompt>A red apple on a wooden table</image_prompt>
```

自动触发：

- 开启 `每隔 N 条角色回复自动生图`。
- 设置 `自动触发间隔`。
- 达到间隔后插件按当前上下文自动生成。

## 缓存表格

缓存表格入口位于 SillyTavern 扩展魔杖菜单，名称为 `AI 生图缓存表格`。

表格包括：

- `角色外貌表`：稳定角色身份、别名、固定外貌、负面约束和锁定状态。
- `角色状态表`：当前服装、当前状态、表情、姿势和最后出现位置。
- `场景表`：地点、时间、天气、氛围、道具、镜头和摘要。

表格规则：

- 当前主角色会自动进入角色外貌表并锁定。
- 角色卡缺少外貌缓存时，插件会从角色卡抽取稳定外貌。
- NPC 可以手动新增、编辑和删除。
- 表格按当前用户、角色卡和聊天 ID 隔离。
- 表格回显字段要求中文，便于人工维护。
- 最终发给图片模型的 `finalPrompt` 要求英文，便于生图模型理解。

## 连贯性

插件会为不同触发来源维护独立上一张图缓存：

- `currentContext`：当前场景。
- `lastReply`：上一条回复。
- `manualIntent`：输入框补充。
- `autoContext`：自动触发。

智能连贯性会默认继承上一张图的身份、服装、场景、光线、镜头和风格，只有明确改变地点、时间段、场景目标或可见角色时才判定转场。

## 图片插入

- `上一条回复`：图片追加到对应助手消息楼层。
- 其他触发：插入独立的插件系统消息。
- 图片以正文 HTML `<img>` 显示，不写入 `extra.media`。
- 普通聊天不会把插件生成图片当作多模态输入发送给聊天模型。

## 数据结构

缓存和 `generationRequest` 结构见 [SCHEMA.md](./SCHEMA.md)。
