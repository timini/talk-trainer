"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { clipsOf, header, INSTRUCTIONS, nextLabel, textOf } from "@/lib/flow";
import { countdown, streak } from "@/lib/schedule";
import { hide } from "@/lib/text";
import { deliveryLine, plural, savedLine, type Script, verdict } from "@/lib/train";
import { Engine } from "./engine";

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

function Train({ engine: e }: { engine: Engine }) {
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

  const sum = e.summary();
  const status = e.screen === "session" && e.item ? header(e.item, e.slides.length) : e.script.talk.title;
  return (
    <div className="trainer" data-screen={e.screen}>
      <header className="tr-head">
        <button type="button" className="name" onClick={() => e.show("home")}>Train</button>
        <span className="status" data-testid="status">{status}</span>
        {e.screen === "session" && <button type="button" className="ghost" onClick={() => e.show("home")} aria-label="End session">End</button>}
        <button type="button" className="ghost" aria-expanded={menu} onClick={() => setMenu(!menu)}>Menu</button>
      </header>
      {e.screen === "session" && (
        <div className="learnbar" role="img" aria-label={`${sum.learned} of ${sum.total} slides learned`}>
          <span style={{ width: `${(100 * sum.learned) / Math.max(1, sum.total)}%` }} />
        </div>
      )}
      <main className="tr-main">
        {e.screen === "home" && <Home e={e} />}
        {e.screen === "session" && <Card e={e} />}
        {e.screen === "done" && (
          <section className="stack">
            <h1>Every slide is learned</h1>
            <p>Come back tomorrow for the warm-up: each slide said once from the slide alone.</p>
            <button type="button" className="big primary" onClick={() => e.show("home")}>Back to the start</button>
          </section>
        )}
      </main>
      {menu && <Menu e={e} close={() => setMenu(false)} />}
    </div>
  );
}

function Home({ e }: { e: Engine }) {
  const now = e.now, sum = e.summary(), days = streak(e.get("train:days", []), now);
  const todo = sum.warm > 0 || !!sum.from;
  return (
    <section className="home">
      <h1>{e.script.talk.title}</h1>
      {e.talkAt && <p className="countdown">{countdown(now, e.talkAt)}</p>}
      <p className="hstatus" data-testid="learned">{`${sum.learned} of ${plural(sum.total, "slide")} learned`}</p>
      <div className="meter"><span style={{ width: `${(100 * sum.learned) / Math.max(1, sum.total)}%` }} /></div>
      <button type="button" className="big primary" disabled={!todo} onClick={() => e.start()}>
        {todo ? "Start" : "Every slide is learned"}
      </button>
      <div className="hprog">
        {sum.warm > 0 && <p data-testid="warm">{`Warm up: ${plural(sum.warm, "slide")} learned before today, each said once from the slide.`}</p>}
        {sum.from && <p data-testid="from">{`${sum.warm ? "Then new slides from" : "Start at"} slide ${sum.from.n}: ${sum.from.title}.`}</p>}
        {days > 0 && <p>{`Streak: ${plural(days, "day")} in a row.`}</p>}
        <p className={`note saved${e.sync.state === "error" ? " off" : ""}`} data-testid="saved">{savedLine(e.sync.state, e.sync.at, now)}</p>
      </div>
    </section>
  );
}

function Card({ e }: { e: Engine }) {
  const item = e.item;
  if (!item) return null;
  const u = item.unit, step = item.step, phase = e.phase, r = e.result, text = textOf(u);
  const v = r && phase === "judged" ? verdict(r) : null, j = r?.judge;
  const clips = clipsOf(u);
  let words: React.ReactNode = null;
  if (r && phase === "judged") {
    words = r.parts.flatMap((part, pi) => part.words.map((w, wi) => (
      <span key={`${pi}.${wi}`}>{pi || wi ? " " : ""}<span className={!w.ok ? (w.crit ? "miss crit" : "miss") : ""}>{w.w}</span></span>)));
  } else if (phase === "shown" || phase === "failed" || step === 1) words = text;
  else if (step === 2) words = hide(text, e.focus);
  const label = (name: string, value: string | undefined) => (value ? <p className={name.toLowerCase()}><b>{`${name}: `}</b>{value}</p> : null);
  return (
    <section className="session">
      <div className="stage">
        <div className="slidecol">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {u.slide.image ? <img src={u.slide.image} alt={u.slide.title} /> : <div className="noimg">No slide image</div>}
        </div>
        <div className="cardcol" data-testid="card">
          <p className="instruction" data-testid="instruction">{INSTRUCTIONS[step]}</p>
          <p className="stitle">{`${u.slide.n}. ${u.slide.title}`}</p>
          {words !== null && <p className={`cue${step === 2 && phase !== "judged" && phase !== "shown" && phase !== "failed" ? " letters" : ""}`} data-testid="cue">{words}</p>}
          {phase === "listening" && <p className="heard">Listening. Tap when you have finished.</p>}
          {phase === "checking" && <p className="heard" data-testid="checking">Checking...</p>}
          {v && (
            <div className={`verdict ${v.good ? "good" : "bad"}`} data-testid="verdict">
              {v.head}<small>{v.detail}</small>
              {v.note && <small className="quiet">{v.note}</small>}
              {step === 1 && !v.good && <small className="quiet">Reading it is practice: on to the first letters.</small>}
              {e.counted !== null && e.counted !== r?.pass && <small className="quiet">{`Counted as ${e.counted ? "got" : "missed"}.`}</small>}
            </div>
          )}
          {j && phase === "judged" && (
            <div className="feedback">
              {label("Heard", j.heard)}
              {label("Delivery", deliveryLine(j))}
              {label("Tip", j.tip)}
            </div>
          )}
          {e.note && <p className="note" role="status">{e.note}</p>}
          <div className="minor">
            {clips && phase !== "listening" && <button type="button" className="small" onClick={() => e.hear()}>Hear it</button>}
            {phase === "judged" && step > 1 && e.counted === false && (
              <button type="button" className="small" onClick={() => e.recount(true)}>Count it as got</button>)}
            {phase === "judged" && step > 1 && e.counted === true && r && !r.pass && (
              <button type="button" className="small" onClick={() => e.recount(false)}>Count it as missed</button>)}
            {phase === "ready" && step === 3 && !item.warm && <button type="button" className="small" onClick={() => e.showMe()}>Show me first</button>}
            {phase === "ready" && e.micOn && step > 1 && <button type="button" className="small" onClick={() => e.reveal()}>Show the words</button>}
          </div>
          <div className="actions">
            {phase === "ready" && e.micOn && <button type="button" className="big primary" onClick={() => e.space()}>Tap to speak</button>}
            {phase === "ready" && !e.micOn && <button type="button" className="big primary" onClick={() => e.reveal()}>Show the words</button>}
            {phase === "listening" && <button type="button" className="big primary on" onClick={() => e.space()}>Tap to stop</button>}
            {phase === "checking" && <button type="button" className="big primary" disabled>Checking...</button>}
            {phase === "judged" && (
              <button type="button" className="big primary" onClick={() => e.go()}>{nextLabel(item, e.counted ?? false)}</button>)}
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
        <Link className="item" href="/talks">Your talks</Link>
        <button type="button" className="item" onClick={close}>Close</button>
      </div>
    </div>
  );
}
