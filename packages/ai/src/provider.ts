/**
 * One interface for every model provider, so switching is configuration, not
 * a rewrite. Tests use the scripted fake; nothing in the test suite calls a
 * real model.
 *
 * This package has no access to PayPal (INV-01): it only returns text that the
 * policy layer validates.
 */

export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  /** Ask for a JSON object response where the provider supports it. */
  readonly json: boolean;
}

export interface CompletionResult {
  readonly text: string;
  readonly model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "ProviderError";
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 30_000;

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    // Never include the response body or headers in errors: they can echo prompts. INV-21
    if (!res.ok) throw new ProviderError(`Model provider returned ${res.status}`, res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError("Model provider unreachable", null);
  } finally {
    clearTimeout(timer);
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const json = (await post(
      this.fetchImpl,
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      },
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    return { text, model: this.model };
  }
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const json = (await post(
      this.fetchImpl,
      url,
      { "x-goog-api-key": this.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: req.maxTokens,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      },
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { text, model: this.model };
  }
}

/** Deterministic provider for tests: replies come from a script. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model = "scripted-1";
  readonly calls: CompletionRequest[] = [];
  constructor(private readonly reply: (req: CompletionRequest) => string | Error) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const r = this.reply(req);
    if (r instanceof Error) throw r;
    return { text: r, model: this.model };
  }
}

export interface ProviderConfig {
  readonly AI_PROVIDER?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly ANTHROPIC_MODEL?: string;
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
}

/** Picks a provider from environment configuration. */
export function providerFromEnv(env: ProviderConfig): LlmProvider {
  switch (env.AI_PROVIDER ?? "anthropic") {
    case "anthropic":
      return new AnthropicProvider(env.ANTHROPIC_API_KEY ?? "", env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5");
    case "gemini":
      return new GeminiProvider(env.GEMINI_API_KEY ?? "", env.GEMINI_MODEL ?? "gemini-3.8-flash");
    default:
      throw new Error(`Unknown AI_PROVIDER: ${env.AI_PROVIDER}`);
  }
}
