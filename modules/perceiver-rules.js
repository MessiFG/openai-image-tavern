/**
 * AI Image Tavern - 本地感知规则词典
 * 用于实现“感知-替换-同步”的底层解耦逻辑
 */

// 1. 视觉触发词 (决定是否需要处理视觉状态)
export const VISUAL_TRIGGERS = [
  '走', '跑', '坐', '躺', '换', '脱', '穿', '戴', '拿', '握', '看', '望',
  '红', '蓝', '白', '黑', '金', '绿', '紫', '粉', '银',
  '光', '影', '背景', '环境', '姿势', '身体', '衣服', '服饰', '脸红', '笑',
  '表情', '眼神', '距离', '靠近', '接触', '手', '脚', '头发', '皮肤'
];

// 2. 状态映射词典 (本地直接替换的规则)
// 映射格式: 关键词 -> { table, field, value }
export const STATE_MAPPINGS = {
  // === 场景位置 (Scene.location) ===
  '卧室': { table: 'scene', field: 'location', value: '卧室' },
  '客厅': { table: 'scene', field: 'location', value: '客厅' },
  '浴室': { table: 'scene', field: 'location', value: '浴室' },
  '洗手间': { table: 'scene', field: 'location', value: '浴室' },
  '卫生间': { table: 'scene', field: 'location', value: '浴室' },
  '厨房': { table: 'scene', field: 'location', value: '厨房' },
  '海边': { table: 'scene', field: 'location', value: '海边沙滩' },
  '沙滩': { table: 'scene', field: 'location', value: '海边沙滩' },
  '酒店': { table: 'scene', field: 'location', value: '酒店房间' },
  '公园': { table: 'scene', field: 'location', value: '公园' },
  '学校': { table: 'scene', field: 'location', value: '学校校园' },
  '教室': { table: 'scene', field: 'location', value: '教室' },
  '办公室': { table: 'scene', field: 'location', value: '办公室' },
  '街道': { table: 'scene', field: 'location', value: '城市街道' },
  '商场': { table: 'scene', field: 'location', value: '商场' },
  '屋顶': { table: 'scene', field: 'location', value: '屋顶天台' },
  '天台': { table: 'scene', field: 'location', value: '屋顶天台' },
  '森林': { table: 'scene', field: 'location', value: '森林' },
  '地牢': { table: 'scene', field: 'location', value: '地牢' },

  // === 简单表情 (Characters.currentExpression) ===
  '脸红': { table: 'characters', field: 'currentExpression', value: '脸红/娇羞' },
  '害羞': { table: 'characters', field: 'currentExpression', value: '脸红/娇羞' },
  '羞涩': { table: 'characters', field: 'currentExpression', value: '脸红/娇羞' },
  '微笑': { table: 'characters', field: 'currentExpression', value: '微笑' },
  '大笑': { table: 'characters', field: 'currentExpression', value: '大笑/开心' },
  '开心': { table: 'characters', field: 'currentExpression', value: '大笑/开心' },
  '哭泣': { table: 'characters', field: 'currentExpression', value: '流泪/悲伤' },
  '流泪': { table: 'characters', field: 'currentExpression', value: '流泪/悲伤' },
  '生气': { table: 'characters', field: 'currentExpression', value: '生气/愤怒' },
  '愤怒': { table: 'characters', field: 'currentExpression', value: '生气/愤怒' },
  '惊讶': { table: 'characters', field: 'currentExpression', value: '惊讶/瞪大眼睛' },
  '发呆': { table: 'characters', field: 'currentExpression', value: '发呆/失神' },
  '冷笑': { table: 'characters', field: 'currentExpression', value: '冷笑/不屑' },

  // === 简单动作/姿势 (Characters.currentPose) ===
  '坐下': { table: 'characters', field: 'currentPose', value: '坐姿' },
  '坐着': { table: 'characters', field: 'currentPose', value: '坐姿' },
  '躺下': { table: 'characters', field: 'currentPose', value: '躺着' },
  '躺着': { table: 'characters', field: 'currentPose', value: '躺着' },
  '站起来': { table: 'characters', field: 'currentPose', value: '站立' },
  '站着': { table: 'characters', field: 'currentPose', value: '站立' },
  '跪下': { table: 'characters', field: 'currentPose', value: '跪姿' },
  '趴着': { table: 'characters', field: 'currentPose', value: '趴在地上/床上' },
  '背对着': { table: 'characters', field: 'currentPose', value: '背对镜头' },
  '走': { table: 'characters', field: 'currentPose', value: '行走中' },
  '跑': { table: 'characters', field: 'currentPose', value: '奔跑中' },

  // === 简单服装更新 (Characters.currentOutfit) ===
  '脱掉外衣': { table: 'characters', field: 'currentOutfit', value: '内衣/简陋服装' },
  '脱衣服': { table: 'characters', field: 'currentOutfit', value: '内衣/简陋服装' },
  '全裸': { table: 'characters', field: 'currentOutfit', value: '赤裸' },
  '赤裸': { table: 'characters', field: 'currentOutfit', value: '赤裸' },
  '没穿衣服': { table: 'characters', field: 'currentOutfit', value: '赤裸' },
  '制服': { table: 'characters', field: 'currentOutfit', value: '制服' },
  '校服': { table: 'characters', field: 'currentOutfit', value: '学校校服' },
  '女仆装': { table: 'characters', field: 'currentOutfit', value: '女仆装' },
  '泳装': { table: 'characters', field: 'currentOutfit', value: '泳装/比基尼' },
  '比基尼': { table: 'characters', field: 'currentOutfit', value: '比基尼' },
  '睡衣': { table: 'characters', field: 'currentOutfit', value: '睡衣' },
  '礼服': { table: 'characters', field: 'currentOutfit', value: '正式礼服' },
  '西装': { table: 'characters', field: 'currentOutfit', value: '商务西装' },
  '围裙': { table: 'characters', field: 'currentOutfit', value: '围裙' },
};

// 3. 转场指示词 (识别大变动，需强制 LLM 同步)
export const TRANSITION_INDICATORS = [
  '第二天', '很久以后', '离开', '出发', '转场', '瞬间', '几个小时后', '傍晚时分', '深夜', '次日'
];

// 4. 身份模式词 (用于推断目标角色)
export const IDENTITY_PATTERNS = {
  self: ['我', '本尊', '老子', '老娘', '人家'],
  target: ['你', '她', '他', '它', '妹妹', '姐姐', '老师', '学姐', '主人']
};
