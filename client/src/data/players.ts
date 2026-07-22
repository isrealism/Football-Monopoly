// ========== 球员卡类型 ==========
export interface PlayerCard {
  id: string;
  name: string;           // 真实姓名
  nickname: string;       // 绰号（食物/动物）
  pool: 'food' | 'animal' | 'transfer';
  marketValue: number;    // 身价 (kw)
  ovr: number;            // 总评
  attrs: number[];        // [PAC, SHO, PAS, DRI, DEF, PHY] 六维
  isGK: boolean;
  isResident?: boolean;      // 驻守球员
  residentClubId?: number;   // 绑定的球场 cellId
}

// ========== 街头足球·食物组 (16人) ==========
export const FOOD_PLAYERS: PlayerCard[] = [
  { id: 'wirtz',     name: '维尔茨',     nickname: '土豆',         pool: 'food', marketValue: 11, ovr: 89, attrs: [80, 82, 88, 90, 54, 67], isGK: false },
  { id: 'rice',      name: '赖斯',       nickname: '大米',         pool: 'food', marketValue: 12, ovr: 87, attrs: [73, 75, 82, 78, 86, 85], isGK: false },
  { id: 'mctominay', name: '麦克托米奈',  nickname: '小麦',         pool: 'food', marketValue: 4,  ovr: 83, attrs: [70, 80, 78, 76, 74, 86], isGK: false },
  { id: 'lautaro',   name: '劳塔罗',     nickname: '菠萝',         pool: 'food', marketValue: 8.5,  ovr: 88, attrs: [82, 88, 74, 85, 35, 76], isGK: false },
  { id: 'odegaard',  name: '厄德高',     nickname: '糕',           pool: 'food', marketValue: 6.5,  ovr: 87, attrs: [68, 78, 87, 87, 58, 62], isGK: false },
  { id: 'palmer',    name: '帕尔默',     nickname: '糖',           pool: 'food', marketValue: 11, ovr: 87, attrs: [78, 84, 85, 87, 40, 62], isGK: false },
  { id: 'isak',      name: '伊萨克',     nickname: '竹竿',         pool: 'food', marketValue: 8.5,  ovr: 88, attrs: [88, 85, 72, 83, 32, 78], isGK: false },
  { id: 'ekitike',   name: '埃基蒂克',   nickname: '法棍',         pool: 'food', marketValue: 8,  ovr: 82, attrs: [86, 78, 69, 85, 33, 73], isGK: false },
  { id: 'schlotterbeck', name: '施洛特贝克', nickname: '贝壳',     pool: 'food', marketValue: 5.5,  ovr: 83, attrs: [72, 45, 68, 62, 84, 82], isGK: false },
  { id: 'pavlovic',  name: '帕夫洛维奇',  nickname: '泡芙',         pool: 'food', marketValue: 7.5,  ovr: 79, attrs: [62, 64, 79, 78, 76, 71], isGK: false },
  { id: 'bischof',   name: '比朔夫',     nickname: '饼干',         pool: 'food', marketValue: 4,  ovr: 82, attrs: [70, 74, 83, 80, 76, 69], isGK: false },
  { id: 'k77',       name: '克瓦拉茨赫利亚', nickname: 'K22',       pool: 'food', marketValue: 14, ovr: 87, attrs: [88, 82, 84, 89, 35, 68], isGK: false },
  { id: 'gnabry',    name: '格纳布里',   nickname: '狗不理包子',    pool: 'food', marketValue: 2.2,  ovr: 80, attrs: [82, 80, 77, 82, 36, 66], isGK: false },
  { id: 'oriley',    name: '奥赖利',     nickname: '蘑菇',         pool: 'food', marketValue: 2,  ovr: 78, attrs: [68, 75, 78, 76, 65, 74], isGK: false },
  { id: 'bellingham',name: '贝林厄姆',   nickname: '辣椒',         pool: 'food', marketValue: 13, ovr: 90, attrs: [80, 86, 83, 90, 78, 85], isGK: false },
  { id: 'ake',       name: '阿克',       nickname: '可食用小章鱼',  pool: 'food', marketValue: 1.4,  ovr: 79, attrs: [70, 50, 66, 68, 82, 76], isGK: false },
];

// ========== 街头足球·动物组 (16人) ==========
export const ANIMAL_PLAYERS: PlayerCard[] = [
  { id: 'haaland',   name: '哈兰德',     nickname: '海怪',         pool: 'animal', marketValue: 20, ovr: 90, attrs: [86, 91, 70, 80, 45, 88], isGK: false },
  { id: 'mbappe',    name: '姆巴佩',     nickname: '龟',           pool: 'animal', marketValue: 18, ovr: 91, attrs: [97, 90, 81, 92, 37, 76], isGK: false },
  { id: 'olise',     name: '奥利塞',     nickname: '猫',           pool: 'animal', marketValue: 15, ovr: 88, attrs: [87, 84, 86, 89, 42, 66], isGK: false },
  { id: 'grealish',  name: '格拉利什',   nickname: '狗',           pool: 'animal', marketValue: 2.5,  ovr: 82, attrs: [73, 74, 83, 85, 36, 70], isGK: false },
  { id: 'kane',      name: '凯恩',       nickname: '狮子',         pool: 'animal', marketValue: 9,  ovr: 89, attrs: [64, 92, 83, 82, 48, 82], isGK: false },
  { id: 'doku',      name: '多库',       nickname: '树獭',         pool: 'animal', marketValue: 7.5,  ovr: 85, attrs: [93, 74, 76, 88, 30, 64], isGK: false },
  { id: 'neuer',     name: '诺伊尔',     nickname: '熊',           pool: 'animal', marketValue: 0.3,   ovr: 75, attrs: [0, 0, 0, 0, 0, 0], isGK: true },
  { id: 'cubarsi',   name: '库巴西',     nickname: '奶龙',         pool: 'animal', marketValue: 8,  ovr: 84, attrs: [68, 42, 72, 65, 84, 76], isGK: false },
  { id: 'debruyne',  name: '德布劳内',   nickname: '丁丁',         pool: 'animal', marketValue: 3.5,  ovr: 87, attrs: [67, 86, 92, 85, 65, 78], isGK: false },
  { id: 'havertz',   name: '哈弗茨',     nickname: '驴',           pool: 'animal', marketValue: 6,  ovr: 84, attrs: [76, 82, 80, 83, 48, 74], isGK: false },
  { id: 'musiala',   name: '穆夏拉',     nickname: '鹿',           pool: 'animal', marketValue: 10, ovr: 88, attrs: [84, 82, 83, 92, 55, 64], isGK: false },
  { id: 'courtois',  name: '库尔图瓦',   nickname: '长颈鹿',       pool: 'animal', marketValue: 2,  ovr: 80, attrs: [0, 0, 0, 0, 0, 0], isGK: true },
  { id: 'modric',    name: '莫德里奇',   nickname: '兔',           pool: 'animal', marketValue: 0.3,   ovr: 82, attrs: [58, 74, 86, 86, 64, 58], isGK: false },
  { id: 'vinicius',  name: '维尼修斯',   nickname: '大猩猩',       pool: 'animal', marketValue: 14, ovr: 89, attrs: [95, 84, 81, 91, 29, 69], isGK: false },
  { id: 'kimmich',   name: '基米希',     nickname: '鸡',           pool: 'animal', marketValue: 4,  ovr: 89, attrs: [72, 74, 89, 84, 83, 79], isGK: false },
  { id: 'richarlison', name: '里沙利松',  nickname: '鸽子',         pool: 'animal', marketValue: 2.5,  ovr: 80, attrs: [78, 80, 70, 80, 40, 76], isGK: false },
];

// ========== 转会窗 (16人) ==========
export const TRANSFER_PLAYERS: PlayerCard[] = [
  { id: 'dembele',   name: '登贝莱',     nickname: '', pool: 'transfer', marketValue: 10, ovr: 90, attrs: [91, 88, 83, 93, 50, 69], isGK: false },
  { id: 'pedri',     name: '佩德里',     nickname: '', pool: 'transfer', marketValue: 15, ovr: 89, attrs: [77, 73, 85, 91, 78, 77], isGK: false },
  { id: 'hakimi',    name: '阿什拉夫',   nickname: '', pool: 'transfer', marketValue: 7,  ovr: 89, attrs: [92, 79, 82, 83, 82, 79], isGK: false },
  { id: 'rodri',     name: '罗德里',     nickname: '', pool: 'transfer', marketValue: 5,  ovr: 90, attrs: [65, 80, 86, 84, 86, 85], isGK: false },
  { id: 'salah',     name: '萨拉赫',     nickname: '', pool: 'transfer', marketValue: 4.5,  ovr: 91, attrs: [89, 88, 86, 90, 45, 76], isGK: false },
  { id: 'caicedo',   name: '凯塞多',     nickname: '', pool: 'transfer', marketValue: 11, ovr: 87, attrs: [75, 72, 82, 79, 86, 84], isGK: false },
  { id: 'vandijk',   name: '范戴克',     nickname: '', pool: 'transfer', marketValue: 3,  ovr: 90, attrs: [73, 60, 72, 72, 90, 87], isGK: false },
  { id: 'diaz',      name: '路易斯·迪亚斯', nickname: '', pool: 'transfer', marketValue: 7.5,  ovr: 86, attrs: [93, 80, 76, 87, 35, 68], isGK: false },
  { id: 'gakpo',     name: '加克波',     nickname: '', pool: 'transfer', marketValue: 5.5,  ovr: 85, attrs: [86, 82, 79, 83, 38, 76], isGK: false },
  { id: 'tah',       name: '若纳坦·塔',  nickname: '', pool: 'transfer', marketValue: 4,  ovr: 87, attrs: [74, 48, 68, 64, 87, 88], isGK: false },
  { id: 'maguire',   name: '马奎尔',     nickname: '', pool: 'transfer', marketValue: 1.5,  ovr: 81, attrs: [48, 55, 65, 58, 82, 86], isGK: false },
  { id: 'guimaraes', name: '吉马良斯',   nickname: '', pool: 'transfer', marketValue: 7,  ovr: 85, attrs: [68, 74, 84, 82, 78, 82], isGK: false },
  { id: 'tonali',    name: '托纳利',     nickname: '', pool: 'transfer', marketValue: 5,  ovr: 84, attrs: [72, 72, 80, 79, 78, 80], isGK: false },
  { id: 'szoboszlai', name: '索博斯洛伊', nickname: '', pool: 'transfer', marketValue: 10, ovr: 86, attrs: [82, 83, 85, 84, 55, 74], isGK: false },
  { id: 'upamecano', name: '于帕梅卡诺', nickname: '', pool: 'transfer', marketValue: 4.5,  ovr: 84, attrs: [78, 38, 62, 60, 85, 86], isGK: false },
  { id: 'bruno',     name: 'B费',        nickname: '稳定元素',     pool: 'transfer', marketValue: 5,  ovr: 87, attrs: [72, 84, 89, 83, 68, 76], isGK: false },
];

// ========== 驻守球员（23人，每俱乐部1人，球场Lv3自动加入） ==========
// cellId 映射: 1=曼城,2=曼联,3=阿森纳,4=利物浦,6=切尔西,7=热刺,8=纽卡,9=水晶宫
// 12=拜仁,14=多特,16=勒沃库森,18=莱比锡,19=斯图加特
// 21=皇马,22=巴萨,24=马竞,26=贝蒂斯
// 31=AC米兰,32=国米,33=尤文,34=那不勒斯
// 37=巴黎,38=摩纳哥
export const RESIDENT_PLAYERS: PlayerCard[] = [
  { id: 'res_cherki',     name: '谢尔基',     nickname: '', pool: 'transfer', marketValue: 10,  ovr: 84, attrs: [75,77,82,87,38,64], isGK: false, isResident: true, residentClubId: 1 },
  { id: 'res_deligt',     name: '德利赫特',   nickname: '', pool: 'transfer', marketValue: 4.0, ovr: 82, attrs: [62,56,62,67,82,83], isGK: false, isResident: true, residentClubId: 2 },
  { id: 'res_merino',     name: '梅里诺',     nickname: '', pool: 'transfer', marketValue: 3.5, ovr: 83, attrs: [63,79,80,80,81,80], isGK: false, isResident: true, residentClubId: 3 },
  { id: 'res_gravenberch',name: '赫拉芬贝赫', nickname: '', pool: 'transfer', marketValue: 8.0, ovr: 86, attrs: [76,73,79,83,79,81], isGK: false, isResident: true, residentClubId: 4 },
  { id: 'res_james',      name: '里斯·詹姆斯',nickname: '', pool: 'transfer', marketValue: 4.5, ovr: 84, attrs: [76,67,83,81,84,84], isGK: false, isResident: true, residentClubId: 6 },
  { id: 'res_kulusevski', name: '库卢塞夫斯基',nickname: '',pool: 'transfer', marketValue: 5.5, ovr: 85, attrs: [78,80,84,86,45,76], isGK: false, isResident: true, residentClubId: 7 },
  { id: 'res_joelinton',  name: '乔林顿',     nickname: '', pool: 'transfer', marketValue: 4.0, ovr: 83, attrs: [74,77,78,80,79,88], isGK: false, isResident: true, residentClubId: 8 },
  { id: 'res_wharton',    name: '亚当·沃顿',  nickname: '', pool: 'transfer', marketValue: 3.0, ovr: 80, attrs: [65,68,79,76,74,70], isGK: false, isResident: true, residentClubId: 9 },
  { id: 'res_karl',       name: '卡尔',       nickname: '', pool: 'transfer', marketValue: 4.5, ovr: 81, attrs: [72,70,78,82,68,65], isGK: false, isResident: true, residentClubId: 12 },
  { id: 'res_kobel',      name: '科贝尔',     nickname: '', pool: 'transfer', marketValue: 4.0, ovr: 78, attrs: [0,0,0,0,0,0], isGK: true,  isResident: true, residentClubId: 14 },
  { id: 'res_boniface',   name: '博尼费斯',   nickname: '', pool: 'transfer', marketValue: 5.0, ovr: 84, attrs: [85,84,72,82,38,84], isGK: false, isResident: true, residentClubId: 16 },
  { id: 'res_diomande',   name: '迪奥曼德',   nickname: '', pool: 'transfer', marketValue: 5.0, ovr: 83, attrs: [72,40,62,64,84,82], isGK: false, isResident: true, residentClubId: 18 },
  { id: 'res_stiller',    name: '施蒂勒',     nickname: '', pool: 'transfer', marketValue: 3.0, ovr: 82, attrs: [65,68,83,79,72,70], isGK: false, isResident: true, residentClubId: 19 },
  { id: 'res_tchouameni', name: '楚阿梅尼',   nickname: '', pool: 'transfer', marketValue: 5.5, ovr: 84, attrs: [71,69,79,78,81,82], isGK: false, isResident: true, residentClubId: 21 },
  { id: 'res_dejong',     name: '德容',       nickname: '', pool: 'transfer', marketValue: 6.0, ovr: 87, attrs: [74,72,87,88,74,76], isGK: false, isResident: true, residentClubId: 22 },
  { id: 'res_sorloth',    name: '瑟洛特',     nickname: '', pool: 'transfer', marketValue: 3.0, ovr: 83, attrs: [82,84,68,76,34,86], isGK: false, isResident: true, residentClubId: 24 },
  { id: 'res_antony',     name: '安东尼',     nickname: '', pool: 'transfer', marketValue: 2.5, ovr: 82, attrs: [86,78,76,87,35,64], isGK: false, isResident: true, residentClubId: 26 },
  { id: 'res_pulisic',    name: '普利西奇',   nickname: '', pool: 'transfer', marketValue: 4.0, ovr: 84, attrs: [87,80,80,86,42,64], isGK: false, isResident: true, residentClubId: 31 },
  { id: 'res_barella',    name: '巴雷拉',     nickname: '', pool: 'transfer', marketValue: 7.0, ovr: 87, attrs: [76,76,84,86,80,78], isGK: false, isResident: true, residentClubId: 32 },
  { id: 'res_vlahovic',   name: '弗拉霍维奇', nickname: '', pool: 'transfer', marketValue: 5.5, ovr: 85, attrs: [78,86,70,78,32,80], isGK: false, isResident: true, residentClubId: 33 },
  { id: 'res_dilorenzo',  name: '迪洛伦佐',   nickname: '', pool: 'transfer', marketValue: 2.5, ovr: 84, attrs: [78,68,78,78,84,80], isGK: false, isResident: true, residentClubId: 34 },
  { id: 'res_doue',       name: '杜埃',       nickname: '', pool: 'transfer', marketValue: 4.0, ovr: 82, attrs: [88,76,76,86,36,66], isGK: false, isResident: true, residentClubId: 37 },
  { id: 'res_akliouche',  name: '阿克利乌什', nickname: '', pool: 'transfer', marketValue: 2.5, ovr: 79, attrs: [82,72,76,82,38,58], isGK: false, isResident: true, residentClubId: 38 },
];

// ========== 青训池 (15人) ==========
export const YOUTH_PLAYERS: PlayerCard[] = [
  { id: 'y_madueke',     name: '马杜埃凯',     nickname: '', pool: 'transfer', marketValue: 5, ovr: 80, attrs: [89,76,75,84,36,68], isGK: false },
  { id: 'y_adeyemi',     name: '阿德耶米',     nickname: '', pool: 'transfer', marketValue: 4, ovr: 80, attrs: [96,76,72,82,36,69], isGK: false },
  { id: 'y_barcola',     name: '巴尔克拉',     nickname: '', pool: 'transfer', marketValue: 7, ovr: 84, attrs: [90,77,78,84,39,66], isGK: false },
  { id: 'y_nmendes',     name: '努诺·门德斯',  nickname: '', pool: 'transfer', marketValue: 8, ovr: 88, attrs: [91,62,78,82,80,74], isGK: false },
  { id: 'y_jneves',      name: '若昂·内维斯',  nickname: '', pool: 'transfer', marketValue: 14, ovr: 87, attrs: [72,70,86,84,80,74], isGK: false },
  { id: 'y_zaireemery',  name: '扎伊尔-埃梅里',nickname: '', pool: 'transfer', marketValue: 8, ovr: 82, attrs: [74,72,82,82,80,76], isGK: false },
  { id: 'y_bradley',     name: '布拉德利',     nickname: '', pool: 'transfer', marketValue: 2.5, ovr: 79, attrs: [82,59,69,73,74,78], isGK: false },
  { id: 'y_rlewis',      name: '里科·刘易斯',  nickname: '', pool: 'transfer', marketValue: 3.5, ovr: 78, attrs: [76,56,76,80,77,66], isGK: false },
  { id: 'y_smal',        name: '赛义德·马拉',  nickname: '', pool: 'transfer', marketValue: 4.5, ovr: 74, attrs: [85,68,64,78,32,62], isGK: false },
  { id: 'y_mainoo',      name: '梅努',         nickname: '', pool: 'transfer', marketValue: 5.5, ovr: 86, attrs: [77,78,85,87,81,84], isGK: false },
  { id: 'y_saibari',     name: '塞巴里',       nickname: '', pool: 'transfer', marketValue: 4, ovr: 79, attrs: [76,74,80,82,68,72], isGK: false },
  { id: 'y_stanisic',    name: '斯塔尼西奇',   nickname: '', pool: 'transfer', marketValue: 2, ovr: 80, attrs: [74,56,72,74,82,78], isGK: false },
  { id: 'y_urbig',       name: '乌尔比希',     nickname: '', pool: 'transfer', marketValue: 1.5, ovr: 72, attrs: [0,0,0,0,0,0], isGK: true },
  { id: 'y_ngumoha',     name: '恩古莫哈',     nickname: '', pool: 'transfer', marketValue: 1.5, ovr: 74, attrs: [90,72,68,82,28,58], isGK: false },
  { id: 'y_estevao',     name: '埃斯特旺',     nickname: '', pool: 'transfer', marketValue: 4.5, ovr: 80, attrs: [87,76,74,87,30,58], isGK: false },
];

// ========== 全量合并 ==========
export const ALL_PLAYERS: PlayerCard[] = [
  ...FOOD_PLAYERS,
  ...ANIMAL_PLAYERS,
  ...TRANSFER_PLAYERS,
  ...RESIDENT_PLAYERS,
  ...YOUTH_PLAYERS,
];

// ========== 快速查找 ==========
const cardMap = new Map<string, PlayerCard>();
ALL_PLAYERS.forEach(c => cardMap.set(c.id, c));

export function getPlayerCard(id: string): PlayerCard | undefined {
  return cardMap.get(id);
}

export function getAttr(card: PlayerCard, index: number): number {
  return card.attrs[index] ?? 0;
}

// 属性名称
export const ATTR_NAMES = ['速度', '射门', '传球', '盘带', '防守', '身体'];

// 赛事名称
export const TOURNAMENT_NAMES = ['', '国内联赛', '国内杯赛', '欧协联', '欧联', '欧冠'];

// 赛事奖金（冠军）
export const TOURNAMENT_PRIZES = [0, 2, 3, 4, 5, 10];
