"use client";

import { useState, useTransition } from "react";
import { Panel, buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";
import { createPaymentAction } from "../../actions";

const field =
  "mt-1.5 w-full min-h-[56px] rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[18px] font-normal text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

export function NewPaymentForm() {
  const t = useT();
  const methods = [
    ["p2p", t.payment.methodP2p],
    ["gift_card", t.payment.methodGiftCard],
    ["crypto", t.payment.methodCrypto],
    ["bank_transfer", t.payment.methodBank],
  ] as const;
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
          // Accept "42,50" as well as "42.50": many of our readers write money with a comma.
          const r = await createPaymentAction({ ...form, amount: form.amount.trim().replace(/^(\d+),(\d{1,2})$/, "$1.$2") });
          if (r && !r.ok) setError(r.message);
        });
      }}
    >
      <Panel className="space-y-5">
        <label className="block text-[18px] font-semibold">
          {t.payment.whoPaying}
          <input className={field} required value={form.payeeName} onChange={set("payeeName")} autoComplete="off" />
        </label>
        <label className="block text-[18px] font-semibold">
          {t.payment.theirEmail}
          <input className={field} required type="email" value={form.payeeEmail} onChange={set("payeeEmail")} autoComplete="off" />
        </label>
        <label className="block text-[18px] font-semibold">
          {t.payment.amount}
          <input className={field} required inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set("amount")} />
        </label>
        <fieldset>
          <legend className="text-[18px] font-semibold">{t.payment.howAsked}</legend>
          <div className="mt-2 grid gap-2">
            {methods.map(([v, label]) => (
              <label
                key={v}
                className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl px-4 text-[18px] ${form.method === v ? "bg-sage/70 shadow-[inset_0_0_0_2px_#2E5E45]" : "bg-white/80 shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)]"}`}
              >
                <input type="radio" name="method" value={v} checked={form.method === v} onChange={set("method")} className="h-6 w-6 accent-[#2E5E45]" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-[18px] font-semibold">
          {t.payment.whatSaid} <span className="font-normal text-ink-soft">{t.payment.optional}</span>
          <textarea
            className={`${field} resize-y`}
            rows={3}
            maxLength={500}
            placeholder={t.payment.whatSaidPlaceholder}
            value={form.note}
            onChange={set("note")}
          />
        </label>
        <p className="text-[16px] text-ink-soft">{t.payment.whatSaidHelp}</p>
      </Panel>
      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-[#FCEFD9] px-4 py-3 text-[17px] text-amber-ink">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} mt-5`}>
        {pending ? t.payment.checkingIt : t.payment.checkAndSend}
      </button>
    </form>
  );
}
