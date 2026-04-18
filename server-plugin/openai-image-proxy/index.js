import { SecretManager } from '../../src/endpoints/secrets.js';

const DEFAULT_TIMEOUT_MS = 180000;
const IMAGE_SECRET_KEY = 'openai_image_tavern_api_key';
const DEFAULT_CONFIG = {
  baseUrl: process.env.OPENAI_IMAGE_BASE_URL || '',
  promptBaseUrl: process.env.OPENAI_IMAGE_PROMPT_BASE_URL || '',
  apiKey: process.env.OPENAI_IMAGE_API_KEY || '',
  model: process.env.OPENAI_IMAGE_MODEL || '',
  size: process.env.OPENAI_IMAGE_SIZE || '1024x1024',
  responseFormat: process.env.OPENAI_IMAGE_RESPONSE_FORMAT || 'url',
  refinePrompt: process.env.OPENAI_IMAGE_REFINE_PROMPT !== 'false',
  promptModel: process.env.OPENAI_IMAGE_PROMPT_MODEL || '',
  n: 1,
  contextDepth: 8,
  maxCharacterText: 1600,
  maxContextText: 2200,
};

const runtimeCache = {
  version: 1,
  users: {},
};

const GENERATION_REQUEST_SCHEMA_EXPLANATION = `
Data definition:
- trigger.type: How image generation was triggered. Use it to understand whether the user explicitly requested an image or it was automatic.
- trigger.source: The semantic source for the request. current_scene means use the latest overall context; last_reply means focus on the latest assistant reply; user_intent means prioritize trigger.userIntent.
- trigger.userIntent: The user's short image request or automatic trigger intent.
- raw.chatId: Current SillyTavern chat identifier.
- raw.activeCharacterId: The currently focused character.
- raw.recentMessages: Recent chat messages ordered oldest to newest. Use them for pose, action, emotion, location, and continuity.
- raw.characterCards: Original character card fields from SillyTavern. Use them only when cache is missing or incomplete.
- cache.scene: AI-summarized scene memory. Empty fields mean infer from raw.recentMessages. Keep location, time, weather, mood, props, and camera consistent when present.
- cache.characters: AI-summarized character appearance memory keyed by character id. Preserve identity, base appearance, outfit, and current visual state. If locked is true, do not contradict it.
- generation.style: The required visual style preset. Apply it clearly unless it conflicts with safety or explicit user intent.
- generation: The current image generation target, focus, style, size, and constraints.
- provider: Image API settings. Do not mention provider settings in the final prompt unless they affect image composition.

Task:
Read the JSON above and write exactly one final image generation prompt in English.
The prompt must be concrete and visual, preserve roleplay continuity, include relevant character appearance, scene, action, mood, camera/framing if useful, and avoid UI/text/watermark/caption/speech bubbles.
Return only the final image prompt. Do not return JSON, markdown, notes, or explanations.
`.trim();

export const info = {
  id: 'openai-image-proxy',
  name: 'OpenAI Image Proxy',
  description: 'Same-origin proxy for OpenAI-compatible image generation APIs.',
};

export async function init(router) {
  router.get('/health', (_req, res) => {
    res.json({ ok: true, plugin: info.id });
  });

  router.post('/models', async (req, res) => {
    await proxyModels(req, res);
  });

  router.post('/chat/completions', async (req, res) => {
    await proxyChatCompletions(req, res);
  });

  router.post('/images/generations', async (req, res) => {
    await proxyImageGenerations(req, res);
  });

  router.post('/generate', async (req, res) => {
    await proxyGenerate(req, res);
  });

  router.get('/file', async (req, res) => {
    await proxyFile(req, res);
  });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function buildHeaders(apiKey, extraHeaders = {}) {
  const headers = {
    Accept: 'application/json',
    ...extraHeaders,
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function sameOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyModels(req, res) {
  try {
    const config = resolveConfig(req);
    const root = normalizeBaseUrl(config.baseUrl);
    if (!root) return res.status(400).json({ error: 'baseUrl is required' });
    if (!config.apiKey) return res.status(400).json({ error: 'api key is required' });

    const upstream = await fetchWithTimeout(`${root}/v1/models`, {
      method: 'GET',
      headers: buildHeaders(config.apiKey),
    }, 30000);

    const data = await readJsonOrText(upstream);
    res.status(upstream.status).json(normalizeModels(data));
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

async function proxyChatCompletions(req, res) {
  try {
    const body = req.body || {};
    const config = resolveConfig(req);
    const root = normalizeBaseUrl(body.promptBaseUrl || config.promptBaseUrl || config.baseUrl).replace(/\/v1$/, '');
    if (!root) return res.status(400).json({ error: 'baseUrl is required' });
    if (!config.apiKey) return res.status(400).json({ error: 'api key is required' });
    if (!body.payload || typeof body.payload !== 'object') return res.status(400).json({ error: 'payload is required' });

    const upstream = await fetchWithTimeout(`${root}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body.payload),
    }, Number(body.timeoutMs || 60000));

    const data = await readJsonOrText(upstream);
    res.status(upstream.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

async function proxyImageGenerations(req, res) {
  try {
    const body = req.body || {};
    const config = resolveConfig(req);
    const root = normalizeBaseUrl(config.baseUrl);
    if (!root) return res.status(400).json({ error: 'baseUrl is required' });
    if (!config.apiKey) return res.status(400).json({ error: 'api key is required' });
    if (!body.payload || typeof body.payload !== 'object') return res.status(400).json({ error: 'payload is required' });

    const upstream = await fetchWithTimeout(`${root}/v1/images/generations`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body.payload),
    }, Number(body.timeoutMs || DEFAULT_TIMEOUT_MS));

    const data = await readJsonOrText(upstream);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: extractErrorMessage(data),
        raw: data,
      });
    }

    res.json({
      ...normalizeImages(data, req),
      raw: data,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

async function proxyGenerate(req, res) {
  try {
    const body = req.body || {};
    const config = resolveConfig(req);
    const root = normalizeBaseUrl(config.baseUrl);
    if (!root) return res.status(400).json({ error: 'baseUrl is required' });
    if (!config.apiKey) return res.status(400).json({ error: 'api key is required' });
    if (!config.model) return res.status(400).json({ error: 'model is required' });
    const generationRequest = body.promptIsFinal ? null : await prepareGenerationRequest(root, config, body);
    const composerPrompt = generationRequest ? buildComposerPrompt(generationRequest) : String(body.prompt || '').trim();
    if (!composerPrompt) return res.status(400).json({ error: 'prompt is required' });
    const prompt = generationRequest
      ? await refineImagePrompt(root, config, composerPrompt, generationRequest)
      : composerPrompt;

    const payload = {
      model: config.model,
      prompt,
      n: Number(config.n || 1),
      size: config.size || '1024x1024',
    };

    if (config.responseFormat) payload.response_format = config.responseFormat;
    for (const key of ['quality', 'style', 'background', 'moderation', 'seed', 'aspect_ratio', 'negative_prompt']) {
      if (body.extra?.[key] !== undefined && body.extra?.[key] !== '') {
        payload[key] = body.extra[key];
      }
    }

    const upstream = await fetchWithTimeout(`${root}/v1/images/generations`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, Number(body.timeoutMs || DEFAULT_TIMEOUT_MS));

    const data = await readJsonOrText(upstream);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: extractErrorMessage(data),
        raw: data,
      });
    }

    res.json({
      ...normalizeImages(data, req),
      prompt,
      generationRequest,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

function resolveConfig(req = {}) {
  const body = req.body || {};
  return {
    ...DEFAULT_CONFIG,
    baseUrl: body.baseUrl || DEFAULT_CONFIG.baseUrl,
    promptBaseUrl: body.promptBaseUrl || DEFAULT_CONFIG.promptBaseUrl,
    apiKey: resolveApiKey(req, body),
    model: body.model || DEFAULT_CONFIG.model,
    size: body.size || DEFAULT_CONFIG.size,
    responseFormat: body.response_format || body.responseFormat || DEFAULT_CONFIG.responseFormat,
    refinePrompt: body.refinePrompt ?? DEFAULT_CONFIG.refinePrompt,
    promptModel: normalizePromptModel(body.promptModel || DEFAULT_CONFIG.promptModel),
    n: body.n || DEFAULT_CONFIG.n,
    contextDepth: body.contextDepth || DEFAULT_CONFIG.contextDepth,
    maxCharacterText: body.maxCharacterText || DEFAULT_CONFIG.maxCharacterText,
    maxContextText: body.maxContextText || DEFAULT_CONFIG.maxContextText,
  };
}

function resolveApiKey(req, body = {}) {
  if (body.apiKey) return body.apiKey;
  const secretKey = body.apiSecretKey || IMAGE_SECRET_KEY;
  const secretId = body.apiSecretId || null;
  if (req?.user?.directories && secretId) {
    const value = new SecretManager(req.user.directories).readSecret(secretKey, secretId);
    if (value) return value;
  }
  return DEFAULT_CONFIG.apiKey;
}

function normalizePromptModel(model) {
  return model || DEFAULT_CONFIG.promptModel;
}

async function refineImagePrompt(root, config, composerPrompt, generationRequest = null) {
  const fallbackPrompt = buildFallbackImagePrompt(generationRequest, composerPrompt);
  if (!config.refinePrompt) return fallbackPrompt;
  const promptRoot = normalizeBaseUrl(config.promptBaseUrl || root).replace(/\/v1$/, '');

  const candidateModels = unique([
    config.promptModel,
  ]);

  for (const model of candidateModels) {
    try {
    const upstream = await fetchWithTimeout(`${promptRoot}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: [
              'You convert roleplay chat context into a single high-quality image generation prompt.',
              'Return only the final image prompt.',
              'Use concrete visual details. Keep identity and continuity. Do not include analysis or markdown.',
            ].join(' '),
          },
          { role: 'user', content: composerPrompt },
        ],
      }),
    }, 60000);

    const data = await readJsonOrText(upstream);
    if (!upstream.ok) {
        console.warn(`[openai-image-proxy] prompt refinement failed with ${model}:`, extractErrorMessage(data));
        continue;
    }

    const refined = extractChatContent(data);
      if (refined) return refined;
  } catch (error) {
      console.warn(`[openai-image-proxy] prompt refinement failed with ${model}:`, error.message || String(error));
    }
  }

  console.warn('[openai-image-proxy] prompt refinement unavailable; using compact fallback prompt.');
  return fallbackPrompt;
}

function extractChatContent(data) {
  if (typeof data === 'string') return data.trim();
  return String(
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.content ||
    ''
  ).trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildFallbackImagePrompt(generationRequest, composerPrompt) {
  if (!generationRequest) return truncateText(composerPrompt, 1800);

  const trigger = generationRequest.trigger || {};
  const scene = generationRequest.cache?.scene || {};
  const characters = Object.values(generationRequest.cache?.characters || {});
  const card = generationRequest.raw?.characterCards?.[0] || {};
  const latestMessages = (generationRequest.raw?.recentMessages || [])
    .slice(-3)
    .map((message) => `${message.role || 'message'}: ${message.text || ''}`)
    .join(' ');
  const characterText = characters
    .map((character) => [
      character.name || card.name || 'Character',
      character.baseAppearance || card.description || '',
      character.currentOutfit ? `outfit: ${character.currentOutfit}` : '',
      character.currentState ? `state: ${character.currentState}` : '',
    ].filter(Boolean).join(', '))
    .join('; ');

  return [
    generationRequest.generation?.style || '',
    trigger.userIntent || 'Generate the current roleplay scene.',
    characterText ? `Character: ${characterText}.` : '',
    scene.summary ? `Scene: ${scene.summary}.` : '',
    scene.location ? `Location: ${scene.location}.` : '',
    scene.mood ? `Mood: ${scene.mood}.` : '',
    latestMessages ? `Latest context: ${latestMessages}.` : '',
    'Preserve character identity and scene continuity. No text, watermark, captions, UI, or speech bubbles.',
  ].filter(Boolean).join(' ');
}

async function prepareGenerationRequest(root, config, body) {
  const request = normalizeGenerationRequest(body, config);
  await hydrateCache(root, config, request);
  mergeCacheIntoRequest(request);
  return request;
}

function buildComposerPrompt(request) {
  return [
    'Generation Request JSON:',
    JSON.stringify(request, null, 2),
    '',
    GENERATION_REQUEST_SCHEMA_EXPLANATION,
  ].join('\n');
}

function normalizeGenerationRequest(body, config) {
  if (body.generationRequest && typeof body.generationRequest === 'object') {
    return normalizeModernGenerationRequest(body.generationRequest, config);
  }

  const context = body.contextPackage || {};
  const profile = context.visualProfile || {};
  const character = context.character || {};
  const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : [];
  const request = String(body.prompt || context.intent || '').trim() || 'Generate the current roleplay scene from context.';
  const now = new Date().toISOString();
  const activeCharacterId = character.id || character.avatar || character.name || 'active-character';

  return {
    schemaVersion: 1,
    trigger: {
      type: body.triggerType || context.triggerType || 'manual_menu',
      source: body.triggerSource || context.triggerSource || 'current_scene',
      userIntent: request,
      messageId: body.messageId ?? context.messageId ?? null,
      createdAt: now,
    },
    raw: {
      userId: context.userId || body.userId || 'default-user',
      chatId: context.chatId || body.chatId || 'current-chat',
      activeCharacterId,
      recentMessages: recentMessages
        .slice(-Number(config.contextDepth || 8))
        .map((message, index) => ({
          id: message.id ?? index,
          role: message.role || 'message',
          text: truncateText(message.text || '', 1200),
          createdAt: message.createdAt || '',
        }))
        .filter((message) => message.text),
      characterCards: [
        {
          id: activeCharacterId,
          name: character.name || 'Character',
          description: truncateText(character.description || '', Number(config.maxCharacterText || 1600)),
          personality: truncateText(character.personality || '', 800),
          scenario: truncateText(character.scenario || '', 800),
          creatorNotes: truncateText(character.creator_notes || character.creatorNotes || '', 800),
        },
      ],
    },
    cache: {
      scene: context.scene || emptySceneCache(),
      characters: {
        [activeCharacterId]: {
          name: character.name || 'Character',
          baseAppearance: truncateText(profile.base || '', Number(config.maxCharacterText || 1600)),
          currentOutfit: profile.outfit || '',
          currentState: profile.state || '',
          negative: profile.negative || 'text, watermark, blurry, bad anatomy',
          locked: Boolean(profile.locked),
          updatedAt: profile.updatedAt || '',
        },
      },
    },
    generation: {
      target: 'image_prompt',
      focus: body.triggerSource || context.triggerSource || 'current_scene',
      style: '',
      size: config.size,
      constraints: [
        'preserve character identity',
        'preserve scene continuity',
        'avoid text, watermark, captions, speech bubbles',
      ],
    },
    provider: {
      imageModel: config.model,
      promptModel: config.promptModel,
      size: config.size,
      responseFormat: config.responseFormat,
      refinePrompt: Boolean(config.refinePrompt),
    },
  };
}

function normalizeModernGenerationRequest(request, config) {
  const now = new Date().toISOString();
  const raw = request.raw || {};
  const activeCharacterId = raw.activeCharacterId || request.context?.activeCharacterId || 'active-character';
  return {
    schemaVersion: request.schemaVersion || 1,
    trigger: {
      type: request.trigger?.type || 'manual_menu',
      source: request.trigger?.source || 'current_scene',
      userIntent: request.trigger?.userIntent || 'Generate the current roleplay scene from context.',
      messageId: request.trigger?.messageId ?? null,
      createdAt: request.trigger?.createdAt || now,
    },
    raw: {
      userId: raw.userId || request.context?.userId || 'default-user',
      chatId: raw.chatId || request.context?.chatId || 'current-chat',
      activeCharacterId,
      recentMessages: Array.isArray(raw.recentMessages) ? raw.recentMessages : [],
      characterCards: Array.isArray(raw.characterCards) ? raw.characterCards : [],
    },
    cache: {
      scene: request.cache?.scene || emptySceneCache(),
      characters: request.cache?.characters || {},
    },
    generation: {
      target: request.generation?.target || 'image_prompt',
      focus: request.generation?.focus || request.trigger?.source || 'current_scene',
      style: request.generation?.style || '',
      size: request.generation?.size || config.size,
      constraints: Array.isArray(request.generation?.constraints) ? request.generation.constraints : [
        'preserve character identity',
        'preserve scene continuity',
        'avoid text, watermark, captions, speech bubbles',
      ],
    },
    provider: {
      imageModel: request.provider?.imageModel || config.model,
      promptModel: normalizePromptModel(request.provider?.promptModel || config.promptModel),
      size: request.provider?.size || config.size,
      responseFormat: request.provider?.responseFormat || config.responseFormat,
      refinePrompt: request.provider?.refinePrompt ?? Boolean(config.refinePrompt),
    },
  };
}

async function hydrateCache(root, config, request) {
  const userId = request.raw.userId || 'default-user';
  const chatId = request.raw.chatId || 'current-chat';
  const chatCache = ensureChatCache(userId, chatId);
  const characterCards = Array.isArray(request.raw.characterCards) ? request.raw.characterCards : [];
  const now = new Date().toISOString();

  if (request.cache?.scene?.summary) {
    chatCache.scene = {
      ...emptySceneCache(),
      ...chatCache.scene,
      ...request.cache.scene,
    };
  }

  for (const [id, cachedCharacter] of Object.entries(request.cache?.characters || {})) {
    if (!cachedCharacter?.baseAppearance) continue;
    chatCache.characters[id] = {
      ...emptyCharacterCache({ name: cachedCharacter.name }),
      ...chatCache.characters[id],
      ...cachedCharacter,
    };
  }

  if (!chatCache.scene?.summary && request.raw.recentMessages?.length) {
    chatCache.scene = {
      ...emptySceneCache(),
      ...await summarizeScene(root, config, request),
      updatedAt: now,
    };
  }

  for (const card of characterCards) {
    const id = card.id || card.name || 'active-character';
    if (chatCache.characters[id]?.baseAppearance) continue;
    chatCache.characters[id] = {
      ...emptyCharacterCache(card),
      ...await summarizeCharacter(root, config, card),
      updatedAt: now,
    };
  }
}

function mergeCacheIntoRequest(request) {
  const chatCache = ensureChatCache(request.raw.userId || 'default-user', request.raw.chatId || 'current-chat');
  request.cache = {
    scene: {
      ...emptySceneCache(),
      ...chatCache.scene,
      ...request.cache?.scene,
    },
    characters: {
      ...chatCache.characters,
      ...request.cache?.characters,
    },
  };
}

function ensureChatCache(userId, chatId) {
  if (!runtimeCache.users[userId]) {
    runtimeCache.users[userId] = { chats: {} };
  }
  if (!runtimeCache.users[userId].chats[chatId]) {
    runtimeCache.users[userId].chats[chatId] = {
      scene: emptySceneCache(),
      characters: {},
    };
  }
  return runtimeCache.users[userId].chats[chatId];
}

function emptySceneCache() {
  return {
    sceneId: 'current',
    location: '',
    timeOfDay: '',
    weather: '',
    mood: '',
    props: [],
    camera: '',
    summary: '',
    updatedAt: '',
  };
}

function emptyCharacterCache(card = {}) {
  return {
    name: card.name || '',
    baseAppearance: '',
    currentOutfit: '',
    currentState: '',
    negative: 'text, watermark, blurry, bad anatomy',
    locked: false,
    updatedAt: '',
  };
}

async function summarizeScene(root, config, request) {
  const messages = (request.raw.recentMessages || [])
    .map((message) => `${message.role || 'message'}: ${message.text || ''}`)
    .join('\n');
  const prompt = [
    'Summarize the current visual scene for an image generation cache.',
    'Return only JSON with keys: location, timeOfDay, weather, mood, props, camera, summary.',
    'Use empty strings or empty arrays when unknown.',
    '',
    messages,
  ].join('\n');
  return await chatJson(root, config, prompt, emptySceneCache());
}

async function summarizeCharacter(root, config, card) {
  const prompt = [
    'Summarize this roleplay character card into stable visual appearance cache.',
    'Return only JSON with keys: name, baseAppearance, currentOutfit, currentState, negative, locked.',
    'Describe visible traits, body, hair, eyes, clothing defaults, notable accessories, and avoid personality-only details unless visually relevant.',
    '',
    JSON.stringify(card, null, 2),
  ].join('\n');
  return await chatJson(root, config, prompt, emptyCharacterCache(card));
}

async function chatJson(root, config, prompt, fallback) {
  try {
    const promptRoot = normalizeBaseUrl(config.promptBaseUrl || root).replace(/\/v1$/, '');
    const upstream = await fetchWithTimeout(`${promptRoot}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.promptModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Return strict JSON only. No markdown. No explanation.' },
          { role: 'user', content: prompt },
        ],
      }),
    }, 60000);
    const data = await readJsonOrText(upstream);
    if (!upstream.ok) return fallback;
    return parseJsonLoose(extractChatContent(data), fallback);
  } catch {
    return fallback;
  }
}

function parseJsonLoose(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

async function proxyFile(req, res) {
  try {
    const encoded = req.query.url;
    if (!encoded) return res.status(400).send('Missing url');
    const url = Buffer.from(String(encoded), 'base64url').toString('utf8');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid url');

    const upstream = await fetchWithTimeout(url, { method: 'GET' }, DEFAULT_TIMEOUT_MS);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

async function readJsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeModels(data) {
  let models = [];
  if (Array.isArray(data)) {
    models = data;
  } else if (Array.isArray(data?.data)) {
    models = data.data;
  } else if (Array.isArray(data?.models)) {
    models = data.models;
  }

  return {
    models: models
      .map((item) => typeof item === 'string' ? item : item?.id || item?.name || item?.model)
      .filter(Boolean),
    raw: data,
  };
}

function normalizeImages(data, req) {
  const items = [];
  const candidates = [];

  if (Array.isArray(data?.data)) candidates.push(...data.data);
  if (Array.isArray(data?.images)) candidates.push(...data.images);
  if (data?.url || data?.image_url || data?.b64_json) candidates.push(data);

  for (const item of candidates) {
    const b64 = item?.b64_json || item?.base64 || item?.image_base64;
    let url = item?.url || item?.image_url;
    if (url) url = proxifyUrl(url, req);
    if (url || b64) items.push({ url, b64_json: b64 || null });
  }

  return {
    images: items,
    raw: data,
  };
}

function proxifyUrl(url, req) {
  if (!/^https?:\/\//i.test(url)) return url;
  const encoded = Buffer.from(url, 'utf8').toString('base64url');
  return `${sameOrigin(req)}/api/plugins/openai-image-proxy/file?url=${encoded}`;
}

function extractErrorMessage(data) {
  if (typeof data === 'string') return data;
  return data?.error?.message || data?.message || JSON.stringify(data);
}
