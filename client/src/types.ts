// ========== 格子类型 ==========
export type CellType =
  | 'start'
  | 'club'
  | 'sponsor'
  | 'bank'
  | 'jail'
  | 'airport'
  | 'transfer'
  | 'street'
  | 'random'
  | 'windfall'
  | 'blank';

// ========== 联赛 ==========
export type League = 'premier' | 'bundesliga' | 'laliga' | 'serieA' | 'ligue1';

export const LEAGUE_NAMES: Record<League, string> = {
  premier: '英超',
  bundesliga: '德甲',
  laliga: '西甲',
  serieA: '意甲',
  ligue1: '法甲',
};

export const LEAGUE_COLORS: Record<League, string> = {
  premier: '#3c1053',
  bundesliga: '#c41e3a',
  laliga: '#1a6e3e',
  serieA: '#0a2b5c',
  ligue1: '#1e90c8',
};

// ========== 球场等级 ==========
export const LEVEL_NAMES = ['', '社区球场', '初级球场', '中级球场', '高级球场', '现代化球场'];
export const LEVEL_TOURNAMENTS = ['', '国内联赛', '国内杯赛', '欧协联', '欧联', '欧冠'];
export const UPGRADE_COSTS = [0, 3, 4, 5, 10];
export const MATCH_INCOMES = [0, 2, 3, 4, 5, 10];

// ========== 格子数据 ==========
export interface Cell {
  id: number;
  type: CellType;
  name: string;
  league?: League;
  price?: number;
  upgradeCosts?: number[];
  matchIncome?: number[];
}

// ========== 玩家 ==========
export interface Player {
  id: number;
  name: string;
  color: string;
  position: number;
  cash: number;
  savings: number;
  debt: number;
  properties: number[];
  jailTurns: number;
  isBankrupt: boolean;
  bankruptTurn: number;     // 破产发生的轮次
  isAI: boolean;           // NPC 人机
}

// ========== 球员实例（运行时，挂载成长数据） ==========
export interface PlayerInstance {
  uid: string;          // 唯一 ID（如 "wirtz_0"）
  cardId: string;       // 指向 PlayerCard.id
  ownerId: number;      // 所属玩家
  clubId: number;       // 所属球场 cellId
  growth: number[];     // 6 维历练增量 [0,0,0,0,0,0]
}

// ========== 赛后报告数据 ==========
export interface ClubTrophy {
  total: number;
  byLevel: number[];   // index 1-5 对应联赛等级
}
export interface TurnSnapshot {
  turn: number;
  players: { cash: number; savings: number; debt: number; propertyValue: number }[];
}
export interface PlayerStats {
  totalIncome: number; totalSpent: number;
  jailCount: number; matchesPlayed: number; matchesWon: number;
  championships: number;
}
export interface GameEvent {
  turn: number; playerId: number; icon: string; text: string;
}

// ========== 对战回合 ==========
export interface MatchRound {
  homeUid: string;        // 主队出场球员 uid
  awayUid: string;        // 客队出场球员 uid
  homeCardId: string;
  awayCardId: string;
  diceValue: number;      // 骰子 1-6
  attrIndex: number;      // 比较的属性索引 0-5
  homeVal: number;        // 主队该属性值
  awayVal: number;        // 客队该属性值
  winner: 'home' | 'away' | 'draw';
}

// ========== 对战状态 ==========
export interface MatchState {
  level: number;                          // 比赛等级 1-5
  homeClubId: number;
  awayClubId: number;
  homePlayerId: number;                   // 主队玩家
  awayPlayerId: number;                   // 客队玩家
  homeSquad: string[];                    // 主队可选球员 uid[]
  awaySquad: string[];                    // 客队可选球员 uid[]
  homePick: string | null;                // 当前轮主队选人 uid
  awayPick: string | null;                // 当前轮客队选人 uid
  round: number;                          // 当前轮次
  maxRounds: number;                      // = level
  homeScore: number;
  awayScore: number;
  phase: 'picking' | 'reveal' | 'round_result';
  diceValue: number | null;
  rounds: MatchRound[];
  isGoldenGoal: boolean;
  homeUsed: string[];                     // 已出场 uid
  awayUsed: string[];                     // 已出场 uid
}

// ========== 转会竞价 ==========
export interface TransferBidState {
  cardId: string;
  currentBid: number | null;              // null = 无人出价
  currentBidderId: number | null;
  bidders: number[];                      // 玩家顺序（从当前玩家开始轮转）
  bidderIndex: number;
  passedPlayers: number[];
  phase: 'bidding' | 'assign';            // assign = 赢家选球场
  isSell: boolean;                        // true = 玩家卖人
  sellerId?: number;                      // 卖人时的卖家
  instanceUid?: string;                   // 卖人时的实例 uid
}

// ========== 联赛榜 ==========
export interface LeagueEntry {
  clubId: number;
  ownerId: number;
  points: number;
  matches: number;
}

export interface LeagueTable {
  level: number;
  entries: LeagueEntry[];
  matchesPlayed: number;
  matchesNeeded: number;                  // 2 × playerCount
}

// ========== 游戏状态 ==========
export interface GameState {
  phase: 'setup' | 'playing' | 'finished';
  players: Player[];
  currentPlayerIndex: number;
  cells: Cell[];
  cellOwners: Record<number, number>;
  cellLevels: Record<number, number>;
  turn: number;
  diceValue: number | null;
  diceAnimating: boolean;
  log: string[];
  winner: number | null;

  // 球员系统
  instances: PlayerInstance[];
  foodPool: string[];                     // cardId[]
  animalPool: string[];
  transferPool: string[];
  youthPool: string[];            // 青训池

  // 对战
  matchState: MatchState | null;
  peakDuel: boolean;           // 巅峰对决进行中

  // 转会竞价
  transferBidState: TransferBidState | null;

  // 联赛榜（index 0 不用，1-5 对应比赛等级）
  leagueTables: LeagueTable[];

  // 训练点
  trainingPoints: Record<number, number>;  // playerId → points

  // 奖杯
  clubTrophies: Record<number, ClubTrophy>;   // clubId → {total, byLevel}
  hasUCLTitle: Record<number, boolean>;       // playerId → 是否拿过欧冠

  // 赛后报告
  snapshots: TurnSnapshot[];                   // 每轮财务快照
  playerStats: Record<number, PlayerStats>;    // playerId → 累计统计
  events: GameEvent[];                         // 大事记
  bankruptTeams: Record<number, { name: string; avgOvr: number; players: { name: string; ovr: number }[]; leagueTitles: number; cupTitles: number; eclTitles: number; uelTitles: number; uclTitles: number }>; // 破产时记录最强球队

  // UI state（保留原有）
  pendingAction: PendingAction | null;
  challengeState: ChallengeState | null;
}

export type PendingActionType =
  | 'buy_club'
  | 'buy_sponsor'
  | 'upgrade'
  | 'visit_or_challenge'
  | 'confirm_pay'
  | 'loan'
  | 'airport_fly'
  | 'post_move'
  // 新增：球员系统
  | 'street_food'           // 街头足球·食物
  | 'street_animal'         // 街头足球·动物
  | 'transfer_bid'          // 转会窗竞价中
  | 'transfer_sell'         // 转会窗卖人选择
  | 'assign_player'         // 选择球场分配球员
  | 'match_pick'            // 对战选人
  | 'match_setup'           // 对战前选择球队
  | 'match_reveal'          // 对战揭晓结果
  | 'internal_transfer';    // 球场降级溢出内部转会

export interface PendingAction {
  type: PendingActionType;
  message: string;
  options: ActionOption[];
  cellId?: number;
  // 附加数据（用于复杂操作）
  cardId?: string;           // 球员卡 id
  instanceUid?: string;      // 球员实例 uid
  matchSide?: 'home' | 'away';
  playerId?: number;         // 操作权归属（用于巅峰对决等需要切换操作者的场景）
}

export interface ActionOption {
  label: string;
  action: string;
  cost?: number;
  disabled?: boolean;
}

export interface ChallengeState {
  challengerRoll: number | null;
  ownerRoll: number | null;
  phase: 'challenger_roll' | 'owner_roll' | 'result';
  cellId: number;
  visitFee: number;
}

// ========== Reducer Actions ==========
export type GameAction =
  | { type: 'START_GAME'; players: { name: string; color: string; isAI: boolean }[] }
  | { type: 'LOAD_GAME'; state: GameState }
  | { type: 'ROLL_DICE' }
  | { type: 'START_DICE_ANIMATION' }
  | { type: 'MOVE_PLAYER'; steps: number }
  | { type: 'CHOOSE_ACTION'; action: string; cellId?: number }
  | { type: 'BUY_PROPERTY'; cellId: number }
  | { type: 'BUY_SPONSOR'; cellId: number }
  | { type: 'UPGRADE_CLUB'; cellId: number }
  | { type: 'PAY_VISIT'; cellId: number }
  | { type: 'START_CHALLENGE'; cellId: number }
  | { type: 'TAKE_LOAN'; amount: number }
  | { type: 'DEPOSIT'; amount: number }
  | { type: 'WITHDRAW'; amount: number }
  | { type: 'REPAY_LOAN'; amount: number }
  | { type: 'DECLINE_LOAN' }
  | { type: 'EXECUTE_PAY'; amount: number; ownerId: number; reason: string }
  | { type: 'AIRPORT_FLY'; targetCellId: number }
  | { type: 'AIRPORT_SKIP' }
  | { type: 'END_TURN' }
  | { type: 'ROUND_SETTLEMENT' }
  | { type: 'RESET_GAME' }
  // 球员系统
  | { type: 'BUY_STREET_PLAYER'; cardId: string }
  | { type: 'SKIP_STREET_PLAYER' }
  | { type: 'START_TRANSFER_BID'; cardId: string }
  | { type: 'START_TRANSFER_SELL'; instanceUid: string }
  | { type: 'PLACE_BID'; amount: number }
  | { type: 'PASS_BID' }
  | { type: 'ASSIGN_PLAYER'; instanceUid: string; clubId: number }
  | { type: 'RELEASE_PLAYER'; instanceUid: string }
  | { type: 'INTERNAL_TRANSFER'; instanceUid: string; targetClubId: number }
  // 对战
  | { type: 'START_MATCH'; homeClubId: number; awayClubId: number }
  | { type: 'PICK_MATCH_PLAYER'; instanceUid: string; side: 'home' | 'away' }
  | { type: 'ROLL_MATCH_DICE' }
  | { type: 'CONFIRM_MATCH_RESULT' }
  // 联赛结算
  | { type: 'EXECUTE_BANKRUPT' }
  | { type: 'EXECUTE_BANKRUPT_ID'; playerId: number }
  | { type: 'FORFEIT_MATCH'; side: 'home' | 'away' };
