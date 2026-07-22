import React from 'react';
import { useGame } from '../../state/GameContext';
import { ALL_PLAYERS } from '../../data/players';
import { LEVEL_TOURNAMENTS } from '../../types';
import { BOARD_CELLS } from '../../data/board';
import styles from './MatchPanel.module.css';

export default function MatchPanel() {
  const { gameState: state, playerId, sendAction } = useGame();
  if (!state?.matchState) return null;

  const ms = state.matchState;
  const homeCell = BOARD_CELLS[ms.homeClubId];
  const awayCell = BOARD_CELLS[ms.awayClubId];
  const homePlayer = state.players[ms.homePlayerId];
  const awayPlayer = state.players[ms.awayPlayerId];
  const isPicking = ms.phase === 'picking';

  const getAvail = (side: 'home' | 'away') => {
    const squad = side === 'home' ? ms.homeSquad : ms.awaySquad;
    const used = side === 'home' ? ms.homeUsed : ms.awayUsed;
    if (ms.isGoldenGoal) return squad;
    return squad.filter((uid: string) => !used.includes(uid));
  };

  const mySide = playerId === ms.homePlayerId ? 'home' : playerId === ms.awayPlayerId ? 'away' : null;

  const handlePick = (uid: string, side: 'home' | 'away') => {
    sendAction({ type: 'PICK_MATCH_PLAYER', instanceUid: uid, side });
  };

  const handleConfirm = () => {
    if (!state.pendingAction) return;
    const act = state.pendingAction.options[0].action;
    if (act === 'CONFIRM_MATCH_RESULT') sendAction({ type: 'CONFIRM_MATCH_RESULT' });
    else if (act === 'ROLL_MATCH_DICE') sendAction({ type: 'ROLL_MATCH_DICE' });
    else if (act === 'OPEN_MATCH') sendAction({ type: 'CHOOSE_ACTION', action: 'OPEN_MATCH' });
  };

  const getInfo = (uid: string) => {
    const inst = state.instances.find(i => i.uid === uid);
    if (!inst) return null;
    const card = ALL_PLAYERS.find(c => c.id === inst.cardId);
    if (!card) return null;
    return { card, attrs: card.attrs.map((v, i) => v + (inst.growth[i] || 0)), inst };
  };

  const lastRound = ms.rounds[ms.rounds.length - 1];

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.forfeitRow}>
            <button className={styles.forfeitBtn} onClick={() => sendAction({ type: 'FORFEIT_MATCH', side: 'home' })}>
              🏳️ {homePlayer?.name} 投降
            </button>
            <button className={styles.forfeitBtn} onClick={() => sendAction({ type: 'FORFEIT_MATCH', side: 'away' })}>
              🏳️ {awayPlayer?.name} 投降
            </button>
          </div>
          <h2 className={styles.title}>
            ⚔️ {LEVEL_TOURNAMENTS[ms.level]} · {ms.isGoldenGoal ? '金球决胜' : `第${ms.round}/${ms.maxRounds}轮`}
          </h2>
          <div className={styles.scoreboard}>
            <span style={{ color: homePlayer?.color }}>{homeCell?.name} {ms.homeScore}</span>
            <span className={styles.vs}>:</span>
            <span style={{ color: awayPlayer?.color }}>{ms.awayScore} {awayCell?.name}</span>
          </div>
        </div>

        {/* Arena */}
        <div className={styles.arena}>
          {/* Home */}
          <div className={styles.side}>
            <h3 className={styles.sideName} style={{ color: homePlayer?.color }}>🏠 {homeCell?.name}</h3>
            {isPicking && getAvail('home').map(uid => {
              const info = getInfo(uid);
              if (!info) return null;
              const canPick = mySide === 'home';
              return (
                <button
                  key={uid}
                  className={`${styles.playerBtn} ${ms.homePick === uid ? styles.selected : ''}`}
                  onClick={() => canPick && handlePick(uid, 'home')}
                  disabled={!canPick}
                >
                  <span className={styles.pName}>{info.card.name}</span>
                  <span className={styles.pAttrs}>
                    {info.card.isGK ? `OVR ${info.card.ovr + (info.inst.growth[0] || 0)}` : info.attrs.join('/')}
                  </span>
                </button>
              );
            })}
            {lastRound && (
              <div className={`${styles.revealCard} ${lastRound.winner === 'home' ? styles.winner : ''}`}>
                <span>{ALL_PLAYERS.find(c => c.id === lastRound.homeCardId)?.name ?? '?'}</span>
                <span className={styles.rVal}>{lastRound.homeVal}</span>
              </div>
            )}
          </div>

          {/* Center */}
          <div className={styles.center}>
            {lastRound && (
              <div className={styles.diceResult}>
                <span className={styles.diceIcon}>{['','⚀','⚁','⚂','⚃','⚄','⚅'][lastRound.diceValue] || '🎲'}</span>
                <span className={styles.attrLabel}>{['速度','射门','传球','盘带','防守','身体'][lastRound.attrIndex]}</span>
                <span>{lastRound.winner === 'home' ? '主队胜' : lastRound.winner === 'away' ? '客队胜' : '平'}</span>
              </div>
            )}
          </div>

          {/* Away */}
          <div className={styles.side}>
            <h3 className={styles.sideName} style={{ color: awayPlayer?.color }}>✈️ {awayCell?.name}</h3>
            {isPicking && getAvail('away').map(uid => {
              const info = getInfo(uid);
              if (!info) return null;
              const canPick = mySide === 'away';
              return (
                <button
                  key={uid}
                  className={`${styles.playerBtn} ${ms.awayPick === uid ? styles.selected : ''}`}
                  onClick={() => canPick && handlePick(uid, 'away')}
                  disabled={!canPick}
                >
                  <span className={styles.pName}>{info.card.name}</span>
                  <span className={styles.pAttrs}>
                    {info.card.isGK ? `OVR ${info.card.ovr + (info.inst.growth[0] || 0)}` : info.attrs.join('/')}
                  </span>
                </button>
              );
            })}
            {lastRound && (
              <div className={`${styles.revealCard} ${lastRound.winner === 'away' ? styles.winner : ''}`}>
                <span>{ALL_PLAYERS.find(c => c.id === lastRound.awayCardId)?.name ?? '?'}</span>
                <span className={styles.rVal}>{lastRound.awayVal}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          {state.pendingAction && (state.pendingAction.type === 'match_pick' || state.pendingAction.type === 'match_reveal' ||
            (state.pendingAction.type === 'post_move' && state.pendingAction.options[0]?.action === 'CONFIRM_MATCH_RESULT')) ? (
            <button className={styles.confirmBtn} onClick={handleConfirm}>
              {state.pendingAction.options[0]?.label || '确定'}
            </button>
          ) : isPicking ? (
            <span className={styles.waiting}>
              {mySide ? `👆 选择你的出场球员` : `⏳ 等待双方选人...`}
            </span>
          ) : null}
        </div>

        {/* Round log */}
        <div className={styles.roundLog}>
          {ms.rounds.map((r: any, i: number) => {
            const hCard = ALL_PLAYERS.find(c => c.id === r.homeCardId);
            const aCard = ALL_PLAYERS.find(c => c.id === r.awayCardId);
            return (
              <span key={i} className={styles.roundItem}>
                R{i + 1}: {hCard?.name ?? '?'}({r.homeVal}) vs {aCard?.name ?? '?'}({r.awayVal}) — {r.winner === 'home' ? '主' : r.winner === 'away' ? '客' : '平'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
