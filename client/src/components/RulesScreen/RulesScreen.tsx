import React, { useState } from 'react';
import styles from './RulesScreen.module.css';

const PAGES = [
  {
    title: '基本设定',
    content: `· 2-4 名玩家在 40 格棋盘上轮流行动
· 掷骰子前进，经过起点获得 5kw
· 到达银行可以存取款、贷款
· 入狱需要停留 2 回合
· 到达机场可飞往自己的地产`,
  },
  {
    title: '地产与球员',
    content: `· 俱乐部：购买价 2kw，可升级 5 次
· 升级后可参加更高级别联赛
· 赞助商：购买后他人停留需付双倍
· 街头足球：低价购买球员
· 转会窗：竞价拍卖球员
· 球场容量 = 等级，超员需转会或解约`,
  },
  {
    title: '对战与联赛',
    content: `· 挑战他人球场：双方各出球员对战
· 对战等级 = 球场等级，对应轮次数
· 骰子决定比较的属性（6 维）
· 每场比赛计入联赛积分榜
· 联赛结算：冠军获得奖金+奖杯
· 巅峰对决：随机事件，胜者获 5kw`,
  },
  {
    title: '胜利条件',
    content: `· 资金 ≥ 100kw
· 拥有 3 座五级（现代化）球场
· 获得过欧冠冠军（5级联赛）
· 三条件同时满足即获胜
· 或：其他所有玩家破产`,
  },
];

export default function RulesScreen({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <h2 className={styles.title}>📖 游戏规则</h2>
        <h3 className={styles.pageTitle}>{PAGES[page].title}</h3>
        <p className={styles.text}>{PAGES[page].content}</p>
        <div className={styles.nav}>
          {PAGES.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === page ? styles.dotOn : ''}`}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
        <div className={styles.arrows}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>◀</button>
          <span>{page + 1}/{PAGES.length}</span>
          <button disabled={page === PAGES.length - 1} onClick={() => setPage(p => p + 1)}>▶</button>
        </div>
      </div>
    </div>
  );
}
