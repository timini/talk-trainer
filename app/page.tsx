import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Talk Trainer</h1>
      <p>You are signed in. The trainer is coming: upload a talk, then learn it sentence by sentence.</p>
      <p><Link href="/talks">Your talks</Link></p>
    </main>
  );
}
