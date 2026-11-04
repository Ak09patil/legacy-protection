import Link from "next/link";
import { redirect } from "next/navigation";
import { Heading, Panel } from "@/components/app/ui";
import { currentUser } from "@/server/auth";
import { SignInButton } from "../PasskeyForms";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await currentUser()) redirect("/home");
  return (
    <div className="space-y-6">
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Welcome back</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">Use the same fingerprint, face or screen lock you set up with.</p>
      </div>
      <Panel>
        <SignInButton />
      </Panel>
      <p className="text-center text-[16px]">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          Set up protection
        </Link>
      </p>
    </div>
  );
}
