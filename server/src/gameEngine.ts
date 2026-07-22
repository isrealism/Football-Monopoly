import { GameState, GameAction, PendingAction, ActionOption, MatchRound, LeagueTable, MATCH_INCOMES, UPGRADE_COSTS, LEVEL_TOURNAMENTS, LEAGUE_NAMES } from './types.js';
import { BOARD_CELLS } from './data/board.js';
import { rollDice, calcMove, getVisitFee, calcCapital, WIN_CAPITAL, BANKRUPT_DEBT, SAVINGS_RATE, LOAN_RATE } from './utils/gameLogic.js';
import { ALL_PLAYERS, FOOD_PLAYERS, ANIMAL_PLAYERS, TRANSFER_PLAYERS, YOUTH_PLAYERS } from './data/players.js';

// Server-side ID generator (replaces Date.now())
let _idCounter = 0;
export function resetIdCounter(start = 0) { _idCounter = start; }
export function generateId(): string { return `inst_${++_idCounter}`; }

export const PLAYER_COLORS = ['#ff69b4', '#f5f5f5', '#fff176', '#a0522d', '#c4a4e0', '#81c784', '#ff5f1f'];
export const PLAYER_COLOR_NAMES = ['粉', '白', '浅黄', '棕', '浅紫', '浅绿', '荧光橙'];

/** Create a minimal empty state for START_GAME to build upon */
export function createEmptyState(): GameState {
  return {
    phase: 'setup',
    players: [],
    currentPlayerIndex: 0,
    cells: BOARD_CELLS,
    cellOwners: {},
    cellLevels: {},
    turn: 0,
    diceValue: null,
    diceAnimating: false,
    log: [],
    winner: null,
    instances: [],
    foodPool: [],
    animalPool: [],
    transferPool: [],
    youthPool: [],
    matchState: null,
    peakDuel: false,
    transferBidState: null,
    leagueTables: [],
    trainingPoints: {},
    clubTrophies: {},
    hasUCLTitle: {},
    snapshots: [],
    playerStats: {},
    events: [],
    bankruptTeams: {},
    pendingAction: null,
    challengeState: null,
  };
}

function initPlayerPools() {
  return {
    foodPool: [...FOOD_PLAYERS.map(p => p.id)],
    animalPool: [...ANIMAL_PLAYERS.map(p => p.id)],
    transferPool: [...TRANSFER_PLAYERS.map(p => p.id)],
    youthPool: [...YOUTH_PLAYERS.map(p => p.id)],
    instances: [] as GameState['instances'],
    trainingPoints: {} as Record<number, number>,
    clubTrophies: {} as Record<number, GameState['clubTrophies'][number]>,
    hasUCLTitle: {} as Record<number, boolean>,
  };
}
// ========== 赞助商配置 ==========
// 停留时获得/支付 = 购买价 × 2
function getSponsorPayout(cellId: number): number {
  const cell = BOARD_CELLS[cellId];
  return (cell.price || 0) * 2;
}

// ========== 获取当前玩家 ==========
function currentPlayer(state: GameState) {
  return state.players[state.currentPlayerIndex];
}

// ========== 日志辅助 ==========
function log(state: GameState, msg: string): GameState {
  return { ...state, log: [msg, ...state.log].slice(0, 20) };
}

// ========== 大事记辅助 ==========
function pushEvent(state: GameState, playerId: number, icon: string, text: string): GameState {
  return { ...state, events: [...state.events, { turn: state.turn, playerId, icon, text }] };
}

// ========== 统计辅助 ==========
function addIncome(state: GameState, pid: number, amt: number): GameState {
  if (amt <= 0 || !state.playerStats[pid]) return state;
  const s = state.playerStats[pid];
  return { ...state, playerStats: { ...state.playerStats, [pid]: { ...s, totalIncome: Math.round((s.totalIncome + amt) * 100) / 100 } } };
}
function addSpending(state: GameState, pid: number, amt: number): GameState {
  if (amt <= 0 || !state.playerStats[pid]) return state;
  const s = state.playerStats[pid];
  return { ...state, playerStats: { ...state.playerStats, [pid]: { ...s, totalSpent: Math.round((s.totalSpent + amt) * 100) / 100 } } };
}
function addJail(state: GameState, pid: number): GameState {
  if (!state.playerStats[pid]) return state;
  const s = state.playerStats[pid];
  return { ...state, playerStats: { ...state.playerStats, [pid]: { ...s, jailCount: s.jailCount + 1 } } };
}
function addMatch(state: GameState, pid: number, won: boolean): GameState {
  if (!state.playerStats[pid]) return state;
  const s = state.playerStats[pid];
  return { ...state, playerStats: { ...state.playerStats, [pid]: { ...s, matchesPlayed: s.matchesPlayed + 1, matchesWon: s.matchesWon + (won ? 1 : 0) } } };
}
function addChampionship(state: GameState, pid: number): GameState {
  if (!state.playerStats[pid]) return state;
  const s = state.playerStats[pid];
  return { ...state, playerStats: { ...state.playerStats, [pid]: { ...s, championships: s.championships + 1 } } };
}

function getPropertyValue(state: GameState, playerId: number): number {
  let total = 0;
  for (const [cid, ownerId] of Object.entries(state.cellOwners)) {
    if (ownerId !== playerId) continue;
    const cell = BOARD_CELLS[parseInt(cid)];
    if (!cell) continue;
    const level = state.cellLevels[parseInt(cid)] || 1;
    // 购买价 + 累计升级费
    let val = cell.price || 0;
    for (let lv = 1; lv < level; lv++) val += UPGRADE_COSTS[lv] || 0;
    total += val;
  }
  return total;
}

// ========== 强制扣费（不足时自动紧急贷款） ==========
function forcePay(
  state: GameState,
  playerIndex: number,
  amount: number,
): { newState: GameState; hadToLoan: boolean } {
  const p = state.players[playerIndex];
  if (p.cash >= amount) {
    const newPlayers = state.players.map((pl, i) => {
      if (i !== playerIndex) return pl;
      return { ...pl, cash: Math.round((pl.cash - amount) * 100) / 100 };
    });
    return { newState: { ...state, players: newPlayers }, hadToLoan: false };
  }
  const shortfall = Math.round((amount - p.cash) * 100) / 100;
  const newPlayers = state.players.map((pl, i) => {
    if (i !== playerIndex) return pl;
    return { ...pl, cash: 0, debt: Math.round((pl.debt + shortfall) * 100) / 100 };
  });
  return { newState: { ...state, players: newPlayers }, hadToLoan: true };
}

// ========== 净值计算 ==========
function getPlayerCapital(state: GameState, playerId: number): number {
  const p = state.players[playerId];
  return calcCapital(p.cash, p.savings, p.debt);
}

// ========== 资金胜利检测（需同时满足3个条件） ==========
function checkNetWorthWin(state: GameState): GameState | null {
  for (const p of state.players) {
    if (p.isBankrupt) continue;
    const cap = getPlayerCapital(state, p.id);
    if (cap < WIN_CAPITAL) continue;
    // 条件2：至少3个五级球场
    const lv5Count = Object.entries(state.cellOwners)
      .filter(([cid, oid]) => oid === p.id && (state.cellLevels[parseInt(cid)] || 0) >= 5).length;
    if (lv5Count < 3) continue;
    // 条件3：拿过欧冠冠军（5级联赛冠军）
    if (!state.hasUCLTitle[p.id]) continue;
    // 三条件全满足
    return {
      ...state,
      phase: 'finished',
      winner: p.id,
      pendingAction: {
        type: 'post_move',
        message: `🏆 ${p.name} 达成全部胜利条件！资金 ≥100kw + 3座五级 + 欧冠冠军，大富翁胜利！`,
        options: [{ label: '再来一局', action: 'RESET' }],
      },
    };
  }
  return null;
}

// ========== 单玩家存活检测 ==========
function checkLastPlayerStanding(state: GameState): GameState | null {
  const alive = state.players.filter(pl => !pl.isBankrupt);
  const total = state.players.length;
  // 3人及以上开局时，必须只剩1人才结束；2人局正常1人破产即结束
  if (total >= 3 && alive.length > 1) return null;
  if (alive.length === 1) {
    return {
      ...state,
      phase: 'finished',
      winner: alive[0].id,
      pendingAction: {
        type: 'post_move',
        message: `🏆 ${alive[0].name} 获胜！所有对手均已破产。`,
        options: [{ label: '再来一局', action: 'RESET' }],
      },
    };
  }
  // 全员破产 → 最后破产者"获胜"
  if (alive.length === 0) {
    const lastOne = state.players.reduce((a, b) => (a.bankruptTurn || 0) > (b.bankruptTurn || 0) ? a : b);
    return {
      ...state,
      phase: 'finished',
      winner: lastOne.id,
      pendingAction: {
        type: 'post_move',
        message: `💀 全员破产！${lastOne.name} 坚持到了最后。`,
        options: [{ label: '再来一局', action: 'RESET' }],
      },
    };
  }
  return null;
}

// ========== 统一胜利检测 ==========
function checkWin(state: GameState): GameState {
  return checkNetWorthWin(state) || checkLastPlayerStanding(state) || state;
}

// ========== 主 Reducer（核心） ==========
function gameReducerCore(state: GameState, action: GameAction): GameState {
  switch (action.type) {

    // ===== 读取存档 =====
    case 'LOAD_GAME': {
      const s = (action as any).state;
      return { ...s, phase: 'playing', diceAnimating: false,
        players: s.players.map((p: any) => ({ ...p, bankruptTurn: p.bankruptTurn ?? (p.isBankrupt ? s.turn : 0) })),
        snapshots: s.snapshots || [],
        playerStats: s.playerStats || Object.fromEntries(s.players.map((p: any) => [p.id, { totalIncome: 0, totalSpent: 0, jailCount: 0, matchesPlayed: 0, matchesWon: 0, championships: 0 }])),
        events: s.events || [],
        bankruptTeams: s.bankruptTeams || {},
        clubTrophies: s.clubTrophies ? Object.fromEntries(Object.entries(s.clubTrophies).map(([k, v]: [string, any]) => [k, typeof v === 'number' ? { total: v, byLevel: [0,0,0,0,0,0] } : v])) : {},
        pendingAction: s.pendingAction || { type: 'post_move', message: `${s.players[s.currentPlayerIndex]?.name ?? '?'} 的回合`, options: [{ label: '掷骰子', action: 'ROLL_DICE' }] },
      };
    }

    // ===== 开始游戏 =====
    case 'START_GAME': {
      const players = action.players.map((p, i) => ({
        id: i,
        name: p.name,
        color: p.color,
        position: 0,
        cash: 10,
        savings: 0,
        isAI: p.isAI || false,
        debt: 0,
        properties: [],
        jailTurns: 0,
        isBankrupt: false,
        bankruptTurn: 0,
      }));
      const playerCount = players.length;
      const pools = initPlayerPools();
      const leagueTables = createEmptyLeagueTables();
      for (let lv = 1; lv <= 5; lv++) {
        leagueTables[lv].matchesNeeded = 2 * playerCount;
      }
      return {
        ...state,
        phase: 'playing',
        players,
        currentPlayerIndex: 0,
        cellOwners: {},
        cellLevels: {},
        turn: 1,
        diceValue: null,
        diceAnimating: false,
        log: ['🎮 游戏开始！每位玩家起始资金 10kw'],
        winner: null,
        pendingAction: {
          type: 'post_move',
          message: `${players[0].name} 的回合，请掷骰子 🎲`,
          options: [{ label: '掷骰子', action: 'ROLL_DICE' }],
        },
        challengeState: null,
        // 球员系统初始化
        ...pools,
        matchState: null,
        peakDuel: false,
        transferBidState: null,
        leagueTables,
        // 赛后报告初始化
        snapshots: [],
        playerStats: Object.fromEntries(players.map(p => [p.id, { totalIncome: 0, totalSpent: 0, jailCount: 0, matchesPlayed: 0, matchesWon: 0, championships: 0 }])),
        events: [],
        bankruptTeams: {},
      };
    }

    // ===== 开始掷骰子动画 =====
    case 'START_DICE_ANIMATION': {
      return { ...state, diceAnimating: true, diceValue: null, pendingAction: null };
    }

    // ===== 移动玩家（清除骰子动画） =====

    // ===== 掷骰子 =====
    case 'ROLL_DICE': {
      const value = rollDice();
      const player = currentPlayer(state);
      return {
        ...state,
        diceValue: value,
        // diceAnimating stays true for result display phase
        pendingAction: {
          type: 'post_move',
          message: `${player.name} 掷出了 ${value} 点！`,
          options: [{ label: '前进', action: `MOVE:${value}` }],
        },
      };
    }

    // ===== 移动玩家 =====
    case 'MOVE_PLAYER': {
      const steps = action.steps;
      const p = currentPlayer(state);
      const { newPosition, passedStart } = calcMove(p.position, steps);

      let newState = { ...state };
      let newCash = p.cash;
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, position: newPosition };
      });

      // 经过起点 +5kw
      if (passedStart) {
        newCash += 5;
        newState = log(newState, `💰 ${p.name} 经过起点，获得 5kw 资金！`);
      }

      // 更新玩家现金和位置
      newState = {
        ...newState,
        players: newPlayers.map((pl, i) => {
          if (i !== state.currentPlayerIndex) return pl;
          return { ...pl, cash: newCash };
        }),
        diceValue: null,
        diceAnimating: false,
      };

      // 处理落地格
      return handleLanding(newState, newPosition);
    }

    // ===== 选择行动 =====
    case 'CHOOSE_ACTION': {
      const { action: choice, cellId } = action;
      // 根据 action 字符串分发
      const [cmd, ...args] = choice.split(':');
      switch (cmd) {
        case 'ROLL_DICE':
          return gameReducerCore(state, { type: 'START_DICE_ANIMATION' });
        case 'MOVE':
          return gameReducerCore(state, { type: 'MOVE_PLAYER', steps: parseInt(args[0]) });
        case 'BUY_CLUB':
          return gameReducerCore(state, { type: 'BUY_PROPERTY', cellId: cellId! });
        case 'BUY_STREET':
          return gameReducerCore(state, { type: 'BUY_STREET_PLAYER', cardId: args[0] });
        case 'SKIP_STREET':
          return gameReducerCore(state, { type: 'SKIP_STREET_PLAYER' });
        case 'ASSIGN':
          return gameReducerCore(state, { type: 'ASSIGN_PLAYER', instanceUid: args[0], clubId: parseInt(args[1]) });
        case 'RELEASE':
          return gameReducerCore(state, { type: 'RELEASE_PLAYER', instanceUid: args[0] });
        case 'START_BID':
          return gameReducerCore(state, { type: 'START_TRANSFER_BID', cardId: args[0] });
        case 'PLACE_BID':
          return gameReducerCore(state, { type: 'PLACE_BID', amount: parseFloat(args[0]) });
        case 'PASS_BID':
          return gameReducerCore(state, { type: 'PASS_BID' });
        case 'SELECT_SELL':
          return handleSellSelection(state);
        case 'SELL_PLAYER':
          return gameReducerCore(state, { type: 'START_TRANSFER_SELL', instanceUid: args[0] });
        case 'SKIP_TRANSFER':
          return skipAndEnd(state);
        case 'LOSS_TRANSFER':
          return handleLossTransfer(state, args[0], parseInt(args[1]), parseInt(args[2]), parseInt(args[3]));
        case 'LOSS_RELEASE':
          return handleLossRelease(state, args[0], parseInt(args[1]), parseInt(args[2]));
        case 'OVERFLOW_SELECT':
          return handleOverflowSelect(state, args[0], parseInt(args[1]), parseInt(args[2]), parseInt(args[3]));
        case 'OVERFLOW_TRANSFER':
          return handleOverflowTransfer(state, args[0], parseInt(args[1]), parseInt(args[2]), parseInt(args[3]));
        case 'OVERFLOW_RELEASE':
          return handleOverflowRelease(state, args[0], parseInt(args[1]), parseInt(args[2]));
        case 'NOOP':
          return state;
        case 'RND_EVT': {
          const evtIdx = parseInt(args[0]);
          const evtArgs = args.slice(1);
          const evtP = currentPlayer(state);
          let evtNewState = state;
          switch (evtIdx) {
            case 0: { const bonus = parseFloat(evtArgs[0]) || 1; evtNewState = log({ ...state, players: state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash + bonus) * 100) / 100 }) }, `🎲 ${evtP.name} 刮出彩票，中奖 ${bonus}kw！`); break; }
            case 1: evtNewState = log({ ...state, players: state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash + 10) * 100) / 100 }) }, `🎲 ${evtP.name} 挖出石油，获得 10kw！`); break;
            case 2: { const halved = parseFloat(evtArgs[0]) || 0; evtNewState = log({ ...state, players: state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: halved }) }, `🎲 ${evtP.name} 被曝光特大丑闻，现金折半！`); break; }
            case 3: { const act = evtArgs[0]; const cid = parseInt(evtArgs[1]); if (act === 'lose') return startStadiumLossFlow(state, cid); else return applyStadiumDowngrade(state, cid); }
            case 4: { const tf = parseFloat(evtArgs[0]) || 0; const rid = parseInt(evtArgs[1]); const pid = parseInt(evtArgs[2]); evtNewState = log({ ...state, players: state.players.map((pl, i) => { if (i === rid) return { ...pl, cash: Math.round((pl.cash - tf) * 100) / 100 }; if (i === pid) return { ...pl, cash: Math.round((pl.cash + tf) * 100) / 100 }; return pl; }) }, `🎲 财政公平！${state.players[rid].name} 支付 ${tf}kw 给 ${state.players[pid].name}。`); break; }
            case 5: { const fine = parseFloat(evtArgs[0]) || 0; const { newState: afterPay, hadToLoan } = forcePay(state, state.currentPlayerIndex, fine); evtNewState = afterPay; if (hadToLoan) evtNewState = log(evtNewState, `🚨 ${evtP.name} 现金不足，自动紧急贷款！`); evtNewState = log(evtNewState, `🎲 ${evtP.name} 违规燃放焰火，被罚款 ${fine}kw！`); break; }
            case 6: { const income = parseFloat(evtArgs[0]) || 0; evtNewState = log({ ...state, players: state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash + income) * 100) / 100 }) }, `🎲 ${evtP.name} 的球场周边车水马龙，增收 ${income}kw！`); break; }
            case 8: { const tax = parseFloat(evtArgs[0]) || 0; const rid = parseInt(evtArgs[1]); evtNewState = log({ ...state, players: state.players.map((pl, i) => i === rid ? { ...pl, cash: Math.round((pl.cash - tax) * 100) / 100 } : pl) }, `🎲 税务稽查！${state.players[rid].name} 缴纳了 ${tax}kw 税款。`); break; }
            case 9: { const cleared = parseFloat(evtArgs[0]) || 0; evtNewState = log({ ...state, players: state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, debt: 0 }) }, `🍀 绝处逢生！${evtP.name} 的 ${cleared}kw 负债被一笔勾销！`); evtNewState = pushEvent(evtNewState, state.currentPlayerIndex, '🍀', `${cleared}kw`); break; }
          }
          return skipAndEnd(evtNewState);
        }
        case 'START_MATCH':
          return gameReducerCore(state, { type: 'START_MATCH', homeClubId: parseInt(args[0]), awayClubId: parseInt(args[1]) });
        case 'CONFIRM_MATCH_RESULT':
          return gameReducerCore(state, { type: 'CONFIRM_MATCH_RESULT' });
        case 'ROLL_MATCH_DICE':
          return gameReducerCore(state, { type: 'ROLL_MATCH_DICE' });
        case 'OPEN_MATCH':
          return { ...state, pendingAction: null };
        case 'BUY_SPONSOR':
          return gameReducerCore(state, { type: 'BUY_SPONSOR', cellId: cellId! });
        case 'UPGRADE':
          return gameReducerCore(state, { type: 'UPGRADE_CLUB', cellId: cellId! });
        case 'PAY_VISIT':
          return gameReducerCore(state, { type: 'PAY_VISIT', cellId: cellId! });
        case 'CHALLENGE':
          return gameReducerCore(state, { type: 'START_CHALLENGE', cellId: cellId! });
        case 'TAKE_LOAN':
          return gameReducerCore(state, { type: 'TAKE_LOAN', amount: parseFloat(args[0]) });
        case 'MATCH_INCOME':
          return handleMatchIncome(state, args[0], parseFloat(args[1]), parseInt(args[2]));
        case 'REPAY_LOAN':
          return gameReducerCore(state, { type: 'REPAY_LOAN', amount: parseFloat(args[0]) });
        case 'DEPOSIT':
          return gameReducerCore(state, { type: 'DEPOSIT', amount: parseFloat(args[0]) });
        case 'WITHDRAW':
          return gameReducerCore(state, { type: 'WITHDRAW', amount: parseFloat(args[0]) });
        case 'EXECUTE_PAY':
          return gameReducerCore(state, { type: 'EXECUTE_PAY', amount: parseFloat(args[0]), ownerId: parseInt(args[1]), reason: args[2] || '' });
        case 'WINDFALL_GET': {
          const bonus = parseFloat(args[0]) || 3;
          const newPlayers = state.players.map((pl, i) => {
            if (i !== state.currentPlayerIndex) return pl;
            return { ...pl, cash: pl.cash + bonus };
          });
          const newState = log({ ...state, players: newPlayers }, `🍀 ${currentPlayer(state).name} 捡起了天降横财，获得 ${bonus}kw！`);
          return skipAndEnd(newState);
        }
        case 'DECLINE_LOAN':
          return gameReducerCore(state, { type: 'DECLINE_LOAN' });
        case 'SKIP_BUY':
          return skipAndEnd(state);
        case 'SKIP_UPGRADE':
          return skipAndEnd(state);
        case 'SKIP_VISIT':
          return gameReducerCore(state, { type: 'PAY_VISIT', cellId: cellId! });
        case 'AIRPORT_FLY':
          return gameReducerCore(state, { type: 'AIRPORT_FLY', targetCellId: parseInt(args[0]) });
        case 'AIRPORT_SKIP':
          return skipAndEnd(state);
        case 'OK':
          // 如果挑战刚结束，清理 challengeState
          if (state.challengeState) {
            return skipAndEnd({ ...state, challengeState: null });
          }
          return skipAndEnd(state);
        case 'END_TURN':
          return gameReducerCore(state, { type: 'END_TURN' });
        case 'EXECUTE_BANKRUPT':
          if (args.length > 0) return gameReducerCore(state, { type: 'EXECUTE_BANKRUPT_ID', playerId: parseInt(args[0]) });
          return gameReducerCore(state, { type: 'EXECUTE_BANKRUPT' });
        case 'PEAK_DUEL_SELECT':
          return startPeakDuelSelect(state);
        case 'PEAK_DUEL_PICK':
          return startPeakDuelMatch(state, parseInt(args[0]));
        case 'PEAK_DUEL_CLUB':
          return startPeakDuelWithClub(state, parseInt(args[0]), parseInt(args[1]));
        case 'TRAIN_SELECT':
          return executeTrainAttr(state, args[0]);
        case 'YOUTH_DRAW':
          return executeYouthDraw(state);
        case 'RESET':
          return gameReducerCore(state, { type: 'RESET_GAME' });
        case 'PAY_DOUBLE': {
          // 挑战失败，展示支付按钮（保留挑战结果显示）
          const pCellId = cellId || parseInt(args[0]) || state.challengeState?.cellId;
          if (pCellId === undefined) return state;
          const pLevel = state.cellLevels[pCellId] || 1;
          const doubleFee = (MATCH_INCOMES[pLevel] || 2) * 2;
          const pOwnerId = state.cellOwners[pCellId];
          if (pOwnerId === undefined) return state;

          return log({
            ...state,
            pendingAction: {
              type: 'confirm_pay',
              message: `挑战失败！需支付双倍参观费 ${doubleFee}kw 给 ${state.players[pOwnerId].name}`,
              options: [{ label: `支付 ${doubleFee}kw`, action: `EXECUTE_PAY:${doubleFee}:${pOwnerId}:挑战罚金` }],
              cellId: pCellId,
            },
          }, `😞 ${currentPlayer(state).name} 挑战失败，需支付双倍罚金 ${doubleFee}kw`);
        }
        default:
          return state;
      }
    }

    // ===== 购买街头球员 =====
    case 'BUY_STREET_PLAYER': {
      const { cardId } = action;
      const p = currentPlayer(state);
      const pool = idToPool(cardId);
      if (!pool) return state;
      const card = getCard(cardId);
      if (!card) return state;
      const price = Math.round(card.marketValue / 2 * 100) / 100;
      if (p.cash < price) return log(state, `❌ 现金不足，需要 ${price}kw`);
      // 检查容量
      const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
      if (myClubs.length === 0) return log(state, `❌ 没有球场可容纳球员！`);
      if (!myClubs.some(c => c.count < getClubCapacity(c.level))) return log(state, `❌ 所有球场已满，无注册名额！`);
      const uid = `${cardId}_${generateId()}`;
      const instance = { uid, cardId, ownerId: p.id, clubId: -1, growth: [0, 0, 0, 0, 0, 0] };
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: Math.round((pl.cash - price) * 100) / 100 };
      });
      const newPoolKey = pool === 'food' ? 'foodPool' : 'animalPool';
      let newState = log({
        ...state,
        players: newPlayers,
        instances: [...state.instances, instance],
        [newPoolKey]: state[newPoolKey].filter(id => id !== cardId),
      }, `⚽ ${p.name} 以 ${price}kw 买下了 ${card.nickname}（${card.name}）！`);
      newState = pushEvent(newState, state.currentPlayerIndex, '⚽', `${card.name}（OVR ${card.ovr}）`);

      // 选择球场分配
      const clubs = getPlayerClubs(p.id, newState.cellOwners, newState.cellLevels, newState.instances);
      const clubOptions = clubs.filter(c => c.count < getClubCapacity(c.level)).map(c => ({
        label: `${c.name}（Lv${c.level}，${c.count}/${getClubCapacity(c.level)}人）`,
        action: `ASSIGN:${uid}:${c.cellId}`,
      }));
      return {
        ...newState,
        pendingAction: {
          type: 'assign_player',
          message: `${p.name} 要把 ${card.nickname}（${card.name}）带到...`,
          options: clubOptions,
          instanceUid: uid,
        },
      };
    }

    // ===== 跳过街头球员 =====
    case 'SKIP_STREET_PLAYER': {
      return skipAndEnd(state);
    }

    // ===== 分配球员到球场 =====
    case 'ASSIGN_PLAYER': {
      const { instanceUid, clubId } = action;
      // 检查容量
      const currentCount = state.instances.filter(i => i.clubId === clubId).length;
      const capacity = state.cellLevels[clubId] || 1;
      if (currentCount >= capacity) {
        return log(state, `❌ 该球场已满（${currentCount}/${capacity}），无法分配！`);
      }
      const newInstances = state.instances.map(inst => {
        if (inst.uid === instanceUid) return { ...inst, clubId };
        return inst;
      });
      const inst = state.instances.find(i => i.uid === instanceUid);
      if (!inst) return state;
      const card = getCard(inst.cardId);
      const cell = BOARD_CELLS[clubId];
      const p = state.players.find(pl => pl.id === inst.ownerId);
      const msg = `✅ ${p?.name ?? '?'} 将 ${card?.nickname ?? card?.name}（${card?.name}）分配至 ${cell.name}！`;
      const newState = log({ ...state, instances: newInstances }, msg);
      return {
        ...newState,
        pendingAction: {
          type: 'post_move',
          message: msg,
          options: [{ label: '确定', action: 'OK' }],
        },
      };
    }

    // ===== 解约球员 =====
    case 'RELEASE_PLAYER': {
      const { instanceUid } = action;
      const inst = state.instances.find(i => i.uid === instanceUid);
      if (!inst) return state;
      const card = getCard(inst.cardId);
      const pool = idToPool(inst.cardId) || 'transfer';
      const poolKey = pool === 'food' ? 'foodPool' : pool === 'animal' ? 'animalPool' : 'transferPool';
      const p = state.players.find(pl => pl.id === inst.ownerId);
      const msg = `🔙 ${p?.name ?? '?'} 解约了 ${card?.nickname ?? card?.name}（${card?.name}），球员回到市场。`;
      const newState = log({
        ...state,
        instances: state.instances.filter(i => i.uid !== instanceUid),
        [poolKey]: [...state[poolKey], inst.cardId],
      }, msg);
      return {
        ...newState,
        pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'OK' }] },
      };
    }

    // ===== 内部转会（降级溢出） =====
    case 'INTERNAL_TRANSFER': {
      const { instanceUid, targetClubId } = action;
      const newInstances = state.instances.map(inst => {
        if (inst.uid === instanceUid) return { ...inst, clubId: targetClubId };
        return inst;
      });
      const inst = state.instances.find(i => i.uid === instanceUid);
      if (!inst) return state;
      const card = getCard(inst.cardId);
      const cell = BOARD_CELLS[targetClubId];
      const newState = log({ ...state, instances: newInstances },
        `🔄 ${card?.nickname ?? card?.name} 内部转会至 ${cell.name}。`);
      return newState;
    }

    // ===== 购买俱乐部 =====
    case 'BUY_PROPERTY': {
      const cellId = action.cellId;
      const cell = BOARD_CELLS[cellId];
      const price = cell.price ?? 2;
      const p = currentPlayer(state);
      if (p.cash < price) return log(state, `❌ 现金不足，无法购买 ${cell.name}`);

      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: Math.round((pl.cash - price) * 100) / 100, properties: [...pl.properties, cellId] };
      });

      const msg = `🏟️ ${p.name} 以 ${price}kw 买下了 ${cell.name}（社区球场）！`;
      let newState = log({
        ...state,
        players: newPlayers,
        cellOwners: { ...state.cellOwners, [cellId]: p.id },
        cellLevels: { ...state.cellLevels, [cellId]: 1 },
      }, msg);
      newState = pushEvent(newState, state.currentPlayerIndex, '🏟️', cell.name);

      return {
        ...newState,
        pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'OK' }] },
      };
    }

    // ===== 购买赞助商 =====
    case 'BUY_SPONSOR': {
      const cellId = action.cellId;
      const cell = BOARD_CELLS[cellId];
      const price = cell.price || 0;
      const p = currentPlayer(state);
      if (p.cash < price) return log(state, `❌ 现金不足，无法购买 ${cell.name}`);

      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: Math.round((pl.cash - price) * 100) / 100, properties: [...pl.properties, cellId] };
      });

      let newState = log({
        ...state,
        players: newPlayers,
        cellOwners: { ...state.cellOwners, [cellId]: p.id },
      }, `🏪 ${p.name} 以 ${price}kw 买下了 ${cell.name}！`);
      newState = pushEvent(newState, state.currentPlayerIndex, '🏪', cell.name);

      return skipAndEnd(newState);
    }

    // ===== 升级俱乐部 =====
    case 'UPGRADE_CLUB': {
      const cellId = action.cellId;
      const cell = BOARD_CELLS[cellId];
      const currentLevel = state.cellLevels[cellId] || 1;
      if (currentLevel >= 5) return log(state, `❌ ${cell.name} 已是最高级！`);
      const cost = UPGRADE_COSTS[currentLevel];
      const p = currentPlayer(state);
      if (p.cash < cost) return log(state, `❌ 现金不足，升级 ${cell.name} 需要 ${cost}kw`);

      const newLevel = currentLevel + 1;
      const levelNames = ['', '社区球场', '初级球场', '中级球场', '高级球场', '现代化球场'];
      const tournamentNames = ['', '国内联赛', '国内杯赛', '欧协联', '欧联', '欧冠'];

      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: pl.cash - cost };
      });

      let newState = log({
        ...state,
        players: newPlayers,
        cellLevels: { ...state.cellLevels, [cellId]: newLevel },
      }, `⬆️ ${p.name} 将 ${cell.name} 升级到 ${levelNames[newLevel]}（可参加${tournamentNames[newLevel]}），花费 ${cost}kw`);
      newState = pushEvent(newState, state.currentPlayerIndex, '⬆️', `${cell.name} 升至 ${levelNames[newLevel]}`);
      if (newLevel === 5) newState = pushEvent(newState, state.currentPlayerIndex, '⭐', `${cell.name} 升至现代化球场`);

      // Lv3 自动加入驻守球员
      if (newLevel === 3) {
        const resident = ALL_PLAYERS.find(c => c.isResident && c.residentClubId === cellId);
        if (resident) {
          const uid = `${resident.id}_${generateId()}`;
          const instance = { uid, cardId: resident.id, ownerId: p.id, clubId: cellId, growth: [0,0,0,0,0,0] };
          newState = log({ ...newState, instances: [...newState.instances, instance] }, `🏠 ${resident.name} 加入 ${cell.name}，成为驻守球员！`);
        }
      }

      return skipAndEnd(newState);
    }

    // ===== 支付参观费（展示确认按钮，玩家必须点击） =====
    case 'PAY_VISIT': {
      const cellId = action.cellId;
      const cell = BOARD_CELLS[cellId];
      const level = state.cellLevels[cellId] || 1;
      const fee = getVisitFee(cell, level);
      const ownerId = state.cellOwners[cellId];
      if (ownerId === undefined) return skipAndEnd(state); // 地主已破产
      const p = currentPlayer(state);

      return {
        ...state,
        pendingAction: {
          type: 'confirm_pay',
          message: `${p.name} 参观 ${cell.name}（${state.players[ownerId].name} 的主场），需支付 ${fee}kw`,
          options: [{ label: `支付 ${fee}kw`, action: `EXECUTE_PAY:${fee}:${ownerId}:参观费` }],
          cellId,
        },
      };
    }

    // ===== 开始挑战（改为完整对战） =====
    case 'START_CHALLENGE': {
      const cellId = action.cellId;
      const cell = BOARD_CELLS[cellId];
      const ownerId = state.cellOwners[cellId];
      if (ownerId === undefined) return skipAndEnd(state); // 地主已破产
      const owner = state.players[ownerId];
      const p = currentPlayer(state);
      // 检查挑战者是否有球队
      const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
      if (myClubs.length === 0) {
        // 无球队 → 退回选择
        return {
          ...log(state, `❌ ${p.name} 没有球队，无法挑战！`),
          pendingAction: {
            type: 'visit_or_challenge',
            message: `${cell.name} 属于 ${owner.name}，参观费 ${MATCH_INCOMES[state.cellLevels[cellId] || 1] || 2}kw。你没有球队，只能支付参观费。`,
            options: [
              { label: `支付参观费 (${MATCH_INCOMES[state.cellLevels[cellId] || 1] || 2}kw)`, action: `PAY_VISIT:${cellId}` },
            ],
            cellId,
          },
        };
      }
      // 1-2级主场：只能同联赛球队挑战
      const homeLevel = state.cellLevels[cellId] || 1;
      const homeLeague = cell.league;
      const eligibleClubs = myClubs.filter(c => {
        if (homeLevel >= 3) return true;
        return BOARD_CELLS[c.cellId].league === homeLeague;
      });

      if (eligibleClubs.length === 0) {
        return {
          ...log(state, `❌ 没有符合条件的球队可挑战（${homeLevel <= 2 ? `需要${LEAGUE_NAMES[homeLeague!]}球队` : ''}）`),
          pendingAction: {
            type: 'visit_or_challenge',
            message: `${cell.name} 属于 ${owner.name}，参观费 ${MATCH_INCOMES[homeLevel] || 2}kw。${homeLevel <= 2 ? `非${LEAGUE_NAMES[homeLeague!]}球队无法挑战。` : ''}`,
            options: [{ label: `支付参观费 (${MATCH_INCOMES[homeLevel] || 2}kw)`, action: `PAY_VISIT:${cellId}` }],
            cellId,
          },
        };
      }

      if (eligibleClubs.length === 1) {
        const myClub = eligibleClubs[0];
        if (getClubPlayerCount(myClub.cellId, state.instances) === 0) {
          return {
            ...log(state, `❌ ${myClub.name} 没有球员，无法挑战！`),
            pendingAction: {
              type: 'visit_or_challenge',
              message: `${cell.name} 属于 ${owner.name}，参观费 ${MATCH_INCOMES[state.cellLevels[cellId] || 1] || 2}kw。${myClub.name} 没有球员，只能支付参观费。`,
              options: [
                { label: `支付参观费 (${MATCH_INCOMES[state.cellLevels[cellId] || 1] || 2}kw)`, action: `PAY_VISIT:${cellId}` },
              ],
              cellId,
            },
          };
        }
        return gameReducerCore(state, { type: 'START_MATCH', homeClubId: cellId, awayClubId: myClub.cellId });
      }
      // 多支球队，让玩家选择（仅显示符合条件的）
      const clubOptions: ActionOption[] = eligibleClubs.map(c => ({
        label: `${c.name}（Lv${c.level}，${c.count}名球员）${c.count === 0 ? '— 无球员' : ''}`,
        action: `START_MATCH:${cellId}:${c.cellId}`,
        disabled: c.count === 0,
      }));
      clubOptions.push({ label: '放弃挑战（支付参观费）', action: `PAY_VISIT:${cellId}` });
      return {
        ...state,
        pendingAction: {
          type: 'match_setup',
          message: `${p.name} 选择挑战 ${cell.name}（${owner.name} 的主场，Lv${state.cellLevels[cellId] || 1}）的球队：`,
          options: clubOptions,
          cellId,
        },
      };
    }

    // ===== 开始对战 =====
    case 'START_MATCH': {
      const { homeClubId, awayClubId } = action;
      const level = state.cellLevels[homeClubId] || 1;
      const homeOwnerId = state.cellOwners[homeClubId];
      const awayOwnerId = state.currentPlayerIndex;
      const homeSquad = state.instances.filter(i => i.clubId === homeClubId).map(i => i.uid);
      const awaySquad = state.instances.filter(i => i.clubId === awayClubId).map(i => i.uid);
      const homeCell = BOARD_CELLS[homeClubId];
      const awayCell = BOARD_CELLS[awayClubId];
      const homePlayer = state.players[homeOwnerId];
      const awayPlayer = currentPlayer(state);

      // 客队（挑战者）无球员 → 自动失败
      if (awaySquad.length === 0) {
        const fee = (MATCH_INCOMES[level] || 2) * 2;
        const failMsg = `😞 ${awayPlayer.name} 的球队没有球员，挑战失败！支付双倍参观费 ${fee}kw。`;
        return { ...log(state, failMsg), pendingAction: { type: 'post_move', message: failMsg, options: [{ label: `支付 ${fee}kw`, action: `EXECUTE_PAY:${fee}:${homeOwnerId}:挑战罚金-空阵` }] } };
      }
      // 主队无球员 → 客队自动获胜
      if (homeSquad.length === 0) {
        const msg = `🎉 ${awayPlayer.name} 挑战成功！${homeCell.name} 没有球员，${awayPlayer.name} 不战而胜，免费参观！`;
        const newState = log(state, msg);
        return { ...newState, pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'OK' }] } };
      }

      const newState = log(state, `⚔️ ${awayPlayer.name}（${awayCell.name}）挑战 ${homePlayer.name}（${homeCell.name}）！${LEVEL_TOURNAMENTS[level]}，${level} 轮制。`);
      return {
        ...newState,
        matchState: {
          level,
          homeClubId,
          awayClubId,
          homePlayerId: homeOwnerId,
          awayPlayerId: awayOwnerId,
          homeSquad,
          awaySquad,
          homePick: null,
          awayPick: null,
          round: 1,
          maxRounds: level,
          homeScore: 0,
          awayScore: 0,
          phase: 'picking',
          diceValue: null,
          rounds: [],
          isGoldenGoal: false,
          homeUsed: [],
          awayUsed: [],
        },
        pendingAction: null, // MatchPanel 直接接管选人
      };
    }

    // ===== 对战选人 =====
    case 'PICK_MATCH_PLAYER': {
      const { instanceUid, side } = action;
      const ms = state.matchState;
      if (!ms || ms.phase !== 'picking') return state;
      const newMs = { ...ms };
      if (side === 'home') newMs.homePick = instanceUid;
      else newMs.awayPick = instanceUid;
      // 双方都选好 → 等待确认
      if (newMs.homePick && newMs.awayPick) {
        return {
          ...state,
          matchState: { ...newMs, phase: 'picking' },
          pendingAction: {
            type: 'match_pick',
            message: '双方已选好球员，点击确认开始对决',
            options: [{ label: '确认对决', action: 'ROLL_MATCH_DICE' }],
          },
        };
      }
      return { ...state, matchState: newMs };
    }

    // ===== 掷骰子对决 =====
    case 'ROLL_MATCH_DICE': {
      const ms = state.matchState;
      if (!ms || !ms.homePick || !ms.awayPick) return state;
      const diceValue = rollDice();
      const newMs = { ...ms, diceValue, phase: 'reveal' as const };
      const homeInst = state.instances.find(i => i.uid === ms.homePick);
      const awayInst = state.instances.find(i => i.uid === ms.awayPick);
      if (!homeInst || !awayInst) return state;
      const homeCard = getCard(homeInst.cardId);
      const awayCard = getCard(awayInst.cardId);
      if (!homeCard || !awayCard) return state;
      const attrIndex = diceValue - 1;
      const isHomeGK = homeCard.isGK;
      const isAwayGK = awayCard.isGK;
      let homeVal: number, awayVal: number, attrName: string;
      if (isHomeGK && isAwayGK) {
        homeVal = homeCard.ovr + (homeInst.growth[0] || 0);
        awayVal = awayCard.ovr + (awayInst.growth[0] || 0);
        attrName = 'OVR';
      } else if (isHomeGK) {
        homeVal = homeCard.ovr + (homeInst.growth[0] || 0);
        attrName = 'OVR';
        awayVal = (awayCard.attrs[attrIndex] || 0) + (awayInst.growth[attrIndex] || 0);
      } else if (isAwayGK) {
        homeVal = (homeCard.attrs[attrIndex] || 0) + (homeInst.growth[attrIndex] || 0) + 1;
        awayVal = awayCard.ovr + (awayInst.growth[0] || 0);
        attrName = ['速度','射门','传球','盘带','防守','身体'][attrIndex];
      } else {
        attrName = ['速度','射门','传球','盘带','防守','身体'][attrIndex];
        homeVal = (homeCard.attrs[attrIndex] || 0) + (homeInst.growth[attrIndex] || 0) + 1;
        awayVal = (awayCard.attrs[attrIndex] || 0) + (awayInst.growth[attrIndex] || 0);
      }
      let winner: 'home' | 'away' | 'draw';
      if (homeVal > awayVal) winner = 'home';
      else if (awayVal > homeVal) winner = 'away';
      else winner = 'draw';
      const round: MatchRound = { homeUid: ms.homePick, awayUid: ms.awayPick, homeCardId: homeCard.id, awayCardId: awayCard.id, diceValue, attrIndex, homeVal, awayVal, winner };
      if (winner === 'home') newMs.homeScore++;
      else if (winner === 'away') newMs.awayScore++;
      newMs.rounds = [...newMs.rounds, round];
      newMs.homeUsed = [...newMs.homeUsed, ms.homePick];
      newMs.awayUsed = [...newMs.awayUsed, ms.awayPick];
      newMs.homePick = null;
      newMs.awayPick = null;
      // 球员历练
      const newInstances = state.instances.map(inst => {
        if (inst.uid === ms.homePick || inst.uid === ms.awayPick) {
          const newGrowth = [...inst.growth];
          const c = getCard(inst.cardId);
          if (c?.isGK) newGrowth[0] += 1;
          else if (attrIndex !== undefined) newGrowth[attrIndex] += 1;
          return { ...inst, growth: newGrowth };
        }
        return inst;
      });
      const newTP = { ...state.trainingPoints };
      if (winner === 'home') newTP[ms.homePlayerId] = (newTP[ms.homePlayerId] || 0) + 1;
      else if (winner === 'away') newTP[ms.awayPlayerId] = (newTP[ms.awayPlayerId] || 0) + 1;
      // 自动进入下一轮：展示结果后自动推进（机器人即时，人类 1.5s）
      const isHumanMatch = !state.players[ms.homePlayerId]?.isAI || !state.players[ms.awayPlayerId]?.isAI;
      return {
        ...state,
        matchState: newMs,
        instances: newInstances,
        trainingPoints: newTP,
        pendingAction: {
          type: 'match_reveal',
          message: `🎲 ${homeCard.name}(${homeVal}) vs ${awayCard.name}(${awayVal}) — ${winner === 'home' ? '主队胜' : winner === 'away' ? '客队胜' : '平局'}！`,
          options: [{ label: isHumanMatch ? '继续' : '继续', action: 'CONFIRM_MATCH_RESULT' }],
        },
      };
    }

    // ===== 投降 =====
    case 'FORFEIT_MATCH': {
      const ms = state.matchState;
      if (!ms) return state;
      const { side } = action;
      const newMs = {
        ...ms,
        homeScore: side === 'away' ? ms.maxRounds : ms.homeScore,
        awayScore: side === 'home' ? ms.maxRounds : ms.awayScore,
        isGoldenGoal: false,
      };
      const forfeiter = side === 'home' ? state.players[ms.homePlayerId] : state.players[ms.awayPlayerId];
      const winner = side === 'home' ? state.players[ms.awayPlayerId] : state.players[ms.homePlayerId];
      const newState = log(state, `🏳️ ${forfeiter.name} 投降！${winner.name} 直接获胜！`);
      return finishMatch({ ...newState, matchState: newMs });
    }

    // ===== 确认比赛结果 → 下一轮/金球/结束 =====
    case 'CONFIRM_MATCH_RESULT': {
      const ms = state.matchState;
      if (!ms) return state;
      const isRegularEnd = ms.round >= ms.maxRounds;
      // 检查平局
      if (isRegularEnd && ms.homeScore === ms.awayScore) {
        // 金球决胜：双方均可重新使用已出场球员，清空used
        // 安全兜底：双方都无人则主队胜
        if (ms.homeSquad.length === 0 && ms.awaySquad.length === 0) {
          const newMs = { ...ms, homeScore: ms.homeScore + 1 };
          return finishOrContinue(state, newMs, '金球决胜双方均无球员，判主队胜');
        }
        const newMs = {
          ...ms,
          round: ms.round + 1,
          maxRounds: ms.maxRounds + 1,
          isGoldenGoal: true,
          homePick: null,
          awayPick: null,
          phase: 'picking' as const,
          diceValue: null,
          homeUsed: [],
          awayUsed: [],
        };
        return { ...state, matchState: newMs, pendingAction: null };
      }
      // 安全兜底：达到maxRounds但仍在非golden状态 → 强制结算
      if (isRegularEnd && !ms.isGoldenGoal) {
        return finishMatch({ ...state, matchState: ms });
      }
      if (!isRegularEnd && !ms.isGoldenGoal) {
        const homeAvail = ms.homeSquad.filter(uid => !ms.homeUsed.includes(uid));
        const awayAvail = ms.awaySquad.filter(uid => !ms.awayUsed.includes(uid));
        // 有效轮次 = min(max(主场人数, 客场人数), 比赛等级)
        const effectiveMax = Math.min(Math.max(ms.homeSquad.length, ms.awaySquad.length), ms.maxRounds);
        if (homeAvail.length === 0 && awayAvail.length === 0) {
          // 双方都无人 → 跳到有效最大轮次
          if (ms.round >= effectiveMax) {
            // 已达有效上限，强制结束（平局则走 CONFIRM 金球逻辑）
            const endMs = { ...ms, round: ms.maxRounds };
            if (ms.homeScore === ms.awayScore) {
              return { ...state, matchState: endMs, pendingAction: { type: 'post_move', message: `双方均无球员，平局进入金球决胜！`, options: [{ label: '查看结果', action: 'CONFIRM_MATCH_RESULT' }] } };
            }
            return finishMatch({ ...state, matchState: endMs });
          }
          const remain = effectiveMax - ms.round;
          const newMs = { ...ms, round: effectiveMax, homeScore: ms.homeScore + remain, homePick: null, awayPick: null };
          return finishOrContinue(state, newMs, `双方均无球员，剩余${remain}轮全判主队胜`);
        }
        if (homeAvail.length === 0) {
          const remain = Math.min(effectiveMax - ms.round, awayAvail.length);
          if (remain <= 0) { const endMs = { ...ms, round: ms.maxRounds }; if (ms.homeScore === ms.awayScore) { return { ...state, matchState: endMs, pendingAction: { type: 'post_move', message: '双方均无剩余球员，平局进入金球决胜！', options: [{ label: '查看结果', action: 'CONFIRM_MATCH_RESULT' }] } }; } return finishMatch({ ...state, matchState: endMs }); }
          const newMs = { ...ms, round: ms.round + remain, awayScore: ms.awayScore + remain, homePick: null, awayPick: null };
          return finishOrContinue(state, newMs, `主队无球员，剩余${remain}轮全判客队胜`);
        }
        if (awayAvail.length === 0) {
          const remain = Math.min(effectiveMax - ms.round, homeAvail.length);
          if (remain <= 0) { const endMs = { ...ms, round: ms.maxRounds }; if (ms.homeScore === ms.awayScore) { return { ...state, matchState: endMs, pendingAction: { type: 'post_move', message: '双方均无剩余球员，平局进入金球决胜！', options: [{ label: '查看结果', action: 'CONFIRM_MATCH_RESULT' }] } }; } return finishMatch({ ...state, matchState: endMs }); }
          const newMs = { ...ms, round: ms.round + remain, homeScore: ms.homeScore + remain, homePick: null, awayPick: null };
          return finishOrContinue(state, newMs, `客队无球员，剩余${remain}轮全判主队胜`);
        }
        // 继续下一轮：直接进入选人状态
        const newMs = { ...ms, round: ms.round + 1, homePick: null, awayPick: null, phase: 'picking' as const, diceValue: null };
        return { ...state, matchState: newMs, pendingAction: null };
      }
      return finishMatch(state);
    }

// ========== 比赛辅助 ==========
function finishOrContinue(state: GameState, ms: NonNullable<GameState['matchState']>, reason: string): GameState {
  const msg = `⚡ ${reason}！（比分 ${ms.homeScore}:${ms.awayScore}）`;
  const newState = log(state, msg);
  const isEnd = ms.round >= ms.maxRounds && !ms.isGoldenGoal;
  // 平局时不能直接结束，要回到 CONFIRM_MATCH_RESULT 触发金球
  if (isEnd && ms.homeScore === ms.awayScore && !ms.isGoldenGoal) {
    return { ...newState, matchState: ms, pendingAction: { type: 'post_move', message: msg, options: [{ label: '查看结果', action: 'CONFIRM_MATCH_RESULT' }] } };
  }
  if (isEnd || (ms.isGoldenGoal && ms.homeScore !== ms.awayScore)) {
    return finishMatch({ ...newState, matchState: ms });
  }
  // 下一轮继续，用 CONFIRM_MATCH_RESULT 链式推进（避免进入空阵容选人）
  // 保持在 reveal 阶段，等待 "确定" 按钮推进
  return {
    ...newState,
    matchState: { ...ms, homePick: null, awayPick: null, phase: 'reveal', diceValue: null },
    pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'CONFIRM_MATCH_RESULT' }] },
  };
}

function finishMatch(state: GameState): GameState {
  const ms = state.matchState;
  if (!ms) return state;
  const homeCell = BOARD_CELLS[ms.homeClubId];
  const awayCell = BOARD_CELLS[ms.awayClubId];
  const homePlayer = state.players[ms.homePlayerId];
  const awayPlayer = state.players[ms.awayPlayerId];
  const homeWon = ms.homeScore > ms.awayScore;
  const level = ms.level;
  const visitFee = MATCH_INCOMES[level] || 2;

  // 写入联赛积分榜
  const newTables = state.leagueTables.map((t, i) => {
    if (i !== level) return t;
    const entries = [...t.entries];
    const homeIdx = entries.findIndex(e => e.clubId === ms.homeClubId);
    const awayIdx = entries.findIndex(e => e.clubId === ms.awayClubId);
    // 积分规则：赢3 金球胜2 金球负1 输0
    let homePoints = 0, awayPoints = 0;
    if (homeWon) {
      if (ms.isGoldenGoal) { homePoints = 2; awayPoints = 1; }
      else { homePoints = 3; awayPoints = 0; }
    } else {
      if (ms.isGoldenGoal) { homePoints = 1; awayPoints = 2; }
      else { homePoints = 0; awayPoints = 3; }
    }
    if (homeIdx >= 0) entries[homeIdx] = { ...entries[homeIdx], points: entries[homeIdx].points + homePoints, matches: entries[homeIdx].matches + 1 };
    else entries.push({ clubId: ms.homeClubId, ownerId: ms.homePlayerId, points: homePoints, matches: 1 });
    if (awayIdx >= 0) entries[awayIdx] = { ...entries[awayIdx], points: entries[awayIdx].points + awayPoints, matches: entries[awayIdx].matches + 1 };
    else entries.push({ clubId: ms.awayClubId, ownerId: ms.awayPlayerId, points: awayPoints, matches: 1 });
    const newMatchesPlayed = t.matchesPlayed + 1;
    // 检查是否需要结算
    if (newMatchesPlayed >= t.matchesNeeded) {
      // 结算由后续处理
    }
    return { ...t, entries, matchesPlayed: newMatchesPlayed };
  });

  let newState = log({
    ...state,
    matchState: null,
    leagueTables: newTables,
  }, `🏁 比赛结束！${homeCell.name} ${ms.homeScore}:${ms.awayScore} ${awayCell.name} — ${homeWon ? '主队胜' : '客队胜'}！`);

  // 比赛统计
  newState = addMatch(newState, ms.homePlayerId, homeWon);
  newState = addMatch(newState, ms.awayPlayerId, !homeWon);

  // 联赛结算检查（巅峰对决也参与联赛积分，需要结算）
  const tt = newTables[level];
  if (tt && tt.matchesPlayed >= tt.matchesNeeded) {
    newState = settleLeague(newState, level);
  }

  // 巅峰对决奖励（联赛结算后再发）
  if (state.peakDuel) {
    const winnerId = homeWon ? ms.homePlayerId : ms.awayPlayerId;
    const winner = state.players[winnerId];
    const reward = 5;
    const newPlayers2 = newState.players.map((pl, i) => i === winnerId ? { ...pl, cash: Math.round((pl.cash + reward) * 100) / 100 } : pl);
    const duelMsg = `⚔️ 巅峰对决！${winner.name} 获胜，领取 ${reward}kw 奖金！`;
    const duelState = log({ ...newState, players: newPlayers2, peakDuel: false }, duelMsg);
    return { ...duelState, pendingAction: { type: 'post_move', message: duelMsg, options: [{ label: `领取 ${reward}kw`, action: 'OK' }], playerId: winnerId } };
  }

  // 格式化比分（金球显示括号）
  const isGG = ms.isGoldenGoal;
  const ggHome = isGG ? ms.homeScore - ms.awayScore > 0 ? ms.homeScore - ms.awayScore : 0 : 0;
  const ggAway = isGG ? ms.awayScore - ms.homeScore > 0 ? ms.awayScore - ms.homeScore : 0 : 0;
  const scoreStr = isGG
    ? `${homeCell.name} ${ms.homeScore}(${ggHome}):${ms.awayScore}(${ggAway}) ${awayCell.name}`
    : `${homeCell.name} ${ms.homeScore}:${ms.awayScore} ${awayCell.name}`;
  const resultPlayer = awayPlayer.name; // 挑战者（客队）
  const resultText = homeWon ? '挑战失败' : '挑战成功';

  if (homeWon) {
    const fee = visitFee * 2;
    const failMsg = `💸 ${resultPlayer} ${resultText}！${scoreStr}，支付双倍参观费 ${fee}kw 给 ${homePlayer.name}。`;
    newState = log(newState, failMsg);
    newState = { ...newState, pendingAction: { type: 'post_move', message: failMsg, options: [{ label: `支付 ${fee}kw`, action: `EXECUTE_PAY:${fee}:${ms.homePlayerId}:挑战罚金` }] } };
  } else {
    const winMsg = `🎉 ${resultPlayer} ${resultText}！${scoreStr}，免费参观 ${homeCell.name}。`;
    newState = log(newState, winMsg);
    newState = { ...newState, pendingAction: { type: 'post_move', message: winMsg, options: [{ label: '免费参观', action: 'OK' }] } };
  }

  // 联赛结算后检查胜利条件
  const winCheck = checkWin(newState);
  if (winCheck.phase === 'finished') return winCheck;

  return newState;
}

function settleLeague(state: GameState, level: number): GameState {
  const t = state.leagueTables[level];
  if (!t) return skipAndEnd(state);
  const sorted = [...t.entries].sort((a, b) => b.points - a.points);
  const prize = [0, 2, 3, 4, 5, 10][level];
  const newTrophies = { ...state.clubTrophies };
  let newPlayers = [...state.players];
  let newLogState = state;

  // 冠军：所有并列第一
  const topPoints = sorted[0]?.points ?? 0;
  if (topPoints <= 0) return skipAndEnd(state); // 没人有分，不结算
  const champions = sorted.filter(e => e.points === topPoints);
  const newUCL = { ...state.hasUCLTitle };
  champions.forEach(e => {
    const existing = newTrophies[e.clubId] || { total: 0, byLevel: [0, 0, 0, 0, 0, 0] };
    newTrophies[e.clubId] = { total: existing.total + 1, byLevel: existing.byLevel.map((v, i) => i === level ? v + 1 : v) };
    if (level === 5) newUCL[e.ownerId] = true;
    newPlayers = newPlayers.map(pl => {
      if (pl.id === e.ownerId) return { ...pl, cash: Math.round((pl.cash + prize) * 100) / 100 };
      return pl;
    });
    const cell = BOARD_CELLS[e.clubId];
    const owner = state.players[e.ownerId];
    newLogState = log(newLogState, `🏆 ${cell?.name ?? '?'}（${owner.name}）获得${LEVEL_TOURNAMENTS[level]}冠军！+${prize}kw奖金 + 奖杯！`);
    newLogState = addChampionship(newLogState, e.ownerId);
    const titleIcon = level === 5 ? '👑' : '🏆';
    newLogState = pushEvent(newLogState, e.ownerId, titleIcon, `${cell?.name ?? '?'} ${LEVEL_TOURNAMENTS[level]}冠军`);
  });

  // 亚军：第二高分（如果有且不是并列冠军）
  if (champions.length === 1 && sorted.length > 1) {
    const secondPoints = sorted[champions.length]?.points ?? 0;
    const runners = sorted.filter(e => e.points === secondPoints);
    const runnerPrize = Math.floor(prize / 2);
    runners.forEach(e => {
      newPlayers = newPlayers.map(pl => {
        if (pl.id === e.ownerId) return { ...pl, cash: Math.round((pl.cash + runnerPrize) * 100) / 100 };
        return pl;
      });
      const cell = BOARD_CELLS[e.clubId];
      newLogState = log(newLogState, `🥈 ${cell?.name ?? '?'} 获得${LEVEL_TOURNAMENTS[level]}亚军！+${runnerPrize}kw奖金。`);
    });
  }

  // 清空榜单
  const newTables = state.leagueTables.map((tb, i) => {
    if (i !== level) return tb;
    return { ...tb, entries: [], matchesPlayed: 0 };
  });

  // 合并比赛结果和联赛结算消息
  const existingPA = newLogState.pendingAction;
  const result = {
    ...newLogState,
    players: newPlayers,
    leagueTables: newTables,
    clubTrophies: newTrophies,
    hasUCLTitle: newUCL,
  };
  // 生成联赛结算摘要
  const sorted2 = [...(newLogState.leagueTables[level]?.entries || [])].sort((a, b) => b.points - a.points);
  const summary = sorted2.filter(e => e.points > 0).map((e, i) => {
    const cell = BOARD_CELLS[e.clubId];
    const owner = state.players[e.ownerId];
    return `${i + 1}. ${cell?.name ?? '?'}(${owner.name}) ${e.points}分`;
  }).join('；');
  const combinedMsg = existingPA ? `${existingPA.message} | 🏆 ${LEVEL_TOURNAMENTS[level]}结算：${summary || '无队伍得分'}` : `🏆 ${LEVEL_TOURNAMENTS[level]}结算：${summary || '无队伍得分'}`;
  return {
    ...result,
    pendingAction: {
      type: 'post_move',
      message: combinedMsg,
      options: [{ label: existingPA?.options[0]?.label || '确定', action: existingPA?.options[0]?.action || 'OK' }],
    },
  };
}

    // ===== 开始转会竞价（买人） =====
    case 'START_TRANSFER_BID': {
      const { cardId } = action;
      const card = getCard(cardId);
      if (!card) return state;
      const basePrice = Math.round(card.marketValue / 2 * 100) / 100;
      const alive = state.players.filter(pl => !pl.isBankrupt).map(pl => pl.id);
      // 从当前玩家开始轮转
      const startIdx = alive.indexOf(state.currentPlayerIndex);
      const bidders = [...alive.slice(startIdx), ...alive.slice(0, startIdx)];
      const newState = log(state, `🔁 转会窗开启！${card.name}（OVR ${card.ovr}）寻求转会，起拍价 ${basePrice}kw。`);
      const firstBidderClubs = getPlayerClubs(bidders[0], state.cellOwners, state.cellLevels, state.instances);
      const firstHasClubs = firstBidderClubs.length > 0;
      const firstHasSpace = firstBidderClubs.some(c => c.count < getClubCapacity(c.level));
      return {
        ...newState,
        transferBidState: {
          cardId,
          currentBid: null,
          currentBidderId: null,
          bidders,
          bidderIndex: 0,
          passedPlayers: [],
          phase: 'bidding',
          isSell: false,
        },
        pendingAction: {
          type: 'transfer_bid',
          message: `转会竞价：${card.name}（OVR ${card.ovr}），起拍价 ${basePrice}kw。当前出价者：${state.players[bidders[0]].name}`,
          options: getBidOptions(state.players[bidders[0]], basePrice, null, firstHasClubs, firstHasSpace),
          cardId,
        },
      };
    }

    // ===== 开始转会卖出 =====
    case 'START_TRANSFER_SELL': {
      const { instanceUid } = action;
      const inst = state.instances.find(i => i.uid === instanceUid);
      if (!inst) return state;
      const card = getCard(inst.cardId);
      if (!card) return state;
      const basePrice = Math.round(card.marketValue / 4 * 100) / 100;
      const p = state.players.find(pl => pl.id === inst.ownerId);
      const alive = state.players.filter(pl => !pl.isBankrupt).map(pl => pl.id);
      const startIdx = alive.indexOf(state.currentPlayerIndex);
      const bidders = [...alive.slice(startIdx), ...alive.slice(0, startIdx)];
      // 卖家自动排除（不能买自己的球员）
      const filteredBidders = bidders.filter(id => id !== inst.ownerId);
      const newState = log(state, `🏷️ ${p?.name ?? '?'} 将 ${card.name} 挂牌出售，起拍价 ${basePrice}kw。`);
      if (filteredBidders.length === 0) {
        // 无人可竞拍，系统回收
        const seller = state.players.map((pl, i) => {
          if (i !== inst.ownerId) return pl;
          return { ...pl, cash: Math.round((pl.cash + basePrice) * 100) / 100 };
        });
        const newState2 = log({
          ...state,
          players: seller,
          instances: state.instances.filter(i => i.uid !== instanceUid),
          transferPool: [...state.transferPool, inst.cardId],
        }, `💔 无玩家可竞拍，系统以 ${basePrice}kw 回收 ${card.name}。`);
        return {
          ...newState2,
          pendingAction: {
            type: 'post_move',
            message: `无人可竞拍，${card.name} 被系统以 ${basePrice}kw 回收。`,
            options: [{ label: '确定', action: 'OK' }],
          },
        };
      }
      return {
        ...newState,
        transferBidState: {
          cardId: inst.cardId,
          currentBid: null,
          currentBidderId: null,
          bidders: filteredBidders,
          bidderIndex: 0,
          passedPlayers: [],
          phase: 'bidding',
          isSell: true,
          sellerId: inst.ownerId,
          instanceUid,
        },
        pendingAction: {
          type: 'transfer_bid',
          message: `转会竞价：${card.name}（OVR ${card.ovr}），起拍价 ${basePrice}kw。`,
          options: getBidOptions(state.players[filteredBidders[0]], basePrice, null,
            getPlayerClubs(filteredBidders[0], state.cellOwners, state.cellLevels, state.instances).length > 0,
            getPlayerClubs(filteredBidders[0], state.cellOwners, state.cellLevels, state.instances).some(c => c.count < getClubCapacity(c.level))),
          cardId: inst.cardId,
        },
      };
    }

    // ===== 竞价出价 =====
    case 'PLACE_BID': {
      const { amount } = action;
      const tbs = state.transferBidState;
      if (!tbs || tbs.phase !== 'bidding') return state;
      const newBidderId = tbs.bidders[tbs.bidderIndex];
      const card = getCard(tbs.cardId);
      const newState = log(state, `💰 ${state.players[newBidderId].name} 出价 ${amount}kw 竞拍 ${card?.name ?? '?'}！`);
      const nextTbs = {
        ...tbs,
        currentBid: amount,
        currentBidderId: newBidderId,
        passedPlayers: tbs.passedPlayers.filter(id => id !== newBidderId),
      };
      return advanceBid(newState, nextTbs);
    }

    // ===== 竞价跳过 =====
    case 'PASS_BID': {
      const tbs = state.transferBidState;
      if (!tbs || tbs.phase !== 'bidding') return state;
      const passerId = tbs.bidders[tbs.bidderIndex];
      const newPassed = [...tbs.passedPlayers, passerId];
      // 检查：是否只剩 1 个未 pass 且有出价 → 成交
      const remaining = tbs.bidders.filter(id => !newPassed.includes(id));
      if (tbs.currentBid !== null && remaining.length === 1 && remaining[0] === tbs.currentBidderId) {
        return finalizeTransferBid(state, tbs, tbs.currentBid, tbs.currentBidderId);
      }
      // 全部 pass → 流拍（但如果有人出过价则成交）
      if (remaining.length === 0) {
        if (tbs.currentBid !== null && tbs.currentBidderId !== null) {
          return finalizeTransferBid(state, tbs, tbs.currentBid, tbs.currentBidderId);
        }
        return cancelTransferBid(state, tbs);
      }
      // 推进到下一个未 pass 的 bidder
      return advanceBid(state, { ...tbs, passedPlayers: newPassed });
    }

    // ===== 执行支付（参观费/赞助费/挑战罚金） =====
    case 'EXECUTE_PAY': {
      const { amount, ownerId, reason } = action;
      const p = currentPlayer(state);
      const { newState: afterPay, hadToLoan } = forcePay(state, state.currentPlayerIndex, amount);
      const newPlayers = afterPay.players.map((pl, i) => {
        if (i === ownerId) return { ...pl, cash: Math.round((pl.cash + amount) * 100) / 100 };
        return pl;
      });
      let newState: GameState = { ...afterPay, players: newPlayers, challengeState: null };
      if (hadToLoan) {
        newState = log(newState, `🚨 ${p.name} 现金不足，自动紧急贷款补足差额！`);
      }
      newState = log(newState, `💸 ${p.name} 支付 ${reason} ${amount}kw 给 ${state.players[ownerId].name}`);
      return checkBankruptcyAndEnd(newState);
    }

    // ===== 还款 =====
    case 'REPAY_LOAN': {
      const amount = action.amount;
      const p = currentPlayer(state);
      const actualRepay = Math.min(amount, p.debt);
      if (actualRepay <= 0) return log(state, `❌ 没有负债需要还！`);
      if (p.cash < actualRepay) return log(state, `❌ 现金不足，无法还款 ${actualRepay}kw`);
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: Math.round((pl.cash - actualRepay) * 100) / 100, debt: Math.round((pl.debt - actualRepay) * 100) / 100 };
      });
      const newState = log({ ...state, players: newPlayers }, `🏦 ${p.name} 还款 ${actualRepay}kw，剩余负债 ${(p.debt - actualRepay).toFixed(2)}kw`);
      // 重新显示银行菜单
      const np = newPlayers[state.currentPlayerIndex];
      return { ...newState, pendingAction: buildBankMenu(np, false) };
    }

    // ===== 贷款 =====
    case 'TAKE_LOAN': {
      const amount = action.amount;
      const p = currentPlayer(state);
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: pl.cash + amount, debt: pl.debt + amount };
      });
      const newState = log({ ...state, players: newPlayers }, `🏦 ${p.name} 贷款 ${amount}kw，当前负债 ${(p.debt + amount).toFixed(2)}kw`);
      return skipAndEnd(newState);
    }

    // ===== 银行存款 =====
    case 'DEPOSIT': {
      const amount = action.amount;
      const p = currentPlayer(state);
      if (p.cash < amount) return log(state, `❌ 现金不足，无法存入 ${amount}kw`);
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: pl.cash - amount, savings: pl.savings + amount };
      });
      const newState = log({
        ...state,
        players: newPlayers,
      }, `🏦 ${p.name} 存入 ${amount}kw，存款余额 ${(p.savings + amount).toFixed(2)}kw`);
      // 回到银行菜单
      const np = newPlayers[state.currentPlayerIndex];
      return { ...newState, pendingAction: buildBankMenu(np, false) };
    }

    // ===== 银行取款 =====
    case 'WITHDRAW': {
      const amount = action.amount;
      const p = currentPlayer(state);
      const actualWithdraw = Math.min(amount, p.savings);
      if (actualWithdraw <= 0) return log(state, `❌ 存款不足`);
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, cash: Math.round((pl.cash + actualWithdraw) * 100) / 100, savings: Math.round((pl.savings - actualWithdraw) * 100) / 100 };
      });
      const newState = log({
        ...state,
        players: newPlayers,
      }, `🏦 ${p.name} 取出 ${actualWithdraw}kw，存款余额 ${(p.savings - actualWithdraw).toFixed(2)}kw`);
      const np = newPlayers[state.currentPlayerIndex];
      return { ...newState, pendingAction: buildBankMenu(np, false) };
    }

    // ===== 拒绝贷款 =====
    case 'DECLINE_LOAN': {
      return skipAndEnd(state);
    }

    // ===== 机场飞行 =====
    case 'AIRPORT_FLY': {
      const targetCellId = action.targetCellId;
      const p = currentPlayer(state);
      const cell = BOARD_CELLS[targetCellId];
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, position: targetCellId };
      });
      const newState = log({
        ...state,
        players: newPlayers,
      }, `✈️ ${p.name} 从机场飞往 ${cell.name}！`);
      return skipAndEnd(newState);
    }

    // ===== 宣告破产 =====
    case 'EXECUTE_BANKRUPT': {
      const p = currentPlayer(state);
      const newPlayers = state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, isBankrupt: true, bankruptTurn: state.turn });
      let bankruptState = cleanupBankruptPlayer({ ...state, players: newPlayers, pendingAction: null }, state.currentPlayerIndex);
      bankruptState = log(bankruptState, `💀 ${p.name} 宣告破产！负债 ${p.debt.toFixed(2)}kw，球员回池，地产清空。`);
      const winState = checkWin(bankruptState);
      if (winState.phase === 'finished') return winState;
      return advancePlayer(bankruptState);
    }

    // ===== 宣告破产（ROUND_SETTLEMENT中，指定玩家） =====
    case 'EXECUTE_BANKRUPT_ID': {
      const playerId = action.playerId!;
      const bp = state.players[playerId];
      if (!bp || bp.isBankrupt) return state;
      const newPlayers = state.players.map((pl, i) => i !== playerId ? pl : { ...pl, isBankrupt: true, bankruptTurn: state.turn });
      let bankruptState = cleanupBankruptPlayer({ ...state, players: newPlayers, pendingAction: null }, playerId);
      bankruptState = log(bankruptState, `💀 ${bp.name} 宣告破产！负债 ${bp.debt.toFixed(2)}kw，球员回池，地产清空。`);
      const winState = checkWin(bankruptState);
      if (winState.phase === 'finished') return winState;
      // 将回合还给当前玩家（不跳过）
      const cp = bankruptState.players[bankruptState.currentPlayerIndex];
      if (!cp || cp.isBankrupt) return advancePlayer(bankruptState);
      return {
        ...bankruptState,
        pendingAction: {
          type: 'post_move',
          message: `${cp.name} 的回合，请掷骰子 🎲`,
          options: [{ label: '掷骰子', action: 'ROLL_DICE' }],
        },
      };
    }

    // ===== 结束当前行动（回合末） =====
    case 'END_TURN': {
      const p = currentPlayer(state);
      if (p.debt >= BANKRUPT_DEBT) {
        const newPlayers = state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, isBankrupt: true, bankruptTurn: state.turn });
        let bankruptState = cleanupBankruptPlayer({ ...state, players: newPlayers, pendingAction: null }, state.currentPlayerIndex);
        bankruptState = log(bankruptState, `💀 ${p.name} 破产了！球员回池，地产清空。`);
        const winState = checkWin(bankruptState);
        if (winState.phase === 'finished') return winState;
        return advancePlayer(bankruptState);
      }
      const nwWin = checkWin(state);
      if (nwWin.phase === 'finished') return nwWin;
      return advancePlayer(state);
    }

    // ===== 回合结算 =====
    case 'ROUND_SETTLEMENT': {
      // 所有玩家回合结束后：存款 +2%，负债 +5%
      let newPlayers = state.players.map(pl => {
        let changes: Partial<typeof pl> = {};
        if (pl.isBankrupt) return pl; // 破产者跳过利息
        if (pl.debt > 0) {
          const raw = Math.round(pl.debt * (1 + LOAN_RATE) * 100) / 100;
          // 确保每回合至少增长 0.01kw，不被舍掉
          changes.debt = Math.max(raw, +(pl.debt + 0.01).toFixed(2));
        }
        if (pl.savings > 0) {
          const raw = Math.round(pl.savings * (1 + SAVINGS_RATE) * 100) / 100;
          changes.savings = Math.max(raw, +(pl.savings + 0.01).toFixed(2));
        }
        return { ...pl, ...changes };
      });

      // 生成利息明细日志
      const interestMsgs: string[] = [];
      newPlayers.forEach((pl, i) => {
        const oldP = state.players[i];
        if (oldP.debt > 0 && pl.debt !== oldP.debt) {
          interestMsgs.push(`${pl.name} 负债 ${oldP.debt}→${pl.debt}kw`);
        }
        if (oldP.savings > 0 && pl.savings !== oldP.savings) {
          interestMsgs.push(`${pl.name} 存款 ${oldP.savings}→${pl.savings}kw`);
        }
      });
      const turnMsg = `🔄 第 ${state.turn} 轮结束` + (interestMsgs.length > 0 ? `：${interestMsgs.join('；')}` : '，无利息变动');

      let newState = log({
        ...state,
        players: newPlayers,
        turn: state.turn + 1,
      }, turnMsg);

      // 检查破产（负债 >= 100kw）—— 先捕获快照（含触发破产的高负债），再清理
      const bankruptPlayers = newPlayers.filter(pl => pl.debt >= BANKRUPT_DEBT && !pl.isBankrupt);
      if (bankruptPlayers.length > 0) {
        // 快照：此时 debt 还是利息后的高值（如 51kw），propertyValue 也还在
        const snapEntry = { turn: state.turn, players: newPlayers.map(pl => ({
          cash: pl.cash, savings: pl.savings, debt: pl.debt,
          propertyValue: pl.isBankrupt ? 0 : getPropertyValue({ ...newState, players: newPlayers }, pl.id),
        })) };
        newState = { ...newState, snapshots: [...newState.snapshots, snapEntry] };
        for (const bp of bankruptPlayers) {
          newState = log(newState, `💀 ${bp.name} 负债超过 ${BANKRUPT_DEBT}kw，破产！`);
          newState = cleanupBankruptPlayer(newState, bp.id);
        }
        // 标记破产（清理后 debt 已归零，用 ID 匹配而非 debt 条件）
        const bankruptIds = new Set(bankruptPlayers.map(b => b.id));
        newPlayers = newState.players.map(pl => {
          if (bankruptIds.has(pl.id)) return { ...pl, isBankrupt: true, bankruptTurn: state.turn };
          return pl;
        });
        newState = { ...newState, players: newPlayers };

        // 游戏未结束 → 直接推进到下一个存活玩家（不走"确定→结束回合"多余循环）
        const winCheck = checkWin({ ...newState, players: newPlayers });
        if (winCheck.phase === 'finished') return winCheck;

        const nextIdx = findNextAlivePlayer(newState.players, newState.currentPlayerIndex);
        const nextP = newState.players[nextIdx];
        const inJail = nextP.jailTurns > 0;
        return {
          ...newState,
          currentPlayerIndex: nextIdx,
          pendingAction: {
            type: 'post_move',
            message: inJail ? `💀 ${bankruptPlayers.map(b => b.name).join('、')} 破产！🔒 ${nextP.name} 坐牢中，剩余 ${nextP.jailTurns} 轮`
                           : `💀 ${bankruptPlayers.map(b => b.name).join('、')} 破产！轮到 ${nextP.name}`,
            options: [{ label: inJail ? '结束回合' : '掷骰子', action: inJail ? 'END_TURN' : 'ROLL_DICE' }],
          },
        };
      }

      // 检查净值胜利
      const nwWin = checkWin({ ...newState, players: newPlayers });
      if (nwWin.phase === 'finished') return nwWin;

      // advancePlayer 已设置好下一玩家，直接使用
      const nextPlayerIdx = findNextAlivePlayer(newState.players, newState.currentPlayerIndex);
      const nextPlayer = newState.players[nextPlayerIdx];
      const isInJail = nextPlayer.jailTurns > 0;

      // 财务快照
      const snapEntry = { turn: state.turn, players: newPlayers.map(pl => ({
        cash: pl.cash, savings: pl.savings, debt: pl.debt,
        propertyValue: pl.isBankrupt ? 0 : getPropertyValue({ ...newState, players: newPlayers }, pl.id),
      })) };
      return {
        ...newState,
        currentPlayerIndex: nextPlayerIdx,
        snapshots: [...newState.snapshots, snapEntry],
        pendingAction: {
          type: 'post_move',
          message: isInJail ? `🔒 ${nextPlayer.name} 坐牢中，剩余 ${nextPlayer.jailTurns} 轮` : `${nextPlayer.name} 的回合，请掷骰子 🎲`,
          options: [{ label: isInJail ? '结束回合' : '掷骰子', action: isInJail ? 'END_TURN' : 'ROLL_DICE' }],
        },
      };
    }

    // ===== 重置游戏 =====
    case 'RESET_GAME': {
      const pools = initPlayerPools();
      return {
        ...state,
        phase: 'setup',
        players: [],
        currentPlayerIndex: 0,
        cellOwners: {},
        cellLevels: {},
        turn: 0,
        diceValue: null,
        diceAnimating: false,
        log: [],
        winner: null,
        pendingAction: null,
        challengeState: null,
        ...pools,
        matchState: null,
        transferBidState: null,
        peakDuel: false,
        leagueTables: createEmptyLeagueTables(),
      };
    }

    default:
      return state;
  }
}

// ========== 联赛榜初始化 ==========
function createEmptyLeagueTables(): LeagueTable[] {
  const arr: LeagueTable[] = [{} as LeagueTable];
  for (let lv = 1; lv <= 5; lv++) {
    arr.push({ level: lv, entries: [], matchesPlayed: 0, matchesNeeded: 0 });
  }
  return arr;
}

// ========== 辅助函数 ==========

/**
 * 处理落地的格子
 */
function handleLanding(state: GameState, position: number): GameState {
  const cell = BOARD_CELLS[position];
  const p = currentPlayer(state);

  switch (cell.type) {

    case 'start':
      return {
        ...state,
        pendingAction: {
          type: 'post_move',
          message: `${p.name} 停在起点，获得休息回合。`,
          options: [{ label: '确定', action: 'OK' }],
        },
      };

    case 'club': {
      const ownerId = state.cellOwners[position];
      const level = state.cellLevels[position] || 1;

      if (ownerId === undefined) {
        // 无人持有 → 可以购买
        const clubPrice = cell.price ?? 2;
        return {
          ...state,
          pendingAction: {
            type: 'buy_club',
            message: `${cell.name} 无人所有，是否以 ${clubPrice}kw 购买？（${cell.league}俱乐部）`,
            options: [
              { label: `购买 (${clubPrice}kw)`, action: `BUY_CLUB:${position}`, disabled: p.cash < clubPrice },
              { label: '不买', action: 'SKIP_BUY' },
            ],
            cellId: position,
          },
        };
      }

      if (ownerId === p.id) {
        // 自己的 → 比赛日收入分配
        const income = MATCH_INCOMES[level];
        const currentLevel = level;
        const canUpgrade = currentLevel < 5;
        const nextCost = canUpgrade ? UPGRADE_COSTS[currentLevel] : 0;
        const hasDebt = p.debt > 0;
        const stadiumLevel = ['','社区','初级','中级','高级','现代化'][currentLevel];

        const opts: ActionOption[] = [
          { label: `支取现金 (+${income}kw)`, action: `MATCH_INCOME:cash:${income}:${position}` },
          { label: `存入银行 (+${income}kw)`, action: `MATCH_INCOME:savings:${income}:${position}` },
        ];
        if (hasDebt) {
          const repayAmt = Math.min(income, p.debt);
          const leftover = Math.round((income - repayAmt) * 100) / 100;
          const repayLabel = leftover > 0
            ? `偿还贷款 (抵${repayAmt}kw + 存${leftover}kw)`
            : `偿还贷款 (抵${repayAmt}kw)`;
          opts.push({ label: repayLabel, action: `MATCH_INCOME:repay:${income}:${position}` });
        }

        return {
          ...state,
          pendingAction: {
            type: 'visit_or_challenge', // reuse existing type for multi-option
            message: `🎟️ ${p.name} 在 ${cell.name} 获得比赛日收入 ${income}kw（${stadiumLevel}球场）。${hasDebt ? '你想将其用于？' : '你想将其用于？'}`,
            options: opts,
            cellId: position,
          },
        };
      }

      // 他人持有
      const visitFee = MATCH_INCOMES[level];
      const owner = state.players[ownerId];
      // 检查挑战者是否有可用球队（有球场且有球员）
      const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
      const canChallenge = myClubs.some(c => c.count > 0);
      const options: ActionOption[] = [
        { label: `支付参观费 (${visitFee}kw)`, action: `PAY_VISIT:${position}` },
      ];
      if (canChallenge) {
        options.push({ label: '挑战', action: `CHALLENGE:${position}` });
      }
      return {
        ...state,
        pendingAction: {
          type: 'visit_or_challenge',
          message: `${cell.name} 属于 ${owner.name}（${['','社区','初级','中级','高级','现代化'][level]}球场），参观费 ${visitFee}kw。${canChallenge ? '请选择：' : '你没有可出战的球员，只能支付参观费。'}`,
          options,
          cellId: position,
        },
      };
    }

    case 'sponsor': {
      const ownerId = state.cellOwners[position];
      const payout = getSponsorPayout(position);
      if (ownerId === undefined) {
        return {
          ...state,
          pendingAction: {
            type: 'buy_sponsor',
            message: `${cell.name} 无人所有，是否以 ${cell.price}kw 购买？（他人停留需支付 ${payout}kw）`,
            options: [
              { label: `购买 (${cell.price}kw)`, action: `BUY_SPONSOR:${position}`, disabled: p.cash < (cell.price || 0) },
              { label: '不买', action: 'SKIP_BUY' },
            ],
            cellId: position,
          },
        };
      }

      if (ownerId === p.id) {
        const newPlayers = state.players.map((pl, i) => {
          if (i !== state.currentPlayerIndex) return pl;
          return { ...pl, cash: Math.round((pl.cash + payout) * 100) / 100 };
        });
        const msg = `🏪 ${p.name} 到达自己的 ${cell.name}，获得 ${payout}kw 赞助收入！`;
        const newState = log({ ...state, players: newPlayers }, msg);
        return { ...newState, pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'OK' }] } };
      }

      // 他人持有 → 展示支付按钮（必须点击）
      const owner = state.players[ownerId];
      return {
        ...state,
        pendingAction: {
          type: 'confirm_pay',
          message: `${p.name} 在 ${cell.name}（${owner.name} 的赞助商）停留，需支付 ${payout}kw`,
          options: [{ label: `支付 ${payout}kw`, action: `EXECUTE_PAY:${payout}:${ownerId}:赞助费` }],
          cellId: position,
        },
      };
    }

    case 'bank': {
      return { ...state, pendingAction: { ...buildBankMenu(p, false), cellId: position } };
    }

    case 'jail': {
      if (p.jailTurns > 0) {
        // 已经在监狱中（不太可能发生，但安全处理）
        return skipAndEnd(state);
      }
      // 入狱 2 回合
      const newPlayers = state.players.map((pl, i) => {
        if (i !== state.currentPlayerIndex) return pl;
        return { ...pl, jailTurns: 2 };
      });
      let newState = log({
        ...state,
        players: newPlayers,
      }, `🔒 ${p.name} 被关进监狱！需要停留 2 回合。`);
      newState = addJail(newState, state.currentPlayerIndex);
      newState = pushEvent(newState, state.currentPlayerIndex, '🔒', '');
      return skipAndEnd(newState);
    }

    case 'airport': {
      const ownedCells = p.properties.filter(id => {
        const c = BOARD_CELLS[id];
        return c.type === 'club' || c.type === 'sponsor';
      });

      if (ownedCells.length === 0) {
        return {
          ...state,
          pendingAction: {
            type: 'post_move',
            message: `${p.name} 到达机场，但没有自己的地产可以飞往。`,
            options: [{ label: '确定', action: 'OK' }],
          },
        };
      }

      const flyOptions = ownedCells.map(id => ({
        label: `飞往 ${BOARD_CELLS[id].name}`,
        action: `AIRPORT_FLY:${id}`,
      }));
      flyOptions.push({ label: '不飞了', action: 'AIRPORT_SKIP' });

      return {
        ...state,
        pendingAction: {
          type: 'airport_fly',
          message: `${p.name} 到达机场！可以飞往任意自己的地产：`,
          options: flyOptions,
          cellId: position,
        },
      };
    }

    case 'windfall': {
      // cell 11 = 绝处逢生
      if (position === 11) {
        if (p.debt > 0) {
          const msg = `🍀 绝处逢生！${p.name} 的 ${p.debt}kw 负债被一笔勾销！`;
          return { ...state, pendingAction: { type: 'post_move', message: msg, options: [{ label: '太好了', action: `RND_EVT:9:${p.debt}` }] } };
        }
        // 无负债 → 财政公平
        const alive = state.players.filter(pl => !pl.isBankrupt);
        const richest = alive.reduce((a, b) => a.cash > b.cash ? a : b);
        const poorest = alive.reduce((a, b) => a.cash < b.cash ? a : b);
        if (richest.id === poorest.id || richest.cash <= poorest.cash) {
          return { ...state, pendingAction: { type: 'post_move', message: `🍀 绝处逢生！但所有玩家现金相当，无事发生。`, options: [{ label: '知道了', action: 'OK' }] } };
        }
        const diff = Math.round((richest.cash - poorest.cash) * 100) / 100;
        const transfer = Math.round(diff / 4 * 100) / 100;
        if (transfer <= 0) {
          return { ...state, pendingAction: { type: 'post_move', message: `🍀 绝处逢生！差额太小，无事发生。`, options: [{ label: '知道了', action: 'OK' }] } };
        }
        return { ...state, pendingAction: { type: 'post_move', message: `🍀 绝处逢生（财政公平）！${richest.name} 支付 ${transfer}kw 给 ${poorest.name}。`, options: [{ label: '知道了', action: `RND_EVT:4:${transfer}:${richest.id}:${poorest.id}` }] } };
      }
      const amounts = [2, 5, 10];
      const bonus = amounts[Math.floor(Math.random() * amounts.length)];
      return {
        ...state,
        pendingAction: {
          type: 'confirm_pay',
          message: `🍀 天降横财！${p.name} 发现了一笔意外之财！`,
          options: [{ label: `捡起 ${bonus}kw`, action: `WINDFALL_GET:${bonus}` }],
          cellId: position,
        },
      };
    }

    case 'random':
      return handleRandomEvent(state, position);

    case 'street':
      return handleStreetLanding(state, position);

    case 'transfer':
      return handleTransferLanding(state, position);

    case 'blank':
      // cell 29 = 银行分行
      if (position === 29) {
        return startTrainingCamp(state, position);
      }
      if (position === 39) {
        return startYouthAcademy(state, position);
      }
      return {
        ...state,
        pendingAction: {
          type: 'post_move',
          message: `${p.name} 到达 ${cell.name}（暂未开放）。`,
          options: [{ label: '确定', action: 'OK' }],
        },
      };

    default:
      return skipAndEnd(state);
  }
}

/**
 * 处理随机事件格
 */

function handleRandomEvent(state: GameState, position: number): GameState {
  const p = currentPlayer(state);
  const validEvents = [0, 1, 2, 3, 5, 6, 7, 8]; // 4(财政公平)已移至"绝处逢生"
  const eventIndex = validEvents[Math.floor(Math.random() * validEvents.length)];

  switch (eventIndex) {
    case 0: { // 刮出彩票
      const bonus = Math.random() < 0.5 ? 1 : 2;
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：刮出彩票！${p.name} 中奖 ${bonus}kw。`, options: [{ label: `领取 ${bonus}kw`, action: `RND_EVT:0:${bonus}` }] } };
    }
    case 1: // 挖出石油
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：挖出石油！${p.name} 获得 10kw。`, options: [{ label: "领取 10kw", action: "RND_EVT:1" }] } };
    case 2: { // 特大丑闻
      const halved = Math.floor(p.cash * 100 / 2) / 100;
      const lost = Math.round((p.cash - halved) * 100) / 100;
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：特大丑闻！${p.name} 现金折半，损失 ${lost}kw。`, options: [{ label: `失去 ${lost}kw`, action: `RND_EVT:2:${halved}` }] } };
    }
    case 3: { // 球场漏水
      const clubs = p.properties.filter(id => BOARD_CELLS[id].type === "club");
      if (clubs.length === 0) {
        return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：球场漏水！${p.name} 没有球场，无事发生。`, options: [{ label: "知道了", action: "OK" }] } };
      }
      const targetClub = clubs[Math.floor(Math.random() * clubs.length)];
      const currentLevel = state.cellLevels[targetClub] || 1;
      if (currentLevel <= 1) {
        return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：球场漏水！${BOARD_CELLS[targetClub].name} 受损严重，${p.name} 将失去这处地产！`, options: [{ label: "知道了", action: `RND_EVT:3:lose:${targetClub}` }] } };
      }
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：球场漏水！${BOARD_CELLS[targetClub].name} 从 Lv${currentLevel} 降级到 Lv${currentLevel - 1}。`, options: [{ label: "知道了", action: `RND_EVT:3:downgrade:${targetClub}` }] } };
    }
    case 5: { // 燃放焰火
      const clubCount = p.properties.filter(id => BOARD_CELLS[id].type === "club").length;
      if (clubCount === 0) {
        return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：燃放焰火！${p.name} 没有球场，免于罚款。`, options: [{ label: "知道了", action: "OK" }] } };
      }
      const fine = clubCount * 0.5;
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：燃放焰火！${p.name} 被罚款 ${fine}kw（${clubCount} 座球场 × 0.5kw）。`, options: [{ label: `支付 ${fine}kw`, action: `RND_EVT:5:${fine}` }] } };
    }
    case 6: { // 车水马龙
      const clubCount = p.properties.filter(id => BOARD_CELLS[id].type === "club").length;
      if (clubCount === 0) {
        return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：车水马龙！${p.name} 没有球场，无事发生。`, options: [{ label: "知道了", action: "OK" }] } };
      }
      const income = clubCount * 1;
      return { ...state, pendingAction: { type: "post_move", message: `🎲 随机事件：车水马龙！${p.name} 增收 ${income}kw（${clubCount} 座球场 × 1kw）。`, options: [{ label: `领取 ${income}kw`, action: `RND_EVT:6:${income}` }] } };
    }
    case 7: // 巅峰对决
      return { ...state, pendingAction: { type: 'post_move', message: `⚔️ 巅峰对决！${p.name} 可以选择一名玩家进行对战，胜者获得 5kw！`, options: [{ label: '选择对手', action: 'PEAK_DUEL_SELECT' }] } };
    case 8: { // 税务稽查
      const alive = state.players.filter(pl => !pl.isBankrupt);
      const richest = alive.reduce((a, b) => a.cash > b.cash ? a : b);
      const tax = Math.round(richest.cash * 0.2 * 100) / 100;
      if (tax <= 0) {
        return { ...state, pendingAction: { type: 'post_move', message: `🎲 随机事件：税务稽查！但所有玩家现金都很少，无事发生。`, options: [{ label: '知道了', action: 'OK' }] } };
      }
      let btnLabel = '知道了';
      if (p.id === richest.id) btnLabel = `缴纳 ${tax}kw`;
      return { ...state, pendingAction: { type: 'post_move', message: `🎲 随机事件：税务稽查！${richest.name} 需缴纳 20% 现金税款 ${tax}kw。`, options: [{ label: btnLabel, action: `RND_EVT:8:${tax}:${richest.id}` }] } };
    }
    default:
      return skipAndEnd(state);
  }
}

// ========== 巅峰对决 ==========
function startPeakDuelSelect(state: GameState): GameState {
  const p = currentPlayer(state);
  // 检查自己是否有球队
  const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
  const canFight = myClubs.some(c => c.count > 0);
  if (!canFight) {
    const msg = `😞 ${p.name} 没有可出战的球队，巅峰对决失败！罚款 2kw。`;
    const { newState: afterPay, hadToLoan } = forcePay(state, state.currentPlayerIndex, 2);
    let s = afterPay;
    if (hadToLoan) s = log(s, `🚨 ${p.name} 现金不足，自动紧急贷款！`);
    return { ...log(s, msg), pendingAction: { type: 'post_move', message: msg, options: [{ label: `支付 2kw`, action: 'OK' }] } };
  }
  const opponents = state.players.filter(pl => pl.id !== p.id && !pl.isBankrupt).map(pl => ({
    label: pl.name,
    action: `PEAK_DUEL_PICK:${pl.id}`,
  }));
  return { ...state, pendingAction: { type: 'transfer_bid', message: `⚔️ ${p.name} 选择巅峰对决的对手：`, options: opponents } };
}

function startPeakDuelMatch(state: GameState, opponentId: number): GameState {
  const p = currentPlayer(state);
  const opp = state.players[opponentId];
  const oppClubs = getPlayerClubs(opponentId, state.cellOwners, state.cellLevels, state.instances);
  const oppCanFight = oppClubs.some(c => c.count > 0);
  if (!oppCanFight) {
    const msg = `🎉 ${opp.name} 没有可出战的球队，${p.name} 巅峰对决直接获胜！+5kw！`;
    const newPlayers = state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash + 5) * 100) / 100 });
    return { ...log({ ...state, players: newPlayers }, msg), pendingAction: { type: 'post_move', message: msg, options: [{ label: '领取 5kw', action: 'OK' }] } };
  }
  // 双方选择自己的球队
  const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances).filter(c => c.count > 0);
  const opts: ActionOption[] = myClubs.map(c => ({
    label: `${c.name}（Lv${c.level}，${c.count}名球员）`,
    action: `PEAK_DUEL_CLUB:${opponentId}:${c.cellId}`,
  }));
  return { ...state, pendingAction: { type: 'match_setup', message: `⚔️ ${p.name} vs ${opp.name} — 请选择你的球队：`, options: opts } };
}

function startPeakDuelWithClub(state: GameState, opponentId: number, myClubId: number): GameState {
  const p = currentPlayer(state);
  const opp = state.players[opponentId];
  const oppClubs = getPlayerClubs(opponentId, state.cellOwners, state.cellLevels, state.instances).filter(c => c.count > 0);
  if (oppClubs.length === 1) {
    return gameReducer({ ...state, peakDuel: true }, { type: 'START_MATCH', homeClubId: oppClubs[0].cellId, awayClubId: myClubId });
  }
  const opts: ActionOption[] = oppClubs.map(c => ({
    label: `${c.name}（Lv${c.level}，${c.count}名球员）`,
    action: `START_MATCH:${c.cellId}:${myClubId}`,
  }));
  return { ...state, peakDuel: true, pendingAction: { type: 'match_setup', message: `⚔️ ${p.name} vs ${opp.name} — 选择${opp.name}的球队：`, options: opts, playerId: opponentId } };
}

function applyStadiumDowngrade(state: GameState, cid: number): GameState {
  const nl = (state.cellLevels[cid] || 1) - 1;
  // 总人数（驻守+普通）不得超过等级容量
  const totalPlayers = state.instances.filter(i => i.clubId === cid).length;
  const overflow = totalPlayers - nl;
  if (overflow > 0) return startStadiumOverflowFlow(state, cid, nl);
  let s = { ...state, cellLevels: { ...state.cellLevels, [cid]: nl } };
  if (nl < 3) {
    const residentInst = s.instances.find(i => getCard(i.cardId)?.isResident && getCard(i.cardId)?.residentClubId === cid && i.clubId === cid);
    if (residentInst) {
      s = { ...s, instances: s.instances.filter(i => i.uid !== residentInst.uid) };
      s = log(s, `🔙 ${getCard(residentInst.cardId)?.name ?? '?'} 离开球队（球场降至Lv2）。`);
    }
  }
  const result = log(s, `🎲 ${BOARD_CELLS[cid].name} 降级到 Lv${nl}。`);
  return { ...result, pendingAction: { type: 'post_move', message: `🎲 ${BOARD_CELLS[cid].name} 降级到 Lv${nl}。`, options: [{ label: '知道了', action: 'OK' }] } };
}

// ========== 球场失去处理 ==========
function prepareStadiumLoss(state: GameState, cid: number): GameState {
  const playerId = state.currentPlayerIndex;
  const np = state.players.map((pl, i) => i !== playerId ? pl : { ...pl, properties: pl.properties.filter(id => id !== cid) });
  const no = { ...state.cellOwners }; delete no[cid];
  const nl = { ...state.cellLevels }; delete nl[cid];
  // 移除驻守球员（不回池），保留其他球员待转会
  const newInstances = state.instances.filter(inst => {
    if (inst.clubId !== cid) return true;
    return getCard(inst.cardId)?.isResident ? false : true; // 驻守直接移除
  });
  // 清除该球场的奖杯和联赛战绩（否则重新购买后会继承）
  const newTrophies = { ...state.clubTrophies }; delete newTrophies[cid];
  const newTables = state.leagueTables.map(t => ({
    ...t,
    entries: (t.entries || []).filter(e => e.clubId !== cid),
  }));
  return { ...state, players: np, cellOwners: no, cellLevels: nl, instances: newInstances, clubTrophies: newTrophies, leagueTables: newTables };
}

function buildLossTransferUI(state: GameState, lostCid: number): PendingAction {
  const lostPlayers = state.instances.filter(inst => inst.clubId === lostCid && !getCard(inst.cardId)?.isResident);
  if (lostPlayers.length === 0) {
    return { type: 'post_move', message: `🎲 ${BOARD_CELLS[lostCid].name} 受损严重，失去了这处地产！`, options: [{ label: '确定', action: 'OK' }] };
  }
  // 逐个处理：第一个球员显示转会选项
  const inst = lostPlayers[0];
  const card = getCard(inst.cardId);
  const remaining = lostPlayers.length - 1;
  const otherClubs = getPlayerClubs(state.currentPlayerIndex, state.cellOwners, state.cellLevels, state.instances).filter(c => c.cellId !== lostCid);
  const hasSpace = otherClubs.some(c => c.count < getClubCapacity(c.level));

  const opts: ActionOption[] = [];
  if (hasSpace) {
    otherClubs.forEach(c => {
      if (c.count < getClubCapacity(c.level)) {
        opts.push({ label: `转至 ${c.name}（${c.count}/${getClubCapacity(c.level)}）`, action: `LOSS_TRANSFER:${inst.uid}:${c.cellId}:${lostCid}:${remaining}` });
      }
    });
  }
  opts.push({ label: '释放回市场', action: `LOSS_RELEASE:${inst.uid}:${lostCid}:${remaining}` });

  const extra = remaining > 0 ? `（还有 ${remaining} 名球员待处理）` : '';
  return {
    type: 'internal_transfer',
    message: `🎲 ${BOARD_CELLS[lostCid].name} 受损严重！${card?.name ?? '?'} 需要转会${extra}`,
    options: opts,
  };
}

// ========== 失去球场球员转会处理 ==========
function startStadiumLossFlow(state: GameState, cid: number): GameState {
  const s = prepareStadiumLoss(state, cid);
  return { ...s, pendingAction: buildLossTransferUI(s, cid) };
}

function startStadiumOverflowFlow(state: GameState, cid: number, newLevel: number): GameState {
  // 应用降级
  let s = { ...state, cellLevels: { ...state.cellLevels, [cid]: newLevel } };
  if (newLevel < 3) {
    const residentInst = s.instances.find(i => {
      const card = getCard(i.cardId);
      return card?.isResident && card.residentClubId === cid && i.clubId === cid;
    });
    if (residentInst) {
      s = { ...s, instances: s.instances.filter(i => i.uid !== residentInst.uid) };
      s = log(s, `🔙 ${getCard(residentInst.cardId)?.name ?? '?'} 离开球队（球场降至Lv2）。`);
    }
  }
  // 驻守球员是否还存在（newLevel≥3 时保留）
  const hasResident = s.instances.some(i => {
    const card = getCard(i.cardId);
    return card?.isResident && card.residentClubId === cid && i.clubId === cid;
  });
  const remainingN = s.instances.filter(i => i.clubId === cid && !getCard(i.cardId)?.isResident);
  // 总人数 = 驻守(0或1) + 普通球员
  const totalRemaining = remainingN.length + (hasResident ? 1 : 0);
  if (totalRemaining <= newLevel) {
    const msg = `🎲 ${BOARD_CELLS[cid].name} 降级到 Lv${newLevel}。`;
    return { ...s, pendingAction: { type: 'post_move', message: msg, options: [{ label: '确定', action: 'OK' }] } };
  }
  // 需要处理的普通球员数
  const needToRelease = totalRemaining - newLevel;
  const opts: ActionOption[] = remainingN.map(inst => {
    const card = getCard(inst.cardId);
    return {
      label: `${card?.name ?? '?'} — 选择转会或释放`,
      action: `OVERFLOW_SELECT:${inst.uid}:${cid}:${newLevel}:${remainingN.length - 1}`,
      disabled: false,
    };
  });
  return {
    ...s,
    pendingAction: {
      type: 'internal_transfer',
      message: `🎲 ${BOARD_CELLS[cid].name} 降级到 Lv${newLevel}！需释放 ${needToRelease} 名球员，请选择要处理的球员：`,
      options: opts,
    },
  };
}

function handleLossTransfer(state: GameState, uid: string, targetCid: number, lostCid: number, remaining: number): GameState {
  const newInstances = state.instances.map(inst => inst.uid === uid ? { ...inst, clubId: targetCid } : inst);
  const card = getCard(newInstances.find(i => i.uid === uid)?.cardId ?? '');
  const newState = log({ ...state, instances: newInstances }, `🔄 ${card?.name ?? '?'} 免费转会至 ${BOARD_CELLS[targetCid].name}。`);
  if (remaining <= 0) {
    // 全部处理完
    return { ...newState, pendingAction: { type: 'post_move', message: `🎲 ${BOARD_CELLS[lostCid].name} 失去了这处地产，球员已安置。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  return { ...newState, pendingAction: buildLossTransferUI(newState, lostCid) };
}

function handleLossRelease(state: GameState, uid: string, lostCid: number, remaining: number): GameState {
  const inst = state.instances.find(i => i.uid === uid);
  if (!inst) return state;
  const pool = idToPool(inst.cardId) || 'transfer';
  const pk = (pool === 'food' ? 'foodPool' : pool === 'animal' ? 'animalPool' : 'transferPool') as 'foodPool' | 'animalPool' | 'transferPool';
  const card = getCard(inst.cardId);
  const newState = log({ ...state, instances: state.instances.filter(i => i.uid !== uid), [pk]: [...state[pk], inst.cardId] }, `🔙 ${card?.name ?? '?'} 被释放回市场。`);
  if (remaining <= 0) {
    return { ...newState, pendingAction: { type: 'post_move', message: `🎲 ${BOARD_CELLS[lostCid].name} 失去了这处地产，球员已安置。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  return { ...newState, pendingAction: buildLossTransferUI(newState, lostCid) };
}

// ========== 降级溢出处理 ==========
function handleOverflowSelect(state: GameState, uid: string, cid: number, newLevel: number, remaining: number): GameState {
  const inst = state.instances.find(i => i.uid === uid);
  if (!inst) return state;
  const card = getCard(inst.cardId);
  const otherClubs = getPlayerClubs(state.currentPlayerIndex, state.cellOwners, state.cellLevels, state.instances).filter(c => c.cellId !== cid && c.count < getClubCapacity(c.level));
  const opts: ActionOption[] = otherClubs.map(c => ({
    label: `转至 ${c.name}（${c.count}/${getClubCapacity(c.level)}）`,
    action: `OVERFLOW_TRANSFER:${uid}:${c.cellId}:${cid}:${remaining}`,
  }));
  opts.push({ label: '释放回市场', action: `OVERFLOW_RELEASE:${uid}:${cid}:${remaining}` });
  return {
    ...state,
    pendingAction: {
      type: 'internal_transfer',
      message: `🎲 ${BOARD_CELLS[cid].name} 降级，${card?.name ?? '?'} 需转会${remaining > 0 ? `（还有 ${remaining} 名球员待处理）` : ''}`,
      options: opts,
    },
  };
}

function handleOverflowTransfer(state: GameState, uid: string, targetCid: number, fromCid: number, remaining: number): GameState {
  const newInstances = state.instances.map(inst => inst.uid === uid ? { ...inst, clubId: targetCid } : inst);
  const card = getCard(newInstances.find(i => i.uid === uid)?.cardId ?? '');
  const newState = log({ ...state, instances: newInstances }, `🔄 ${card?.name ?? '?'} 免费转会至 ${BOARD_CELLS[targetCid].name}。`);
  if (remaining <= 0) {
    return { ...newState, pendingAction: { type: 'post_move', message: `✅ 降级处理完成，球员已安置。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  return startStadiumOverflowFlow(newState, fromCid, state.cellLevels[fromCid] || 1);
}

function handleOverflowRelease(state: GameState, uid: string, fromCid: number, remaining: number): GameState {
  const inst = state.instances.find(i => i.uid === uid);
  if (!inst) return state;
  const pool = idToPool(inst.cardId) || 'transfer';
  const pk = (pool === 'food' ? 'foodPool' : pool === 'animal' ? 'animalPool' : 'transferPool') as 'foodPool' | 'animalPool' | 'transferPool';
  const card = getCard(inst.cardId);
  const newState = log({ ...state, instances: state.instances.filter(i => i.uid !== uid), [pk]: [...state[pk], inst.cardId] }, `🔙 ${card?.name ?? '?'} 被释放回市场。`);
  if (remaining <= 0) {
    return { ...newState, pendingAction: { type: 'post_move', message: `✅ 降级处理完成，球员已安置。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  return startStadiumOverflowFlow(newState, fromCid, state.cellLevels[fromCid] || 1);
}

// ========== 比赛日收入分配 ==========
function handleMatchIncome(state: GameState, choice: string, amount: number, cellId: number): GameState {
  const p = currentPlayer(state);
  const cell = BOARD_CELLS[cellId];
  const level = state.cellLevels[cellId] || 1;
  let newPlayers = [...state.players];
  let msg = '';

  if (choice === 'cash') {
    newPlayers = newPlayers.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash + amount) * 100) / 100 });
    msg = `💰 ${p.name} 将 ${amount}kw 比赛日收入取为现金。`;
  } else if (choice === 'savings') {
    newPlayers = newPlayers.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, savings: Math.round((pl.savings + amount) * 100) / 100 });
    msg = `🏦 ${p.name} 将 ${amount}kw 比赛日收入存入银行。`;
  } else if (choice === 'repay') {
    const actualRepay = Math.min(amount, p.debt);
    const remainder = Math.round((amount - actualRepay) * 100) / 100;
    newPlayers = newPlayers.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, debt: Math.round((pl.debt - actualRepay) * 100) / 100, savings: Math.round((pl.savings + remainder) * 100) / 100 });
    msg = `🏦 ${p.name} 用 ${actualRepay}kw 偿还贷款` + (remainder > 0 ? `，剩余 ${remainder}kw 存入银行` : '') + `。`;
  }

  const newState = log({ ...state, players: newPlayers }, `🎟️ ${p.name} 在 ${cell.name} 获得比赛日收入 ${amount}kw。${msg}`);

  // 显示升级选项
  const canUpgrade = level < 5;
  if (canUpgrade) {
    const nextCost = UPGRADE_COSTS[level];
    const levelNames = ['', '社区球场', '初级球场', '中级球场', '高级球场', '现代化球场'];
    const tol = ['', '国内联赛', '国内杯赛', '欧协联', '欧联', '欧冠'];
    return {
      ...newState,
      pendingAction: {
        type: 'upgrade',
        message: `是否升级 ${cell.name}？${levelNames[level]} → ${levelNames[level+1]}（可参加${tol[level+1]}），需要 ${nextCost}kw`,
        options: [
          { label: `升级 (${nextCost}kw)`, action: `UPGRADE:${cellId}`, disabled: newPlayers[state.currentPlayerIndex].cash < nextCost },
          { label: '暂不升级', action: 'SKIP_UPGRADE' },
        ],
        cellId,
      },
    };
  }
  return skipAndEnd(newState);
}

// ========== 青训学院 ==========
function startYouthAcademy(state: GameState, position: number): GameState {
  const p = currentPlayer(state);
  // 检查青训池
  const available = state.youthPool || YOUTH_PLAYERS.map(pl => pl.id);
  if (available.length === 0) {
    return { ...state, pendingAction: { type: 'post_move', message: `🎓 青训学院已无新人可签。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  // 检查容量
  const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
  if (myClubs.length === 0) {
    return { ...state, pendingAction: { type: 'post_move', message: `🎓 你没有球场可容纳新人。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  if (!myClubs.some(c => c.count < getClubCapacity(c.level))) {
    return { ...state, pendingAction: { type: 'post_move', message: `🎓 所有球场已满，无注册名额。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  const canAfford = p.cash >= 5;
  return {
    ...state,
    pendingAction: {
      type: 'transfer_bid',
      message: `🎓 ${p.name} 到达青训学院！5kw 签一个盲盒新人（剩余 ${available.length} 人）`,
      options: [
        { label: '购买盲盒 (5kw)', action: 'YOUTH_DRAW', disabled: !canAfford },
        { label: '离开', action: 'SKIP_TRANSFER' },
      ],
      cellId: position,
    },
  };
}

function executeYouthDraw(state: GameState): GameState {
  const p = currentPlayer(state);
  if (p.cash < 5) return log(state, `❌ 现金不足 5kw`);
  const available = state.youthPool;
  if (available.length === 0) return log(state, `🎓 青训池已空！`);
  const cardId = available[Math.floor(Math.random() * available.length)];
  const card = getCard(cardId);
  if (!card) return state;
  const uid = `${cardId}_${generateId()}`;
  const instance = { uid, cardId, ownerId: p.id, clubId: -1, growth: [0,0,0,0,0,0] };
  const newPlayers = state.players.map((pl, i) => i !== state.currentPlayerIndex ? pl : { ...pl, cash: Math.round((pl.cash - 5) * 100) / 100 });
  let newState = log({
    ...state,
    players: newPlayers,
    instances: [...state.instances, instance],
    youthPool: state.youthPool.filter(id => id !== cardId),
  }, `🎓 ${p.name} 从青训学院签下 ${card.name}！（OVR ${card.ovr}）`);
  newState = pushEvent(newState, state.currentPlayerIndex, '⚽', `${card.name}（OVR ${card.ovr}）`);
  // 选球场
  const clubs = getPlayerClubs(p.id, newState.cellOwners, newState.cellLevels, newState.instances);
  const opts = clubs.filter(c => c.count < getClubCapacity(c.level)).map(c => ({
    label: `${c.name}（Lv${c.level}，${c.count}/${getClubCapacity(c.level)}）`,
    action: `ASSIGN:${uid}:${c.cellId}`,
  }));
  return { ...newState, pendingAction: { type: 'assign_player', message: `🎓 签下 ${card.name}！请选择分配的球场：`, options: opts, instanceUid: uid } };
}

// ========== 训练营 ==========
function startTrainingCamp(state: GameState, position: number): GameState {
  const p = currentPlayer(state);
  const tp = state.trainingPoints[p.id] || 0;
  if (tp <= 0) {
    return { ...state, pendingAction: { type: 'post_move', message: `🏋️ ${p.name} 到达训练营，但没有训练点数。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  const trainable = state.instances.filter(i => i.ownerId === p.id && getEffectiveOVR(i) < 100);
  if (trainable.length === 0) {
    return { ...state, pendingAction: { type: 'post_move', message: `🏋️ ${p.name} 到达训练营，但所有球员 OVR 已达上限 100。`, options: [{ label: '确定', action: 'OK' }] } };
  }
  return { ...state, pendingAction: { type: 'loan', message: `🏋️ ${p.name} 到达训练营！训练点数：${tp}。选择要训练的球员：`, options: buildTrainOptions(state, p), cellId: position } };
}

function getEffectiveOVR(inst: GameState['instances'][0]): number {
  const card = getCard(inst.cardId);
  if (!card) return 0;
  if (card.isGK) return card.ovr + (inst.growth[0] || 0);
  const totalGrowth = inst.growth.reduce((a: number, b: number) => a + b, 0);
  return card.ovr + Math.floor(totalGrowth / 6);
}

function executeTrainAttr(state: GameState, uid: string): GameState {
  const p = currentPlayer(state);
  const tp = state.trainingPoints[p.id] || 0;
  if (tp <= 0) return log(state, `❌ 训练点数不足！`);
  const inst = state.instances.find(i => i.uid === uid);
  if (!inst) return state;
  const card = getCard(inst.cardId);
  const currentOVR = getEffectiveOVR(inst);
  if (currentOVR >= 100) {
    return { ...state, pendingAction: { type: 'loan', message: `❌ ${card?.name ?? '?'} OVR 已达上限 100，无法继续训练。选择其他球员：`, options: buildTrainOptions(state, p), cellId: 29 } };
  }
  const newInstances = state.instances.map(i => {
    if (i.uid !== uid) return i;
    const newGrowth = [...i.growth];
    if (card?.isGK) {
      newGrowth[0] += 1;
    } else {
      for (let j = 0; j < 6; j++) newGrowth[j] += 1;
    }
    return { ...i, growth: newGrowth };
  });
  const newTP = { ...state.trainingPoints, [p.id]: tp - 1 };
  const newInst = newInstances.find(i => i.uid === uid)!;
  const newOVR = getEffectiveOVR(newInst);
  let trainState = log({ ...state, instances: newInstances, trainingPoints: newTP }, `🏋️ ${p.name} 训练了 ${card?.name ?? '?'}，全维度 +1（OVR ${currentOVR}→${newOVR}）！剩余训练点：${tp - 1}`);
  trainState = pushEvent(trainState, state.currentPlayerIndex, '🏋️', `${card?.name ?? '?'}（OVR ${currentOVR}→${newOVR}）`);
  // 仍有训练点且还有可训练球员 → 继续；否则结束
  if (tp - 1 > 0) {
    const trainable = newInstances.filter(i => i.ownerId === p.id && getEffectiveOVR(i) < 100);
    if (trainable.length > 0) {
      return { ...trainState, pendingAction: { type: 'loan', message: `🏋️ 训练完成！剩余训练点：${tp - 1}。选择下一位球员：`, options: buildTrainOptions(trainState, p), cellId: 29 } };
    }
  }
  return skipAndEnd(trainState);
}

function buildTrainOptions(state: GameState, p: GameState['players'][0]): ActionOption[] {
  const opts = state.instances.filter(i => i.ownerId === p.id && getEffectiveOVR(i) < 100).map(inst => {
    const card = getCard(inst.cardId);
    const ovr = getEffectiveOVR(inst);
    return { label: `${card?.name ?? '?'}（OVR ${ovr}）`, action: `TRAIN_SELECT:${inst.uid}` };
  });
  opts.push({ label: '离开', action: 'DECLINE_LOAN' });
  return opts;
}

// ========== 银行菜单 ==========
function buildBankMenu(p: GameState['players'][0], isBranch: boolean): PendingAction {
  const max = isBranch ? 5 : 10;
  const min = isBranch ? 2 : 5;
  const opts: ActionOption[] = [
    { label: `存款 ${min}kw`, action: `DEPOSIT:${min}`, disabled: p.cash < min },
    { label: `存款 ${max}kw`, action: `DEPOSIT:${max}`, disabled: p.cash < max },
    { label: `取款 ${min}kw`, action: `WITHDRAW:${min}`, disabled: p.savings < min },
    { label: `取款 ${max}kw`, action: `WITHDRAW:${max}`, disabled: p.savings < max },
    { label: `贷款 ${min}kw`, action: `TAKE_LOAN:${min}` },
    { label: `贷款 ${max}kw`, action: `TAKE_LOAN:${max}` },
  ];
  if (p.debt > 0) {
    opts.push({ label: `还款 ${min}kw`, action: `REPAY_LOAN:${min}`, disabled: p.cash < min });
    opts.push({ label: `还款 ${max}kw`, action: `REPAY_LOAN:${max}`, disabled: p.cash < max });
    opts.push({ label: `全部还清 (${p.debt}kw)`, action: `REPAY_LOAN:${p.debt}`, disabled: p.cash < p.debt });
  }
  opts.push({ label: '离开', action: 'DECLINE_LOAN' });
  return {
    type: 'loan',
    message: `银行${isBranch ? '分行' : ''} — 现金 ${p.cash.toFixed(2)}kw | 存款 ${p.savings.toFixed(2)}kw | 负债 ${p.debt.toFixed(2)}kw`,
    options: opts,
  };
}

// ========== 球员辅助函数 ==========
function getCard(cardId: string) { return ALL_PLAYERS.find(c => c.id === cardId); }
function idToPool(cardId: string): 'food' | 'animal' | 'transfer' | null { return getCard(cardId)?.pool ?? null; }
function getClubPlayerCount(clubId: number, instances: GameState['instances']): number { return instances.filter(i => i.clubId === clubId).length; }
function getClubCapacity(level: number): number { return level; }
function getPlayerClubs(playerId: number, cellOwners: Record<number, number>, cellLevels: Record<number, number>, instances?: GameState['instances']): { cellId: number; name: string; level: number; count: number }[] {
  return Object.entries(cellOwners)
    .filter(([cellId, ownerId]) => ownerId === playerId && BOARD_CELLS[parseInt(cellId)]?.type === 'club')
    .map(([cellId]) => { const cid = parseInt(cellId); return { cellId: cid, name: BOARD_CELLS[cid].name, level: cellLevels[cid] || 1, count: instances ? instances.filter(i => i.clubId === cid).length : 0 }; });
}

function handleStreetLanding(state: GameState, position: number): GameState {
  const p = currentPlayer(state); const poolType = position === 13 ? 'food' : 'animal';
  const poolKey = poolType === 'food' ? 'foodPool' as const : 'animalPool' as const;
  const poolName = poolType === 'food' ? '食物' : '动物'; const pool = state[poolKey];
  if (pool.length === 0) {
    const myPlayers = state.instances.filter(i => i.ownerId === p.id);
    if (myPlayers.length === 0) return { ...log(state, `🎲 ${p.name} 在街头踢球，无事发生。`), pendingAction: { type: 'post_move', message: `🎲 街头足球·${poolName}：${p.name} 没有可训练的球员。`, options: [{ label: '确定', action: 'OK' }] } };
    const attrIndex = Math.floor(Math.random() * 6); const attrName = ['速度','射门','传球','盘带','防守','身体'][attrIndex];
    const newInstances = state.instances.map(inst => { if (inst.ownerId !== p.id) return inst; const card = getCard(inst.cardId); if (!card) return inst; const newGrowth = [...inst.growth]; card.isGK ? newGrowth[0] += 1 : newGrowth[attrIndex] += 1; return { ...inst, growth: newGrowth }; });
    const isGKPool = myPlayers.every(inst => getCard(inst.cardId)?.isGK);
    return { ...log({ ...state, instances: newInstances }, `🎲 ${p.name} 在街头踢球，技术提高！所有球员${isGKPool ? 'OVR' : attrName}+1！`), pendingAction: { type: 'post_move', message: `🎲 街头足球·${poolName}：市场无人，${p.name} 的所有球员${isGKPool ? 'OVR' : attrName}+1！`, options: [{ label: '确定', action: 'OK' }] } };
  }
  const cardId = pool[Math.floor(Math.random() * pool.length)]; const card = getCard(cardId); if (!card) return skipAndEnd(state);
  const price = Math.round(card.marketValue / 2 * 100) / 100;
  const clubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
  const hasSpace = clubs.some(c => c.count < getClubCapacity(c.level));
  return { ...state, pendingAction: { type: poolType === 'food' ? 'street_food' : 'street_animal', message: `${p.name} 在街头踢球时，${poolType === 'food' ? '路边小卖部正在卖' : '遇到了一只'}${card.nickname}（${card.name}，OVR ${card.ovr}，身价 ${card.marketValue}kw）！购买价 ${price}kw（半价）。`, options: [{ label: `支付 ${price}kw 买下`, action: `BUY_STREET:${cardId}`, disabled: p.cash < price || !hasSpace }, { label: '我只是路过', action: 'SKIP_STREET' }], cardId, cellId: position } };
}

// ========== 转会辅助函数 ==========
function getBidOptions(bidder: GameState['players'][0], basePrice: number, currentBid: number | null, hasClubs?: boolean, hasSpace?: boolean): ActionOption[] {
  const opts: ActionOption[] = [];
  if (hasClubs === false) { opts.push({ label: '无球场，无法竞拍', action: 'PASS_BID' }); return opts; }
  if (hasSpace === false) { opts.push({ label: '球场已满，无法竞拍', action: 'PASS_BID' }); return opts; }
  if (currentBid === null) {
    if (bidder.cash >= basePrice) opts.push({ label: `报价底价 ${basePrice}kw`, action: `PLACE_BID:${basePrice}` });
    else { opts.push({ label: `起拍价 ${basePrice}kw — 现金不足（余额 ${bidder.cash}kw）`, action: 'PASS_BID' }); return opts; }
  } else {
    const b2 = currentBid + 2, b1 = currentBid + 1, b05 = currentBid + 0.5;
    if (bidder.cash >= b2) opts.push({ label: `报价 ${b2}kw（+2kw）`, action: `PLACE_BID:${b2}` });
    if (bidder.cash >= b1) opts.push({ label: `报价 ${b1}kw（+1kw）`, action: `PLACE_BID:${b1}` });
    if (bidder.cash >= b05) opts.push({ label: `报价 ${b05}kw（+500w）`, action: `PLACE_BID:${b05}` });
    if (opts.length === 0) { opts.push({ label: `当前价 ${currentBid}kw — 现金不足无法加价（余额 ${bidder.cash}kw）`, action: 'PASS_BID' }); return opts; }
  }
  opts.push({ label: '不跟价', action: 'PASS_BID' }); return opts;
}

function findNextBidder(tbs: NonNullable<GameState['transferBidState']>, players: GameState['players']): number {
  const n = tbs.bidders.length;
  for (let i = 1; i <= n; i++) { const idx = (tbs.bidderIndex + i) % n; const bid = tbs.bidders[idx]; if (!tbs.passedPlayers.includes(bid) && !players[bid]?.isBankrupt) return idx; }
  return -1;
}

function advanceBid(state: GameState, tbs: GameState['transferBidState']): GameState {
  if (!tbs) return state;
  const nextIdx = findNextBidder(tbs, state.players);
  if (nextIdx === -1) { if (tbs.currentBid !== null && tbs.currentBidderId !== null) return finalizeTransferBid(state, tbs, tbs.currentBid, tbs.currentBidderId); return cancelTransferBid(state, tbs); }
  const bidderId = tbs.bidders[nextIdx]; const card = getCard(tbs.cardId);
  const basePrice = tbs.isSell ? Math.round((card?.marketValue ?? 0) / 4 * 100) / 100 : Math.round((card?.marketValue ?? 0) / 2 * 100) / 100;
  const bc = getPlayerClubs(bidderId, state.cellOwners, state.cellLevels, state.instances);
  return { ...state, transferBidState: { ...tbs, bidderIndex: nextIdx }, pendingAction: { type: 'transfer_bid', message: `转会竞价：${card?.name ?? '?'} | 当前出价：${tbs.currentBid ?? '无'}kw | 轮到 ${state.players[bidderId].name}`, options: getBidOptions(state.players[bidderId], basePrice, tbs.currentBid, bc.length > 0, bc.some(c => c.count < getClubCapacity(c.level))), cardId: tbs.cardId } };
}

function finalizeTransferBid(state: GameState, tbs: NonNullable<GameState['transferBidState']>, amount: number, winnerId: number): GameState {
  const card = getCard(tbs.cardId); if (!card) return { ...state, transferBidState: null, pendingAction: null };
  const bidder = state.players[winnerId];
  const clubs = getPlayerClubs(winnerId, state.cellOwners, state.cellLevels, state.instances);
  const hasSpace = clubs.some(c => c.count < getClubCapacity(c.level));
  if (clubs.length === 0 || !hasSpace) { const ns = log({ ...state, transferBidState: null }, `❌ ${bidder.name} 没有可容纳的球场，${card.name} 回归转会池。`); return skipAndEnd(ns); }
  const uid = `${tbs.cardId}_${generateId()}`; const instance = { uid, cardId: tbs.cardId, ownerId: winnerId, clubId: -1, growth: [0,0,0,0,0,0] };
  if (tbs.isSell && tbs.sellerId !== undefined) {
    const newPlayers = state.players.map((pl, i) => { if (i === winnerId) return { ...pl, cash: Math.round((pl.cash - amount) * 100) / 100 }; if (i === tbs.sellerId) return { ...pl, cash: Math.round((pl.cash + amount) * 100) / 100 }; return pl; });
    let ns = log({ ...state, players: newPlayers, instances: state.instances.filter(i => i.uid !== tbs.instanceUid), transferBidState: null }, `🤝 ${bidder.name} 以 ${amount}kw 竞得 ${card.name}！`);
    ns = pushEvent(ns, winnerId, '⚽', `${card.name}（OVR ${card.ovr}）`);
    const clubOpts = clubs.filter(c => c.count < getClubCapacity(c.level)).map(c => ({ label: `${c.name}（Lv${c.level}，${c.count}/${getClubCapacity(c.level)}人）`, action: `ASSIGN:${uid}:${c.cellId}` }));
    return { ...ns, instances: [...ns.instances, instance], pendingAction: { type: 'assign_player', message: `${bidder.name} 竞得 ${card.name}！请选择分配的球场：`, options: clubOpts, instanceUid: uid } };
  }
  const newPlayers = state.players.map((pl, i) => i === winnerId ? { ...pl, cash: Math.round((pl.cash - amount) * 100) / 100 } : pl);
  let ns = log({ ...state, players: newPlayers, transferPool: state.transferPool.filter(id => id !== tbs.cardId), transferBidState: null }, `🤝 ${bidder.name} 以 ${amount}kw 竞得 ${card.name}！`);
  ns = pushEvent(ns, winnerId, '⚽', `${card.name}（OVR ${card.ovr}）`);
  const clubOpts = clubs.filter(c => c.count < getClubCapacity(c.level)).map(c => ({ label: `${c.name}（Lv${c.level}，${c.count}/${getClubCapacity(c.level)}人）`, action: `ASSIGN:${uid}:${c.cellId}` }));
  return { ...ns, instances: [...ns.instances, instance], pendingAction: { type: 'assign_player', message: `${bidder.name} 竞得 ${card.name}！请选择分配的球场：`, options: clubOpts, instanceUid: uid } };
}

function cancelTransferBid(state: GameState, tbs: NonNullable<GameState['transferBidState']>): GameState {
  const card = getCard(tbs.cardId);
  if (tbs.isSell && tbs.sellerId !== undefined && tbs.instanceUid) {
    const basePrice = Math.round((card?.marketValue ?? 0) / 4 * 100) / 100;
    const seller = state.players.map((pl, i) => i !== tbs.sellerId ? pl : { ...pl, cash: Math.round((pl.cash + basePrice) * 100) / 100 });
    const ns = log({ ...state, players: seller, instances: state.instances.filter(i => i.uid !== tbs.instanceUid), transferPool: [...state.transferPool, tbs.cardId!], transferBidState: null }, `💔 无人竞拍，系统以 ${basePrice}kw 回收 ${card?.name ?? '?'}。`);
    return skipAndEnd(ns);
  }
  return skipAndEnd(log({ ...state, transferBidState: null }, `💔 无人竞拍，${card?.name ?? '?'} 流拍，回归转会池。`));
}

function handleSellSelection(state: GameState): GameState {
  const p = currentPlayer(state); const myPlayers = state.instances.filter(i => i.ownerId === p.id && !getCard(i.cardId)?.isResident);
  if (myPlayers.length === 0) return skipAndEnd(state);
  const options = myPlayers.map(inst => { const card = getCard(inst.cardId); const cell = BOARD_CELLS[inst.clubId]; return { label: `${card?.name ?? '?'}（OVR ${card?.ovr ?? '?'}，${cell?.name ?? '?'}）`, action: `SELL_PLAYER:${inst.uid}` }; });
  options.push({ label: '不卖了', action: 'SKIP_TRANSFER' });
  return { ...state, pendingAction: { type: 'transfer_sell', message: `${p.name} 选择要出售的球员：`, options } };
}

function handleTransferLanding(state: GameState, position: number): GameState {
  const p = currentPlayer(state); const myPlayers = state.instances.filter(i => i.ownerId === p.id); const canSell = myPlayers.length > 0;
  if (state.transferPool.length > 0) {
    const cardId = state.transferPool[Math.floor(Math.random() * state.transferPool.length)]; const card = getCard(cardId); if (!card) return skipAndEnd(state);
    const basePrice = Math.round(card.marketValue / 2 * 100) / 100;
    const myClubs = getPlayerClubs(p.id, state.cellOwners, state.cellLevels, state.instances);
    const hasSpace = myClubs.some(c => c.count < getClubCapacity(c.level)); const canAfford = p.cash >= basePrice;
    const opts: ActionOption[] = [];
    if (myClubs.length === 0) opts.push({ label: `竞拍 ${card.name}（起拍 ${basePrice}kw）— 无球场，无法竞拍`, action: 'NOOP', disabled: true });
    else if (!hasSpace) opts.push({ label: `竞拍 ${card.name}（起拍 ${basePrice}kw）— 球场已满，无法竞拍`, action: 'NOOP', disabled: true });
    else if (!canAfford) opts.push({ label: `竞拍 ${card.name}（起拍 ${basePrice}kw）— 现金不足`, action: 'NOOP', disabled: true });
    else opts.push({ label: `竞拍 ${card.name}（起拍 ${basePrice}kw）`, action: `START_BID:${cardId}` });
    if (canSell) opts.push({ label: '出售自己的球员', action: 'SELECT_SELL' });
    opts.push({ label: '离开转会窗', action: 'SKIP_TRANSFER' });
    return { ...state, pendingAction: { type: 'transfer_bid', message: `${p.name} 进入转会窗！目前挂牌：${card.name}（OVR ${card.ovr}，起拍价 ${basePrice}kw）`, options: opts, cardId, cellId: position } };
  }
  const opts: ActionOption[] = [];
  if (canSell) opts.push({ label: '出售自己的球员', action: 'SELECT_SELL' });
  opts.push({ label: '离开', action: 'SKIP_TRANSFER' });
  return { ...state, pendingAction: { type: 'transfer_sell', message: `${p.name} 进入转会窗。暂无挂牌球员。${canSell ? '你可以出售一名球员。' : ''}`, options: opts, cellId: position } };
}

// ========== 破产清理 ==========
function cleanupBankruptPlayer(state: GameState, playerId: number): GameState {
  // 捕获破产前快照（含触发破产的高负债；若调用方已捕获则产生同轮重复，report 端会去重）
  const preSnap = { turn: state.turn, players: state.players.map(pl => ({
    cash: pl.cash, savings: pl.savings, debt: pl.debt,
    propertyValue: getPropertyValue(state, pl.id), // 破产玩家也要记录真实资产，而非 0
  })) };
  const withSnap = state.snapshots.length === 0 || state.snapshots[state.snapshots.length - 1].turn !== state.turn
    ? { ...state, snapshots: [...state.snapshots, preSnap] } : state;

  // 记录最强球队（清理前）
  const myClubs = Object.keys(withSnap.cellOwners).filter(cid => withSnap.cellOwners[+cid] === playerId).map(cid => parseInt(cid));
  let bestOvrSum = -1;
  let bestTeamData: GameState['bankruptTeams'][0] | null = null;
  for (const cid of myClubs) {
    const squad = withSnap.instances.filter(i => i.clubId === cid);
    if (squad.length === 0) continue;
    let ovrSum = 0;
    const pls: { name: string; ovr: number }[] = [];
    for (const inst of squad) {
      const card = getCard(inst.cardId);
      if (!card) continue;
      const ovr = card.isGK ? card.ovr + (inst.growth[0] || 0) : card.ovr + Math.floor(inst.growth.reduce((a: number, b: number) => a + b, 0) / 6);
      ovrSum += ovr;
      pls.push({ name: card.name, ovr });
    }
    if (ovrSum > bestOvrSum) {
      bestOvrSum = ovrSum;
      const tr = withSnap.clubTrophies[cid];
      const byLevel = tr?.byLevel || [0,0,0,0,0,0];
      bestTeamData = {
        name: BOARD_CELLS[cid]?.name ?? '?',
        avgOvr: Math.round((ovrSum / squad.length) * 10) / 10,
        players: pls,
        leagueTitles: byLevel[1] || 0, cupTitles: byLevel[2] || 0,
        eclTitles: byLevel[3] || 0, uelTitles: byLevel[4] || 0, uclTitles: byLevel[5] || 0,
      };
    }
  }

  // 球员回池
  const myInstances = withSnap.instances.filter(i => i.ownerId === playerId);
  let newPools = { foodPool: [...withSnap.foodPool], animalPool: [...withSnap.animalPool], transferPool: [...withSnap.transferPool] };
  myInstances.forEach(inst => {
    const card = getCard(inst.cardId);
    if (card?.isResident) return;
    const pool = idToPool(inst.cardId) || 'transfer';
    const pk = (pool === 'food' ? 'foodPool' : pool === 'animal' ? 'animalPool' : 'transferPool') as 'foodPool' | 'animalPool' | 'transferPool';
    newPools[pk] = [...newPools[pk], inst.cardId];
  });
  const newInstances = withSnap.instances.filter(i => i.ownerId !== playerId);
  // 清除地产
  const newOwners: Record<number, number> = {};
  const newLevels: Record<number, number> = {};
  const newTrophies = { ...withSnap.clubTrophies };
  for (const cid of Object.keys(withSnap.cellOwners)) {
    if (withSnap.cellOwners[+cid] !== playerId) {
      newOwners[+cid] = withSnap.cellOwners[+cid];
      newLevels[+cid] = withSnap.cellLevels[+cid];
    } else {
      delete newTrophies[+cid]; // 清除奖杯，新买家不会继承
    }
  }
  const newPlayers = withSnap.players.map((pl, i) => i !== playerId ? pl : { ...pl, properties: [], cash: 0, savings: 0, debt: 0 });
  const newTables = withSnap.leagueTables.map(t => ({
    ...t,
    entries: (t.entries || []).filter(e => e.ownerId !== playerId),
  }));
  const newTP = { ...withSnap.trainingPoints }; delete newTP[playerId];
  const newUCL = { ...withSnap.hasUCLTitle }; delete newUCL[playerId];
  const clearTransfer = withSnap.transferBidState && (
    withSnap.transferBidState.bidders.includes(playerId) ||
    withSnap.transferBidState.currentBidderId === playerId ||
    withSnap.transferBidState.sellerId === playerId
  ) ? null : withSnap.transferBidState;
  const clearMatch = withSnap.matchState && (
    withSnap.matchState.homePlayerId === playerId || withSnap.matchState.awayPlayerId === playerId
  ) ? null : withSnap.matchState;
  const newBankruptTeams = { ...withSnap.bankruptTeams };
  if (bestTeamData) newBankruptTeams[playerId] = bestTeamData;
  return { ...withSnap, players: newPlayers, instances: newInstances, cellOwners: newOwners, cellLevels: newLevels, clubTrophies: newTrophies, ...newPools, leagueTables: newTables, trainingPoints: newTP, hasUCLTitle: newUCL, transferBidState: clearTransfer, matchState: clearMatch, bankruptTeams: newBankruptTeams };
}

function skipAndEnd(state: GameState): GameState {
  const p = currentPlayer(state);
  return {
    ...state,
    pendingAction: {
      type: 'post_move',
      message: `${p.name} 回合结束。`,
      options: [{ label: '结束回合', action: 'END_TURN' }],
    },
  };
}

/**
 * 检查破产并结束回合
 */
function checkBankruptcyAndEnd(state: GameState): GameState {
  const p = currentPlayer(state);
  if (p.debt >= BANKRUPT_DEBT) {
    return {
      ...state,
      pendingAction: {
        type: 'post_move',
        message: `💀 ${p.name} 负债达到 ${p.debt.toFixed(2)}kw（上限 ${BANKRUPT_DEBT}kw），必须退出足坛！`,
        options: [{ label: '宣告破产', action: 'EXECUTE_BANKRUPT' }],
      },
    };
  }
  return skipAndEnd(state);
}

/**
 * 推进到下一个未破产玩家
 */
function advancePlayer(state: GameState): GameState {
  const { players, currentPlayerIndex } = state;
  const totalPlayers = players.length;

  // 跳过在监狱中的玩家
  let nextIdx = currentPlayerIndex;
  let updatedPlayers = [...players];

  // 找下一个可行动的玩家，遇到坐牢的跳过并减刑
  let loggedState: GameState | null = null;
  for (let attempt = 0; attempt < totalPlayers; attempt++) {
    nextIdx = (nextIdx + 1) % totalPlayers;
    const np = updatedPlayers[nextIdx];
    if (np.isBankrupt) continue;
    if (np.jailTurns > 0) {
      const newTurns = np.jailTurns - 1;
      updatedPlayers = updatedPlayers.map((pl, i) => {
        if (i === nextIdx) return { ...pl, jailTurns: newTurns };
        return pl;
      });
      // 记录被跳过的玩家
      loggedState = log(loggedState || state, newTurns > 0
        ? `🔒 ${np.name} 坐牢中，剩余 ${newTurns} 轮，跳过回合。`
        : `🔓 ${np.name} 刑满释放！`);
      continue;
    }
    break;
  }

  const roundComplete = nextIdx <= currentPlayerIndex;

  let newState2: GameState = {
    ...(loggedState || state),
    players: updatedPlayers,
    currentPlayerIndex: nextIdx,
    pendingAction: null,
  };

  if (roundComplete) {
    return gameReducer(newState2, { type: 'ROUND_SETTLEMENT' });
  }

  const nextPlayer = updatedPlayers[nextIdx];
  // 如果选中的下一个玩家仍在坐牢（所有人都在坐牢的情况），显示坐牢消息
  if (nextPlayer.jailTurns > 0) {
    return {
      ...newState2,
      pendingAction: {
        type: 'post_move',
        message: `🔒 ${nextPlayer.name} 坐牢中，剩余 ${nextPlayer.jailTurns} 轮`,
        options: [{ label: '结束回合', action: 'END_TURN' }],
      },
    };
  }
  return {
    ...newState2,
    pendingAction: {
      type: 'post_move',
      message: `${nextPlayer.name} 的回合，请掷骰子 🎲`,
      options: [{ label: '掷骰子', action: 'ROLL_DICE' }],
    },
  };
}

/**
 * 找到下一个未破产的玩家
 */
function findNextAlivePlayer(players: GameState['players'], startIdx: number): number {
  for (let i = 0; i < players.length; i++) {
    const idx = (startIdx + i) % players.length;
    if (!players[idx].isBankrupt) return idx;
  }
  return startIdx;
}

// ========== 导出的 Reducer（带统计追踪） ==========
export function gameReducer(state: GameState, action: GameAction): GameState {
  // 跳过不影响现金的 action
  if (action.type === 'START_DICE_ANIMATION' || action.type === 'CONFIRM_MATCH_RESULT' ||
      action.type === 'ROLL_MATCH_DICE' || action.type === 'PICK_MATCH_PLAYER' ||
      action.type === 'DEPOSIT' || action.type === 'WITHDRAW' ||
      action.type === 'TAKE_LOAN' || action.type === 'REPAY_LOAN' ||
      action.type === 'LOAD_GAME' || action.type === 'RESET_GAME' || action.type === 'START_GAME') {
    return gameReducerCore(state, action);
  }
  const oldPlayers = state.players;
  const newState = gameReducerCore(state, action);
  const newPlayers = newState.players;
  // Diff 现金变化 → 自动归类收入/支出
  let tracked = newState;
  for (let i = 0; i < oldPlayers.length; i++) {
    // 跳过破产导致的清零（资产清算不算消费）
    if (newPlayers[i]?.isBankrupt) continue;
    const oldCash = oldPlayers[i]?.cash ?? 0;
    const newCash = newPlayers[i]?.cash ?? 0;
    const delta = Math.round((newCash - oldCash) * 100) / 100;
    if (delta > 0) tracked = addIncome(tracked, i, delta);
    else if (delta < 0) tracked = addSpending(tracked, i, -delta);
  }
  // 游戏结束/破产时捕获最终快照（不再走 ROUND_SETTLEMENT）
  if (tracked.phase === 'finished' && state.phase !== 'finished') {
    const finalPlayers = tracked.players;
    tracked = {
      ...tracked,
      snapshots: [...tracked.snapshots, {
        turn: tracked.turn,
        players: finalPlayers.map(pl => ({
          cash: pl.cash, savings: pl.savings, debt: pl.debt,
          propertyValue: pl.isBankrupt ? 0 : getPropertyValue({ ...tracked, players: finalPlayers }, pl.id),
        })),
      }],
    };
  }
  return tracked;
}
