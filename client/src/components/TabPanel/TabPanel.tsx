import React, { useState } from 'react';
import { useGame } from '../../state/GameContext';
import { LEVEL_TOURNAMENTS, LEAGUE_NAMES } from '../../types';
import { TOURNAMENT_PRIZES } from '../../data/players';
import { BOARD_CELLS } from '../../data/board';
import { ALL_PLAYERS } from '../../data/players';
import { calcCapital } from '../../utils/gameLogic';
import styles from './TabPanel.module.css';

type Tab = 'league' | 'stats' | 'log';

export default function TabPanel() {
  const { gameState: state } = useGame();
  const [tab, setTab] = useState<Tab>('stats');
  if (!state) return null;

  return (
    <div className={styles.container}>
      {/* Tab Headers */}
      <div className={styles.tabHeader}>
        {([
          ['league', '🏆 联赛'],
          ['stats', '📊 玩家'],
          ['log', '📜 日志'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.tab} ${tab === key ? styles.tabOn : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className={styles.content}>
        {tab === 'league' && <LeagueTab state={state} />}
        {tab === 'stats' && <StatsTab state={state} />}
        {tab === 'log' && <LogTab state={state} />}
      </div>
    </div>
  );
}

// ====== League Tab ======
function LeagueTab({ state }: { state: any }) {
  const { leagueTables, players } = state;
  return (
    <div className={styles.scrollArea}>
      {[1, 2, 3, 4, 5].map(level => {
        const t = leagueTables[level];
        if (!t) return null;
        const sorted = [...(t.entries || [])].sort((a: any, b: any) => b.points - a.points);
        return (
          <div key={level} className={styles.leagueBlock}>
            <div className={styles.leagueHeader}>
              <span className={styles.leagueTitle}>{LEVEL_TOURNAMENTS[level]}</span>
              <span className={styles.leagueProgress}>
                {t.matchesPlayed}/{t.matchesNeeded} 场 · 🥇{TOURNAMENT_PRIZES[level]}kw
              </span>
            </div>
            {sorted.length > 0 ? (
              sorted.map((e: any, i: number) => {
                const cell = BOARD_CELLS[e.clubId];
                const owner = players[e.ownerId];
                return (
                  <div key={e.clubId} className={styles.entry}>
                    <span className={styles.rank}>{i + 1}</span>
                    <span className={styles.clubName} style={{ color: owner?.color }}>{cell?.name ?? '?'}</span>
                    <span className={styles.pts}>{e.points}分 · {e.matches}场</span>
                  </div>
                );
              })
            ) : (
              <span className={styles.empty}>暂无比赛</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ====== Stats Tab ======
function StatsTab({ state }: { state: any }) {
  const { players, currentPlayerIndex, cellLevels, cellOwners, instances, clubTrophies, trainingPoints, hasUCLTitle } = state;
  return (
    <div className={styles.scrollArea}>
      {players.map((p: any) => {
        if (p.isBankrupt) return (
          <div key={p.id} className={styles.playerCard}>
            <div className={styles.playerHeader}>
              <span className={styles.dot} style={{ backgroundColor: p.color, opacity: 0.3 }} />
              <span className={styles.playerName} style={{ opacity: 0.5 }}>{p.name}</span>
              <span className={styles.badge}>💀 破产</span>
            </div>
          </div>
        );

        const capital = p.cash + p.savings - p.debt;
        const lv5Count = Object.entries(cellOwners)
          .filter(([cid, oid]: any) => oid === p.id && (cellLevels[parseInt(cid)] || 0) >= 5).length;
        const isCurrent = p.id === currentPlayerIndex;

        // Properties
        const props = (p.properties || []).map((cid: number) => {
          const cell = state.cells[cid];
          const level = cellLevels[cid];
          const clubPlayers = instances.filter((inst: any) => inst.clubId === cid);
          return { cid, name: cell.name, level, players: clubPlayers, trophies: clubTrophies[cid]?.total || 0 };
        });

        return (
          <div key={p.id} className={`${styles.playerCard} ${isCurrent ? styles.active : ''}`}>
            <div className={styles.playerHeader}>
              <span className={styles.dot} style={{ backgroundColor: p.color }} />
              <span className={styles.playerName}>{p.name}</span>
              {p.isAI && <span className={styles.badge}>🤖</span>}
              {isCurrent && <span className={styles.badge}>当前</span>}
            </div>

            <div className={styles.capitalRow}>
              <div className={styles.capitalItem}>
                <span className={styles.capLabel}>现金</span>
                <span className={styles.capVal}>{p.cash.toFixed(1)}kw</span>
              </div>
              <div className={styles.capitalItem}>
                <span className={styles.capLabel}>存款</span>
                <span className={styles.capVal}>{p.savings.toFixed(1)}kw</span>
              </div>
              <div className={styles.capitalItem}>
                <span className={styles.capLabel}>负债</span>
                <span className={`${styles.capVal} ${p.debt > 0 ? styles.debt : ''}`}>{p.debt.toFixed(1)}kw</span>
              </div>
              <div className={styles.capitalItem}>
                <span className={styles.capLabel}>资金</span>
                <span className={`${styles.capVal} ${capital >= 0 ? styles.positive : styles.negative}`}>{capital.toFixed(1)}kw</span>
              </div>
            </div>

            {/* Win conditions */}
            <div className={styles.conditions}>
              <span className={capital >= 100 ? styles.condDone : styles.condTodo}>
                {capital >= 100 ? '☑' : '☐'} 资金≥100kw
              </span>
              <span className={lv5Count >= 3 ? styles.condDone : styles.condTodo}>
                {lv5Count >= 3 ? '☑' : '☐'} 3座五级 ({lv5Count}/3)
              </span>
              <span className={hasUCLTitle?.[p.id] ? styles.condDone : styles.condTodo}>
                {hasUCLTitle?.[p.id] ? '☑' : '☐'} 欧冠
              </span>
            </div>

            {/* Properties */}
            {props.length > 0 && (
              <div className={styles.propertyList}>
                {props.map((pp: any) => (
                  <span key={pp.cid} className={styles.propertyTag} style={{ borderColor: p.color }}>
                    {pp.name} Lv{pp.level || 1}
                    {pp.trophies > 0 ? ` 🏆×${pp.trophies}` : ''}
                    {pp.players.map((inst: any) => {
                      const card = ALL_PLAYERS.find(c => c.id === inst.cardId);
                      return card ? ` ${card.name}` : '';
                    }).join('')}
                  </span>
                ))}
              </div>
            )}

            {trainingPoints[p.id] > 0 && (
              <div className={styles.tp}>🎯 训练点: {trainingPoints[p.id]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ====== Log Tab ======
function LogTab({ state }: { state: any }) {
  return (
    <div className={styles.scrollArea}>
      {state.log.slice(0, 20).map((msg: string, i: number) => (
        <div key={i} className={styles.logItem}>{msg}</div>
      ))}
      {state.log.length === 0 && <p className={styles.empty}>暂无事件</p>}
    </div>
  );
}
