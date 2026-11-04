"use client";

import { useState, useTransition } from "react";
import { Panel, buttonStyles } from "@/components/app/ui";
import { createPaymentAction } from "../../actions";

const field =
  "mt-1.5 w-full rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[17px] text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

const METHODS = [
  ["p2p", "PayPal, as usual"],
  ["gift_card", "Gift cards"],
  ["crypto", "Cryptocurrency"],
  ["bank_transfer", "A bank transfer"],
] as const;

export function NewPaymentForm() {
  const [form, setForm] = useState({ payeeName: "", payeeEmail: "", amount: "", method: "p2p", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createPaymentAction(form);
          if (r && !r.ok) setError(r.message);
        });
      }}
    >
      <Panel className="space-y-4">
        <label className="block text-[16px] font-semibold">
          Who are you paying?
          <input className={field} required value={form.payeeName} onChange={set("payeeName")} autoComplete="off" />
        </label>
        <label className="block text-[16px] font-semibold">
          Their PayPal email
          <input className={field} required type="email" value={form.payeeEmail} onChange={set("payeeEmail")} autoComplete="off" />
        </label>
        <label className="block text-[16px] font-semibold">
          Amount (US dollars)
          <input className={field} required inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set("amount")} />
        </label>
        <label className="block text-[16px] font-semibold">
          How did they ask to be paid?
          <select className={field} value={form.method} onChange={set("method")}>
            {METHODS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[16px] font-semibold">
          What did they say? <span className="font-normal text-ink-soft">(optional)</span>
          <textarea
            className={`${field} resize-y`}
            rows={3}
            maxLength={500}
            placeholder="Paste or type their message, if there was one."
            value={form.note}
            onChange={set("note")}
          />
        </label>
        <p className="text-[14px] text-ink-soft">Their message helps us spot scams. We only use it to check this payment.</p>
      </Panel>
      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-[#FCEFD9] px-4 py-3 text-[16px] text-amber-ink">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} mt-5`}>
        {pending ? "Checking it…" : "Check and send"}
      </button>
    </form>
  );
}
