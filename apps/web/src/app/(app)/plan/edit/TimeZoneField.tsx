"use client";

import { useId, useMemo, useState } from "react";

/** Common zones first, in words people use; every IANA zone is one tap away. */
const COMMON: ReadonlyArray<[string, string]> = [
  ["America/New_York", "Eastern Time (New York)"],
  ["America/Chicago", "Central Time (Chicago)"],
  ["America/Denver", "Mountain Time (Denver)"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific Time (Los Angeles)"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["Europe/London", "UK (London)"],
  ["Asia/Kolkata", "India"],
  ["Australia/Sydney", "Sydney"],
];

function longName(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(0).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

export function TimeZoneField({ value, onChange, className }: { value: string; onChange: (tz: string) => void; className: string }) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const all = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return COMMON.map(([z]) => z);
    }
  }, []);
  const known = COMMON.some(([z]) => z === value);
  const options: Array<[string, string]> = showAll
    ? all.map((z) => [z, z.replaceAll("_", " ")])
    : [...(known ? [] : ([[value, `${longName(value)} (${value.replaceAll("_", " ")})`]] as Array<[string, string]>)), ...COMMON];

  return (
    <div>
      <label htmlFor={id} className="block text-[16px] font-semibold">
        Your time zone
      </label>
      <p className="text-[14px] text-ink-soft">So we check in with you at the right time of day, even when the clocks change.</p>
      <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([z, label]) => (
          <option key={z} value={z}>
            {label}
          </option>
        ))}
      </select>
      {!showAll && (
        <button type="button" className="mt-2 text-[15px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[5px]" onClick={() => setShowAll(true)}>
          My time zone isn’t listed
        </button>
      )}
    </div>
  );
}
