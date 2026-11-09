import { Talks } from "./talks";

export const metadata = { title: "Talks | Talk Trainer" };

export default function TalksPage() {
  return (
    <main>
      <h1>Talks</h1>
      <p>Upload a deck. Each sentence of the speaker notes becomes a card, with the slide and a voice clip.</p>
      <Talks />
    </main>
  );
}
