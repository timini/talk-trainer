"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { countdown, minutes, progress, streak, tally, ymd } from "@/lib/schedule";
import { shows } from "@/lib/text";
import {
  checkingLine, deliveryLine, doneLines, exportFile, importFile, kind, lastLine, LEVELS, plural, savedLine, type Script,
  startInfo, todayLine, verdict, weakLine,
} from "@/lib/train";
import { cues } from "@/lib/text";
import { type Attempt, Engine } from "./engine";

export function Trainer({ id }: { id: string }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    fetch(`/api/talks/${id}/script`).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? "There is no such talk." : "The talk could not be loaded.");
      return res.json() as Promise<Script>;
    }).then((script) => {
      if (stop) return;
      const e = new Engine(script);
      setEngine(e);
      void e.pull();
    }).catch((err: Error) => { if (!stop) setError(err.message); });
    return () => { stop = true; };
  }, [id]);
  if (error) return <main className="tr-main"><p role="alert" className="error">{error}</p><Link href="/talks">Back to the talks</Link></main>;
  if (!engine) return <main className="tr-main"><p>Loading the talk</p></main>;
  return <Train engine={engine} />;
}

const EngineContext = createContext<Engine | null>(null);
const useEngine = () => useContext(EngineContext);

function Train({ engine: e }: { engine: Engine }) {
  useSyncExternalStore(e.subscribe, e.snapshot, e.snapshot);
  const [menu, setMenu] = useState(false);

  // Keys: Space speaks, stops or shows; Enter goes on; 1 got it; 3 missed; R hears the sentence; Escape closes.
  useEffect(() => {
    const keys: Record<string, () => void> = {
      " ": () => e.space(), Enter: () => e.enter(), 1: () => e.mark(true), 3: () => e.mark(false), r: () => e.hear(),
      R: () => e.hear(), Escape: () => { setMenu(false); if (e.screen === "stats" || e.screen === "done") e.show("home"); },
    };
    const down = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox")) return;
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

  const status = e.screen === "session" ? `${e.session.done + 1} of ${e.session.done + e.queue}` : e.script.talk.title;
  return (
    <EngineContext.Provider value={e}>
    <div className="trainer" data-screen={e.screen}>
      <header className="tr-head">
        <button type="button" className="name" onClick={() => e.show("home")}>Train</button>
        <span className="status" data-testid="status">{status}</span>
        {e.screen === "session" && <button type="button" className="ghost" onClick={() => e.finish()} aria-label="End session">End</button>}
        <button type="button" className="ghost" aria-expanded={menu} onClick={() => setMenu(!menu)}>Menu</button>
      </header>
      <main className="tr-main">
        {e.screen === "home" && <Home e={e} />}
        {e.screen === "session" && <Session e={e} />}
        {e.screen === "done" && <Done e={e} />}
        {e.screen === "stats" && <Stats e={e} />}
      </main>
      {menu && <Menu e={e} close={() => setMenu(false)} />}
    </div>
    </EngineContext.Provider>
  );
}

function TalkDate({ e }: { e: Engine }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const talkAt = new Date(value).getTime();
    if (!Number.isFinite(talkAt)) return;
    const res = await fetch(`/api/talks/${e.script.talk.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ talkAt }) });
    if (res.ok) e.setTalkAt(talkAt);
    else setNote("The date could not be saved.");
  };
  return (
    <form onSubmit={save} className="card datebox">
      <label htmlFor="talkat">When is the talk? The sessions are planned to it.</label>
      <input id="talkat" type="datetime-local" value={value} onChange={(ev) => setValue(ev.target.value)} required />
      <button type="submit" className="big primary">Save the date</button>
      {note && <p role="alert" className="error">{note}</p>}
    </form>
  );
}

function Home({ e }: { e: Engine }) {
  const now = e.now;
  if (!e.talkAt) return <section className="home"><h1>{e.script.talk.title}</h1><TalkDate e={e} /></section>;
  const p = e.planNow(now);
  const g = progress(e.cards.map((c) => ({ s: c.s, state: e.state(c) })));
  const n = p.queue.length;
  const more = !n && e.cards.some((c) => !e.state(c));
  return (
    <section className="home">
      <p className="countdown">{countdown(now, e.talkAt)}</p>
      <p className={`hstatus ${p.behind ? "behind" : "ontrack"}`}>
        {`${p.behind ? "Behind" : "On track"}: ${g.started} of ${p.total} sentences started, ${p.top} learned`}
      </p>
      <div className="meter"><span style={{ width: `${(100 * g.started) / Math.max(1, p.total)}%` }} /></div>
      <button type="button" className="big primary" disabled={!n} onClick={() => e.start()}>
        {n ? "Start today's session" : "Done for today"}
      </button>
      <p className="sub" data-testid="startinfo">{startInfo(p, minutes(p.queue), now)}</p>
      {more && <button type="button" className="link" onClick={() => e.start(10)}>Learn 10 more sentences now</button>}
      <div className="hprog">
        <h2>Your progress</h2>
        <p data-testid="today">{todayLine(e.get(`train:log:${ymd(now)}`, null), streak(e.get("train:days", []), now),
          e.get("train:last", null), now)}</p>
        <div className="levels" role="img" aria-label={g.levels.map((x, i) => `${LEVELS[i]} ${x}`).join(", ")}>
          {g.levels.map((x, i) => (x ? <span key={i} className={i ? `lv${i - 1}` : ""}
            style={{ width: `${(100 * x) / Math.max(1, e.cards.length)}%` }} /> : null))}
        </div>
        <p className="note key">
          {g.levels.map((x, i) => (x ? <span key={i}><i className={i ? `lv${i - 1}` : "new"} />{`${LEVELS[i]} ${x}`}</span> : null))}
        </p>
        {g.weak.length > 0 && <p>{weakLine(g.weak)}</p>}
        <p className={`note saved${e.sync.state === "error" ? " off" : ""}`} data-testid="saved">{savedLine(e.sync.state, e.sync.at, now)}</p>
      </div>
    </section>
  );
}

// The strip over the card: how the attempt before it went, judged in the background. Tapping it opens the full
// feedback.
function Strip({ a }: { a: Attempt }) {
  const [open, setOpen] = useState(false);
  const line = lastLine(a);
  return (
    <>
      <button type="button" className={`strip ${line.tone}`} data-testid="strip" onClick={() => setOpen(true)}
        disabled={a.checking}>{line.text}</button>
      {open && !a.checking && <LastSheet a={a} close={() => setOpen(false)} />}
    </>
  );
}

function LastSheet({ a, close }: { a: Attempt; close: () => void }) {
  const e = useEngine();
  const r = a.result, j = r?.judge, v = r ? verdict(r) : null;
  return (
    <div className="menu" onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-label="The last card">
        <p className="stitle">{`${a.card.s.n}. ${a.card.s.title}`}</p>
        {r ? <p className="cue small-cue">{r.parts.flatMap((part, pi) => part.words.map((w, wi) => (
          <span key={`${pi}.${wi}`}>{pi || wi ? " " : ""}<span className={!w.ok ? (w.crit ? "miss crit" : "miss") : ""}>{w.w}</span></span>)))}</p>
          : <p className="cue small-cue">{a.card.text}</p>}
        {v && <div className={`verdict ${v.good ? "good" : "bad"}`}>{v.head}<small>{v.detail}</small></div>}
        {!r && <p className="note">{`The judge could not check it: ${a.error}`}</p>}
        {j && (
          <div className="feedback">
            {j.heard && <p className="heard"><b>Heard: </b>{j.heard}</p>}
            <p className="delivery"><b>Delivery: </b>{deliveryLine(j)}</p>
            {j.tip && <p className="tip"><b>Tip: </b>{j.tip}</p>}
          </div>
        )}
        <div className="minor">
          {a.marked !== true && <button type="button" className="small" onClick={() => { e?.recount(a, true); close(); }}>Count it as got</button>}
          {a.marked !== false && <button type="button" className="small" onClick={() => { e?.recount(a, false); close(); }}>Count it as missed</button>}
        </div>
        <button type="button" className="item" onClick={close}>Close</button>
      </div>
    </div>
  );
}

function Session({ e }: { e: Engine }) {
  const c = e.card, v = e.view();
  if (!c || !v) return null;
  const sh = shows(v.lv), r = e.result, phase = e.phase;
  const total = e.session.done + e.queue;
  const before = sh.before && !v.chain && c.i > 0 ? c.s.sentences[c.i - 1].text : "";
  const verdictBox = r && phase === "graded" ? verdict(r) : null;
  const j = r?.judge;
  const label = (name: string, text: string | undefined) => (text ? <p className={name.toLowerCase()}><b>{`${name}: `}</b>{text}</p> : null);
  let cue: React.ReactNode;
  if (r && phase === "graded") {
    cue = r.parts.flatMap((part, pi) => part.words.map((w, wi) => (
      <span key={`${pi}.${wi}`}>{pi || wi ? " " : ""}<span className={!w.ok ? (w.crit ? "miss crit" : "miss") : w.close ? "close" : ""}>{w.w}</span></span>)));
  } else if (phase === "shown" || phase === "failed") cue = v.parts.join(" ");
  else if (v.chain || v.lv < 4) cue = cues(v.parts, v.levels);
  else cue = "Say it from the slide.";
  const letters = phase === "ready" && v.levels[v.levels.length - 1] === 3;
  return (
    <section className="session">
      <div className="track"><span style={{ width: `${(100 * e.session.done) / Math.max(1, total)}%` }} /></div>
      <div className="stage">
        <div className="slidecol">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.s.image && sh.image ? <img src={c.s.image} alt={c.s.title} /> : (
            <div className="noimg">{sh.image ? "No slide image" : "First letters only: no slide"}</div>)}
        </div>
        <div className="cardcol">
          {e.last && <Strip key={e.attempts.length} a={e.last} />}
          <div className="meta">
            <span className="dots" role="img" aria-label={`Level ${v.lv} of 4`} title={`Level ${v.lv} of 4`}>
              {[1, 2, 3, 4].map((i) => <span key={i} className={i <= v.lv ? "on" : ""} />)}
            </span>
            <span data-testid="kind">{kind(v, c, e.state(c))}</span>
          </div>
          <p className="stitle">{`${c.s.n}. ${c.s.title}`}</p>
          {before && <p className="before">{`After: ${before}`}</p>}
          <p className={`cue${letters ? " letters" : ""}${phase === "ready" && !v.chain && v.lv === 4 ? " prompt" : ""}`} data-testid="cue">{cue}</p>
          {phase === "listening" && <p className="heard">Listening. Tap when done.</p>}
          {phase === "judging" && <p className="heard" data-testid="judging">The Gemini judge is listening to your attempt...</p>}
          {verdictBox && (
            <div className={`verdict ${verdictBox.good ? "good" : "bad"}`} data-testid="verdict">
              {verdictBox.head}<small>{verdictBox.detail}</small>
            </div>
          )}
          {j && phase === "graded" && (
            <div className="feedback">
              {label("Heard", j.heard)}
              {label("Delivery", deliveryLine(j))}
              {label("Tip", j.tip)}
            </div>
          )}
          {e.note && <p className="note" role="status">{e.note}</p>}
          <div className="minor">
            {(phase === "graded" || phase === "failed") && <button type="button" className="small" onClick={() => void e.speak()}>Try again</button>}
            {v.clips && phase !== "listening" && <button type="button" className="small" onClick={() => e.hear()}>Hear it</button>}
            {phase === "ready" && e.micOn && <button type="button" className="small" onClick={() => e.reveal()}>Show the words</button>}
            {r && phase === "graded" && (
              <button type="button" className="small" onClick={() => e.mark(!r.pass)}>{r.pass ? "Count it as missed" : "Count it as got"}</button>)}
          </div>
          <div className="actions">
            {e.micOn && (phase === "ready" || phase === "listening") && (
              <button type="button" className={`big primary${phase === "listening" ? " on" : ""}`} onClick={() => e.space()}>
                {phase === "listening" ? "Listening. Tap when done" : "Tap to speak"}
              </button>)}
            {!e.micOn && phase === "ready" && <button type="button" className="big primary" onClick={() => e.reveal()}>Show</button>}
            {(phase === "shown" || phase === "failed") && (
              <div className="pair">
                <button type="button" className="big good" onClick={() => e.mark(true)}>Got it</button>
                <button type="button" className="big bad" onClick={() => e.mark(false)}>Missed</button>
              </div>)}
            {r && phase === "graded" && <button type="button" className="big primary" onClick={() => e.mark(r.pass)}>Next</button>}
          </div>
          <p className="keys">Keys: Space to speak, stop or show. Enter for next. 1 for got it, 3 for missed. R to hear the sentence.</p>
        </div>
      </div>
    </section>
  );
}

function Done({ e }: { e: Engine }) {
  const now = e.now, p = e.planNow(now);
  const [sum, next] = doneLines(e.session, p, now);
  const waiting = e.pending;
  return (
    <section className="stack">
      <h1>Session done</h1>
      {waiting ? <p data-testid="dsum">{checkingLine(waiting)}</p> : <>
        <p data-testid="dsum">{sum}</p>
        <p>{next}</p>
        {p.queue.length > 0 && <button type="button" className="big primary" onClick={() => e.resume()}>
          {`Keep going: ${plural(p.queue.length, "card")} came back`}</button>}
      </>}
      {e.last && <Strip key={e.attempts.length} a={e.last} />}
      <button type="button" className="big primary" onClick={() => e.show("home")}>Back to the start</button>
    </section>
  );
}

function Stats({ e }: { e: Engine }) {
  const [note, setNote] = useState("Export saves your progress as a file. Import adds a file from your other device and keeps the newer review of each sentence.");
  const now = e.now;
  const rows = tally(e.cards.map((c) => ({ section: "Whole talk", words: c.words, level: e.level(c) })));
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportFile(e.script.talk.id, e.items(), Date.now())], { type: "application/json" }));
    a.download = `progress-${ymd(Date.now())}.json`;
    a.click();
    setNote(`Exported ${plural(Object.keys(e.items()).filter((k) => /^train:[^:]+:\d+:/.test(k)).length, "sentence")}.`);
  };
  const load = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const items = importFile(await f.text());
      e.absorb(items);
      e.pushSoon();
      setNote(`Imported ${plural(Object.keys(items).filter((k) => /^train:[^:]+:\d+:/.test(k)).length, "sentence")}.`);
    } catch (err) {
      setNote((err as Error).message);
    }
    ev.target.value = "";
  };
  return (
    <section className="stack">
      <button type="button" className="link back" onClick={() => e.show("home")}>Back</button>
      <h1>Progress</h1>
      <p>{`Streak: ${plural(streak(e.get("train:days", []), now), "day")} in a row.`}</p>
      <table className="grid">
        <thead><tr><th>Part</th><th>New</th><th>0</th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.section}><td>{r.section}</td>{r.sentences.map((x, i) => <td key={i} className="n">{`${x} (${r.words[i]})`}</td>)}</tr>))}
        </tbody>
      </table>
      <p className="note">Sentences at each level, with their words in brackets. A sentence is learned at level 4.</p>
      <div className="pair">
        <button type="button" className="big primary" onClick={save}>Export</button>
        <label className="big primary filebtn">Import<input type="file" accept="application/json,.json" onChange={load} hidden /></label>
      </div>
      <p className="note" role="status">{note}</p>
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
          Gemini, which judges it word for word. The recording is not kept. With it off, say the sentence, tap Show,
          then mark yourself.</p>
        <label className="toggle">
          <input type="checkbox" checked={e.waits} onChange={(ev) => e.setWait(ev.target.checked)} /> Wait for each verdict
        </label>
        <p className="note">Off: the next card comes up at once, and the judge&apos;s verdict on the last one shows in a strip
          over it. On: each card waits for its verdict.</p>
        <button type="button" className="item" onClick={() => { close(); e.show("stats"); }}>Progress, export and import</button>
        <Link className="item" href="/talks">Your talks</Link>
        <button type="button" className="item" onClick={close}>Close</button>
      </div>
    </div>
  );
}
