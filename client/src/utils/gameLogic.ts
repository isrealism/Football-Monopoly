import { Cell, MATCH_INCOMES } from '../types';

/**
 * 掷骰子：1-6
 */
export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * 计算移动后的位置，返回 { newPosition, passedStart }
 */
export function calcMove(from: number, steps: number): { newPosition: number; passedStart: boolean } {
  const newPos = (from + steps) % 40;
  // 顺时针走，如果新位置 ≤ 旧位置说明绕了一圈，经过了起点
  const passedStart = from + steps >= 40;
  return { newPosition: newPos, passedStart };
}

/**
 * 获取某格的参观费（基于等级的比赛日收入）
 */
export function getVisitFee(cell: Cell, level: number): number {
  return MATCH_INCOMES[level] || MATCH_INCOMES[1];
}

/**
 * 获取赞助商的停留费用 = 购买价 × 2
 */
export function getSponsorFee(price: number): number {
  return price * 2;
}

/**
 * 格式化金额显示
 */
export function fmtMoney(kw: number): string {
  if (kw >= 100) {
    const y = kw / 10;
    return `${y.toFixed(y % 1 === 0 ? 0 : 2)}亿`;
  }
  // 统一 kw 格式，最多两位
  const fixed = kw.toFixed(2);
  return `${parseFloat(fixed)}kw`;
}

/**
 * 计算玩家总净值（含银行存款）
 * 俱乐部：购买价 2kw + 升级费；赞助商：按实际购买价
 */
/** 资金 = 现金 + 存款 - 负债 */
export function calcCapital(cash: number, savings: number, debt: number): number {
  return Math.round((cash + savings - debt) * 100) / 100;
}

/** 资产 = 所有地产的购买+升级总花费 */
export function calcAssets(
  properties: number[],
  cellLevels: Record<number, number>,
  cells?: { id: number; type: string; price?: number }[],
): number {
  let total = 0;
  for (const cid of properties) {
    const cell = cells?.find(c => c.id === cid);
    if (cell?.type === 'sponsor') {
      total += cell.price || 0;
    } else {
      total += 2; // 购买价
      const level = cellLevels[cid] || 1;
      for (let lv = 2; lv <= level; lv++) {
        total += [0, 3, 4, 5, 10][lv - 1];
      }
    }
  }
  return Math.round(total * 100) / 100;
}

export function calcNetWorth(
  cash: number,
  debt: number,
  savings: number,
  properties: number[],
  cellLevels: Record<number, number>,
  cells?: { id: number; type: string; price?: number }[],
): number {
  return Math.round((calcCapital(cash, savings, debt) + calcAssets(properties, cellLevels, cells)) * 100) / 100;
}

/** 胜利资金目标 (kw) */
export const WIN_CAPITAL = 100;

/** 胜利净资产目标 (kw) — 保留兼容 */
export const WIN_NET_WORTH = 100;

/** 破产负债上限 (kw) */
export const BANKRUPT_DEBT = 50;

/** 存款利息 (每回合) */
export const SAVINGS_RATE = 0.02;

/** 贷款利息 (每回合) */
export const LOAN_RATE = 0.05;
