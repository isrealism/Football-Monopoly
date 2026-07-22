import React from 'react';
import { GameProvider, useGame } from './state/GameContext';
import SetupScreen from './components/SetupScreen/SetupScreen';
import RoomLobby from './components/RoomLobby/RoomLobby';
import Board from './components/Board/Board';
import TabPanel from './components/TabPanel/TabPanel';
import ActionBar from './components/ActionBar/ActionBar';
import MatchPanel from './components/MatchPanel/MatchPanel';
import ErrorBoundary from './components/ErrorBoundary';
import PostGameReport from './components/PostGameReport/PostGameReport';
import styles from './App.module.css';

function AppContent() {
  const { status, gameState } = useGame();
  const [showReport, setShowReport] = React.useState(false);

  // Wrap all screens in phone frame for mobile proportions
  const wrap = (children: React.ReactNode) => (
    <div className={styles.phoneFrame}>
      <div className={styles.phoneScreen}>{children}</div>
    </div>
  );

  switch (status) {
    case 'disconnected':
      return wrap(<CenterMsg text="连接服务器中..." spinner />);

    case 'connecting':
      return wrap(<CenterMsg text="正在连接..." spinner />);

    case 'connected':
      return wrap(<SetupScreen />);

    case 'lobby':
      return wrap(<RoomLobby />);

    case 'playing':
    case 'finished':
      return wrap(
        <ErrorBoundary>
          <div className={styles.gameLayout}>
            {/* Board on top */}
            <div className={styles.boardArea}>
              <Board />
            </div>

            {/* Tabbed panel in middle */}
            <div className={styles.panelArea}>
              <TabPanel />
            </div>

            {/* Action bar at bottom */}
            <div className={styles.actionArea}>
              <ActionBar />
            </div>

            {/* Match overlay */}
            <MatchPanel />

            {/* Post-game report */}
            {showReport && gameState && (
              <PostGameReport state={gameState} onClose={() => setShowReport(false)} />
            )}

            {/* Win overlay */}
            {!showReport && status === 'finished' && gameState?.winner !== null && gameState && (
              <div className={styles.winOverlay}>
                <div className={styles.winCard}>
                  <h1 className={styles.winTitle}>🏆</h1>
                  <h2 className={styles.winName}>
                    {gameState.players[gameState.winner]?.name ?? '?'} 获胜！
                  </h2>
                  <p className={styles.winMsg}>{gameState.pendingAction?.message}</p>
                  <button className={styles.reportBtn} onClick={() => setShowReport(true)}>
                    查看赛后报告
                  </button>
                </div>
              </div>
            )}
          </div>
        </ErrorBoundary>
      );

    default:
      return null;
  }
}

function CenterMsg({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <div className={styles.connecting}>
      {spinner && <div className={styles.spinner} />}
      <p>{text}</p>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <AppContent />
    </GameProvider>
  );
}
