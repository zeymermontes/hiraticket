import { redirect } from "next/navigation";

export default function Home() {
  // Middleware gates auth; authed users land in the full app, others go to /login.
  redirect("/app/Hiraticket.html");
}
