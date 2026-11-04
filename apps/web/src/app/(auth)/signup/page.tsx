import Link from "next/link";
import { redirect } from "next/navigation";
import { Heading, Panel } from "@/components/app/ui";
import { currentUser } from "@/server/auth";
import { SignUpForm } from "../PasskeyForms";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await currentUser()) redirect("/home");
  return (
    <div className="space-y-6">
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Set up Legacy Protection</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">For your own PayPal account. Takes about a minute.</p>
      </div>
      <Panel>
        <SignUpForm />
      </Panel>
      <p className="text-center text-[16px]">
        Already set up?{" "}
        <Link href="/signin" className="font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
