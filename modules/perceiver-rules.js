/**
 * AI Image Tavern - 本地感知规则词典
 * 用于实现“感知-替换-同步”的底层解耦逻辑
 */

// 1. 视觉触发词 (决定是否需要处理视觉状态)
export const VISUAL_TRIGGERS = [
  '走', '跑', '坐', '躺', '换', '脱', '穿', '戴', '拿', '握',
  '红', '蓝', '白', '黑', '光', '背景', '环境', '姿势', '身体', '衣服', '脸红', '笑'
];

// 2. 状态映射词典 (本地直接替换的规则)
// 映射格式: 关键词 -> { table, field, value }
export const STATE_MAPPINGS = {
  // 场景位置 (Scene)
  '卧室': { table: 'scene', field: 'location', value: '卧室' },
  '客厅': { table: 'scene', field: 'location', value: '客厅' },
  '浴室': { table: 'scene', field: 'location', value: '浴室' },
  '卫生间': { table: 'scene', field: 'location', value: '浴室' },
  '厨房': { table: 'scene', field: 'location', value: '厨房' },
  '海边': { table: 'scene', field: 'location', value: '海边' },
  '酒店': { table: 'scene', field: 'location', value: '酒店房间' },
  '公园': { table: 'scene', field: 'location', value: '公园' },

  // 简单表情 (Characters.currentExpression)
  '脸红': { table: 'characters', field: 'currentExpression', value: '脸红' },
  '微笑': { table: 'characters', field: 'currentExpression', value: '微笑' },
  '大笑': { table: 'characters', field: 'currentExpression', value: '大笑' },
  '哭泣': { table: 'characters', field: 'currentExpression', value: '流泪' },
  '生气': { table: 'characters', field: 'currentExpression', value: '生气' },

  // 简单动作/姿势 (Characters.currentPose)
  '坐下': { table: 'characters', field: 'currentPose', value: '坐姿' },
  '躺下': { table: 'characters', field: 'currentPose', value: '躺着' },
  '站起来': { table: 'characters', field: 'currentPose', value: '站立' },

  // 简单服装更新 (Characters.currentOutfit)
  '脱掉外衣': { table: 'characters', field: 'currentOutfit', value: '内衣/简陋服装' },
  '全裸': { table: 'characters', field: 'currentOutfit', value: '赤裸' },
  '赤裸': { table: 'characters', field: 'currentOutfit', value: '赤裸' },
};

// 3. 转场指示词 (识别大变动，需强制 LLM 同步)
export const TRANSITION_INDICATORS = [
  '第二天', '很久以后', '离开', '出发', '转场', '瞬间', '几个小时后'
];

// 4. 身份模式词 (用于推断目标角色)
export const IDENTITY_PATTERNS = {
  self: ['我', '本尊', '老子'],
  target: ['你', '她', '他', '它', '妹妹', '姐姐']
};
