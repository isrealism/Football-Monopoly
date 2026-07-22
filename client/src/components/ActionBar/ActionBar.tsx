import React from 'react';
import { useGame } from '../../state/GameContext';
import SavePanel from '../SavePanel/SavePanel';
import styles from './ActionBar.module.css';

const DICE_FACES: Record<number, string> = {
  1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅',
};

export default function ActionBar() {
  const { gameState: state, playerId, sendAction, botHighlight, send } = useGame();
  if (!state || state.phase !== 'playing') return null;

  const { players, diceValue, diceAnimating, pendingAction, currentPlayerIndex, matchState } = state;

  // Determine whose turn it is to act
  const actingPlayerId = getActingPlayerId(state);
  const player = players[actingPlayerId];
  if (!player || player.isBankrupt) return null;

  const isMyTurn = actingPlayerId === playerId;
  const isBot = player.isAI;

  // Match in progress without pendingAction → show match prompt
  if (!pendingAction && matchState) {
    return (
      <div className={styles.container}>
        <div className={styles.currentPlayer}>
          <span className={styles.dot} style={{ backgroundColor: player.color }} />
          <span className={styles.name}>{player.name}</span>
        </div>
        <span className={styles.waiting}>⚔️ 比赛进行中</span>
      </div>
    );
  }

  if (!pendingAction) return null;

  const isSimpleStep = pendingAction.type === 'post_move' && pendingAction.options.length === 1;

  const handleAction = (actionStr: string) => {
    const parts = actionStr.split(':');
    const cmd = parts[0];

    if (cmd === 'END_TURN') {
      sendAction({ type: 'END_TURN' });
    } else if (cmd === 'ROLL_DICE') {
      sendAction({ type: 'START_DICE_ANIMATION' });
    } else if (cmd === 'MOVE') {
      sendAction({ type: 'MOVE_PLAYER', steps: parseInt(parts[1]) });
    } else if (cmd === 'OK') {
      sendAction({ type: 'CHOOSE_ACTION', action: 'OK' });
    } else {
      sendAction({
        type: 'CHOOSE_ACTION',
        action: actionStr,
        cellId: pendingAction.cellId,
      });
    }
  };

  return (
    <div className={styles.container}>
      {/* Current player indicator */}
      <div className={styles.currentPlayer}>
        <span className={styles.dot} style={{ backgroundColor: player.color }} />
        <span className={styles.name}>
          {player.name}
          {isBot && ' 🤖'}
          {isMyTurn && ' (你)'}
        </span>
        <SavePanel />
        {!isMyTurn && !isBot && (
          <>
            <span className={styles.waitingBadge}>等待中</span>
            <button
              className={styles.kickBtn}
              onClick={() => send({ type: 'KICK_PLAYER', targetId: actingPlayerId })}
              title="60秒无操作可踢出"
            >
              踢出
            </button>
          </>
        )}
        {isBot && (
          <span className={styles.botBadge}>思考中...</span>
        )}
      </div>

      {/* Dice display */}
      {diceValue && !diceAnimating && (
        <div className={styles.diceDisplay}>
          <span className={styles.diceFace}>{DICE_FACES[diceValue]}</span>
          <span className={styles.diceNum}>{diceValue}</span>
        </div>
      )}

      {/* Action message */}
      <span className={styles.actionPrompt}>{pendingAction.message}</span>

      {/* Single action button */}
      {isSimpleStep && (() => {
        const opt = pendingAction.options[0];
        const botStyle = (isBot && botHighlight && botHighlight.action === opt.action)
          ? { boxShadow: `0 0 0 3px ${botHighlight.color}`, outline: `2px solid ${botHighlight.color}`, outlineOffset: '1px' }
          : undefined;
        return (
          <button
            className={styles.primaryBtn}
            disabled={!isMyTurn}
            style={botStyle}
            onClick={() => handleAction(opt.action)}
          >
            {opt.label}
          </button>
        );
      })()}

      {/* Multiple action buttons */}
      {!isSimpleStep && (
        <div className={styles.actionBtns}>
          {pendingAction.options.map((opt: any, i: number) => {
            const isSecondary =
              opt.label.includes('不买') || opt.label.includes('暂不') ||
              opt.label.includes('不贷款') || opt.label.includes('不飞了') ||
              opt.label.includes('不跟价') || opt.label.includes('不卖') ||
              opt.label.includes('路过') || opt.label.includes('确定') ||
              opt.label.includes('知道了') || opt.label === '离开';
            const botStyle = (isBot && botHighlight && botHighlight.action === opt.action)
              ? { boxShadow: `0 0 0 3px ${botHighlight.color}`, outline: `2px solid ${botHighlight.color}`, outlineOffset: '1px' }
              : undefined;
            return (
              <button
                key={i}
                className={isSecondary ? styles.secondaryBtn : styles.primaryBtn}
                disabled={!isMyTurn || opt.disabled === true}
                style={botStyle}
                onClick={() => handleAction(opt.action)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Determine which player the action is for */
function getActingPlayerId(state: any): number {
  if (state.pendingAction?.playerId !== undefined) return state.pendingAction.playerId;
  if (state.transferBidState?.phase === 'bidding') {
    return state.transferBidState.bidders[state.transferBidState.bidderIndex];
  }
  if (state.pendingAction?.type === 'assign_player' && state.pendingAction.instanceUid) {
    const inst = state.instances.find((i: any) => i.uid === state.pendingAction.instanceUid);
    if (inst) return inst.ownerId;
  }
  return state.currentPlayerIndex;
}
