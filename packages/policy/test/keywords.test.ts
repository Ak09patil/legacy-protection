import { describe, expect, it } from "vitest";
import { keywordLabels } from "../src/index.js";

describe("keyword labeller", () => {
  it("labels the classic tech-support gift card script", () => {
    expect(keywordLabels("Buy gift cards today to unlock your account")).toEqual(
      expect.arrayContaining(["GIFT_CARD_REQUEST", "URGENCY", "IMPERSONATION_TECH_SUPPORT"]),
    );
  });
  it("labels a grandparent scam", () => {
    expect(keywordLabels("Grandma it's me, I'm in jail and need bail money right now")).toEqual(
      expect.arrayContaining(["IMPERSONATION_FAMILY", "URGENCY"]),
    );
  });
  it.each([
    ["DRINGEND: Kaufen Sie heute Geschenkkarten, sonst wird Ihr Konto gesperrt.", ["GIFT_CARD_REQUEST", "URGENCY", "IMPERSONATION_TECH_SUPPORT"]],
    ["Oma, ich bin's! Ich habe mein Handy verloren, das ist meine neue Nummer. Ich brauche sofort Geld.", ["IMPERSONATION_FAMILY", "URGENCY"]],
    ["Hier ist die Polizei. Gegen Sie liegt ein Haftbefehl vor. Zahlen Sie in Bitcoin.", ["IMPERSONATION_GOVERNMENT", "CRYPTO_REQUEST"]],
    ["URGENTE: compre tarjetas regalo hoy mismo o su cuenta será bloqueada.", ["GIFT_CARD_REQUEST", "URGENCY", "IMPERSONATION_TECH_SUPPORT"]],
    ["Hola abuela, soy yo, tu nieto. Perdí el móvil y estoy en un apuro.", ["IMPERSONATION_FAMILY"]],
    ["Le llamamos de la Agencia Tributaria. Pague con criptomonedas en un cajero de bitcoin.", ["IMPERSONATION_GOVERNMENT", "CRYPTO_REQUEST"]],
  ])("INV-25 scam scripts are recognised in German and Spanish: %s", (text, labels) => {
    expect(keywordLabels(text)).toEqual(expect.arrayContaining(labels));
  });

  it("leaves ordinary German and Spanish notes alone", () => {
    expect(keywordLabels("Danke für die Hilfe diese Woche")).toEqual([]);
    expect(keywordLabels("Miete für November")).toEqual([]);
    expect(keywordLabels("Gracias por la compra, nos vemos el domingo")).toEqual([]);
    expect(keywordLabels("Alquiler de noviembre")).toEqual([]);
    // Words that contain a keyword aren't the keyword ("Opa" is not in "Opal", "hoy" is not in "Hoyos").
    expect(keywordLabels("Ring mit Opal, Familie Hoyos")).toEqual([]);
  });

  it("leaves ordinary notes alone", () => {
    expect(keywordLabels("Thanks for the groceries, see you Sunday")).toEqual([]);
    expect(keywordLabels("Rent for November")).toEqual([]);
  });
});

import { decide, evaluateRules, type ModelSignal } from "../src/index.js";

describe("cold start", () => {
  const behaviourHold: ModelSignal = {
    level: "HOLD",
    networkOnly: false,
    modelVersion: "m",
    reasons: [{ code: "NEW_PAYEE", text: "You haven't paid this person before.", source: "MODEL" }],
  };
  const ordinary = { payeeIsNew: true, payeeIsRegisteredCaregiver: false, amountRatioToTypical: null, textLabels: [], withinRegisteredObligationCap: true } as const;
  const ctx = (n?: number) => ({ payeeIsRegisteredCaregiver: false, policyVersion: "p", planVersionId: null, ownerHistoryCount: n });

  it("INV-23 cold start caps behaviour-only model signals at REVIEW", () => {
    expect(decide(evaluateRules(ordinary), { status: "OK", signals: [behaviourHold] }, ctx(0)).level).toBe("REVIEW");
    expect(decide(evaluateRules(ordinary), { status: "OK", signals: [behaviourHold] }, ctx(9)).level).toBe("REVIEW");
    expect(decide(evaluateRules(ordinary), { status: "OK", signals: [behaviourHold] }, ctx(10)).level).toBe("HOLD");
    expect(decide(evaluateRules(ordinary), { status: "OK", signals: [behaviourHold] }, ctx(undefined)).level).toBe("HOLD");
  });

  it("INV-23 rules still hold during cold start", () => {
    const scam = { ...ordinary, textLabels: ["GIFT_CARD_REQUEST"] as const };
    expect(decide(evaluateRules(scam), { status: "OK", signals: [behaviourHold] }, ctx(0)).level).toBe("HOLD");
  });

  it("INV-23 network signals still hold during cold start", () => {
    const net: ModelSignal = { ...behaviourHold, networkOnly: true, reasons: [{ code: "FAN_IN_10_PLUS", text: "x", source: "NETWORK" }] };
    expect(decide(evaluateRules(ordinary), { status: "OK", signals: [net] }, ctx(0)).level).toBe("HOLD");
  });

  it("INV-23 an unavailable model still holds (fail closed wins)", () => {
    expect(decide(evaluateRules(ordinary), { status: "UNAVAILABLE", detail: "down" }, ctx(0)).level).toBe("HOLD");
  });
});

describe("cold start reasons", () => {
  it("INV-23 does not tell a new user a payment is unusual for them", () => {
    const sig: ModelSignal = {
      level: "HOLD",
      networkOnly: false,
      modelVersion: "m",
      reasons: [
        { code: "UNUSUAL_TIME", text: "This payment was made at an unusual time of day for you.", source: "MODEL" },
        { code: "NEW_PAYEE", text: "You haven't paid this person before.", source: "MODEL" },
      ],
    };
    const facts = { payeeIsNew: true, payeeIsRegisteredCaregiver: false, amountRatioToTypical: null, textLabels: [], withinRegisteredObligationCap: true };
    const d = decide(evaluateRules(facts), { status: "OK", signals: [sig] }, { payeeIsRegisteredCaregiver: false, policyVersion: "p", planVersionId: null, ownerHistoryCount: 2 });
    expect(d.reasons.map((r) => r.code)).toEqual(["NEW_PAYEE"]);
  });
});
