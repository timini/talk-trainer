"use client";

import { useEffect, useState } from "react";

type Talk = { id: string; title: string; status: string; slides: number; sentences: number; images: number;
  voiced: number; error: string | null };
type Status = Talk & { noNotes: number[]; log: { step: string; message: string }[] };

const BUILDING = new Set(["queued", "parsing", "rendering", "voicing"]);

// The build status in words.
export const describe = (t: Talk) => ({
  queued: "Waiting to start",
  parsing: "Reading the deck",
  rendering: `Rendering ${t.slides} slides`,
  voicing: `Voicing ${t.voiced} of ${t.sentences}`,
  ready: `Ready: ${t.slides} slides, ${t.sentences} sentences`,
  failed: `Failed: ${t.error ?? "unknown error"}`,
}[t.status] ?? t.status);

function TalkRow({ talk }: { talk: Talk }) {
  const [s, setS] = useState<Status | null>(null);
  const building = BUILDING.has((s ?? talk).status);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const res = await fetch(`/api/talks/${talk.id}`);
      if (!stop && res.ok) setS(await res.json() as Status);
    };
    poll();
    const timer = building ? setInterval(poll, 2000) : undefined;
    return () => { stop = true; clearInterval(timer); };
  }, [talk.id, building]);
  const t = s ?? talk;
  return (
    <li className="talk" data-testid="talk">
      <strong>{t.title}</strong>
      <span className="status" data-status={t.status}>{describe(t)}</span>
      {s && s.noNotes.length > 0 && (
        <span className="warn">Slides with no notes (no script): {s.noNotes.join(", ")}</span>
      )}
      {s && building && s.log.length > 0 && <span className="small">{s.log[s.log.length - 1].message}</span>}
    </li>
  );
}

export function Talks() {
  const [talks, setTalks] = useState<Talk[] | null>(null);
  const [title, setTitle] = useState("");
  const [deck, setDeck] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let stop = false;
    fetch("/api/talks").then((res) => (res.ok ? res.json() as Promise<{ talks: Talk[] }> : null))
      .then((got) => { if (!stop && got) setTalks(got.talks); });
    return () => { stop = true; };
  }, [version]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deck) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/talks", { method: "POST", body: deck,
      headers: { "Content-Type": deck.type || "application/octet-stream",
        "X-Title": encodeURIComponent(title || deck.name.replace(/\.pptx$/i, "")) } });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({})) as { error?: string }).error ?? `Upload failed (${res.status}).`); return; }
    setTitle("");
    setDeck(null);
    (e.target as HTMLFormElement).reset();
    setVersion((v) => v + 1);
  };

  return (
    <>
      <form onSubmit={send} className="card">
        <label htmlFor="deck">Deck (.pptx, with the script in the speaker notes)</label>
        <input id="deck" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={(e) => setDeck(e.target.files?.[0] ?? null)} required />
        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The deck's file name" />
        <button type="submit" disabled={busy || !deck}>{busy ? "Uploading" : "Upload"}</button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      <h2>Your talks</h2>
      {talks === null ? <p>Loading</p> : talks.length === 0 ? <p>No talks yet.</p> : (
        <ul className="talks">{talks.map((t) => <TalkRow key={t.id} talk={t} />)}</ul>
      )}
    </>
  );
}
