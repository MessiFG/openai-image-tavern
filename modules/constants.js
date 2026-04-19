export const EXTENSION_NAME = 'openai-image-tavern';
export const PROXY_BASE = '/api/plugins/openai-image-proxy';
export const CACHE_KEY = 'openai-image-tavern-cache-v1';
export const BROWSER_SECRET_KEY = 'openai-image-tavern-api-key-v1';
export const PROMPT_BROWSER_SECRET_KEY = 'openai-image-tavern-prompt-api-key-v1';
export const DEBUG_LOG_KEY = 'openai-image-tavern-debug-log-v1';
export const IMAGE_SECRET_KEY = 'openai_image_tavern_api_key';
export const PROMPT_SECRET_KEY = 'openai_image_tavern_prompt_api_key';

export const DEFAULT_SETTINGS = {
  enabled: true,
  baseUrl: '',
  promptBaseUrl: '',
  apiSecretId: '',
  promptApiSecretId: '',
  model: '',
  promptModel: '',
  size: '1024x1024',
  n: 1,
  responseFormat: 'url',
  stylePreset: 'Japanese anime style, clean line art, expressive character design, vibrant colors, cinematic lighting',
  safeMode: false,
  keywordTriggers: '文生图,/image',
  autoConfirmTagTrigger: true,
  autoGenerateEnabled: false,
  autoGenerateEveryReplies: 3,
  useChatContext: true,
  useCharacterCard: true,
  continuityMode: 'smart',
  decoupledSync: false,
  updateContinuityCache: true,
  detectSceneTransition: true,
  panelExpanded: false,
  contextDepth: 8,
  maxCharacterText: 1600,
  maxContextText: 2200,
  visualProfiles: {},
};

