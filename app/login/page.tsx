import { LoginForm } from "./form";

export const metadata = { title: "Sign in | Talk Trainer" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main>
      <h1>Talk Trainer</h1>
      <p>This is a private beta. Enter the password to go on.</p>
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
