import { redirect } from "next/navigation";

// The old trainer is gone: its address opens the trainer, which reads its saved progress once.
export default async function TrainPage({ params }: PageProps<"/talks/[id]/train">) {
  redirect(`/talks/${(await params).id}/learn`);
}
