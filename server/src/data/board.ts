import { Cell, UPGRADE_COSTS, MATCH_INCOMES } from '../types';

/**
 * 棋盘 40 格，顺时针排列
 * 11×11 网格，外围一圈
 *
 * pos  0: START          (顶边左)
 * pos  5: 补水啦          (顶边中)
 * pos 10: BANK           (顶边右)
 * pos 15: 王老吉          (右边中)
 * pos 20: JAIL           (底边右)
 * pos 25: 外星人          (底边中)
 * pos 30: AIRPORT        (底边左)
 * pos 35: 清扬            (左边中)
 */

function club(
  id: number,
  name: string,
  league: Cell['league'],
): Cell {
  return {
    id,
    type: 'club',
    name,
    league,
    price: 2,   // 购买价 2kw
    upgradeCosts: UPGRADE_COSTS,
    matchIncome: MATCH_INCOMES,
  };
}

function sponsor(id: number, name: string, price: number): Cell {
  return { id, type: 'sponsor', name, price };
}

function special(id: number, name: string, type: Cell['type']): Cell {
  return { id, type, name };
}

export const BOARD_CELLS: Cell[] = [
  // ===== 顶边 (id 0-10) =====
  special(0, '起点', 'start'),      // 0: START (左上角)
  club(1, '曼城', 'premier'),
  club(2, '曼联', 'premier'),
  club(3, '阿森纳', 'premier'),
  club(4, '利物浦', 'premier'),
  sponsor(5, '补水啦', 1),           // 5: 顶边中点 — 买1kw
  club(6, '切尔西', 'premier'),
  club(7, '热刺', 'premier'),
  club(8, '纽卡斯尔', 'premier'),
  club(9, '水晶宫', 'premier'),
  special(10, '银行', 'bank'),       // 10: BANK (右上角)

  // ===== 右边 (id 11-20) =====
  special(11, '绝处逢生', 'windfall'),
  club(12, '拜仁慕尼黑', 'bundesliga'),
  special(13, '街头足球', 'street'),  // 二阶段
  club(14, '多特蒙德', 'bundesliga'),
  sponsor(15, '王老吉', 0.5),        // 15: 右边中点 — 买0.5kw
  club(16, '勒沃库森', 'bundesliga'),
  special(17, '转会窗', 'transfer'),  // 二阶段
  club(18, '莱比锡红牛', 'bundesliga'),
  club(19, '斯图加特', 'bundesliga'),
  special(20, '监狱', 'jail'),       // 20: JAIL (右下角)

  // ===== 底边 (id 21-30) =====
  club(21, '皇家马德里', 'laliga'),
  club(22, '巴塞罗那', 'laliga'),
  special(23, '随机事件', 'random'),  // 二阶段
  club(24, '马德里竞技', 'laliga'),
  sponsor(25, '外星人', 1),          // 25: 底边中点 — 买1kw
  club(26, '皇家贝蒂斯', 'laliga'),
  special(27, '天降横财', 'windfall'),
  special(28, '街头足球', 'street'),  // 二阶段
  special(29, '训练营', 'blank'),
  special(30, '机场', 'airport'),    // 30: AIRPORT (左下角)

  // ===== 左边 (id 31-39) =====
  club(31, 'AC米兰', 'serieA'),
  club(32, '国际米兰', 'serieA'),
  club(33, '尤文图斯', 'serieA'),
  club(34, '那不勒斯', 'serieA'),
  sponsor(35, '清扬', 2),            // 35: 左边中点 — 买2kw
  special(36, '随机事件', 'random'),  // 二阶段
  club(37, '巴黎圣日耳曼', 'ligue1'),
  club(38, '摩纳哥', 'ligue1'),
  special(39, '青训学院', 'blank'),
];

/**
 * 获取棋盘格在 11×11 网格中的坐标 (row, col)
 */
export function getCellPosition(cellId: number): { row: number; col: number } {
  // 顶边: 0-10, row=0, col=id
  if (cellId <= 10) return { row: 0, col: cellId };
  // 右边: 11-20, col=10, row=cellId-10
  if (cellId <= 20) return { row: cellId - 10, col: 10 };
  // 底边: 21-30, row=10, col=30-cellId (反向)
  if (cellId <= 30) return { row: 10, col: 30 - cellId };
  // 左边: 31-39, col=0, row=40-cellId (向上反向)
  return { row: 40 - cellId, col: 0 };
}
