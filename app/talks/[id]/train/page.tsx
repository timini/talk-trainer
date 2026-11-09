import { Trainer } from "./trainer";
import "./train.css";

export const metadata = { title: "Train | Talk Trainer" };

export default async function TrainPage({ params }: PageProps<"/talks/[id]/train">) {
  return <Trainer id={(await params).id} />;
}
