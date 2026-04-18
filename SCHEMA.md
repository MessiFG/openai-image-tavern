# AI Image Tavern 数据结构

本文档记录当前前端扩展使用的数据结构。业务逻辑在前端扩展中完成；后端代理只负责转发 OpenAI 兼容接口和代理远程图片 URL。

## generationRequest

每次生图前，前端会构造 `generationRequest` 并发送给聊天补全模型，让补全模型输出最终图片提示词和缓存更新操作。缓存表格面向用户维护，字段内容要求中文；最终发给图片模型的 `finalPrompt` 要求英文。

```json
{
  "schemaVersion": 1,
  "trigger": {
    "type": "manual_menu",
    "source": "current_scene",
    "userIntent": "Generate the current scene",
    "messageId": 123,
    "createdAt": "2026-04-18T12:00:00.000Z"
  },
  "raw": {
    "userId": "default-user",
    "chatId": "character-avatar.png::Character - 2026-04-18 12h00m00s",
    "activeCharacterId": "character-avatar.png",
    "recentMessages": [
      {
        "id": 120,
        "role": "User",
        "text": "Look out the window.",
        "createdAt": "2026-04-18T11:59:00.000Z"
      }
    ],
    "characterCards": [
      {
        "id": "character-avatar.png",
        "name": "Character",
        "description": "",
        "personality": "",
        "scenario": "",
        "creator_notes": ""
      }
    ]
  },
  "cache": {
    "scene": {
      "sceneId": "current",
      "location": "",
      "timeOfDay": "",
      "weather": "",
      "mood": "",
      "props": [],
      "camera": "",
      "summary": "",
      "updatedAt": ""
    },
    "characterRegistry": {
      "character-avatar.png": {
        "id": "character-avatar.png",
        "name": "Character",
        "aliases": [],
        "source": "sillytavern_card",
        "baseAppearance": "",
        "negative": "text, watermark, blurry, bad anatomy",
        "locked": true,
        "updatedAt": ""
      },
      "npc:alice": {
        "id": "npc:alice",
        "name": "Alice",
        "aliases": ["女仆", "她"],
        "source": "chat_context",
        "baseAppearance": "",
        "negative": "",
        "locked": false,
        "updatedAt": ""
      }
    },
    "characters": {
      "character-avatar.png": {
        "name": "Character",
        "baseAppearance": "",
        "currentOutfit": "",
        "currentState": "",
        "currentExpression": "",
        "currentPose": "",
        "lastSeenAt": "",
        "negative": "text, watermark, blurry, bad anatomy",
        "locked": true,
        "updatedAt": ""
      }
    },
    "lastImage": {
      "prompt": "",
      "summary": "",
      "continuityTags": [],
      "anchors": {
        "identity": "",
        "outfit": "",
        "scene": "",
        "camera": "",
        "mood": "",
        "style": ""
      },
      "characters": [],
      "sceneId": "",
      "transitionFromPrevious": false,
      "updatedAt": ""
    }
  },
  "generation": {
    "target": "image_prompt",
    "focus": "current_scene",
    "imageTrack": "currentContext",
    "style": "Japanese anime style, clean line art, expressive character design, vibrant colors, cinematic lighting",
    "safeMode": true,
    "size": "1024x1024",
    "continuityMode": "smart",
    "detectSceneTransition": true,
    "continuityPolicy": {
      "defaultAction": "inherit_unless_clear_scene_transition",
      "transitionOnlyWhen": "location, time period, scene goal, or cast clearly changes; do not treat emotion, pose, dialogue, or small action changes as a scene transition",
      "preserveFields": [
        "character identity",
        "base appearance",
        "current outfit",
        "scene layout",
        "lighting mood",
        "camera language",
        "visual style"
      ]
    },
    "constraints": [
      "preserve character identity",
      "preserve scene continuity when the scene is not transitioning",
      "avoid text, watermark, captions, speech bubbles",
      "safety mode: produce a non-explicit prompt suitable for mainstream image APIs; convert explicit source context into safe cinematic wording"
    ]
  },
  "provider": {
    "imageModel": "image-model",
    "promptModel": "chat-completion-model",
    "size": "1024x1024",
    "responseFormat": "url",
    "refinePrompt": true
  }
}
```

## trigger

`trigger.type` 表示触发方式：

- `manual_menu`：聊天菜单触发。
- `manual_input`：扩展页输入框补充触发。
- `tag`：助手消息内 `<image_prompt>` 标签触发。
- `auto_reply_count`：每隔 N 条角色回复自动触发。

`trigger.source` 表示语义来源：

- `current_scene`：按当前上下文和当前场景生成。
- `last_reply`：按上一条角色回复生成。
- `user_intent`：优先使用用户补充提示词。

## imageTrack

上一张图缓存按轨道隔离：

- `currentContext`：`current_scene` 使用，包含手动当前场景和自动触发。
- `lastReply`：`last_reply` 使用。
- `manualIntent`：`user_intent` 使用。

轨道隔离用于避免不同生图语义互相污染上一张图摘要和连贯锚点；自动触发属于当前场景语义，所以与手动当前场景共用 `currentContext`。

## characterRegistry

`characterRegistry` 是多角色外貌表，只存稳定身份和稳定外貌。
扩展魔杖菜单中的 `AI 生图缓存表格` 的 `角色外貌` 表直接编辑这个字段，保存后写入缓存。

字段：

- `id`：稳定角色 ID。主角色通常是头像文件名，NPC 通常是 `npc:*`。
- `name`：角色名。
- `aliases`：别名、称呼、昵称。
- `source`：`sillytavern_card` 或 `chat_context`。
- `baseAppearance`：稳定外貌。
- `negative`：不要改变的特征或负面提示词。
- `locked`：是否锁定基础外貌。
- `updatedAt`：更新时间。

约束：

- 角色表不存构图位置。
- 角色表不存临时动作。
- 角色表不存当前场景。
- 主角色由 SillyTavern 当前角色卡初始化，并强制锁定。
- 如果主角色缺少 `baseAppearance`，首次生图前会调用补全模型，从当前角色卡中只抽取当前主角色的稳定外貌；多角色角色卡不会整段照搬。
- NPC 可由用户在表格 UI 中新增，也可由补全规划写入。

## characters

`characters` 是当前聊天内的短期角色状态缓存。
扩展魔杖菜单中的 `AI 生图缓存表格` 的 `角色状态` 表直接编辑这个字段，保存后写入缓存。

适合存：

- `currentOutfit`
- `currentState`
- `currentExpression`
- `currentPose`
- `lastSeenAt`

不适合存：

- 长期身份。
- 稳定外貌原始定义。
- 画面左侧、右侧等构图位置。

稳定身份应写入 `characterRegistry`，构图位置应写入 `lastImage.anchors` 或由当前上下文推断。

## scene

`scene` 是当前聊天的场景缓存。
扩展魔杖菜单中的 `AI 生图缓存表格` 的 `场景` 表直接编辑这个字段，保存后写入缓存。

字段：

- `sceneId`
- `location`
- `timeOfDay`
- `weather`
- `mood`
- `props`
- `camera`
- `summary`
- `updatedAt`

场景缓存按当前聊天 ID 隔离。换新聊天不会复用旧聊天的场景缓存。

## lastImage

`lastImage` 是当前 `imageTrack` 的上一张图缓存。

字段：

- `prompt`：上一张图的最终提示词。
- `summary`：上一张图的视觉摘要。
- `continuityTags`：连贯标签。
- `anchors.identity`：身份锚点。
- `anchors.outfit`：服装锚点。
- `anchors.scene`：场景锚点。
- `anchors.camera`：镜头锚点。
- `anchors.mood`：氛围锚点。
- `anchors.style`：画风锚点。
- `characters`：上一张图出现的角色。
- `sceneId`：对应场景 ID。
- `transitionFromPrevious`：是否断开上一张图连贯。
- `updatedAt`：更新时间。

## 补全模型返回格式

提示词规划接口需要返回 JSON。当前实现优先读取 `memoryOps`，旧版 `updatedCache` 只作为兼容结构。

```json
{
  "finalPrompt": "English image prompt, concrete and visual",
  "transitionFromPrevious": false,
  "reason": "short reason",
  "memoryOps": [
    {
      "op": "update",
      "table": "scene",
      "id": "scene",
      "data": {
        "sceneId": "current",
        "location": "客厅",
        "timeOfDay": "夜晚",
        "weather": "",
        "mood": "紧张/吃醋/亲密",
        "props": ["沙发", "前门", "电视"],
        "camera": "中景/电影感构图",
        "summary": "角色在家中客厅对峙"
      }
    },
    {
      "op": "update",
      "table": "characters",
      "id": "character-id",
      "data": {
        "name": "角色名",
        "currentOutfit": "当前服装",
        "currentState": "当前状态",
        "currentExpression": "当前表情",
        "currentPose": "当前姿势",
        "lastSeenAt": "latest_context"
      }
    },
    {
      "op": "update",
      "table": "lastImage",
      "id": "lastImage",
      "data": {
        "prompt": "short English prompt summary",
        "summary": "中文视觉摘要",
        "continuityTags": ["identity", "outfit", "scene", "style"],
        "anchors": {
          "identity": "中文身份锚点",
          "outfit": "中文服装锚点",
          "scene": "中文场景锚点",
          "camera": "中文镜头锚点",
          "mood": "中文氛围锚点",
          "style": "中文风格锚点"
        },
        "characters": ["角色名"],
        "sceneId": "current"
      }
    }
  ]
}
```

`finalPrompt` 会被发送到图片 API。`memoryOps` 中的缓存字段会合并写回浏览器本地缓存。

## 浏览器缓存

主缓存 key：

```text
openai-image-tavern-cache-v1:{userId}
```

缓存结构：

```json
{
  "version": 1,
  "users": {
    "default-user": {
      "chats": {
        "chat-id": {
          "scene": {},
          "characterRegistry": {},
          "characters": {},
          "lastImage": {},
          "imageTracks": {
            "currentContext": { "lastImage": {} },
            "lastReply": { "lastImage": {} },
            "manualIntent": { "lastImage": {} }
          },
          "autoTrigger": {
            "repliesSinceLastImage": 0,
            "lastMessageId": null,
            "lastTriggeredAt": ""
          }
        }
      }
    }
  }
}
```

## 聊天 ID

聊天缓存 key 使用：

```text
{currentCharacterKey}::{currentChatId}
```

`currentChatId` 优先取 SillyTavern 的 `getCurrentChatId()`。如果不可用，则使用当前角色和首条消息生成兜底指纹。

## 密钥缓存

纯前端模式下，API Key 保存到：

```text
openai-image-tavern-api-key-v1:{userId}
```

后端代理模式下，API Key 保存到 SillyTavern 密钥库：

```text
openai_image_tavern_api_key
```

## 后端代理接口

后端代理提供：

```text
GET  /api/plugins/openai-image-proxy/health
POST /api/plugins/openai-image-proxy/models
POST /api/plugins/openai-image-proxy/chat/completions
POST /api/plugins/openai-image-proxy/images/generations
GET  /api/plugins/openai-image-proxy/file?url=...
```

代理只转发插件需要的 OpenAI 兼容接口，不作为通用 HTTP 代理使用。
