/**
 * A small, auditable agent loop with tool calling.
 *
 * The model never touches PayPal itself. Every tool call it proposes is
 * handed to `callTool`, which the caller wires to the policy gate (@lp/guard)
 * and then to PayPal's Agent Toolkit. Whatever the gate refuses comes back to
 * the model as a refusal, never as an action. Tool results are wrapped as
 * untrusted data (INV-18): an invoice note that says "ignore your rules"
 * stays a string.
 */

import type { LlmProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { UNTRUSTED_RULES, wrapUntrusted } from "./untrusted.js";

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: "tool_result"; readonly tool_use_id: string; readonly content: string; readonly is_error?: boolean };

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly ContentBlock[];
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface ChatRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolDef[];
  readonly maxTokens: number;
}

export interface ChatResult {
  readonly content: readonly ContentBlock[];
  readonly stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  readonly model: string;
}

/** Providers that support tool calling implement this in addition to `complete`. */
export interface ChatProvider extends LlmProvider {
  chat(req: ChatRequest): Promise<ChatResult>;
}

export function canChat(p: LlmProvider): p is ChatProvider {
  return typeof (p as Partial<ChatProvider>).chat === "function";
}

export interface ToolOutcome {
  readonly ok: boolean;
  /** What the model sees: the tool's data, or the gate's refusal. */
  readonly content: string;
}

export interface AgentTrace {
  readonly name: string;
  readonly input: unknown;
  readonly ok: boolean;
}

export type AgentResult =
  | { readonly ok: true; readonly text: string; readonly trace: readonly AgentTrace[]; readonly model: string }
  | { readonly ok: false; readonly reason: "PROVIDER_UNAVAILABLE" | "TOO_MANY_STEPS"; readonly trace: readonly AgentTrace[] };

export interface RunAgentInput {
  readonly provider: ChatProvider;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolDef[];
  readonly callTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
}

export async function runAgent(input: RunAgentInput): Promise<AgentResult> {
  const maxSteps = input.maxSteps ?? 6;
  const system = `${input.system}\n\n${UNTRUSTED_RULES}`;
  const messages: ChatMessage[] = [...input.messages];
  const trace: AgentTrace[] = [];
  const allowedNames = new Set(input.tools.map((t) => t.name));

  for (let step = 0; step < maxSteps; step++) {
    let r: ChatResult;
    try {
      r = await input.provider.chat({ system, messages, tools: input.tools, maxTokens: input.maxTokens ?? 1200 });
    } catch (e) {
      // Name and status only: never prompts, tool data or response bodies (INV-21).
      console.error(`[ai] chat failed: ${e instanceof ProviderError ? `provider status ${e.status ?? "none"}` : e instanceof Error ? e.name : "unknown"}`);
      if (e instanceof ProviderError || e instanceof Error) return { ok: false, reason: "PROVIDER_UNAVAILABLE", trace };
      throw e;
    }
    messages.push({ role: "assistant", content: r.content });
    const uses = r.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) {
      const text = r.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
      return { ok: true, text, trace, model: r.model };
    }

    const results: ContentBlock[] = [];
    for (const u of uses.slice(0, 4)) {
      let outcome: ToolOutcome;
      if (!allowedNames.has(u.name)) {
        outcome = { ok: false, content: `The tool "${u.name.slice(0, 60)}" isn't available to you.` };
      } else {
        try {
          outcome = await input.callTool(u.name, u.input);
        } catch {
          outcome = { ok: false, content: "The tool failed. Don't retry it; explain that the information isn't available right now." };
        }
      }
      trace.push({ name: u.name, input: u.input, ok: outcome.ok });
      results.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: outcome.ok ? wrapUntrusted(`tool:${u.name}`, outcome.content).block : outcome.content,
        is_error: !outcome.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { ok: false, reason: "TOO_MANY_STEPS", trace };
}
