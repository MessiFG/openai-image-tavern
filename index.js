import { extension_settings, getContext } from '/scripts/extensions.js';
import { getRequestHeaders, saveSettingsDebounced, eventSource, event_types, characters, this_chid, chat, updateMessageBlock, getCurrentChatId, name1, user_avatar, generateQuietPrompt } from '/script.js';
import { getCurrentUserHandle } from '/scripts/user.js';
import { writeSecret } from '/scripts/secrets.js';
import { power_user } from '/scripts/power-user.js';
import {
  BROWSER_SECRET_KEY,
  CACHE_KEY,
  DEBUG_LOG_KEY,
  DEFAULT_SETTINGS,
  EXTENSION_NAME,
  IMAGE_SECRET_KEY,
  PROMPT_BROWSER_SECRET_KEY,
  PROMPT_SECRET_KEY,
  PROXY_BASE,
} from './modules/constants.js';
import {
  directJson,
  escapeHtml,
  extractChatCompletionContent,
  hashText,
  normalizeBaseUrl,
  parseJsonObject,
  stringifyChatCompletionContent,
  stripHtml,
  truncateText,
} from './modules/utils.js';
import {
  CACHE_PLACEHOLDER_VALUES,
  asStringArray,
  cacheString,
  isPlainObject,
  meaningfulString,
} from './modules/cache-utils.js';

let proxyAvailableCache = null;
let activeMemoryTableKey = 'registry';
let autoTriggerRunning = false;

function settings() {
  if (!extension_settings[EXTENSION_NAME]) {
    extension_settings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
  } else {
    extension_settings[EXTENSION_NAME] = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...extension_settings[EXTENSION_NAME],
      visualProfiles: extension_settings[EXTENSION_NAME].visualProfiles || {},
    };
    if (!String(extension_settings[EXTENSION_NAME].stylePreset || '').trim()) {
      extension_settings[EXTENSION_NAME].stylePreset = DEFAULT_SETTINGS.stylePreset;
    }
  }
  if (Object.prototype.hasOwnProperty.call(extension_settings[EXTENSION_NAME], 'apiKey')) {
    delete extension_settings[EXTENSION_NAME].apiKey;
    saveSettings();
  }
  return extension_settings[EXTENSION_NAME];
}

function saveSettings() {
  saveSettingsDebounced();
}

function headers() {
  return {
    ...getRequestHeaders(),
    'Content-Type': 'application/json',
  };
}

async function proxyPost(path, body) {
  const response = await fetch(`${PROXY_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data?.error?.message || data?.error || text || `HTTP ${response.status}`);
  return data;
}

async function isProxyAvailable(force = false) {
  if (!force && proxyAvailableCache !== null) return proxyAvailableCache;
  try {
    const response = await fetch(`${PROXY_BASE}/health`, {
      method: 'GET',
      headers: getRequestHeaders({ omitContentType: true }),
    });
    proxyAvailableCache = response.ok;
  } catch {
    proxyAvailableCache = false;
  }
  return proxyAvailableCache;
}

function currentCharacterKey() {
  const character = characters?.[this_chid];
  return character?.avatar || character?.name || 'global';
}

function currentCharacterName() {
  return characters?.[this_chid]?.name || 'Character';
}

function currentUserPersonaKey() {
  return `user:${user_avatar || normalizeCharacterId(currentUserPersonaName(), 'user')}`;
}

function currentUserPersonaName() {
  return name1 || 'User';
}

function currentUserPersonaText() {
  const avatarDescription = user_avatar
    ? power_user?.persona_descriptions?.[user_avatar]?.description
    : '';
  return String(avatarDescription || power_user?.persona_description || '').trim();
}

function getUserPersonaPackage() {
  return {
    id: currentUserPersonaKey(),
    name: currentUserPersonaName(),
    avatar: user_avatar || '',
    description: currentUserPersonaText(),
  };
}

function currentChatId() {
  const context = getContext();
  const chatFile = typeof getCurrentChatId === 'function' ? getCurrentChatId() : '';
  const firstMessage = chat?.find((message) => message?.send_date || message?.mes);
  const fallbackFingerprint = [
    currentCharacterKey(),
    firstMessage?.send_date || '',
    stripHtml(firstMessage?.mes || '').slice(0, 80),
  ].filter(Boolean).join(':');
  return [
    currentCharacterKey(),
    context?.chatId || chatFile || characters?.[this_chid]?.chat || fallbackFingerprint || 'current-chat',
  ].filter(Boolean).join('::');
}

function currentUserId() {
  try {
    return getCurrentUserHandle() || 'default-user';
  } catch {
    return 'default-user';
  }
}

function currentChatCompletionModel() {
  const context = getContext();
  try {
    const model = typeof context?.getChatCompletionModel === 'function'
      ? context.getChatCompletionModel()
      : '';
    return normalizePromptModel(model);
  } catch {
    return normalizePromptModel(settings().promptModel);
  }
}

function currentChatCompletionBaseUrl() {
  const context = getContext();
  const chatSettings = context?.chatCompletionSettings || {};
  const source = chatSettings.chat_completion_source || '';

  if (chatSettings.reverse_proxy) return chatSettings.reverse_proxy;
  if (source === 'custom' && chatSettings.custom_url) return chatSettings.custom_url;
  if (chatSettings.custom_url) return chatSettings.custom_url;

  return settings().promptBaseUrl || '';
}

function buildQuietPromptFromPayload(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const transcript = messages
    .map(message => {
      const role = String(message?.role || 'user').toUpperCase();
      const content = stringifyChatCompletionContent(message?.content);
      return content ? `[${role}]\n${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return [
    'Follow the structured task below. Return only the requested final answer, with no markdown fence and no commentary.',
    payload?.response_format?.type === 'json_object' ? 'The final answer must be a valid JSON object.' : '',
    transcript,
  ].filter(Boolean).join('\n\n');
}

function currentCharacterText() {
  const character = characters?.[this_chid];
  if (!character) return '';
  return [
    character.name ? `Name: ${character.name}` : '',
    character.description ? `Description: ${character.description}` : '',
    character.personality ? `Personality: ${character.personality}` : '',
    character.scenario ? `Scenario: ${character.scenario}` : '',
    character.creator_notes ? `Creator notes: ${character.creator_notes}` : '',
    character.extensions?.chub?.full_path ? `Source: ${character.extensions.chub.full_path}` : '',
  ].filter(Boolean).join('\n\n');
}

function getVisualProfile() {
  const s = settings();
  const key = currentCharacterKey();
  if (!s.visualProfiles[key]) {
    s.visualProfiles[key] = {
      locked: false,
      base: '',
      state: '',
      negative: 'text, watermark, blurry, bad anatomy',
    };
  }
  return s.visualProfiles[key];
}

function getRecentContext(depth = 8) {
  return (chat || [])
    .slice(-depth)
    .filter((message) => !message?.extra?.openaiImageTavern)
    .map((message) => `${message.is_user ? 'User' : currentCharacterName()}: ${stripHtml(message.mes || '')}`)
    .join('\n');
}

function getRecentMessages(depth = 8) {
  return (chat || [])
    .slice(-depth)
    .filter((message) => !message?.extra?.openaiImageTavern)
    .map((message, index) => ({
      id: message.id ?? index,
      role: message.is_user ? 'User' : currentCharacterName(),
      text: stripHtml(message.mes || ''),
      createdAt: message.send_date || '',
    }))
    .filter((message) => message.text);
}

function getCharacterPackage() {
  const character = characters?.[this_chid] || {};
  return {
    id: currentCharacterKey(),
    name: character.name || '',
    description: character.description || '',
    personality: character.personality || '',
    scenario: character.scenario || '',
    creator_notes: character.creator_notes || '',
  };
}

function loadBrowserCache() {
  try {
    return JSON.parse(localStorage.getItem(userCacheKey()) || '') || { version: 1, users: {} };
  } catch {
    return { version: 1, users: {} };
  }
}

function saveBrowserCache(cache) {
  localStorage.setItem(userCacheKey(), JSON.stringify(cache));
}

function userCacheKey() {
  return `${CACHE_KEY}:${currentUserId()}`;
}

function browserApiKeyKey() {
  return `${BROWSER_SECRET_KEY}:${currentUserId()}`;
}

function promptBrowserApiKeyKey() {
  return `${PROMPT_BROWSER_SECRET_KEY}:${currentUserId()}`;
}

function debugLogKey() {
  return `${DEBUG_LOG_KEY}:${currentUserId()}`;
}

function loadDebugLogs() {
  try {
    const logs = JSON.parse(localStorage.getItem(debugLogKey()) || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function saveDebugLogs(logs) {
  localStorage.setItem(debugLogKey(), JSON.stringify(logs.slice(0, 20)));
}

function appendDebugLog(type, payload) {
  const logs = loadDebugLogs();
  logs.unshift({
    type,
    at: new Date().toISOString(),
    chatId: currentChatId(),
    character: currentCharacterName(),
    payload,
  });
  saveDebugLogs(logs);
}

function clearDebugLogs() {
  localStorage.removeItem(debugLogKey());
}

function debugLogsText() {
  const logs = loadDebugLogs();
  if (!logs.length) return '暂无日志。触发一次生图后，这里会显示提示词 JSON、模型原始返回和解析结果。';
  return JSON.stringify(logs, null, 2);
}

function getBrowserApiKey() {
  return localStorage.getItem(browserApiKeyKey()) || '';
}

function saveBrowserApiKey(value) {
  localStorage.setItem(browserApiKeyKey(), value);
}

function clearBrowserApiKey() {
  localStorage.removeItem(browserApiKeyKey());
}

function getPromptBrowserApiKey() {
  return localStorage.getItem(promptBrowserApiKeyKey()) || '';
}

function savePromptBrowserApiKey(value) {
  localStorage.setItem(promptBrowserApiKeyKey(), value);
}

function clearPromptBrowserApiKey() {
  localStorage.removeItem(promptBrowserApiKeyKey());
}

function getChatCache() {
  const cache = loadBrowserCache();
  const userId = currentUserId();
  const chatId = currentChatId();
  if (!cache.users) cache.users = {};
  if (!cache.users[userId]) cache.users[userId] = { chats: {} };
  if (!cache.users[userId].chats[chatId]) {
    cache.users[userId].chats[chatId] = {
      scene: emptySceneCache(),
      characterRegistry: {},
      characters: {},
      lastImage: emptyLastImageCache(),
      autoTrigger: emptyAutoTriggerCache(),
    };
  }
  if (!cache.users[userId].chats[chatId].scene) cache.users[userId].chats[chatId].scene = emptySceneCache();
  if (!cache.users[userId].chats[chatId].characterRegistry) cache.users[userId].chats[chatId].characterRegistry = {};
  if (!cache.users[userId].chats[chatId].characters) cache.users[userId].chats[chatId].characters = {};
  if (!cache.users[userId].chats[chatId].lastImage) cache.users[userId].chats[chatId].lastImage = emptyLastImageCache();
  if (!cache.users[userId].chats[chatId].imageTracks) cache.users[userId].chats[chatId].imageTracks = {};
  if (!cache.users[userId].chats[chatId].autoTrigger) cache.users[userId].chats[chatId].autoTrigger = emptyAutoTriggerCache();
  return { cache, userId, chatId, chatCache: cache.users[userId].chats[chatId] };
}

function imageTrackKey(triggerSource = 'current_scene', triggerType = '') {
  if (triggerSource === 'last_reply') return 'lastReply';
  if (triggerSource === 'user_intent') return 'manualIntent';
  if (String(triggerType || '').startsWith('auto')) return 'autoContext';
  return 'currentContext';
}

function getTrackLastImage(chatCache, trackKey) {
  const trackLastImage = chatCache.imageTracks?.[trackKey]?.lastImage;
  if (trackLastImage?.summary || trackLastImage?.prompt) return trackLastImage;
  if (trackKey === 'currentContext' && (chatCache.lastImage?.summary || chatCache.lastImage?.prompt)) return chatCache.lastImage;
  return emptyLastImageCache();
}

function saveReturnedCache(generationRequest, images = []) {
  if (!generationRequest?.cache) return;
  const { cache, userId, chatId, chatCache } = getChatCache();
  const trackKey = generationRequest.generation?.imageTrack || imageTrackKey(generationRequest.trigger?.source, generationRequest.trigger?.type);
  chatCache.scene = mergeSceneCache(chatCache.scene, generationRequest.cache.scene, generationRequest.cache.lastImage?.summary || generationRequest.cache.lastImage?.prompt || '');
  chatCache.characterRegistry = mergeCharacterRegistryCache(chatCache.characterRegistry, generationRequest.cache.characterRegistry);
  chatCache.characters = mergeCharactersCache(chatCache.characters, generationRequest.cache.characters, generationRequest.cache.lastImage?.summary || generationRequest.cache.lastImage?.prompt || '');
  if (generationRequest.cache.lastImage) {
    if (!chatCache.imageTracks) chatCache.imageTracks = {};
    if (!chatCache.imageTracks[trackKey]) chatCache.imageTracks[trackKey] = {};
    chatCache.imageTracks[trackKey].lastImage = {
      ...emptyLastImageCache(),
      ...chatCache.imageTracks[trackKey].lastImage,
      ...generationRequest.cache.lastImage,
      imageCount: images.length,
      updatedAt: new Date().toISOString(),
    };
    if (trackKey === 'currentContext') chatCache.lastImage = chatCache.imageTracks[trackKey].lastImage;
  }
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
}

function resetChatCache() {
  return {
    scene: emptySceneCache(),
    characterRegistry: {},
    characters: {},
    lastImage: emptyLastImageCache(),
    imageTracks: {},
    autoTrigger: emptyAutoTriggerCache(),
  };
}

function clearCurrentChatCache() {
  const { cache, userId, chatId } = getChatCache();
  cache.users[userId].chats[chatId] = resetChatCache();
  saveBrowserCache(cache);
}

function clearCurrentCharacterVisualCache() {
  const s = settings();
  const characterKey = currentCharacterKey();
  delete s.visualProfiles[characterKey];
  const { cache, userId, chatId, chatCache } = getChatCache();
  delete chatCache.characterRegistry?.[characterKey];
  delete chatCache.characters[characterKey];
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
  saveSettings();
}

function normalizeCharacterId(value, fallbackPrefix = 'npc') {
  const raw = String(value || '').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `${fallbackPrefix}:${Date.now()}`;
}

function cardCharacterId(name) {
  const mainKey = currentCharacterKey();
  const normalizedName = normalizeCharacterId(name, 'npc');
  if (name && String(name).trim() === currentCharacterName()) return mainKey;
  return normalizeCharacterId(`${mainKey}:${normalizedName}`, 'npc');
}

function buildMainCharacterRegistryEntry() {
  const profile = getVisualProfile();
  const character = getCharacterPackage();
  const characterKey = currentCharacterKey();
  const legacyBase = !looksLikeUnprocessedSource(profile.base, currentCharacterText()) ? profile.base : '';
  return {
    id: characterKey,
    name: character.name || currentCharacterName(),
    aliases: [],
    source: 'sillytavern_card',
    baseAppearance: legacyBase || '',
    negative: profile.negative || 'text, watermark, blurry, bad anatomy',
    locked: true,
    updatedAt: new Date().toISOString(),
  };
}

function ensureMainCharacterRegistry(chatCache) {
  const characterKey = currentCharacterKey();
  if (!chatCache.characterRegistry) chatCache.characterRegistry = {};
  const mainEntry = buildMainCharacterRegistryEntry();
  const existing = chatCache.characterRegistry[characterKey] || {};
  chatCache.characterRegistry[characterKey] = {
    ...mainEntry,
    ...existing,
    id: characterKey,
    name: existing.name || mainEntry.name,
    source: existing.source || 'sillytavern_card',
    locked: true,
    baseAppearance: existing.baseAppearance || mainEntry.baseAppearance,
    negative: existing.negative || mainEntry.negative,
  };
  return chatCache.characterRegistry;
}

function ensureUserPersonaRegistry(chatCache) {
  if (!chatCache.characterRegistry) chatCache.characterRegistry = {};
  const userKey = currentUserPersonaKey();
  const userPersona = getUserPersonaPackage();
  const existing = chatCache.characterRegistry[userKey] || {};
  chatCache.characterRegistry[userKey] = {
    id: userKey,
    name: existing.name || userPersona.name,
    aliases: Array.isArray(existing.aliases) ? existing.aliases : ['我', '自己', '用户'],
    source: existing.source || 'sillytavern_persona',
    baseAppearance: existing.baseAppearance || '',
    negative: existing.negative || '',
    locked: Boolean(existing.locked),
    updatedAt: existing.updatedAt || new Date().toISOString(),
  };
  return chatCache.characterRegistry;
}

function ensureCoreCharacterMemory(chatCache) {
  ensureMainCharacterRegistry(chatCache);
  ensureUserPersonaRegistry(chatCache);
  return chatCache.characterRegistry;
}

function needsMainCharacterAppearanceExtraction(chatCache) {
  const s = settings();
  if (!s.useCharacterCard) return false;
  const sourceText = currentCharacterText();
  if (!sourceText) return false;
  const characterKey = currentCharacterKey();
  const registryEntry = chatCache.characterRegistry?.[characterKey];
  const profile = getVisualProfile();
  const baseAppearance = String(registryEntry?.baseAppearance || profile.base || '').trim();
  const extraction = chatCache.cardExtraction || {};
  return !baseAppearance
    || registryEntry?.source !== 'sillytavern_card_ai'
    || looksLikeUnprocessedSource(baseAppearance, sourceText)
    || extraction.version !== 3
    || extraction.characterKey !== characterKey
    || extraction.sourceHash !== hashText(sourceText);
}

function needsUserPersonaAppearanceExtraction(chatCache) {
  const personaText = currentUserPersonaText();
  if (!personaText) return false;
  const userKey = currentUserPersonaKey();
  const registryEntry = chatCache.characterRegistry?.[userKey];
  const baseAppearance = String(registryEntry?.baseAppearance || '').trim();
  return !baseAppearance
    || registryEntry?.source !== 'sillytavern_persona_ai'
    || looksLikeUnprocessedSource(baseAppearance, personaText);
}

function looksLikeUnprocessedSource(baseAppearance, sourceText) {
  const base = String(baseAppearance || '').trim();
  const source = String(sourceText || '').trim();
  if (!base || !source) return false;
  if (base.length > 900) return true;
  if (source.includes(base) && base.length > 240) return true;
  if (base.includes('Description:') || base.includes('Personality:') || base.includes('Scenario:') || base.includes('Creator notes:')) return true;
  return false;
}

function buildCharacterAppearanceMessages(character, options = {}) {
  const isUserPersona = options.source === 'persona';
  return [
    {
      role: 'system',
      content: [
        'You extract stable visual identity for an image generation memory table.',
        'Return strict JSON only. No markdown.',
        isUserPersona
          ? 'The source is a SillyTavern user persona. Extract only the user persona visual identity.'
          : 'The SillyTavern card may mention multiple characters. Extract every distinct character with stable visual information, not only the selected main character.',
        isUserPersona
          ? 'Use the selected persona name/id to disambiguate the user character.'
          : 'The selected character is the primary character, but secondary characters from the same card must also be returned as separate rows.',
        'A character is a named or clearly identifiable person/entity. Extract all such characters even when their stable visual appearance is incomplete.',
        'Do not create a character row for places, factions, abstract roles, or scene concepts.',
        'Write stable physical appearance only: body type, hair, eyes, face, age impression, species traits, signature clothing if stable.',
        'All user-visible memory fields must be written in Simplified Chinese: name aliases may preserve proper nouns, but baseAppearance and reason must be Chinese. Keep technical negative prompt terms in English.',
        'Do not include current pose, location, camera position, temporary action, dialogue, personality, relationship, or scene plot.',
        'Do not copy the source text verbatim. Summarize visual traits into a compact image-generation description.',
        'If a character appearance is not clearly defined, still return the character row with an empty baseAppearance and a short alias/name list. Do not copy unrelated text.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${JSON.stringify({
        selectedCharacter: {
          id: character.id || currentCharacterKey(),
          name: character.name || currentCharacterName(),
        },
        sourceType: isUserPersona ? 'user_persona' : 'character_card',
        source: character,
      }, null, 2)}\n\n${isUserPersona
        ? 'Return JSON with this shape:\n{\n  "name": "",\n  "aliases": [],\n  "baseAppearance": "中文稳定外貌描述",\n  "negative": "text, watermark, blurry, bad anatomy",\n  "reason": "中文依据"\n}'
        : 'Return JSON with this shape:\n{\n  "characters": [\n    {\n      "name": "character name or Chinese display name",\n      "aliases": ["中文别名或原名"],\n      "baseAppearance": "中文稳定外貌描述",\n      "negative": "text, watermark, blurry, bad anatomy",\n      "isPrimary": false,\n      "reason": "中文依据"\n    }\n  ],\n  "reason": "中文说明"\n}'}`,
    },
  ];
}

function normalizeCharacterAppearancePlan(plan, character, options = {}) {
  if (!plan || typeof plan !== 'object') return null;
  const baseAppearance = cacheString(plan.baseAppearance, 1200);
  if (!baseAppearance) return null;
  return {
    id: character.id || currentCharacterKey(),
    name: cacheString(plan.name, 80) || character.name || currentCharacterName(),
    aliases: asStringArray(plan.aliases, 16, 80),
    source: options.source === 'persona' ? 'sillytavern_persona_ai' : 'sillytavern_card_ai',
    baseAppearance,
    negative: cacheString(plan.negative, 500) || 'text, watermark, blurry, bad anatomy',
    locked: options.source !== 'persona',
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCharacterAppearanceList(plan, character) {
  if (!plan || typeof plan !== 'object') return [];
  const rawCharacters = Array.isArray(plan.characters) ? plan.characters : [plan];
  const seen = new Set();
  return rawCharacters
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = cacheString(entry.name, 80);
      const baseAppearance = cacheString(entry.baseAppearance, 1200);
      if (!name) return null;
      const isPrimary = Boolean(entry.isPrimary) || name === (character.name || currentCharacterName());
      const id = isPrimary ? (character.id || currentCharacterKey()) : cardCharacterId(name);
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name,
        aliases: asStringArray(entry.aliases, 16, 80),
        source: 'sillytavern_card_ai',
        baseAppearance,
        negative: cacheString(entry.negative, 500) || 'text, watermark, blurry, bad anatomy',
        locked: isPrimary,
        updatedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function stripMarkdownValue(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s*/, '')
    .trim();
}

function compactAppearanceText(value) {
  return String(value || '')
    .split('\n')
    .map(line => stripMarkdownValue(line).replace(/^\w[\w\s/&-]*:\s*/i, '').trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .slice(0, 1200);
}

function extractSection(text, headingPattern) {
  const match = String(text || '').match(headingPattern);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = String(text || '').slice(start);
  const endMatch = rest.match(/\n\s*#{2,3}\s+/);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

function localCharacterFromBlock(block, fallbackName = '') {
  const fullName = block.match(/\*\*\s*Full Name\s*:\s*\*\*\s*([^\r\n]+)/i)?.[1]
    || block.match(/Full Name\s*:\s*([^\r\n]+)/i)?.[1]
    || block.match(/^##\s+([^\r\n#]+)/m)?.[1]
    || fallbackName;
  const name = stripMarkdownValue(fullName).replace(/[“”"]/g, '').trim();
  if (!name || /\{\{char\}\}/i.test(name)) return null;
  const appearance = extractSection(block, /\n\s*##\s+Appearance\s*/i)
    || extractSection(block, /\n\s*###\s+Appearance\s*/i)
    || block.match(/\*\*\s*Appearance\s*:\s*\*\*\s*([^\r\n]+)/i)?.[1]
    || block.match(/Appearance\s*:\s*([^\r\n]+)/i)?.[1]
    || '';
  const baseAppearance = compactAppearanceText(appearance);
  return {
    id: name === currentCharacterName() ? currentCharacterKey() : cardCharacterId(name),
    name,
    aliases: [],
    source: 'sillytavern_card_local',
    baseAppearance,
    negative: 'text, watermark, blurry, bad anatomy',
    locked: name === currentCharacterName(),
    updatedAt: new Date().toISOString(),
  };
}

function extractLocalCharacterAppearances(character) {
  const description = String(character?.description || '');
  if (!description.trim()) return [];
  const blocks = description
    .split(/\n\s*---+\s*\n/)
    .map(block => block.trim())
    .filter(Boolean);
  const candidates = [];
  blocks.forEach((block) => {
    const entry = localCharacterFromBlock(block);
    if (entry) candidates.push(entry);
  });

  const extraSection = description.split(/##\s+EXTRA CHARACTERS/i)[1] || '';
  const extraBlocks = extraSection
    .split(/\n\s*##\s+/)
    .map(block => block.trim())
    .filter(Boolean);
  extraBlocks.forEach((block) => {
    const title = block.split(/\r?\n/)[0] || '';
    const entry = localCharacterFromBlock(`## ${block}`, title);
    if (entry) candidates.push(entry);
  });

  const seen = new Set();
  return candidates.filter((entry) => {
    if (!entry.name || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

async function requestCharacterAppearance(character, options = {}) {
  const s = settings();
  const model = normalizePromptModel(currentChatCompletionModel() || s.promptModel || s.model);
  if (!model) return null;

  const payload = {
    model,
    messages: buildCharacterAppearanceMessages(character, options),
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };
  const transport = promptTransportLabel();
  appendDebugLog('角色卡外貌识别请求', {
    source: options.source || 'character_card',
    model,
    transport,
    payload,
  });

  try {
    const data = await promptChatCompletion(payload, 60000);
    const content = extractChatCompletionContent(data);
    const parsed = parseJsonObject(content);
    const normalized = options.source === 'character_card'
      ? normalizeCharacterAppearanceList(parsed, character)
      : normalizeCharacterAppearancePlan(parsed, character, options);
    appendDebugLog('角色卡外貌识别返回', {
      source: options.source || 'character_card',
      model,
      transport,
      rawContent: content,
      parsed,
      normalized,
    });
    return normalized;
  } catch (error) {
    console.warn('[openai-image-tavern] character appearance extraction skipped:', error);
    appendDebugLog('角色卡外貌识别失败', {
      source: options.source || 'character_card',
      model,
      transport,
      message: error.message,
    });
    return null;
  }
}

async function requestMainCharacterAppearance(character) {
  const extracted = await requestCharacterAppearance(character, { source: 'character_card' });
  if (Array.isArray(extracted) && extracted.length) return extracted;
  const local = extractLocalCharacterAppearances(character);
  if (local.length) {
    appendDebugLog('角色卡本地解析返回', {
      normalized: local,
      reason: '补全 API 未返回可用角色时，从角色卡 Markdown 结构兜底解析',
    });
  }
  return local;
}

async function requestUserPersonaAppearance(persona) {
  return requestCharacterAppearance(persona, { source: 'persona' });
}

async function ensureMainCharacterAppearanceFromCard() {
  const { cache, userId, chatId, chatCache } = getChatCache();
  ensureCoreCharacterMemory(chatCache);

  if (needsMainCharacterAppearanceExtraction(chatCache)) {
    const character = getCharacterPackage();
    const extractedCharacters = await requestMainCharacterAppearance(character);
    if (Array.isArray(extractedCharacters) && extractedCharacters.length) {
      const characterKey = currentCharacterKey();
      extractedCharacters.forEach((extracted) => {
        const id = extracted.id || cardCharacterId(extracted.name);
        const existing = chatCache.characterRegistry[id] || {};
        chatCache.characterRegistry[id] = {
          ...(id === characterKey ? buildMainCharacterRegistryEntry() : {}),
          ...existing,
          ...extracted,
          id,
          source: 'sillytavern_card_ai',
          locked: id === characterKey ? true : Boolean(existing.locked || extracted.locked),
        };
      });
      chatCache.cardExtraction = {
        version: 3,
        characterKey,
        sourceHash: hashText(currentCharacterText()),
        extractedCount: extractedCharacters.length,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  if (needsUserPersonaAppearanceExtraction(chatCache)) {
    const persona = getUserPersonaPackage();
    const extracted = await requestUserPersonaAppearance(persona);
    if (extracted) {
      const userKey = currentUserPersonaKey();
      chatCache.characterRegistry[userKey] = {
        ...(chatCache.characterRegistry[userKey] || {}),
        ...extracted,
        id: userKey,
        source: 'sillytavern_persona_ai',
        locked: Boolean(chatCache.characterRegistry[userKey]?.locked),
      };
    }
  }

  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
}

function saveCurrentCharacterRegistry(registry) {
  const { cache, userId, chatId, chatCache } = getChatCache();
  chatCache.characterRegistry = registry;
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
}

function saveCurrentCharactersState(charactersState) {
  const { cache, userId, chatId, chatCache } = getChatCache();
  chatCache.characters = charactersState;
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
}

function saveCurrentScene(scene) {
  const { cache, userId, chatId, chatCache } = getChatCache();
  chatCache.scene = {
    ...emptySceneCache(),
    ...scene,
    sceneId: scene.sceneId || 'current',
    updatedAt: new Date().toISOString(),
  };
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
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

function emptyLastImageCache() {
  return {
    prompt: '',
    summary: '',
    continuityTags: [],
    anchors: {
      identity: '',
      outfit: '',
      scene: '',
      camera: '',
      mood: '',
      style: '',
    },
    characters: [],
    sceneId: '',
    transitionFromPrevious: false,
    updatedAt: '',
  };
}

function emptyAutoTriggerCache() {
  return {
    repliesSinceLastImage: 0,
    lastMessageId: null,
    lastTriggeredAt: '',
  };
}

function buildGenerationRequest(userPrompt, options = {}) {
  const s = settings();
  const { userId, chatId, chatCache } = getChatCache();
  const triggerType = options.triggerType || 'manual_menu';
  const triggerSource = options.triggerSource || 'current_scene';
  const trackKey = imageTrackKey(triggerSource, triggerType);
  const character = getCharacterPackage();
  const userPersona = getUserPersonaPackage();
  const activeCharacterId = character.id || currentCharacterKey();
  const visualProfile = getVisualProfile();
  const promptModel = currentChatCompletionModel();
  const characterRegistry = ensureCoreCharacterMemory(chatCache);
  const charactersCache = { ...(chatCache.characters || {}) };
  Object.entries(characterRegistry).forEach(([id, entry]) => {
    if (!charactersCache[id]) {
      charactersCache[id] = {
        name: entry.name || id,
        baseAppearance: entry.baseAppearance || '',
        currentOutfit: '',
        currentState: id === userPersona.id ? 'present in the current chat as the user persona' : '',
        negative: entry.negative || '',
        locked: Boolean(entry.locked),
        updatedAt: entry.updatedAt || new Date().toISOString(),
      };
    }
  });
  if (visualProfile.base && !looksLikeUnprocessedSource(visualProfile.base, currentCharacterText()) && !charactersCache[activeCharacterId]?.baseAppearance) {
    charactersCache[activeCharacterId] = {
      name: character.name || currentCharacterName(),
      baseAppearance: visualProfile.base,
      currentOutfit: visualProfile.outfit || '',
      currentState: visualProfile.state || '',
      negative: visualProfile.negative || 'text, watermark, blurry, bad anatomy',
      locked: Boolean(visualProfile.locked),
      updatedAt: visualProfile.updatedAt || new Date().toISOString(),
    };
  }
  return {
    schemaVersion: 1,
    trigger: {
      type: triggerType,
      source: triggerSource,
      userIntent: userPrompt || 'Generate the current roleplay scene from context.',
      messageId: options.messageId ?? null,
      createdAt: new Date().toISOString(),
    },
    raw: {
      userId,
      chatId,
      activeCharacterId,
      recentMessages: s.useChatContext ? getRecentMessages(Number(s.contextDepth || 8)) : [],
      characterCards: s.useCharacterCard ? [character] : [],
      userPersona,
    },
    cache: {
      scene: chatCache.scene || emptySceneCache(),
      characterRegistry,
      characters: charactersCache,
      lastImage: getTrackLastImage(chatCache, trackKey),
    },
    generation: {
      target: 'image_prompt',
      focus: triggerSource,
      imageTrack: trackKey,
      style: String(s.stylePreset || DEFAULT_SETTINGS.stylePreset).trim(),
      safeMode: s.safeMode !== false,
      size: s.size,
      continuityMode: s.continuityMode || 'smart',
      detectSceneTransition: Boolean(s.detectSceneTransition),
      continuityPolicy: {
        defaultAction: s.continuityMode === 'force' ? 'inherit_previous_image' : 'inherit_unless_clear_scene_transition',
        transitionOnlyWhen: 'location, time period, scene goal, or cast clearly changes; do not treat emotion, pose, dialogue, or small action changes as a scene transition',
        preserveFields: ['character identity', 'base appearance', 'current outfit', 'scene layout', 'lighting mood', 'camera language', 'visual style'],
      },
      constraints: [
        'preserve character identity',
        'preserve scene continuity when the scene is not transitioning',
        'avoid text, watermark, captions, speech bubbles',
        ...(s.safeMode !== false ? ['safety mode: produce a non-explicit prompt suitable for mainstream image APIs; convert explicit source context into safe cinematic wording'] : []),
      ],
    },
    provider: {
      imageModel: s.model,
      promptModel,
      size: s.size,
      responseFormat: s.responseFormat,
      refinePrompt: true,
    },
  };
}

function safeModeInstruction() {
  return 'Safety mode is enabled: write a non-explicit image prompt suitable for mainstream image APIs. Avoid nudity, pornographic framing, explicit sexual wording, minors, coercion, graphic violence, gore, hate symbols, and illegal acts. If the source context is explicit, reinterpret it as a safe cinematic or suggestive composition while preserving character identity, scene continuity, mood, and story intent.';
}

function buildContinuityAnchor(generationRequest, continuityPlan = null) {
  const s = settings();
  if ((s.continuityMode || 'smart') === 'off' || continuityPlan?.transitionFromPrevious) return '';
  const cache = generationRequest?.cache || {};
  const lastImage = cache.lastImage || emptyLastImageCache();
  const scene = cache.scene || emptySceneCache();
  const registryText = Object.values(cache.characterRegistry || {})
    .map((entry) => [
      entry.name ? `name: ${entry.name}` : '',
      entry.aliases?.length ? `aliases: ${entry.aliases.join(', ')}` : '',
      entry.baseAppearance ? `base appearance: ${entry.baseAppearance}` : '',
      entry.negative ? `negative: ${entry.negative}` : '',
      entry.locked ? 'locked identity' : '',
    ].filter(Boolean).join(', '))
    .filter(Boolean)
    .slice(0, 6);
  const charactersCache = Object.values(cache.characters || {})
    .map((character) => [
      character.name ? `name: ${character.name}` : '',
      character.baseAppearance ? `appearance: ${character.baseAppearance}` : '',
      character.currentOutfit ? `outfit: ${character.currentOutfit}` : '',
      character.currentState ? `state: ${character.currentState}` : '',
      character.currentExpression ? `expression: ${character.currentExpression}` : '',
      character.currentPose ? `pose: ${character.currentPose}` : '',
    ].filter(Boolean).join(', '))
    .filter(Boolean)
    .slice(0, 3);
  const anchors = lastImage.anchors && typeof lastImage.anchors === 'object'
    ? Object.values(lastImage.anchors).filter(Boolean).join(', ')
    : '';
  const parts = [
    lastImage.summary ? `previous image: ${lastImage.summary}` : '',
    anchors ? `locked visual anchors: ${anchors}` : '',
    registryText.length ? `character registry: ${registryText.join(' | ')}` : '',
    charactersCache.length ? `character continuity: ${charactersCache.join(' | ')}` : '',
    scene.summary || scene.location ? `scene continuity: ${scene.summary || scene.location}` : '',
    lastImage.continuityTags?.length ? `continuity tags: ${lastImage.continuityTags.join(', ')}` : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  return `Continuity anchor: inherit the previous generated image unless explicitly contradicted. Preserve identity, outfit, scene layout, lighting mood, camera language, and visual style. ${truncateText(parts.join(' '), 1200)}`;
}

function buildLocalPromptPreview(userPrompt, generationRequest = null, continuityPlan = null) {
  const s = settings();
  const profile = getVisualProfile();
  const cache = generationRequest?.cache || getChatCache().chatCache;
  const scene = cache.scene || emptySceneCache();
  const lastImage = cache.lastImage || emptyLastImageCache();
  const mode = s.continuityMode || 'smart';
  const shouldUseLastImage = mode === 'force'
    || (mode === 'smart' && !continuityPlan?.transitionFromPrevious && lastImage.summary);
  const characterText = s.useCharacterCard ? truncateText(profile.base || currentCharacterText(), Number(s.maxCharacterText || 1600)) : '';
  const recentContext = s.useChatContext ? truncateText(getRecentContext(Number(s.contextDepth || 8)), Number(s.maxContextText || 2200)) : '';
  const safeMode = s.safeMode !== false;
  const parts = [
    'Generate one image for the current roleplay scene.',
    safeMode ? 'Image request: create a safe, non-explicit visual adaptation of the latest scene and user intent.' : `Image request: ${userPrompt}`,
    `Visual style: ${String(s.stylePreset || DEFAULT_SETTINGS.stylePreset).trim()}`,
    safeMode ? safeModeInstruction() : '',
    buildContinuityAnchor(generationRequest, continuityPlan),
    continuityPlan?.finalPrompt ? `Use this refined visual plan:\n${continuityPlan.finalPrompt}` : '',
    characterText ? `Character card / appearance source:\n${characterText}` : '',
    profile.state ? `Current visual state: ${profile.state}` : '',
    scene.summary || scene.location ? `Cached scene memory:\n${JSON.stringify(scene)}` : '',
    shouldUseLastImage ? `Previous generated image state to preserve:\n${JSON.stringify(lastImage)}` : '',
    recentContext ? `Recent chat context:\n${recentContext}` : '',
    'Keep the character identity, appearance, outfit continuity, scene mood, and latest action consistent. Do not render text, watermark, UI, speech bubbles, or captions.',
  ].filter(Boolean);
  return parts.join('\n');
}

function buildFallbackContinuityPlan(userPrompt, generationRequest) {
  const s = settings();
  const cache = generationRequest.cache || {};
  const lastImage = cache.lastImage || emptyLastImageCache();
  const scene = fallbackSceneCache(generationRequest, userPrompt, '');
  const mode = s.continuityMode || 'smart';
  const transitionFromPrevious = mode === 'off' ? true : false;
  return {
    finalPrompt: '',
    transitionFromPrevious,
    reason: 'local fallback',
    updatedCache: {
      scene,
      characterRegistry: cache.characterRegistry || {},
      characters: cache.characters || {},
      lastImage: {
        ...emptyLastImageCache(),
        ...lastImage,
        prompt: userPrompt,
        summary: userPrompt,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

function hasMeaningfulScene(scene) {
  if (!scene || typeof scene !== 'object') return false;
  const summary = meaningfulString(scene.summary).toLowerCase();
  if (summary && CACHE_PLACEHOLDER_VALUES.has(summary)) return false;
  return Boolean(
    meaningfulString(scene.location)
    || meaningfulString(scene.timeOfDay)
    || meaningfulString(scene.weather)
    || meaningfulString(scene.mood)
    || meaningfulString(scene.camera)
    || meaningfulString(scene.summary)
    || (Array.isArray(scene.props) && scene.props.length)
  );
}

function mergeSceneCache(base, update, fallbackSummary = '') {
  const next = { ...emptySceneCache(), ...(base || {}) };
  const incoming = isPlainObject(update) ? update : {};
  ['sceneId', 'location', 'timeOfDay', 'weather', 'mood', 'camera'].forEach((key) => {
    const value = cacheString(incoming[key], 120);
    if (value) next[key] = value;
  });
  const summary = cacheString(incoming.summary, 600);
  if (summary) next.summary = summary;
  const props = asStringArray(incoming.props, 16, 80);
  if (props.length) {
    next.props = props;
  }
  if (!hasMeaningfulScene(next) && fallbackSummary) {
    next.summary = truncateText(fallbackSummary, 500);
  }
  if (next.summary && CACHE_PLACEHOLDER_VALUES.has(String(next.summary).trim().toLowerCase()) && fallbackSummary) {
    next.summary = truncateText(fallbackSummary, 500);
  }
  next.sceneId = next.sceneId || 'current';
  next.updatedAt = cacheString(incoming.updatedAt, 80) || new Date().toISOString();
  return next;
}

function hasMeaningfulCharacterState(character) {
  if (!character || typeof character !== 'object') return false;
  return Boolean(
    meaningfulString(character.currentOutfit)
    || meaningfulString(character.currentState)
    || meaningfulString(character.currentExpression)
    || meaningfulString(character.currentPose)
    || meaningfulString(character.lastSeenAt)
  );
}

function mergeCharacterState(base, update) {
  const next = { ...(base || {}) };
  const incoming = isPlainObject(update) ? update : {};
  const fieldLimits = {
    name: 80,
    baseAppearance: 1200,
    currentOutfit: 240,
    currentState: 600,
    currentExpression: 160,
    currentPose: 160,
    lastSeenAt: 120,
    negative: 500,
  };
  Object.entries(fieldLimits).forEach(([key, limit]) => {
    const value = cacheString(incoming[key], limit);
    if (value) next[key] = value;
  });
  if (typeof incoming.locked === 'boolean') next.locked = incoming.locked;
  next.updatedAt = cacheString(incoming.updatedAt, 80) || next.updatedAt || new Date().toISOString();
  return next;
}

function mergeCharactersCache(baseCharacters, updatedCharacters, fallbackState = '') {
  const next = { ...(baseCharacters || {}) };
  Object.entries(isPlainObject(updatedCharacters) ? updatedCharacters : {}).forEach(([rawId, character]) => {
    if (!isPlainObject(character)) return;
    const name = cacheString(character.name, 80);
    const incomingId = cacheString(character.id, 80);
    const idCandidate = cacheString(rawId, 80);
    const id = incomingId || (idCandidate && idCandidate !== 'character_id' ? idCandidate : normalizeCharacterId(name, 'npc'));
    if (!id || id === 'character_id') return;
    const merged = mergeCharacterState(next[id], character);
    if (!merged.name && name) merged.name = name;
    if (!hasMeaningfulCharacterState(merged) && !merged.baseAppearance) return;
    next[id] = merged;
  });
  if (!Object.values(next).some(hasMeaningfulCharacterState) && fallbackState) {
    const activeId = currentCharacterKey();
    next[activeId] = mergeCharacterState(next[activeId], {
      name: currentCharacterName(),
      currentState: truncateText(fallbackState, 300),
      lastSeenAt: 'latest_context',
    });
  }
  return next;
}

function mergeCharacterRegistryEntry(base, update, fallbackId = '') {
  const incoming = isPlainObject(update) ? update : {};
  const name = cacheString(incoming.name, 80);
  const rawId = cacheString(incoming.id, 80) || cacheString(fallbackId, 80);
  const id = rawId && rawId !== 'character_id'
    ? rawId
    : normalizeCharacterId(name, 'npc');
  if (!id || id === 'character_id') return null;

  const next = { ...(base || {}), id };
  if (name) next.name = name;
  const aliases = asStringArray(incoming.aliases, 16, 80);
  if (aliases.length) next.aliases = aliases;
  const source = cacheString(incoming.source, 80);
  if (source) next.source = source;
  const baseAppearance = cacheString(incoming.baseAppearance, 1200);
  if (baseAppearance) next.baseAppearance = baseAppearance;
  const negative = cacheString(incoming.negative, 500);
  if (negative) next.negative = negative;
  if (typeof incoming.locked === 'boolean') next.locked = incoming.locked;
  next.updatedAt = cacheString(incoming.updatedAt, 80) || next.updatedAt || new Date().toISOString();
  return next;
}

function mergeCharacterRegistryCache(baseRegistry, updatedRegistry) {
  const next = { ...(baseRegistry || {}) };
  Object.entries(isPlainObject(updatedRegistry) ? updatedRegistry : {}).forEach(([rawId, entry]) => {
    if (!isPlainObject(entry)) return;
    const merged = mergeCharacterRegistryEntry(next[rawId], entry, rawId);
    if (!merged) return;
    if (!merged.name && !merged.baseAppearance) return;
    next[merged.id] = merged;
    if (rawId !== merged.id && next[rawId] && rawId !== currentCharacterKey()) delete next[rawId];
  });
  return next;
}

function normalizeMemoryTable(value) {
  const table = cacheString(value, 80);
  if (['scene', 'characterRegistry', 'characters', 'lastImage'].includes(table)) return table;
  return '';
}

function normalizeMemoryOperation(value) {
  const op = cacheString(value, 40).toLowerCase();
  if (['insert', 'update', 'delete'].includes(op)) return op;
  return '';
}

function normalizeMemoryOpId(table, rawId, data = {}) {
  if (table === 'scene' || table === 'lastImage') return table;
  const name = cacheString(data.name, 80);
  const id = cacheString(rawId || data.id, 120);
  if (id && id !== 'character_id') return id;
  return normalizeCharacterId(name, table === 'characterRegistry' ? 'npc' : 'state');
}

function applyMemoryOps(baseCache, ops, options = {}) {
  const next = {
    scene: { ...emptySceneCache(), ...(baseCache?.scene || {}) },
    characterRegistry: { ...(baseCache?.characterRegistry || {}) },
    characters: { ...(baseCache?.characters || {}) },
    lastImage: { ...emptyLastImageCache(), ...(baseCache?.lastImage || {}) },
  };
  const list = Array.isArray(ops) ? ops : [];
  list.forEach((rawOp) => {
    if (!isPlainObject(rawOp)) return;
    const op = normalizeMemoryOperation(rawOp.op || rawOp.action);
    const table = normalizeMemoryTable(rawOp.table);
    const data = isPlainObject(rawOp.data) ? rawOp.data : {};
    if (!op || !table) return;

    if (table === 'scene') {
      if (op === 'delete') return;
      next.scene = mergeSceneCache(next.scene, data, options.fallbackSummary || '');
      return;
    }

    if (table === 'lastImage') {
      if (op === 'delete') return;
      next.lastImage = normalizeLastImageCache(next.lastImage, data, options.fallbackPrompt || '', options.transitionFromPrevious);
      return;
    }

    const id = normalizeMemoryOpId(table, rawOp.id, data);
    if (!id) return;

    if (op === 'delete') {
      const existing = table === 'characterRegistry' ? next.characterRegistry[id] : next.characters[id];
      if (existing?.locked || id === currentCharacterKey() || id === currentUserPersonaKey()) return;
      if (table === 'characterRegistry') delete next.characterRegistry[id];
      if (table === 'characters') delete next.characters[id];
      return;
    }

    if (table === 'characterRegistry') {
      const merged = mergeCharacterRegistryEntry(next.characterRegistry[id], { ...data, id }, id);
      if (merged && (merged.name || merged.baseAppearance)) next.characterRegistry[merged.id] = merged;
      return;
    }

    if (table === 'characters') {
      const merged = mergeCharacterState(next.characters[id], { ...data, id });
      if (merged.name || hasMeaningfulCharacterState(merged) || merged.baseAppearance) next.characters[id] = merged;
    }
  });

  next.scene = mergeSceneCache(next.scene, {}, options.fallbackSummary || '');
  next.characters = mergeCharactersCache(next.characters, {}, options.fallbackSummary || '');
  next.lastImage = normalizeLastImageCache(next.lastImage, {}, options.fallbackPrompt || '', options.transitionFromPrevious);
  return next;
}

function normalizeLastImageCache(baseLastImage, updatedLastImage, fallbackPrompt, transitionFromPrevious) {
  const base = { ...emptyLastImageCache(), ...(baseLastImage || {}) };
  const incoming = isPlainObject(updatedLastImage) ? updatedLastImage : {};
  const next = { ...base };
  const prompt = cacheString(incoming.prompt, 2000) || cacheString(fallbackPrompt, 2000);
  if (prompt) next.prompt = prompt;
  const summary = cacheString(incoming.summary, 600) || cacheString(fallbackPrompt, 600);
  if (summary) next.summary = summary;
  const tags = asStringArray(incoming.continuityTags, 16, 80);
  if (tags.length) next.continuityTags = tags;
  if (isPlainObject(incoming.anchors)) {
    next.anchors = { ...emptyLastImageCache().anchors, ...(base.anchors || {}) };
    ['identity', 'outfit', 'scene', 'camera', 'mood', 'style'].forEach((key) => {
      const value = cacheString(incoming.anchors[key], 220);
      if (value) next.anchors[key] = value;
    });
  }
  const charactersList = asStringArray(incoming.characters, 12, 80);
  if (charactersList.length) next.characters = charactersList;
  const sceneId = cacheString(incoming.sceneId, 120);
  if (sceneId) next.sceneId = sceneId;
  next.transitionFromPrevious = Boolean(transitionFromPrevious);
  next.updatedAt = cacheString(incoming.updatedAt, 80) || new Date().toISOString();
  return next;
}

function fallbackSceneSummary(generationRequest, userPrompt, finalPrompt = '') {
  const latestMessages = (generationRequest?.raw?.recentMessages || [])
    .slice(-3)
    .map(message => `${message.role}: ${message.text}`)
    .join('\n');
  return [userPrompt, finalPrompt, latestMessages].map(meaningfulString).filter(Boolean).join('\n');
}

function inferSceneFromText(text, fallbackSummary = '') {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const scene = emptySceneCache();

  if (/front door|couch|hardwood|living room|sofa/i.test(raw)) scene.location = 'home living room';
  else if (/park|sidewalk/i.test(raw)) scene.location = 'park sidewalk';
  else if (/gym|boxing|sparring/i.test(raw)) scene.location = 'gym';

  if (/door|couch|phone|boots|hardwood/i.test(raw)) {
    scene.props = [
      /door/i.test(raw) ? 'front door' : '',
      /couch|sofa/i.test(raw) ? 'couch' : '',
      /phone/i.test(raw) ? 'phone' : '',
      /boots/i.test(raw) ? 'boots' : '',
      /hardwood/i.test(raw) ? 'hardwood floor' : '',
    ].filter(Boolean);
  }

  if (/jealous|pout|blush|hurt|furious|angry|panic|soft|shy/i.test(raw)) {
    scene.mood = 'tense jealous emotional confrontation';
  } else if (/quiet|soft|warm/i.test(raw)) {
    scene.mood = 'quiet intimate mood';
  }

  if (/walked in|front door|both their heads snapped|pouts|eyes/i.test(raw)) {
    scene.camera = 'cinematic medium shot focused on character reactions';
  }

  scene.summary = truncateText(
    meaningfulString(fallbackSummary)
    || meaningfulString(raw.replace(/\s+/g, ' ')),
    600,
  );
  scene.updatedAt = new Date().toISOString();
  return scene;
}

function fallbackSceneCache(generationRequest, userPrompt, finalPrompt = '') {
  const latestMessages = (generationRequest?.raw?.recentMessages || [])
    .slice(-3)
    .map(message => message.text)
    .join('\n');
  const summary = fallbackSceneSummary(generationRequest, userPrompt, finalPrompt);
  const inferred = inferSceneFromText([finalPrompt, latestMessages].filter(Boolean).join('\n'), summary);
  return mergeSceneCache(generationRequest?.cache?.scene, inferred, summary);
}

function buildContinuityMessages(generationRequest) {
  const safeMode = generationRequest?.generation?.safeMode !== false;
  const continuityAnchor = buildContinuityAnchor(generationRequest);
  return [
    {
      role: 'system',
      content: [
        'You are an image continuity planner for a SillyTavern image generation extension.',
        'Return strict JSON only. No markdown.',
        'Decide whether the new image should inherit the previous generated image state.',
        'Default to continuity: keep transitionFromPrevious false unless the recent chat clearly changes location, time period, scene goal, or cast.',
        'Do not mark a transition for normal dialogue, emotional changes, pose changes, clothing details, or small actions inside the same scene.',
        'When transitionFromPrevious is false, finalPrompt must explicitly include stable character identity, base appearance, outfit, scene layout, lighting mood, camera language, and visual style from cache.lastImage/cache.characters/cache.scene.',
        'Always preserve stable character identity and stable visual style unless the user explicitly changes them.',
        'Treat cache.characterRegistry as a character appearance table. Each key is one character row. Do not merge different people into one row.',
        'If the recent chat introduces a new named visible character, add one characterRegistry row for stable appearance only when the appearance is explicit or strongly inferable.',
        'Treat cache.characters as the current visual state table. Update one row per visible/active character: outfit, state, expression, pose, and lastSeenAt.',
        'Use existing character ids when names or aliases match. Create a new normalized id only for genuinely new characters.',
        'Return memoryOps as table operations. Do not return a whole rewritten cache unless compatibility is required.',
        'Use insert for genuinely new rows, update for existing rows, delete only when a non-primary character/state is clearly obsolete.',
        'You must update scene through memoryOps from recent messages and finalPrompt. The scene table should describe current location/time/mood/props/camera/summary, not character biography.',
        'finalPrompt must be English for the image model, but every user-visible cache/memory field in memoryOps must be Simplified Chinese: scene.location/timeOfDay/weather/mood/props/camera/summary, characterRegistry.baseAppearance, characters.currentOutfit/currentState/currentExpression/currentPose, lastImage.summary, anchors, and continuityTags. Keep ids, table names, op names, sceneId, lastSeenAt, source, and negative prompt terms unchanged.',
        'Only put changed or confirmed fields in each operation data object. Existing cache values are preserved by code when a field is omitted or empty.',
        'Never fabricate unknown details. Never copy schema examples, placeholders, raw character card prose, or whole source text into cache fields.',
        'Commas are allowed in finalPrompt, but cache fields should stay compact and factual. Prefer slash-separated short traits for cache summaries.',
        safeMode ? `${safeModeInstruction()} The finalPrompt must not repeat unsafe source wording; convert unsafe details into safe visual language.` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: `${JSON.stringify(generationRequest, null, 2)}\n\n${continuityAnchor ? `${continuityAnchor}\n\n` : ''}Return strict JSON with these keys:\n{\n  "finalPrompt": "English image prompt, concrete and visual. If transitionFromPrevious is false, include continuity anchors directly in this prompt.",\n  "transitionFromPrevious": false,\n  "reason": "中文简短原因",\n  "memoryOps": [\n    {"op":"update","table":"scene","id":"scene","data":{"sceneId":"current","location":"中文地点","timeOfDay":"中文时间","weather":"中文天气","mood":"中文氛围","props":["中文道具"],"camera":"中文镜头","summary":"中文场景摘要"}},\n    {"op":"update","table":"characterRegistry","id":"existing_or_new_character_id","data":{"name":"角色名","aliases":["中文别名"],"source":"chat_context","baseAppearance":"中文稳定外貌描述","negative":"text, watermark, blurry, bad anatomy","locked":false}},\n    {"op":"update","table":"characters","id":"existing_or_new_character_id","data":{"name":"角色名","currentOutfit":"中文当前服装","currentState":"中文当前状态","currentExpression":"中文表情","currentPose":"中文姿势","lastSeenAt":"latest_context"}},\n    {"op":"update","table":"lastImage","id":"lastImage","data":{"prompt":"English final prompt summary is allowed here only if needed","summary":"中文画面摘要","continuityTags":["身份","服装","场景","风格"],"anchors":{"identity":"中文身份锚点","outfit":"中文服装锚点","scene":"中文场景锚点","camera":"中文镜头锚点","mood":"中文氛围锚点","style":"中文风格锚点"},"characters":["可见角色名"],"sceneId":"current"}}\n  ]\n}\n\nOperation rules:\n- op must be insert, update, or delete.\n- table must be scene, characterRegistry, characters, or lastImage.\n- finalPrompt must be English. memoryOps user-visible data must be Simplified Chinese.\n- Keep one row per character. Do not combine multiple characters in one field.\n- Put permanent body/face/hair/species traits in characterRegistry.baseAppearance.\n- Put temporary outfit/action/expression/location-dependent status in characters.\n- Put environment/location/time/props/camera in scene.\n- If uncertain, omit the field or leave it empty; do not invent values.\n- Do not output placeholder words such as character_id, existing_or_new_character_id, inferred location, current outfit, or stable appearance only as real values.`,
    },
  ];
}

function normalizeContinuityPlan(plan, generationRequest, userPrompt) {
  const fallback = buildFallbackContinuityPlan(userPrompt, generationRequest);
  if (!plan || typeof plan !== 'object') return fallback;
  const s = settings();
  const transitionFromPrevious = s.continuityMode === 'force'
    ? false
    : s.detectSceneTransition === false
      ? false
      : Boolean(plan.transitionFromPrevious);
  const finalPrompt = String(plan.finalPrompt || '').trim();
  const fallbackSummary = fallbackSceneSummary(generationRequest, userPrompt, finalPrompt);
  const localScene = fallbackSceneCache(generationRequest, userPrompt, finalPrompt);
  const hasMemoryOps = Array.isArray(plan.memoryOps) && plan.memoryOps.length > 0;
  if (hasMemoryOps) {
    const opBaseCache = {
      scene: localScene,
      characterRegistry: generationRequest.cache?.characterRegistry || {},
      characters: generationRequest.cache?.characters || {},
      lastImage: normalizeLastImageCache(generationRequest.cache?.lastImage, plan.updatedCache?.lastImage, finalPrompt || userPrompt, transitionFromPrevious),
    };
    return {
      finalPrompt,
      transitionFromPrevious,
      reason: String(plan.reason || '').trim(),
      updatedCache: applyMemoryOps(opBaseCache, plan.memoryOps, {
        fallbackSummary: localScene.summary || fallbackSummary,
        fallbackPrompt: finalPrompt || userPrompt,
        transitionFromPrevious,
      }),
      memoryOps: plan.memoryOps,
    };
  }
  return {
    finalPrompt,
    transitionFromPrevious,
    reason: String(plan.reason || '').trim(),
    updatedCache: {
      scene: mergeSceneCache(localScene, plan.updatedCache?.scene, localScene.summary || fallbackSummary),
      characterRegistry: mergeCharacterRegistryCache(generationRequest.cache?.characterRegistry, plan.updatedCache?.characterRegistry),
      characters: mergeCharactersCache(generationRequest.cache?.characters, plan.updatedCache?.characters, fallbackSummary),
      lastImage: normalizeLastImageCache(generationRequest.cache?.lastImage, plan.updatedCache?.lastImage, finalPrompt || userPrompt, transitionFromPrevious),
    },
  };
}

async function directChatCompletion(payload, timeoutMs = 60000) {
  const s = settings();
  const apiKey = getPromptBrowserApiKey();
  if (!apiKey) throw new Error('当前为纯前端模式，请先保存补全 API 密钥到浏览器');
  const root = normalizeBaseUrl(currentChatCompletionBaseUrl() || s.promptBaseUrl || s.baseUrl).replace(/\/v1$/, '');
  if (!root) throw new Error('补全接口地址为空');
  return directJson(`${root}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function sillyTavernQuietChatCompletion(payload) {
  if (typeof generateQuietPrompt !== 'function') {
    throw new Error('当前 SillyTavern 环境未暴露 generateQuietPrompt');
  }
  const content = await generateQuietPrompt({
    quietPrompt: buildQuietPromptFromPayload(payload),
    quietToLoud: false,
    skipWIAN: false,
    responseLength: 2048,
    removeReasoning: true,
    trimToSentence: false,
  });
  return {
    choices: [
      {
        message: {
          content: String(content || '').trim(),
        },
      },
    ],
  };
}

function promptTransportLabel() {
  const s = settings();
  if (s.promptApiSecretId) return 'plugin_proxy_prompt_key';
  if (getPromptBrowserApiKey()) return 'sillytavern_generateQuietPrompt_or_browser_fallback';
  return 'sillytavern_generateQuietPrompt';
}

async function promptChatCompletion(payload, timeoutMs = 60000) {
  const s = settings();
  if (s.promptApiSecretId && await isProxyAvailable()) {
    return proxyPost('/chat/completions', {
      baseUrl: s.baseUrl,
      promptBaseUrl: currentChatCompletionBaseUrl() || s.promptBaseUrl || s.baseUrl,
      apiSecretKey: PROMPT_SECRET_KEY,
      apiSecretId: s.promptApiSecretId,
      payload,
      timeoutMs,
    });
  }
  try {
    return await sillyTavernQuietChatCompletion(payload);
  } catch (error) {
    if (getPromptBrowserApiKey()) return directChatCompletion(payload, timeoutMs);
    throw error;
  }
}

async function requestContinuityPlan(generationRequest, userPrompt) {
  const s = settings();
  if ((s.continuityMode || 'smart') === 'off') {
    return buildFallbackContinuityPlan(userPrompt, generationRequest);
  }
  const model = normalizePromptModel(generationRequest.provider?.promptModel || s.promptModel || s.model);
  if (!model) return buildFallbackContinuityPlan(userPrompt, generationRequest);

  const payload = {
    model,
    messages: buildContinuityMessages(generationRequest),
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };
  const transport = promptTransportLabel();
  appendDebugLog('生图补全请求', {
    model,
    transport,
    trigger: generationRequest.trigger,
    payload,
  });

  try {
    const data = await promptChatCompletion(payload, 60000);
    const content = extractChatCompletionContent(data);
    const parsed = parseJsonObject(content);
    const normalized = normalizeContinuityPlan(parsed, generationRequest, userPrompt);
    appendDebugLog('生图补全返回', {
      model,
      transport,
      rawContent: content,
      parsed,
      normalized,
    });
    return normalized;
  } catch (error) {
    console.warn('[openai-image-tavern] continuity planner fallback:', error);
    appendDebugLog('生图补全失败', {
      model,
      transport,
      message: error.message,
    });
    return buildFallbackContinuityPlan(userPrompt, generationRequest);
  }
}

async function composeImagePrompt(userPrompt, options = {}) {
  await ensureMainCharacterAppearanceFromCard();
  const generationRequest = buildGenerationRequest(userPrompt, options);
  const continuityPlan = await requestContinuityPlan(generationRequest, userPrompt);
  const rawPrompt = continuityPlan.finalPrompt || buildLocalPromptPreview(userPrompt, generationRequest, continuityPlan);
  const continuityAnchor = buildContinuityAnchor(generationRequest, continuityPlan);
  const finalPrompt = continuityAnchor && continuityPlan.finalPrompt
    ? `${continuityAnchor}\n\n${rawPrompt}`
    : rawPrompt;
  const nextCache = continuityPlan.updatedCache || {};
  generationRequest.cache = {
    scene: nextCache.scene || generationRequest.cache.scene || emptySceneCache(),
    characterRegistry: nextCache.characterRegistry || generationRequest.cache.characterRegistry || {},
    characters: nextCache.characters || generationRequest.cache.characters || {},
    lastImage: {
      ...emptyLastImageCache(),
      ...(nextCache.lastImage || {}),
      prompt: continuityPlan.finalPrompt || userPrompt,
      summary: nextCache.lastImage?.summary || continuityPlan.finalPrompt || userPrompt,
      continuityTags: Array.isArray(nextCache.lastImage?.continuityTags) ? nextCache.lastImage.continuityTags : [],
      transitionFromPrevious: Boolean(continuityPlan.transitionFromPrevious),
      updatedAt: nextCache.lastImage?.updatedAt || new Date().toISOString(),
    },
  };
  generationRequest.continuity = {
    mode: settings().continuityMode || 'smart',
    transitionFromPrevious: Boolean(continuityPlan.transitionFromPrevious),
    reason: continuityPlan.reason || '',
  };
  return {
    generationRequest,
    finalPrompt,
  };
}

function normalizePromptModel(model) {
  return model || settings().promptModel || '';
}

async function generateImage(prompt, options = {}) {
  const s = settings();
  validateProviderSettings(s);
  if (!await shouldUseProxy(s)) {
    return directGenerateImage(prompt, options);
  }
  return proxyGenerateImage(prompt, options);
}

async function proxyGenerateImage(prompt, options = {}) {
  const s = settings();
  const { generationRequest, finalPrompt } = await composeImagePrompt(prompt, options);
  const payload = {
    model: s.model,
    prompt: finalPrompt,
    n: Number(s.n || 1),
    size: s.size || '1024x1024',
  };

  if (s.responseFormat) payload.response_format = s.responseFormat;

  const result = await proxyPost('/images/generations', {
    baseUrl: s.baseUrl,
    apiSecretKey: IMAGE_SECRET_KEY,
    apiSecretId: s.apiSecretId,
    payload,
  });

  return {
    ...result,
    prompt: finalPrompt,
    generationRequest,
    mode: 'proxy',
  };
}

function validateProviderSettings(s) {
  if (!String(s.baseUrl || '').trim()) throw new Error('请先填写图片接口地址');
  if (!String(s.apiSecretId || getBrowserApiKey()).trim()) throw new Error('请先保存 API 密钥');
  if (!String(s.model || '').trim()) throw new Error('请先填写图片模型');
}

async function shouldUseProxy(s = settings()) {
  return Boolean(s.apiSecretId && await isProxyAvailable());
}

async function directGenerateImage(prompt, options = {}) {
  const s = settings();
  const apiKey = getBrowserApiKey();
  if (!apiKey) throw new Error('当前为纯前端模式，请先保存 API 密钥到浏览器');

  const { generationRequest, finalPrompt } = await composeImagePrompt(prompt, options);
  const root = normalizeBaseUrl(s.baseUrl);
  const payload = {
    model: s.model,
    prompt: finalPrompt,
    n: Number(s.n || 1),
    size: s.size || '1024x1024',
  };

  if (s.responseFormat) payload.response_format = s.responseFormat;

  const data = await directJson(`${root}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return {
    images: Array.isArray(data?.data) ? data.data : [],
    prompt: finalPrompt,
    generationRequest,
    mode: 'browser',
  };
}

function imageHtmlFromUrl(url) {
  if (!url) return '';
  return `<img class="oit-generated-chat-image" src="${escapeHtml(url)}" alt="AI 生图">`;
}

function imageMarkdown(image) {
  if (image.url) return imageHtmlFromUrl(image.url);
  if (image.b64_json) return imageHtmlFromUrl(`data:image/png;base64,${image.b64_json}`);
  return '';
}

async function cleanupLegacyGeneratedMedia() {
  const context = getContext();
  let changed = false;
  (context?.chat || []).forEach((message, messageId) => {
    const extra = message?.extra;
    if (!extra || typeof extra !== 'object') return;

    const legacyImages = Array.isArray(extra.openaiImageTavernMedia)
      ? extra.openaiImageTavernMedia
      : [];
    const generatedMedia = Array.isArray(extra.media)
      ? extra.media.filter(item => item?.source === 'generated' || String(item?.title || '').startsWith('AI 生图'))
      : [];
    const urls = [...legacyImages, ...generatedMedia]
      .map(item => item?.url)
      .filter(Boolean);
    if (!urls.length) return;

    const missingImages = urls
      .filter(url => !String(message.mes || '').includes(url))
      .map(imageHtmlFromUrl)
      .filter(Boolean);
    if (missingImages.length) {
      const existingText = String(message.mes || '').trim();
      message.mes = existingText ? `${existingText}\n\n${missingImages.join('\n\n')}` : missingImages.join('\n\n');
    }

    if (Array.isArray(extra.media)) {
      extra.media = extra.media.filter(item => !(item?.source === 'generated' || String(item?.title || '').startsWith('AI 生图')));
      if (!extra.media.length) delete extra.media;
    }
    delete extra.openaiImageTavernMedia;
    delete extra.inline_image;
    delete extra.media_display;
    delete extra.media_index;

    updateMessageBlock(Number(messageId), message);
    changed = true;
  });

  if (changed && typeof context?.saveChat === 'function') await context.saveChat();
}

function scheduleCleanupLegacyGeneratedMedia() {
  setTimeout(() => {
    cleanupLegacyGeneratedMedia().catch(error => {
      console.warn('[openai-image-tavern] legacy media cleanup failed:', error);
    });
  }, 800);
}

async function insertImages(images, prompt, options = {}) {
  const context = getContext();
  const body = images.map(imageMarkdown).filter(Boolean).join('\n\n');
  if (!body) throw new Error('接口没有返回有效图片 URL 或 Base64 数据');

  const targetMessageId = Number(options.targetMessageId);
  const shouldAppendToTarget = options.triggerSource === 'last_reply'
    && Number.isInteger(targetMessageId)
    && Array.isArray(context?.chat)
    && context.chat[targetMessageId];
  if (shouldAppendToTarget) {
    const message = context.chat[targetMessageId];
    const existing = String(message.mes || '').trim();
    message.mes = existing ? `${existing}\n\n${body}` : body;
    message.extra = {
      ...(message.extra && typeof message.extra === 'object' ? message.extra : {}),
      openaiImageTavernInline: true,
      openaiImageTavernImagePrompt: prompt,
    };
    updateMessageBlock(targetMessageId, message);
    if (typeof context.saveChat === 'function') await context.saveChat();
    if (typeof context.scrollOnMediaLoad === 'function') {
      setTimeout(() => context.scrollOnMediaLoad(), 300);
    }
    return;
  }

  if (Array.isArray(context?.chat) && typeof context?.addOneMessage === 'function') {
    const message = {
      name: 'AI 生图插件',
      is_user: false,
      is_system: true,
      send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
      mes: `${body}\n\n> ${prompt}`,
      extra: {
        openaiImageTavern: true,
        imagePrompt: prompt,
      },
    };
    context.chat.push(message);
    const messageId = context.chat.length - 1;
    await eventSource.emit(event_types.MESSAGE_RECEIVED, messageId, 'extension');
    context.addOneMessage(message);
    await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'extension');
    if (typeof context.saveChat === 'function') await context.saveChat();
    if (typeof context.scrollOnMediaLoad === 'function') {
      setTimeout(() => context.scrollOnMediaLoad(), 300);
    }
    return;
  }

  toastr.info('图片已生成到预览区，但当前环境无法自动插入聊天。', 'AI 生图插件');
}

async function handleGenerate(prompt, options = {}) {
  if (!prompt?.trim()) throw new Error('提示词为空');
  await cleanupLegacyGeneratedMedia();
  const result = await generateImage(prompt.trim(), options);
  const images = result.images || [];
  if (settings().updateContinuityCache) saveReturnedCache(result.generationRequest, images);
  await insertImages(images, prompt.trim(), options);
  renderPreview(images);
  return result;
}

function renderPreview(images) {
  const preview = document.querySelector('#oit-preview');
  if (!preview) return;
  preview.innerHTML = images.map((image) => {
    const src = image.url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : '');
    return src ? `<img src="${escapeHtml(src)}" alt="生成图片">` : '';
  }).join('');
}

function renderCharacterRegistryRows(registry) {
  const entries = Object.values(registry || {});
  if (!entries.length) {
    return '<div class="oit-empty">当前聊天还没有角色外貌缓存。</div>';
  }
  return `
    <h3 class="marginBot5">#0 多角色外貌表</h3>
    <div class="oit-sheet-wrap">
      <table class="sheet-table tableDom oit-character-sheet">
        <tbody>
          <tr>
            <td class="sheet-cell sheet-header-cell-top">#</td>
            <td class="sheet-cell sheet-header-cell-top">角色名</td>
            <td class="sheet-cell sheet-header-cell-top">别名</td>
            <td class="sheet-cell sheet-header-cell-top">固定外貌</td>
            <td class="sheet-cell sheet-header-cell-top">负面约束</td>
            <td class="sheet-cell sheet-header-cell-top">来源</td>
            <td class="sheet-cell sheet-header-cell-top">锁定</td>
            <td class="sheet-cell sheet-header-cell-top">操作</td>
          </tr>
          ${entries.map((entry, index) => `
            <tr class="oit-character-row" data-character-id="${escapeHtml(entry.id || '')}">
              <td class="sheet-cell sheet-header-cell-left">${index + 1}</td>
              <td class="sheet-cell compact-cell"><input data-field="name" value="${escapeHtml(entry.name || '')}" placeholder="Alice"></td>
              <td class="sheet-cell medium-cell"><input data-field="aliases" value="${escapeHtml((entry.aliases || []).join(', '))}" placeholder="女仆, 她"></td>
              <td class="sheet-cell wide-cell"><textarea data-field="baseAppearance" rows="2" placeholder="只写稳定外貌">${escapeHtml(entry.baseAppearance || '')}</textarea></td>
              <td class="sheet-cell wide-cell"><textarea data-field="negative" rows="2" placeholder="不要改变的特征">${escapeHtml(entry.negative || '')}</textarea></td>
              <td class="sheet-cell compact-cell"><input data-field="source" value="${escapeHtml(entry.source || 'chat_context')}" placeholder="chat_context"></td>
              <td class="sheet-cell lock-cell"><input type="checkbox" data-field="locked" title="锁定" ${entry.locked ? 'checked' : ''}></td>
              <td class="sheet-cell"><button class="menu_button menu_button_icon oit-delete-character" type="button" title="删除角色" ${entry.source === 'sillytavern_card' ? 'disabled' : ''}><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <hr>
  `;
}

function renderCharacterStateRows(charactersState) {
  const entries = Object.entries(charactersState || {});
  if (!entries.length) return '<div class="oit-empty">当前聊天还没有角色状态缓存。</div>';
  return `
    <h3 class="marginBot5">#1 角色状态表</h3>
    <div class="oit-sheet-wrap">
      <table class="sheet-table tableDom oit-character-sheet">
        <tbody>
          <tr>
            <td class="sheet-cell sheet-header-cell-top">#</td>
            <td class="sheet-cell sheet-header-cell-top">角色ID</td>
            <td class="sheet-cell sheet-header-cell-top">角色名</td>
            <td class="sheet-cell sheet-header-cell-top">当前服装</td>
            <td class="sheet-cell sheet-header-cell-top">当前状态</td>
            <td class="sheet-cell sheet-header-cell-top">表情</td>
            <td class="sheet-cell sheet-header-cell-top">姿势</td>
            <td class="sheet-cell sheet-header-cell-top">最后出现</td>
            <td class="sheet-cell sheet-header-cell-top">操作</td>
          </tr>
          ${entries.map(([id, entry], index) => `
            <tr class="oit-state-row" data-character-id="${escapeHtml(id)}">
              <td class="sheet-cell sheet-header-cell-left">${index + 1}</td>
              <td class="sheet-cell compact-cell"><input data-field="id" value="${escapeHtml(id)}" placeholder="npc:alice"></td>
              <td class="sheet-cell compact-cell"><input data-field="name" value="${escapeHtml(entry.name || '')}" placeholder="Alice"></td>
              <td class="sheet-cell medium-cell"><input data-field="currentOutfit" value="${escapeHtml(entry.currentOutfit || '')}" placeholder="当前服装"></td>
              <td class="sheet-cell wide-cell"><textarea data-field="currentState" rows="2" placeholder="当前状态">${escapeHtml(entry.currentState || '')}</textarea></td>
              <td class="sheet-cell medium-cell"><input data-field="currentExpression" value="${escapeHtml(entry.currentExpression || '')}" placeholder="表情"></td>
              <td class="sheet-cell medium-cell"><input data-field="currentPose" value="${escapeHtml(entry.currentPose || '')}" placeholder="姿势"></td>
              <td class="sheet-cell compact-cell"><input data-field="lastSeenAt" value="${escapeHtml(entry.lastSeenAt || '')}" placeholder="message:35"></td>
              <td class="sheet-cell"><button class="menu_button menu_button_icon oit-delete-state" type="button" title="删除状态"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <hr>
  `;
}

function renderSceneRows(scene) {
  const value = { ...emptySceneCache(), ...(scene || {}) };
  return `
    <h3 class="marginBot5">#2 场景表</h3>
    <div class="oit-sheet-wrap">
      <table class="sheet-table tableDom oit-character-sheet">
        <tbody>
          <tr>
            <td class="sheet-cell sheet-header-cell-top">场景ID</td>
            <td class="sheet-cell sheet-header-cell-top">地点</td>
            <td class="sheet-cell sheet-header-cell-top">时间</td>
            <td class="sheet-cell sheet-header-cell-top">天气</td>
            <td class="sheet-cell sheet-header-cell-top">氛围</td>
            <td class="sheet-cell sheet-header-cell-top">道具</td>
            <td class="sheet-cell sheet-header-cell-top">镜头</td>
            <td class="sheet-cell sheet-header-cell-top">摘要</td>
          </tr>
          <tr class="oit-scene-row">
            <td class="sheet-cell compact-cell"><input data-field="sceneId" value="${escapeHtml(value.sceneId || 'current')}" placeholder="current"></td>
            <td class="sheet-cell compact-cell"><input data-field="location" value="${escapeHtml(value.location || '')}" placeholder="地点"></td>
            <td class="sheet-cell compact-cell"><input data-field="timeOfDay" value="${escapeHtml(value.timeOfDay || '')}" placeholder="时间"></td>
            <td class="sheet-cell compact-cell"><input data-field="weather" value="${escapeHtml(value.weather || '')}" placeholder="天气"></td>
            <td class="sheet-cell medium-cell"><input data-field="mood" value="${escapeHtml(value.mood || '')}" placeholder="氛围"></td>
            <td class="sheet-cell medium-cell"><input data-field="props" value="${escapeHtml((value.props || []).join(', '))}" placeholder="逗号分隔"></td>
            <td class="sheet-cell medium-cell"><input data-field="camera" value="${escapeHtml(value.camera || '')}" placeholder="镜头"></td>
            <td class="sheet-cell wide-cell"><textarea data-field="summary" rows="2" placeholder="场景摘要">${escapeHtml(value.summary || '')}</textarea></td>
          </tr>
        </tbody>
      </table>
    </div>
    <hr>
  `;
}

function readCharacterRegistryFromPanel(root = document) {
  const registry = {};
  root.querySelectorAll('.oit-character-row').forEach((row) => {
    const originalId = row.dataset.characterId || '';
    const name = row.querySelector('[data-field="name"]')?.value?.trim() || '';
    if (!name) return;
    const source = row.querySelector('[data-field="source"]')?.value?.trim() || 'chat_context';
    const id = source === 'sillytavern_card' ? originalId : (originalId || `npc:${normalizeCharacterId(name)}`);
    registry[id] = {
      id,
      name,
      aliases: (row.querySelector('[data-field="aliases"]')?.value || '')
        .split(',')
        .map(alias => alias.trim())
        .filter(Boolean),
      source,
      baseAppearance: row.querySelector('[data-field="baseAppearance"]')?.value?.trim() || '',
      negative: row.querySelector('[data-field="negative"]')?.value?.trim() || '',
      locked: Boolean(row.querySelector('[data-field="locked"]')?.checked),
      updatedAt: new Date().toISOString(),
    };
  });
  return registry;
}

function readCharacterStateFromPanel(root = document) {
  const charactersState = {};
  root.querySelectorAll('.oit-state-row').forEach((row) => {
    const originalId = row.dataset.characterId || '';
    const id = row.querySelector('[data-field="id"]')?.value?.trim() || originalId;
    if (!id) return;
    charactersState[id] = {
      name: row.querySelector('[data-field="name"]')?.value?.trim() || '',
      currentOutfit: row.querySelector('[data-field="currentOutfit"]')?.value?.trim() || '',
      currentState: row.querySelector('[data-field="currentState"]')?.value?.trim() || '',
      currentExpression: row.querySelector('[data-field="currentExpression"]')?.value?.trim() || '',
      currentPose: row.querySelector('[data-field="currentPose"]')?.value?.trim() || '',
      lastSeenAt: row.querySelector('[data-field="lastSeenAt"]')?.value?.trim() || '',
      updatedAt: new Date().toISOString(),
    };
  });
  return charactersState;
}

function readSceneFromPanel(root = document) {
  const row = root.querySelector('.oit-scene-row');
  if (!row) return emptySceneCache();
  return {
    sceneId: row.querySelector('[data-field="sceneId"]')?.value?.trim() || 'current',
    location: row.querySelector('[data-field="location"]')?.value?.trim() || '',
    timeOfDay: row.querySelector('[data-field="timeOfDay"]')?.value?.trim() || '',
    weather: row.querySelector('[data-field="weather"]')?.value?.trim() || '',
    mood: row.querySelector('[data-field="mood"]')?.value?.trim() || '',
    props: (row.querySelector('[data-field="props"]')?.value || '').split(',').map(item => item.trim()).filter(Boolean),
    camera: row.querySelector('[data-field="camera"]')?.value?.trim() || '',
    summary: row.querySelector('[data-field="summary"]')?.value?.trim() || '',
    updatedAt: new Date().toISOString(),
  };
}

function activeMemoryTable() {
  return activeMemoryTableKey || 'registry';
}

function renderMemoryTable(table, chatCache) {
  if (table === 'state') return renderCharacterStateRows(chatCache.characters || {});
  if (table === 'scene') return renderSceneRows(chatCache.scene || emptySceneCache());
  return renderCharacterRegistryRows(chatCache.characterRegistry || {});
}

function tableLabel(table = activeMemoryTable()) {
  if (table === 'state') return '角色状态表';
  if (table === 'scene') return '场景表';
  return '角色外貌表';
}

function replaceMemoryTable(root, html) {
  const container = root.querySelector('#oit-character-registry');
  if (!container) return;
  container.innerHTML = html;
}

function currentTableJson(root, table = activeMemoryTable()) {
  if (table === 'state') return readCharacterStateFromPanel(root);
  if (table === 'scene') return readSceneFromPanel(root);
  return readCharacterRegistryFromPanel(root);
}

function characterRegistryManagerHtml() {
  const { chatCache } = getChatCache();
  const characterRegistry = ensureCoreCharacterMemory(chatCache);
  const table = activeMemoryTable();
  const label = tableLabel(table);
  return `
    <div class="wide100p padding5 dataBankAttachments" id="table_manager_container">
      <small>这是用于储存生图记忆数据的表格。编辑内容只在点击保存或表格整理时写入缓存。</small>
      <div id="tableEditTips"></div>
      <hr />
      <div id="oit-memory-table-tabs" class="oit-memory-table-tabs">
        <button class="menu_button ${table === 'registry' ? 'active' : ''}" data-table="registry" type="button">角色外貌</button>
        <button class="menu_button ${table === 'state' ? 'active' : ''}" data-table="state" type="button">角色状态</button>
        <button class="menu_button ${table === 'scene' ? 'active' : ''}" data-table="scene" type="button">场景</button>
      </div>
      <hr />
      <div style=" display: flex; justify-content: space-between; flex-wrap: wrap; ">
        <div style=" display: flex; justify-content: flex-start; flex-wrap: wrap; width: fit-content; gap: 4px;">
          <div style="display: flex; justify-content: center" id="oit-add-character" title="新增行">
            <i class="menu_button menu_button_icon fa-solid fa-plus" style="height: 30px; width: 30px"></i>
          </div>
          <div style="display: flex; justify-content: center" id="oit-save-characters" title="保存表格">
            <i class="menu_button menu_button_icon fa-solid fa-floppy-disk" style="height: 30px; width: 30px"></i>
          </div>
          <div style="display: flex; justify-content: center" id="table_rebuild_button" title="保存并整理当前表">
            <i class="menu_button menu_button_icon fa-solid fa-repeat">表格整理</i>
          </div>
        </div>
        <div style=" display: flex; justify-content: flex-end; flex-wrap: wrap; width: fit-content; gap: 4px;">
          <div style="display: flex; justify-content: center" id="copy_table_button" title="复制表格">
            <i class="menu_button menu_button_icon fa-solid fa-copy" style="height: 30px; width: 30px"></i>
          </div>
          <div style="display: flex; justify-content: center" id="clear_table_button" title="清空当前表">
            <i class="menu_button menu_button_icon fa-solid fa-trash-can redWarningBG" style="height: 30px; width: 30px"></i>
          </div>
        </div>
      </div>
      <hr />
      <div style="display: flex; justify-content: space-between; ">
        <div style="display: flex; justify-content: center" id="table_prev_button" title="前表">
          <i class="menu_button menu_button_icon fa-solid">&lt; 前表</i>
        </div>
        <div id="table_indicator">当前：${label}</div>
        <div style="display: flex; justify-content: center" id="table_next_button" title="后表">
          <i class="menu_button menu_button_icon fa-solid">后表 &gt;</i>
        </div>
      </div>
      <hr />
      <div id="oit_table_content_container">
        <div id="oit_table_inner_container">
          <div id="oit-character-registry" class="oit-character-registry table-mode">
            ${renderMemoryTable(table, { ...chatCache, characterRegistry })}
          </div>
        </div>
      </div>
    </div>
  `;
}

function saveCharacterRegistryFromRoot(root = document) {
  const registry = readCharacterRegistryFromPanel(root);
  const mainEntry = {
    ...buildMainCharacterRegistryEntry(),
    ...(registry[currentCharacterKey()] || {}),
    id: currentCharacterKey(),
    source: registry[currentCharacterKey()]?.source || 'sillytavern_card',
    locked: true,
  };
  const userKey = currentUserPersonaKey();
  const userEntry = {
    id: userKey,
    name: registry[userKey]?.name || currentUserPersonaName(),
    aliases: registry[userKey]?.aliases || ['我', '自己', '用户'],
    source: registry[userKey]?.source || 'sillytavern_persona',
    baseAppearance: registry[userKey]?.baseAppearance || '',
    negative: registry[userKey]?.negative || '',
    locked: Boolean(registry[userKey]?.locked),
    updatedAt: registry[userKey]?.updatedAt || new Date().toISOString(),
  };
  const profile = getVisualProfile();
  profile.base = mainEntry.baseAppearance || profile.base || '';
  profile.negative = mainEntry.negative || profile.negative || '';
  saveCurrentCharacterRegistry({
    ...registry,
    [currentCharacterKey()]: mainEntry,
    [userKey]: userEntry,
  });
  saveSettings();
}

function renderCharacterRegistryManager() {
  const drawer = document.querySelector('#oit_app_header_table_container');
  if (!drawer) return;
  drawer.innerHTML = characterRegistryManagerHtml();
  bindCharacterRegistryManager(drawer);
}

function saveActiveMemoryTable(root, table = activeMemoryTable()) {
  if (table === 'state') {
    saveCurrentCharactersState(readCharacterStateFromPanel(root));
    return;
  }
  if (table === 'scene') {
    saveCurrentScene(readSceneFromPanel(root));
    return;
  }
  saveCharacterRegistryFromRoot(root);
}

function addUnsavedMemoryRow(root, table = activeMemoryTable()) {
  if (table === 'state') {
    const charactersState = readCharacterStateFromPanel(root);
    const id = `npc:${Date.now()}`;
    charactersState[id] = {
      name: '新角色',
      currentOutfit: '',
      currentState: '',
      currentExpression: '',
      currentPose: '',
      lastSeenAt: '',
      updatedAt: new Date().toISOString(),
    };
    replaceMemoryTable(root, renderCharacterStateRows(charactersState));
    return;
  }
  if (table === 'scene') {
    toastr.info('场景表是当前聊天的单行记录，直接编辑后保存即可。', 'AI 生图插件');
    return;
  }

  const registry = readCharacterRegistryFromPanel(root);
  const id = `npc:${Date.now()}`;
  registry[id] = {
    id,
    name: '新角色',
    aliases: [],
    source: 'chat_context',
    baseAppearance: '',
    negative: '',
    locked: false,
    updatedAt: new Date().toISOString(),
  };
  replaceMemoryTable(root, renderCharacterRegistryRows(registry));
}

function clearUnsavedMemoryTable(root, table = activeMemoryTable()) {
  if (table === 'state') {
    replaceMemoryTable(root, renderCharacterStateRows({}));
    return;
  }
  if (table === 'scene') {
    replaceMemoryTable(root, renderSceneRows(emptySceneCache()));
    return;
  }
  const mainEntry = buildMainCharacterRegistryEntry();
  const userEntry = {
    id: currentUserPersonaKey(),
    name: currentUserPersonaName(),
    aliases: ['我', '自己', '用户'],
    source: 'sillytavern_persona',
    baseAppearance: '',
    negative: '',
    locked: false,
    updatedAt: new Date().toISOString(),
  };
  replaceMemoryTable(root, renderCharacterRegistryRows({ [mainEntry.id]: mainEntry, [userEntry.id]: userEntry }));
}

function bindCharacterRegistryManager(root) {
  root.querySelectorAll('#oit-memory-table-tabs [data-table]').forEach((button) => {
    button.addEventListener('click', () => {
      activeMemoryTableKey = button.dataset.table || 'registry';
      renderCharacterRegistryManager();
    });
  });

  root.querySelector('#table_prev_button')?.addEventListener('click', () => {
    const tables = ['registry', 'state', 'scene'];
    const index = tables.indexOf(activeMemoryTable());
    activeMemoryTableKey = tables[(index + tables.length - 1) % tables.length];
    renderCharacterRegistryManager();
  });

  root.querySelector('#table_next_button')?.addEventListener('click', () => {
    const tables = ['registry', 'state', 'scene'];
    const index = tables.indexOf(activeMemoryTable());
    activeMemoryTableKey = tables[(index + 1) % tables.length];
    renderCharacterRegistryManager();
  });

  root.querySelector('#oit-add-character')?.addEventListener('click', () => {
    addUnsavedMemoryRow(root);
  });

  root.querySelector('#oit-save-characters')?.addEventListener('click', () => {
    const label = tableLabel();
    saveActiveMemoryTable(root);
    renderCharacterRegistryManager();
    toastr.success(`${label}已保存`, 'AI 生图插件');
  });

  root.querySelector('#oit-close-character-manager')?.addEventListener('click', closeCharacterRegistryDrawer);

  root.querySelector('#copy_table_button')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(JSON.stringify(currentTableJson(root), null, 2));
    toastr.success(`${tableLabel()} JSON 已复制`, 'AI 生图插件');
  });

  root.querySelector('#clear_table_button')?.addEventListener('click', () => {
    clearUnsavedMemoryTable(root);
    toastr.info(`${tableLabel()}已在界面清空，点击保存后才会写入缓存。`, 'AI 生图插件');
  });

  root.querySelector('#table_rebuild_button')?.addEventListener('click', () => {
    const label = tableLabel();
    saveActiveMemoryTable(root);
    renderCharacterRegistryManager();
    toastr.info(`已按当前内容整理保存${label}`, 'AI 生图插件');
  });

  root.querySelector('#oit-character-registry')?.addEventListener('click', (event) => {
    const button = event.target.closest('.oit-delete-character, .oit-delete-state');
    if (!button || button.disabled) return;
    const row = button.closest('.oit-character-row, .oit-state-row');
    row?.remove();
  });
}

function openCharacterRegistryDrawer() {
  addCharacterRegistryTopBar();
  const drawer = document.querySelector('#oit_table_database_settings_drawer');
  const container = document.querySelector('#oit_app_header_table_container');
  if (drawer) drawer.hidden = false;
  if (!container) return;
  container.hidden = false;
  renderCharacterRegistryManager();
}

function closeCharacterRegistryDrawer() {
  const drawer = document.querySelector('#oit_table_database_settings_drawer');
  const container = document.querySelector('#oit_app_header_table_container');
  if (drawer) drawer.hidden = true;
  if (!container) return;
  container.hidden = true;
  container.innerHTML = '';
}

function addCharacterRegistryTopBar() {
  const menu = document.querySelector('#extensionsMenu');
  if (menu && !document.querySelector('#oit_memory_wand_container')) {
    const container = document.createElement('div');
    container.id = 'oit_memory_wand_container';
    container.className = 'extension_container';
    container.innerHTML = `
      <div id="oit_memory_wand_button" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="button">
        <div class="fa-solid fa-table extensionsMenuExtensionButton" title="打开 AI 生图缓存表格"></div>
        <span>AI 生图缓存表格</span>
      </div>
    `;
    menu.prepend(container);
    container.querySelector('#oit_memory_wand_button')?.addEventListener('click', openCharacterRegistryDrawer);
    document.querySelector('#extensionsMenuButton')?.style.setProperty('display', 'flex');
  }

  if (document.querySelector('#oit_table_database_settings_drawer')) return;
  const drawer = document.createElement('div');
  drawer.id = 'oit_table_database_settings_drawer';
  drawer.className = 'oit-memory-drawer';
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="oit-memory-drawer-content">
      <div class="oit-memory-drawer-header">
        <strong><i class="fa-solid fa-table"></i> AI 生图缓存表格</strong>
        <button id="oit_character_close_button" class="menu_button menu_button_icon interactable" type="button" title="关闭">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div id="oit_app_header_table_container" class="oit-memory-inline" hidden></div>
    </div>
  `;
  document.body.appendChild(drawer);
  drawer.querySelector('#oit_character_close_button')?.addEventListener('click', closeCharacterRegistryDrawer);
}

async function refreshModels() {
  const s = settings();
  if (!String(s.baseUrl || '').trim()) throw new Error('请先填写图片接口地址');
  if (!String(s.apiSecretId || getBrowserApiKey()).trim()) throw new Error('请先保存 API 密钥');
  const data = await shouldUseProxy(s)
    ? await proxyPost('/models', {
      baseUrl: s.baseUrl,
      apiSecretKey: IMAGE_SECRET_KEY,
      apiSecretId: s.apiSecretId,
    })
    : await directRefreshModels();
  const select = document.querySelector('#oit-model-select');
  if (!select) return;
  select.innerHTML = `<option value="">Select model</option>${(data.models || []).map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')}`;
}

async function directRefreshModels() {
  const s = settings();
  const apiKey = getBrowserApiKey();
  if (!apiKey) throw new Error('当前为纯前端模式，请先保存 API 密钥到浏览器');
  const root = normalizeBaseUrl(s.baseUrl);
  const data = await directJson(`${root}/v1/models`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return {
    models: Array.isArray(data?.data)
      ? data.data.map(model => model.id || model.name).filter(Boolean)
      : [],
  };
}

async function saveApiSecret() {
  const input = document.querySelector('#oit-api-key');
  const value = String(input?.value || '').trim();
  if (!value) throw new Error('请输入 API 密钥');

  if (await isProxyAvailable(true)) {
    const id = await writeSecret(IMAGE_SECRET_KEY, value, `AI 生图插件 - ${currentUserId()}`, { allowEmpty: false });
    if (!id) throw new Error('密钥保存失败，请检查酒馆密钥权限');

    const s = settings();
    s.apiSecretId = id;
    clearBrowserApiKey();
    if (input) {
      input.value = '';
      input.placeholder = '已保存到酒馆密钥库，重新输入可覆盖';
    }
    saveSettings();
    return 'proxy';
  }

  const s = settings();
  s.apiSecretId = '';
  saveBrowserApiKey(value);
  if (input) {
    input.value = '';
    input.placeholder = '已保存到当前浏览器，重新输入可覆盖';
  }
  saveSettings();
  return 'browser';
}

async function savePromptApiSecret() {
  const input = document.querySelector('#oit-prompt-api-key');
  const value = String(input?.value || '').trim();
  if (!value) throw new Error('请输入补全 API 密钥');

  if (await isProxyAvailable(true)) {
    const id = await writeSecret(PROMPT_SECRET_KEY, value, `AI 生图插件补全 - ${currentUserId()}`, { allowEmpty: false });
    if (!id) throw new Error('补全密钥保存失败，请检查酒馆密钥权限');

    const s = settings();
    s.promptApiSecretId = id;
    clearPromptBrowserApiKey();
    if (input) {
      input.value = '';
      input.placeholder = '已保存补全密钥到酒馆密钥库，重新输入可覆盖';
    }
    saveSettings();
    return 'proxy';
  }

  const s = settings();
  s.promptApiSecretId = '';
  savePromptBrowserApiKey(value);
  if (input) {
    input.value = '';
    input.placeholder = '已保存补全密钥到当前浏览器，重新输入可覆盖';
  }
  saveSettings();
  return 'browser';
}

function apiKeyPlaceholder(s) {
  if (s.apiSecretId) return '图片密钥已保存到酒馆密钥库，重新输入可覆盖';
  if (getBrowserApiKey()) return '图片密钥已保存到当前浏览器，重新输入可覆盖';
  return '输入图片 API 密钥后点击保存';
}

function promptApiKeyPlaceholder(s) {
  if (s.promptApiSecretId) return '补全密钥已保存到酒馆密钥库，重新输入可覆盖';
  if (getPromptBrowserApiKey()) return '补全密钥已保存到当前浏览器，重新输入可覆盖';
  return '输入补全 API 密钥后点击保存';
}

function storageModeText(s) {
  const image = s.apiSecretId ? '图片：酒馆密钥库' : getBrowserApiKey() ? '图片：浏览器本地' : '图片：未保存';
  const prompt = s.promptApiSecretId ? '补全：酒馆密钥库' : getPromptBrowserApiKey() ? '补全：浏览器本地' : '补全：未保存';
  return `${image} / ${prompt}`;
}

function renderDebugLogText() {
  const output = document.querySelector('#oit-debug-log');
  if (output) output.value = debugLogsText();
}

function extractKeywordPrompt(text) {
  const s = settings();
  const raw = String(text || '').trim();
  const triggers = String(s.keywordTriggers || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  for (const trigger of triggers) {
    if (raw.startsWith(`${trigger}:`) || raw.startsWith(`${trigger}：`)) {
      return raw.slice(trigger.length + 1).trim() || 'Generate the current scene from recent chat context.';
    }
    if (raw === trigger) {
      return 'Generate the current scene from recent chat context.';
    }
    if (raw.startsWith(`${trigger} `)) {
      return raw.slice(trigger.length).trim() || 'Generate the current scene from recent chat context.';
    }
  }
  return '';
}

function extractTagPrompt(text) {
  const match = String(text || '').match(/<image_prompt(?:\s[^>]*)?>([\s\S]*?)<\/image_prompt>/i);
  return match?.[1]?.trim() || '';
}

async function onMessageRendered(messageId) {
  const s = settings();
  if (!s.enabled) return;
  const message = chat?.[messageId];
  const prompt = extractTagPrompt(message?.mes || '');
  if (s.autoConfirmTagTrigger && prompt) {
    try {
      await handleGenerate(prompt, { triggerType: 'tag', triggerSource: 'user_intent', messageId });
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
    return;
  }
  await maybeAutoGenerateAfterReply(message, messageId);
}

function isAssistantReplyForAutoTrigger(message) {
  return Boolean(
    message
    && !message.is_user
    && !message.is_system
    && !message?.extra?.openaiImageTavern
    && stripHtml(message.mes || '')
  );
}

function updateAutoTriggerCache(updater) {
  const { cache, userId, chatId, chatCache } = getChatCache();
  chatCache.autoTrigger = {
    ...emptyAutoTriggerCache(),
    ...(chatCache.autoTrigger || {}),
  };
  updater(chatCache.autoTrigger);
  cache.users[userId].chats[chatId] = chatCache;
  saveBrowserCache(cache);
  return chatCache.autoTrigger;
}

async function maybeAutoGenerateAfterReply(message, messageId) {
  const s = settings();
  if (!s.autoGenerateEnabled || autoTriggerRunning || !isAssistantReplyForAutoTrigger(message)) return;
  const threshold = Math.max(1, Number(s.autoGenerateEveryReplies || 3));
  const state = updateAutoTriggerCache((autoTrigger) => {
    if (String(autoTrigger.lastMessageId) === String(messageId)) return;
    autoTrigger.repliesSinceLastImage = Number(autoTrigger.repliesSinceLastImage || 0) + 1;
    autoTrigger.lastMessageId = messageId;
  });
  if (Number(state.repliesSinceLastImage || 0) < threshold) return;

  updateAutoTriggerCache((autoTrigger) => {
    autoTrigger.repliesSinceLastImage = 0;
    autoTrigger.lastTriggeredAt = new Date().toISOString();
  });

  autoTriggerRunning = true;
  try {
    await handleGenerate('Generate the current roleplay scene from the latest context.', {
      triggerType: 'auto_reply_count',
      triggerSource: 'current_scene',
      messageId,
    });
    toastr.success(`已自动按最近 ${threshold} 条回复生成图片`, 'AI 生图插件');
  } catch (error) {
    toastr.error(error.message, 'AI 生图插件');
  } finally {
    autoTriggerRunning = false;
  }
}

function renderPanel() {
  document.querySelector('#openai-image-tavern-panel')?.remove();
  addPanel();
}

function addPanel() {
  if (document.querySelector('#openai-image-tavern-panel')) return;
  const container = document.querySelector('#extensions_settings2') || document.body;
  const s = settings();
  const panel = document.createElement('div');
  panel.id = 'openai-image-tavern-panel';
  panel.className = s.panelExpanded ? 'expanded' : '';
  panel.innerHTML = `
    <div class="oit-panel-header">
      <div class="oit-title-wrap">
        <div class="oit-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div>
          <strong>AI 生图助手</strong>
          <small>${s.enabled ? '已启用' : '已停用'} · 最近 ${Number(s.contextDepth || 8)} 条上下文 · ${currentCharacterName()}</small>
        </div>
      </div>
      <button id="oit-panel-toggle" class="menu_button" type="button">${s.panelExpanded ? '收起' : '展开'}</button>
    </div>
    <div class="oit-panel-body">
      <div class="oit-hero">
        <div class="oit-status">
          <span><i class="fa-solid fa-key"></i>${storageModeText(s)}</span>
          <span><i class="fa-solid fa-route"></i>自动选择后端代理 / 浏览器直连</span>
        </div>
        <div class="oit-checks">
          <label class="oit-switch"><input type="checkbox" id="oit-enabled" ${s.enabled ? 'checked' : ''}><span></span><b>启用插件</b></label>
          <label class="oit-switch"><input type="checkbox" id="oit-use-character" ${s.useCharacterCard ? 'checked' : ''}><span></span><b>读取角色卡</b></label>
          <label class="oit-switch"><input type="checkbox" id="oit-use-context" ${s.useChatContext ? 'checked' : ''}><span></span><b>使用上下文</b></label>
        </div>
      </div>

      <div class="oit-section">
        <div class="oit-section-head">
          <div><b>快速生成</b><small>直接从聊天上下文、上一条回复或手动补充触发</small></div>
        </div>
        <div class="oit-action-grid">
          <button id="oit-generate-current" class="menu_button"><i class="fa-solid fa-clapperboard"></i><span>当前场景</span></button>
          <button id="oit-generate-last" class="menu_button"><i class="fa-solid fa-reply"></i><span>上一条回复</span></button>
        </div>
        <label class="oit-field oit-full"><span>本次补充提示词</span><textarea id="oit-prompt" rows="3" placeholder="可选：本次额外想画什么。留空时会按聊天上下文生成。"></textarea></label>
        <div class="oit-actions">
          <button id="oit-generate" class="menu_button"><i class="fa-solid fa-image"></i> 按补充内容生图</button>
        </div>
      </div>

      <details class="oit-section oit-advanced" open>
        <summary><span><i class="fa-solid fa-plug"></i> 接口配置</span><small>兼容 OpenAI 格式图片接口</small></summary>
        <div class="oit-row">
          <label class="oit-field"><span>图片接口地址</span><input id="oit-base-url" value="${escapeHtml(s.baseUrl)}"></label>
          <label class="oit-field"><span>补全接口地址</span><input id="oit-prompt-base-url" value="${escapeHtml(s.promptBaseUrl || '')}" placeholder="留空则自动读取酒馆当前聊天补全接口"></label>
        </div>
        <div class="oit-row">
          <label class="oit-field"><span>图片 API 密钥</span><input id="oit-api-key" type="text" value="" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="${apiKeyPlaceholder(s)}"></label>
          <label class="oit-field"><span>图片模型</span><input id="oit-model" value="${escapeHtml(s.model)}"></label>
        </div>
        <div class="oit-row">
          <label class="oit-field"><span>补全 API 密钥</span><input id="oit-prompt-api-key" type="text" value="" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="${promptApiKeyPlaceholder(s)}"></label>
          <label class="oit-field"><span>补全模型</span><input id="oit-prompt-model" value="${escapeHtml(s.promptModel || '')}" placeholder="留空读取酒馆当前模型"></label>
        </div>
        <div class="oit-row">
          <label class="oit-field"><span>模型列表</span><select id="oit-model-select"><option value="">先刷新模型</option></select></label>
          <label class="oit-field"><span>图片尺寸</span><input id="oit-size" value="${escapeHtml(s.size)}"></label>
        </div>
        <div class="oit-row">
          <label class="oit-field"><span>返回格式</span><select id="oit-response"><option value="url">url</option><option value="b64_json">b64_json</option></select></label>
        </div>
        <div class="oit-actions">
          <button id="oit-save-api-key" class="menu_button"><i class="fa-solid fa-lock"></i> 保存图片密钥</button>
          <button id="oit-save-prompt-api-key" class="menu_button"><i class="fa-solid fa-key"></i> 保存补全密钥</button>
          <button id="oit-refresh-models" class="menu_button"><i class="fa-solid fa-rotate"></i> 刷新模型</button>
        </div>
      </details>

      <details class="oit-section oit-advanced" open>
        <summary><span><i class="fa-solid fa-palette"></i> 画面控制</span><small>画风、连贯性和自动触发</small></summary>
        <div class="oit-row">
          <label class="oit-field"><span>连贯性模式</span><select id="oit-continuity-mode"><option value="smart">智能判断</option><option value="force">强制继承上一张</option><option value="off">关闭连贯性</option></select></label>
          <label class="oit-field"><span>状态缓存</span><select id="oit-update-continuity"><option value="true">生成后更新缓存</option><option value="false">不更新缓存</option></select></label>
        </div>
        <div class="oit-checks">
          <label class="oit-switch"><input type="checkbox" id="oit-safe-mode" ${s.safeMode !== false ? 'checked' : ''}><span></span><b>安全模式</b></label>
          <label class="oit-switch"><input type="checkbox" id="oit-detect-transition" ${s.detectSceneTransition ? 'checked' : ''}><span></span><b>自动识别转场</b></label>
        </div>
        <div class="oit-row">
          <label class="oit-field"><span>自动触发间隔</span><input id="oit-auto-replies" type="number" min="1" max="50" step="1" value="${Number(s.autoGenerateEveryReplies || 3)}" placeholder="例如：3"></label>
        </div>
        <div class="oit-checks">
          <label class="oit-switch"><input type="checkbox" id="oit-auto-generate" ${s.autoGenerateEnabled ? 'checked' : ''}><span></span><b>每隔 N 条角色回复自动生图</b></label>
        </div>
        <label class="oit-field oit-full"><span>画风预设</span><textarea id="oit-style-preset" rows="2" placeholder="例如：日系动漫风，干净线稿，鲜明色彩">${escapeHtml(s.stylePreset || '')}</textarea></label>
        <div class="oit-actions">
          <button id="oit-clear-character-cache" class="menu_button"><i class="fa-solid fa-user-slash"></i> 清除角色外貌缓存</button>
          <button id="oit-clear-chat-cache" class="menu_button"><i class="fa-solid fa-broom"></i> 清除当前聊天缓存</button>
        </div>
      </details>

      <details class="oit-section oit-advanced">
        <summary><span><i class="fa-solid fa-bug"></i> 调试日志</span><small>查看提示词 JSON 和模型返回</small></summary>
        <label class="oit-field oit-full">
          <span>最近 20 条请求/返回日志</span>
          <textarea id="oit-debug-log" rows="14" readonly>${escapeHtml(debugLogsText())}</textarea>
        </label>
        <div class="oit-actions">
          <button id="oit-refresh-debug-log" class="menu_button"><i class="fa-solid fa-rotate"></i> 刷新日志</button>
          <button id="oit-copy-debug-log" class="menu_button"><i class="fa-solid fa-copy"></i> 复制日志</button>
          <button id="oit-clear-debug-log" class="menu_button"><i class="fa-solid fa-trash-can"></i> 清空日志</button>
        </div>
      </details>

      <div id="oit-preview" class="oit-preview"></div>
    </div>
  `;
  container.appendChild(panel);
  document.querySelector('#oit-response').value = s.responseFormat;
  document.querySelector('#oit-continuity-mode').value = s.continuityMode || 'smart';
  document.querySelector('#oit-update-continuity').value = String(s.updateContinuityCache !== false);

  bindPanel();
}

function bindPanel() {
  const s = settings();
  const bindValue = (selector, key) => {
    document.querySelector(selector)?.addEventListener('change', (event) => {
      s[key] = event.target.value;
      saveSettings();
    });
  };

  document.querySelector('#oit-panel-toggle')?.addEventListener('click', () => {
    s.panelExpanded = !s.panelExpanded;
    saveSettings();
    document.querySelector('#openai-image-tavern-panel')?.classList.toggle('expanded', s.panelExpanded);
    document.querySelector('#oit-panel-toggle').textContent = s.panelExpanded ? '收起' : '展开';
  });

  document.querySelector('#oit-enabled')?.addEventListener('change', (event) => {
    s.enabled = event.target.checked;
    saveSettings();
  });

  document.querySelector('#oit-use-character')?.addEventListener('change', (event) => {
    s.useCharacterCard = event.target.checked;
    saveSettings();
  });

  document.querySelector('#oit-use-context')?.addEventListener('change', (event) => {
    s.useChatContext = event.target.checked;
    saveSettings();
  });

  bindValue('#oit-base-url', 'baseUrl');
  bindValue('#oit-prompt-base-url', 'promptBaseUrl');
  bindValue('#oit-model', 'model');
  bindValue('#oit-prompt-model', 'promptModel');
  bindValue('#oit-size', 'size');
  bindValue('#oit-response', 'responseFormat');
  bindValue('#oit-style-preset', 'stylePreset');
  bindValue('#oit-continuity-mode', 'continuityMode');

  document.querySelector('#oit-update-continuity')?.addEventListener('change', (event) => {
    s.updateContinuityCache = event.target.value === 'true';
    saveSettings();
  });

  document.querySelector('#oit-detect-transition')?.addEventListener('change', (event) => {
    s.detectSceneTransition = event.target.checked;
    saveSettings();
  });

  document.querySelector('#oit-safe-mode')?.addEventListener('change', (event) => {
    s.safeMode = event.target.checked;
    saveSettings();
  });

  document.querySelector('#oit-auto-generate')?.addEventListener('change', (event) => {
    s.autoGenerateEnabled = event.target.checked;
    saveSettings();
  });

  document.querySelector('#oit-auto-replies')?.addEventListener('change', (event) => {
    s.autoGenerateEveryReplies = Math.max(1, Number(event.target.value || 3));
    event.target.value = String(s.autoGenerateEveryReplies);
    saveSettings();
  });

  document.querySelector('#oit-model-select')?.addEventListener('change', (event) => {
    if (!event.target.value) return;
    s.model = event.target.value;
    document.querySelector('#oit-model').value = event.target.value;
    saveSettings();
  });

  document.querySelector('#oit-clear-character-cache')?.addEventListener('click', () => {
    clearCurrentCharacterVisualCache();
    renderPanel();
    toastr.success(`已清除 ${currentCharacterName()} 的角色外貌缓存`, 'AI 生图插件');
  });

  document.querySelector('#oit-open-memory-table')?.addEventListener('click', () => {
    openCharacterRegistryDrawer();
  });

  document.querySelector('#oit-clear-chat-cache')?.addEventListener('click', () => {
    clearCurrentChatCache();
    renderPanel();
    toastr.success('已清除当前聊天的场景、角色状态和连贯性缓存', 'AI 生图插件');
  });

  document.querySelector('#oit-refresh-debug-log')?.addEventListener('click', () => {
    renderDebugLogText();
    toastr.info('日志已刷新', 'AI 生图插件');
  });

  document.querySelector('#oit-copy-debug-log')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(debugLogsText());
    toastr.success('调试日志已复制', 'AI 生图插件');
  });

  document.querySelector('#oit-clear-debug-log')?.addEventListener('click', () => {
    clearDebugLogs();
    renderDebugLogText();
    toastr.success('调试日志已清空', 'AI 生图插件');
  });

  document.querySelector('#oit-refresh-models')?.addEventListener('click', async () => {
    try {
      await refreshModels();
      toastr.success('模型列表已刷新', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });

  document.querySelector('#oit-save-api-key')?.addEventListener('click', async () => {
    try {
      await saveApiSecret();
      renderPanel();
      toastr.success('图片 API 密钥已保存', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });

  document.querySelector('#oit-save-prompt-api-key')?.addEventListener('click', async () => {
    try {
      await savePromptApiSecret();
      renderPanel();
      toastr.success('补全 API 密钥已保存', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });

  document.querySelector('#oit-generate')?.addEventListener('click', async () => {
    const prompt = document.querySelector('#oit-prompt')?.value || '';
    try {
      await handleGenerate(prompt, { triggerType: 'manual_input', triggerSource: 'user_intent' });
      toastr.success('图片已生成', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });

  document.querySelector('#oit-generate-current')?.addEventListener('click', async () => {
    try {
      await handleGenerate('Generate the current roleplay scene from the latest context.', {
        triggerType: 'manual_menu',
        triggerSource: 'current_scene',
      });
      toastr.success('已按上下文生成图片', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });

  document.querySelector('#oit-generate-last')?.addEventListener('click', async () => {
    const last = getLastAssistantMessageInfo();
    try {
      await handleGenerate(last.text || 'Generate the latest character action from recent context.', {
        triggerType: 'manual_menu',
        triggerSource: 'last_reply',
        targetMessageId: last.id,
      });
      toastr.success('已按上一条回复生成图片', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  });
}

function getLastAssistantMessageInfo() {
  for (let index = (chat || []).length - 1; index >= 0; index--) {
    const message = chat[index];
    if (!message?.is_user && !message?.is_system && !message?.extra?.openaiImageTavern) {
      return { id: index, text: stripHtml(message.mes || '') };
    }
  }
  return { id: null, text: '' };
}

function getLastAssistantMessage() {
  return getLastAssistantMessageInfo().text;
}

function addChatMenu() {
  const optionsContent = document.querySelector('#options .options-content');
  if (!optionsContent || document.querySelector('#oit-option-current')) return;
  document.querySelector('#oit-chat-menu')?.remove();
  document.querySelector('#oit-chat-popover')?.remove();
  optionsContent.insertAdjacentHTML('beforeend', `
    <hr id="oit-options-separator">
    <a id="oit-option-current" class="oit-options-entry">
      <i class="fa-lg fa-solid fa-clapperboard"></i>
      <span>AI 生图：当前场景</span>
    </a>
    <a id="oit-option-last" class="oit-options-entry">
      <i class="fa-lg fa-solid fa-reply"></i>
      <span>AI 生图：上一条回复</span>
    </a>
    <a id="oit-option-input" class="oit-options-entry">
      <i class="fa-lg fa-solid fa-pen-nib"></i>
      <span>AI 生图：输入框补充</span>
    </a>
  `);

  bindNativeOptionsMenuItems();
}

function hideNativeOptionsMenu() {
  const menu = document.querySelector('#options');
  if (menu) menu.style.display = 'none';
}

function bindNativeOptionsMenuItems() {
  document.querySelector('#oit-option-current')?.addEventListener('click', async (event) => {
    event.preventDefault();
    hideNativeOptionsMenu();
    await generateFromMenu('Generate the current roleplay scene from the latest context.', 'current_scene');
  });

  document.querySelector('#oit-option-last')?.addEventListener('click', async (event) => {
    event.preventDefault();
    hideNativeOptionsMenu();
    const last = getLastAssistantMessageInfo();
    await generateFromMenu(last.text || 'Generate the latest character action from recent context.', 'last_reply', {
      targetMessageId: last.id,
    });
  });

  document.querySelector('#oit-option-input')?.addEventListener('click', async (event) => {
    event.preventDefault();
    hideNativeOptionsMenu();
    const textarea = document.querySelector('#send_textarea');
    const prompt = textarea?.value?.trim() || 'Generate the current roleplay scene from the latest context.';
    if (textarea) {
      textarea.value = '';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await generateFromMenu(prompt, 'user_intent');
  });
}

async function generateFromMenu(prompt, triggerSource = 'current_scene', extraOptions = {}) {
  if (!settings().enabled) return;
  try {
    await handleGenerate(prompt, { triggerType: 'manual_menu', triggerSource, ...extraOptions });
    toastr.success('已按上下文生成图片', 'AI 生图插件');
  } catch (error) {
    toastr.error(error.message, 'AI 生图插件');
  }
}

function patchSendForKeywordTrigger() {
  const textarea = document.querySelector('#send_textarea');
  const sendButton = document.querySelector('#send_but');
  if (!textarea || !sendButton || sendButton.dataset.oitPatched) return;
  sendButton.dataset.oitPatched = '1';
  sendButton.addEventListener('click', async (event) => {
    const prompt = extractKeywordPrompt(textarea.value || '');
    if (!settings().enabled || !prompt) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      await handleGenerate(prompt, { triggerType: 'manual_input', triggerSource: 'user_intent' });
      toastr.success('已按聊天上下文生成图片', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  }, true);

  textarea.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const prompt = extractKeywordPrompt(textarea.value || '');
    if (!settings().enabled || !prompt) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      await handleGenerate(prompt, { triggerType: 'manual_input', triggerSource: 'user_intent' });
      toastr.success('已按聊天上下文生成图片', 'AI 生图插件');
    } catch (error) {
      toastr.error(error.message, 'AI 生图插件');
    }
  }, true);
}

function restoreChatShellCentering() {
  const shell = document.querySelector('#sheld');
  if (!shell || shell.dataset.dragged === 'true') return;
  if (shell.style.margin === 'unset') shell.style.removeProperty('margin');
  shell.style.setProperty('margin-left', 'auto', 'important');
  shell.style.setProperty('margin-right', 'auto', 'important');
}

function scheduleRestoreChatShellCentering() {
  [0, 300, 1000].forEach(delay => setTimeout(restoreChatShellCentering, delay));
}

jQuery(async () => {
  console.info('[openai-image-tavern] loaded');
  settings();
  addPanel();
  addChatMenu();
  addCharacterRegistryTopBar();
  patchSendForKeywordTrigger();
  scheduleRestoreChatShellCentering();
  scheduleCleanupLegacyGeneratedMedia();
  eventSource.on(event_types.MESSAGE_RECEIVED, onMessageRendered);
  eventSource.on(event_types.CHAT_CHANGED, () => {
    setTimeout(() => {
      renderPanel();
      addChatMenu();
      addCharacterRegistryTopBar();
      patchSendForKeywordTrigger();
      scheduleRestoreChatShellCentering();
      scheduleCleanupLegacyGeneratedMedia();
    }, 500);
  });
});
