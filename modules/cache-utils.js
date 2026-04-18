import { truncateText, isPlainObject } from './utils.js';

export const CACHE_PLACEHOLDER_VALUES = new Set([
  'character_id',
  'name',
  'stable appearance only',
  'negative constraints',
  'current outfit',
  'short current visual state',
  'expression',
  'pose/action',
  'inferred location',
  'inferred time',
  'inferred weather',
  'visual mood',
  'camera/framing',
  'one concise visual scene summary',
  'final prompt or short prompt summary',
  'visual summary of generated image target',
  'identity anchor',
  'outfit anchor',
  'scene anchor',
  'camera anchor',
  'mood anchor',
  'style anchor',
  'scene id',
  'iso time or empty',
  'existing_or_new_character_id',
  'final prompt summary',
  'visual result summary',
  'generate the current roleplay scene from the latest context.',
  'generate the current roleplay scene from context.',
  'generate the current scene from recent chat context.',
]);

export function meaningfulString(value, maxLength = 0) {
  const text = String(value || '').trim();
  return maxLength ? truncateText(text, maxLength) : text;
}

export function cacheString(value, maxLength = 0) {
  const text = meaningfulString(value, maxLength);
  if (!text) return '';
  if (CACHE_PLACEHOLDER_VALUES.has(text.toLowerCase())) return '';
  return text;
}

export function asStringArray(value, maxItems = 12, itemMaxLength = 80) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return list
    .map(item => cacheString(item, itemMaxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export { isPlainObject };

