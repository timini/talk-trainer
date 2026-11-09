"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { TROUBLE_HIGH, TROUBLE_LOW } from "@/lib/learn/rules";
import { countdown } from "@/lib/schedule";
import { redactBits } from "@/lib/text";
import { deliveryLine, plural, savedLine, type Script, verdict } from "@/lib/train";
import { browser, Engine } from "./engine";

export function Learner({ id }: { id: string }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    fetch(`/api/talks/${id}/script`).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? "There is no such talk." : "The talk could not be loaded.");
      return res.json() as Promise<Script>;
    }).then((script) => {
      if (stop) return;
      const e = new Engine(script, browser());
      setEngine(e);
      void e.pull();
    }).catch((err: Error) => { if (!stop) setError(err.message); });
    return () => { stop = true; };
  }, [id]);
  if (error) return <main className="tr-main"><p role="alert" className="error">{error}</p><Link href="/talks">Back to the talks</Link></main>;
  if (!engine) return <main className="tr-main"><p>Loading the talk</p></main>;
  return <Learn engine={engine} />;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Learn({ engine: e }: { engine: Engine }) {
  useSyncExternalStore(e.subscribe, e.snapshot, e.snapshot);
  const [menu, setMenu] = useState(false);

  // Keys: Space is the big button; Enter goes on after a verdict; 1 got it and 3 missed when marking yourself;
  // R hears it; Escape closes the menu.
  useEffect(() => {
    const keys: Record<string, () => void> = {
      " ": () => e.space(), Enter: () => { if (e.phase === "judged" || e.screen !== "session") e.space(); },
      1: () => e.mark(true), 3: () => e.mark(false), r: () => e.hear(), R: () => e.hear(), Escape: () => setMenu(false),
    };
    const down = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox"
        && (t as HTMLInputElement).type !== "radio")) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const act = keys[ev.key];
      if (!act) return;
      ev.preventDefault();
      if (t !== document.body) t.blur?.();
      act();
    };
    const hide = () => e.pagehide();
    document.addEventListener("keydown", down);
    window.addEventListener("pagehide", hide);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("pagehide", hide);
      e.halt();
    };
  }, [e]);

  const sum = e.summary(), node = e.node;
  const status = e.screen === "session" && node
    ? `${e.item?.why === "due" ? "Again: slide" : "Slide"} ${node.slides[e.isRun ? e.at : 0]} of ${e.slides.length}${e.aim === "gist" ? " (gist)" : ""}`
    : e.script.talk.title;
  return (
    <div className="trainer" data-screen={e.screen}>
      <header className="tr-head">
        <button type="button" className="name" onClick={() => e.show("home")}>Learn</button>
        <span className="status" data-testid="status">{status}</span>
        {e.screen === "session" && <button type="button" className="ghost" onClick={() => e.show("home")} aria-label="End session">End</button>}
        <button type="button" className="ghost" aria-expanded={menu} onClick={() => setMenu(!menu)}>Menu</button>
      </header>
      {e.screen === "session" && (
        <div className="learnbar" role="img" aria-label={`${sum.at} of ${sum.total} slides at the aim`}>
          <span style={{ width: `${(100 * sum.at) / Math.max(1, sum.total)}%` }} />
        </div>
      )}
      <main className="tr-main">
        {e.screen === "home" && <Home e={e} />}
        {e.screen === "session" && <Card e={e} />}
        {e.screen === "progress" && <Progress e={e} />}
        {e.screen === "done" && (
          <section className="stack" data-testid="goal-reached">
            <h1>{`Goal reached: slides 1 to ${Math.min(e.goal, e.slides.length)}${e.aim === "gist" ? " at the gist" : " word for word"}`}</h1>
            <p>Nothing up to there is due now. What you know fades over time and comes back with some text showing.</p>
            {e.goal < e.slides.length && (
              <button type="button" className="big primary" onClick={() => { e.setGoal(e.goal + 10); e.start(); }}>
                {`Carry on to slide ${Math.min(e.goal + 10, e.slides.length)}`}</button>)}
            <button type="button" className="big" onClick={() => e.show("home")}>Back to the start</button>
          </section>
        )}
      </main>
      {menu && <Menu e={e} close={() => setMenu(false)} />}
    </div>
  );
}

function Home({ e }: { e: Engine }) {
  const now = e.now, sum = e.summary(), days = e.days, next = e.next;
  return (
    <section className="home">
      <h1>{e.script.talk.title}</h1>
      {e.script.talk.talkAt && <p className="countdown">{countdown(now, e.script.talk.talkAt)}</p>}
      <p className="hstatus" data-testid="learned">{`${sum.at} of ${plural(sum.total, "slide")} at the aim`}</p>
      <div className="meter"><span style={{ width: `${(100 * sum.at) / Math.max(1, sum.total)}%` }} /></div>
      <div className="aim" role="radiogroup" aria-label="Aim">
        <label><input type="radio" name="aim" checked={e.aim === "gist"} onChange={() => e.setAim("gist")} />
          {" "}Get the gist: each slide with the meaning right, at most half hidden</label>
        <label><input type="radio" name="aim" checked={e.aim === "verbatim"} onChange={() => e.setAim("verbatim")} />
          {" "}Word for word: each slide said with every word hidden</label>
      </div>
      <label className="goal">Today, up to slide{" "}
        <input type="number" min={1} max={e.slides.length} value={e.goal} aria-label="Up to slide"
          onChange={(ev) => e.setGoal(Number(ev.target.value))} />
        {` of ${e.slides.length}`}</label>
      <button type="button" className="big primary" onClick={() => e.start()}>Start</button>
      <div className="hprog">
        {sum.due > 0 && <p data-testid="due">{`${plural(sum.due, "part")} to go over again first: faded since you last said ${sum.due === 1 ? "it" : "them"}.`}</p>}
        {next && <p data-testid="from">{`${sum.due ? "Then new slides from" : "New slides from"} slide ${next.n}: ${next.title}.`}</p>}
        {days > 0 && <p>{`Streak: ${plural(days, "day")} in a row.`}</p>}
        <p className={`note saved${e.sync.state === "error" ? " off" : ""}`} data-testid="saved">{savedLine(e.sync.state, e.sync.at, now)}</p>
        <button type="button" className="link" onClick={() => e.show("progress")}>Progress</button>
      </div>
    </section>
  );
}

function Progress({ e }: { e: Engine }) {
  const m = e.progress(), sum = e.summary();
  const rate = (r: { n: number; rate: number | null }) => (r.rate === null ? "no attempts yet" : `${pct(r.rate)} of ${r.n}`);
  return (
    <section className="stack progress" data-testid="progress">
      <h1>Progress</h1>
      <dl>
        <dt>Slides at the aim</dt><dd data-testid="p-slides">{`${sum.at} of ${sum.total}`}</dd>
        <dt>Passed this session</dt>
        <dd data-testid="p-session">{`${rate(m.session)} (the aim is ${pct(m.session.low)} to ${pct(m.session.high)})`}</dd>
        <dt>Retention</dt><dd data-testid="p-retention">{`${rate(m.retention)} passed after a gap of more than 30 minutes`}</dd>
        <dt>Attempts to the bar</dt>
        <dd data-testid="p-tobar">{m.toBar.length ? m.toBar.map((x) => `${x.kind}: ${x.median} (${plural(x.nodes, "part")})`).join("; ") : "none yet"}</dd>
        <dt>Weakest phrases</dt>
        <dd data-testid="p-weakest">{m.weakest.length ? m.weakest.map((x) => `slide ${x.slide}: '${x.phrase}'`).join("; ") : "none yet"}</dd>
        <dt>Most attempts</dt>
        <dd data-testid="p-slowest">{m.slowest.length ? m.slowest.map((x) => `slide ${x.slide} ${x.kind}: ${x.attempts}${x.reached ? "" : ", not yet"}`).join("; ") : "none yet"}</dd>
      </dl>
      <button type="button" className="big" onClick={() => e.show("home")}>Back to the start</button>
    </section>
  );
}

function Card({ e }: { e: Engine }) {
  const item = e.item, node = e.node;
  if (!item || !node) return null;
  const phase = e.phase, r = e.result, share = e.share;
  const v = r && phase === "judged" ? verdict(r) : null, j = r?.judge;
  const clips = e.clips(), slide = e.isRun ? e.runSlide : e.slides.find((s) => s.n === node.slides[0]);
  let words: React.ReactNode = null;
  if (e.isRun) {
    words = (
      <ol className="runs">
        {node.slides.map((n, k) => {
          const s = e.slides.find((x) => x.n === n);
          const done = e.saidDone.get(n);
          return <li key={n} className={k === e.at && phase === "listening" ? "on" : k < e.at ? "done" : ""}>
            {`Slide ${n}: ${s?.sentences[0]?.text.split(/\s+/).slice(0, 3).join(" ")}...`}
            {done && ` ${done.points}${done.why ? ` (${done.why})` : ""}`}</li>;
        })}
      </ol>);
  } else if (r && phase === "judged") {
    // each word shaded by the trouble it has given (low, high), and this attempt's misses underlined in bold
    const t = e.troubles(), base = r.parts.map((_, pi) => r.parts.slice(0, pi).reduce((a, p) => a + p.words.length, 0));
    words = <>
      {r.parts.flatMap((part, pi) => part.words.map((w, wi) => {
        const k = base[pi] + wi;
        const shade = t[k] >= TROUBLE_HIGH ? "t-high" : t[k] >= TROUBLE_LOW ? "t-low" : "";
        return <span key={`${pi}.${wi}`}>{pi || wi ? " " : ""}
          <span className={[!w.ok ? (w.crit ? "miss crit" : "miss") : "", shade].filter(Boolean).join(" ")}>{w.w}</span></span>;
      }))}
      {t.some((x) => x >= TROUBLE_LOW) && <small className="legend">Shaded: words that have given you trouble, darker for more.
        Underlined: missed this time.</small>}
    </>;
  } else {
    // each leaf hidden by its own score; its terms in full, by their first letter, or hidden; the opening words of
    // the node and its parts shown until it is passed. A hidden word is drawn as itself, invisible, over a line.
    let last = -1, slideAt = node.slides[0];
    words = e.lines().map((l) => {
      const change = l.slide !== slideAt;
      slideAt = l.slide;
      const num = l.sentence !== last || change;
      last = l.sentence;
      const bits = redactBits(l.text, l.share, l.keep, [], l.seed, l.initial);
      return (
        <span key={l.id} className="leaf sent">
          {change && <span className="change">{`Next slide: ${l.slide}`}</span>}
          {num && <sup>{l.sentence + 1}</sup>}
          {bits.map((b, bi) => (b.kind === "text" ? b.t : b.kind === "word" ? <span key={bi}>{b.t}</span>
            : b.kind === "hidden" ? <span key={bi} className="gap">{b.t}</span>
            : <span key={bi}>{b.t[0]}<span className="gap">{b.t.slice(1)}</span></span>))}
        </span>);
    });
  }
  const label = (name: string, value: string | undefined) => (value ? <p className={name.toLowerCase()}><b>{`${name}: `}</b>{value}</p> : null);
  const k = e.known, up = k?.after != null && k.after >= k.before;
  return (
    <section className="session">
      <div className="stage">
        <div className="slidecol">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {slide?.image ? <img src={slide.image} alt={slide.title} /> : <div className="noimg">No slide image</div>}
        </div>
        <div className="cardcol" data-testid="card">
          <p className="instruction" data-testid="instruction">{e.instruction}</p>
          <p className="stitle">{slide ? `${slide.n}. ${slide.title}` : ""}</p>
          <p className="position" data-testid="position">{e.position}</p>
          {e.crumbs.length > 1 && <p className="crumbs" data-testid="crumbs">{e.crumbs.join(" > ")}</p>}
          {words !== null && <div className={`cue${share > 0 && phase !== "judged" && phase !== "shown" ? " letters" : ""}`} data-testid="cue">{words}</div>}
          {phase === "listening" && <p className="heard">{e.isRun ? "Listening. Tap Next slide when you move on." : "Listening. Tap when you have finished."}</p>}
          {phase === "checking" && <p className="heard" data-testid="checking">Checking...</p>}
          {phase === "judged" && e.points !== null && (
            <div className={`verdict ${e.counted ? "good" : "bad"}`} data-testid="verdict">
              {v ? v.head : e.counted ? "Got it" : "Missed"}
              <small>{`Score ${e.points}. ${v ? v.detail : ""}`}</small>
              {v?.note && <small className="quiet">{v.note}</small>}
              {r && e.counted !== r.pass && <small className="quiet">{`Counted as ${e.counted ? "got" : "missed"}.`}</small>}
            </div>
          )}
          {phase === "judged" && k && k.after !== null && (
            <p className={`known ${up ? "up" : "down"}`} data-testid="known">
              {`Known ${pct(k.before)} to ${pct(k.after)}; the bar is ${pct(k.bar)}.`}</p>)}
          {j && phase === "judged" && (
            <div className="feedback">
              {label("Heard", j.heard)}
              {label("Delivery", deliveryLine(j))}
              {label("Tip", j.tip)}
            </div>
          )}
          {e.note && <p className="note" role="status">{e.note}</p>}
          <div className="actions">
            <div className="minor">
              {clips && phase !== "listening" && <button type="button" className="small" onClick={() => e.hear()}>Hear it</button>}
              {phase === "judged" && e.counted === false && (
                <button type="button" className="small" onClick={() => e.recount(true)}>Count it as got</button>)}
              {phase === "judged" && e.counted === true && (
                <button type="button" className="small" onClick={() => e.recount(false)}>Count it as missed</button>)}
              {phase === "ready" && !e.isRun && share > 0 && <button type="button" className="small" onClick={() => e.showMe()}>Show me</button>}
              {phase === "ready" && !e.isRun && <button type="button" className="small" onClick={() => e.knowIt()}>I know this one</button>}
            </div>
            {phase === "ready" && e.micOn && <button type="button" className="big primary" onClick={() => e.space()}>Tap to speak</button>}
            {phase === "ready" && !e.micOn && <button type="button" className="big primary" onClick={() => e.reveal()}>Show the words</button>}
            {phase === "listening" && !e.isRun && <button type="button" className="big primary on" onClick={() => e.space()}>Tap to stop</button>}
            {phase === "listening" && e.isRun && (
              <button type="button" className="big primary on" onClick={() => e.space()}>
                {e.at < node.slides.length - 1 ? "Next slide" : "Tap to stop"}</button>)}
            {phase === "checking" && <button type="button" className="big primary" disabled>Checking...</button>}
            {phase === "judged" && <button type="button" className="big primary" onClick={() => e.go()}>Next</button>}
            {phase === "failed" && (
              <div className="pair">
                <button type="button" className="big primary" onClick={() => e.retry()}>Try again</button>
                <button type="button" className="big good" onClick={() => e.mark(true)}>Got it</button>
              </div>)}
            {phase === "shown" && (
              <div className="pair">
                <button type="button" className="big good" onClick={() => e.mark(true)}>Got it</button>
                <button type="button" className="big bad" onClick={() => e.mark(false)}>Missed</button>
              </div>)}
          </div>
          <p className="keys">Keys: Space to speak, stop or go on. R to hear it.</p>
        </div>
      </div>
    </section>
  );
}

function Menu({ e, close }: { e: Engine; close: () => void }) {
  return (
    <div className="menu" onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-label="Menu">
        <label className="toggle">
          <input type="checkbox" checked={e.micOn} onChange={(ev) => e.setMic(ev.target.checked)} /> Use microphone
        </label>
        <p className="note">With the microphone on, each attempt is recorded and sent through this site to Google&apos;s
          Gemini, which checks that the meaning came through. With it off, say it, tap Show the words, then mark
          yourself.</p>
        <button type="button" className="item" onClick={() => { close(); e.show("progress"); }}>Progress</button>
        <Link className="item" href={`/talks/${e.script.talk.id}/train`}>The old trainer</Link>
        <Link className="item" href="/talks">Your talks</Link>
        <button type="button" className="item" onClick={close}>Close</button>
      </div>
    </div>
  );
}
