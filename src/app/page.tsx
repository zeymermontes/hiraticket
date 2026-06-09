import { redirect } from "next/navigation";

export default function Home() {
  // Middleware gates auth; authed users land on Chat, others go to /login.
  redirect("/chat");
}
