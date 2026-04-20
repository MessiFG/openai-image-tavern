/**
 * AI Image Tavern - 本地感知规则主入口
 * 聚合所有分类词库
 */
import { SCENE_RULES } from './rules/scene.js';
import { CHARACTER_RULES } from './rules/characters.js';
import { OUTFIT_RULES } from './rules/outfits.js';

// 1. 视觉触发词 (决定是否需要处理视觉状态)
export const VISUAL_TRIGGERS = [
  '走', '跑', '坐', '躺', '换', '脱', '穿', '戴', '拿', '握', '看', '望',
  '红', '蓝', '白', '黑', '金', '绿', '紫', '粉', '银',
  '光', '影', '背景', '环境', '姿势', '身体', '衣服', '服饰', '脸红', '笑',
  '表情', '眼神', '距离', '靠近', '接触', '手', '脚', '头发', '皮肤'
];

// 2. 状态映射词典 (合并所有子词库)
export const STATE_MAPPINGS = {
  ...SCENE_RULES,
  ...CHARACTER_RULES,
  ...OUTFIT_RULES
};

// 3. 转场指示词
export const TRANSITION_INDICATORS = [
  '第二天', '很久以后', '离开', '出发', '转场', '瞬间', '几个小时后', '傍晚时分', '深夜', '次日', '到了晚上'
];

// 4. 身份模式词
export const IDENTITY_PATTERNS = {
  self: ['我', '本尊', '老子', '老娘', '人家'],
  target: ['你', '她', '他', '它', '妹妹', '姐姐', '老师', '学姐', '主人', '大小姐']
};
