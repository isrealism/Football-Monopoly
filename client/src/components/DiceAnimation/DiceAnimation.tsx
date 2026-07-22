import React, { useEffect, useState } from 'react';
import { useGame } from '../../state/GameContext';
import styles from './DiceAnimation.module.css';

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export default function DiceAnimation() {
  const { gameState: state, playerId, sendAction } = useGame();
  if (!state) return null;

  const { diceAnimating, diceValue, currentPlayerIndex } = state;
  const [frame, setFrame] = useState(0);

  const isSpinning = diceAnimating && diceValue === null;
  const isShowingResult = diceAnimating && diceValue !== null;
  const isMyTurn = currentPlayerIndex === playerId;

  // Only auto-dispatch ROLL_DICE when it's MY turn (human player)
  // For bots, the server handles the dice sequence
  useEffect(() => {
    if (!isSpinning) return;
    if (!isMyTurn) return; // Don't auto-dispatch for bot turns

    const interval = setInterval(() => {
      setFrame(f => (f + 1) % 6);
    }, 120);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      sendAction({ type: 'ROLL_DICE' });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isSpinning, isMyTurn, sendAction]);

  // For bot turns, just spin the animation visually (no dispatch)
  useEffect(() => {
    if (!isSpinning) return;
    if (isMyTurn) return; // Already handled above

    const interval = setInterval(() => {
      setFrame(f => (f + 1) % 6);
    }, 120);

    return () => clearInterval(interval);
  }, [isSpinning, isMyTurn]);

  if (!diceAnimating) return null;

  return (
    <div className={styles.overlay}>
      <div className={`${styles.box} ${isSpinning ? styles.spinning : styles.result}`}>
        <span className={styles.face}>
          {isSpinning ? DICE_FACES[frame] : (diceValue ? DICE_FACES[diceValue - 1] : '🎲')}
        </span>
        {isShowingResult && diceValue && (
          <span className={styles.num}>{diceValue}</span>
        )}
      </div>
    </div>
  );
}
