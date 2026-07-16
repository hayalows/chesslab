import Link from "next/link";
import AuthMenu from "./AuthMenu";
import styles from "./LandingPage.module.css";

const pieces = ["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜", "♟", "♟", "♟", "♟", "♟", "♟", "♟", "♟", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "♙", "♙", "♙", "♙", "♙", "♙", "♙", "♙", "♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"];

export default function LandingPage() {
  return <main className={styles.shell}>
    <nav className={styles.nav}><Link className={styles.brand} href="/"><span><i /><i /><i /></span>RivalMind</Link><div><Link href="#how">How it works</Link><AuthMenu triggerLabel="Sign in" /></div></nav>
    <section className={styles.hero}>
      <div className={styles.heroCopy}><span className={styles.kicker}>CHESS TRAINING THAT EXPLAINS ITSELF</span><h1>Play a game.<br/><em>Understand it.</em></h1><p>Stockfish finds the truth on the board. RivalMind turns it into a lesson you can use on your next move.</p><div className={styles.heroActions}><Link className={styles.primary} href="#choose">Start training</Link><AuthMenu triggerLabel="Create free profile" prominent /></div><small>No account needed to play. Sign in with email when you want to keep your progress.</small></div>
      <div className={styles.demo} aria-label="Example RivalMind lesson">
        <div className={styles.demoTop}><span>LIVE LESSON</span><b>Move 18</b></div>
        <div className={styles.demoBody}><div className={styles.miniBoard}>{pieces.map((piece,index)=><span key={index}>{piece}</span>)}</div><div className={styles.lesson}><span className={styles.lessonTag}>What changed?</span><h2>Your rook reached the open file.</h2><p>Stockfish’s main line now begins with Re1. That move adds pressure without exposing your king.</p><div><span>Position health <b>68</b></span><i><em /></i></div><small>Based on 184,320 Stockfish positions</small></div></div>
      </div>
    </section>
    <section className={styles.loop} id="how"><span>Every move follows one clear loop</span><div><b>1</b><p><strong>Play</strong>Make your own decision.</p><i>→</i><b>2</b><p><strong>Understand</strong>See what changed and why.</p><i>→</i><b>3</b><p><strong>Improve</strong>Build a training path that fits you.</p></div></section>
    <section className={styles.choose} id="choose"><div className={styles.sectionCopy}><span>CHOOSE YOUR SESSION</span><h2>Train at your pace.</h2><p>Start as a guest. Your board, coach and game assistant work immediately.</p></div><div className={styles.modeGrid}>
      <Link href="/play?time=open"><span>LEARN</span><h3>Open practice</h3><p>No clock. Pause, think and use the coach when you need it.</p><b>Play without a clock <i>→</i></b></Link>
      <Link href="/play?time=blitz5"><span>QUICK THINKING</span><h3>5 minute game</h3><p>Five minutes each. Train fast scans without rushing blindly.</p><b>Play 5 minutes <i>→</i></b></Link>
      <Link href="/play?time=rapid10"><span>FOCUS</span><h3>10 minute game</h3><p>Ten minutes each. Enough pressure to practice real decisions.</p><b>Play 10 minutes <i>→</i></b></Link>
      <Link href="/play?time=steady15"><span>DEEP WORK</span><h3>15 + 10 training</h3><p>Fifteen minutes plus ten seconds per move for careful chess.</p><b>Play 15 + 10 <i>→</i></b></Link>
    </div></section>
    <section className={styles.difference}><div><span>WHY IT FEELS DIFFERENT</span><h2>It doesn’t just grade your move.</h2></div><div className={styles.featureGrid}><article><b>A coach that fades away</b><p>Move from position clues to candidate moves only when you need more help.</p></article><article><b>Human pattern prediction</b><p>See likely continuations learned from real games, while Stockfish remains the chess authority.</p></article><article><b>A rival that learns your level</b><p>Strength changes only when results and independent move quality agree.</p></article><article><b>Mistakes return as practice</b><p>Important positions become short exercises until you can solve them yourself.</p></article></div></section>
    <footer><Link className={styles.brand} href="/"><span><i /><i /><i /></span>RivalMind</Link><p>Stockfish calculates. RivalMind teaches.</p><Link href="/play?time=open">Play as guest</Link></footer>
  </main>;
}
