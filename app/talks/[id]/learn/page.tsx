import { Learner } from "./learner";
import "./trainer.css";
import "./learn.css";

export const metadata = { title: "Learn | Talk Trainer" };

export default async function LearnPage({ params }: PageProps<"/talks/[id]/learn">) {
  return <Learner id={(await params).id} />;
}
