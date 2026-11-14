import {
  createGateway,
  isStepCount,
  parsePartialJson,
  tool,
  ToolLoopAgent,
  type LanguageModel,
  type StopCondition,
  type ToolSet,
} from "ai";
import { z } from "zod";

import {
  checkViewHtml,
  MAX_VIEW_HTML_BYTES,
  viewTitle,
  type View,
  type ViewProgress,
} from "../shared/view.ts";
import { DEFAULT_VIEW_MODEL_ID, type ViewModelId } from "../shared/view-models.ts";

/**
 * The default is Claude Haiku 5.5. Settings → Modelo lets the user pick another allowlisted
 * model per device, sent with each request (`shared/view-models.ts`). The figures below were measured on Haiku and are not Sonnet's: expect slower and
 * dearer builds, and check that Sonnet streams tool arguments too (see below) before relying
 * on pages painting while they are written.
 *
 * Claude Haiku 5.5 was chosen because its provider *streams tool arguments*: the
 * page reaches the screen while `write_view` is still being written. DeepSeek
 * V4.1 Flash (the previous model) is served from Baseten, which buffers a tool
 * call's whole input into one delta, so nothing could render until it was done.
 *
 * Measured through the Gateway with `reasoning: "none"` and the prompt below:
 *
 *   | request          | Haiku 5.5: first paint / done / cost | DeepSeek -fast: done / cost |
 *   | calculator       | 1.2 s / 4.6 s / $0.0007              | 1.2 s / $0.0026             |
 *   | snake            | 1.0 s / 4.9 s / $0.0008              | 2.3 s / $0.0039             |
 *   | falling blocks   | 1.0 s / 9.3 s / $0.0015              | 6.1 s / $0.0081             |
 *   | edit (4 changes) | 2.7 s / $0.0006                      | 5.7 s / $0.0038             |
 *
 * At $0.10→$0.50 per M tokens it is also the cheapest of the three (DeepSeek
 * is $0.30→$1.20, `-fast` twice that). Re-measure before switching: whether
 * tool input streams is a property of the serving provider, not the model.
 */
export const VIEW_MODEL_ID: ViewModelId = DEFAULT_VIEW_MODEL_ID;

/**
 * The coding agent's model, reached through the same AI Gateway key that mints
 * the voice token — no second credential to manage.
 *
 * Kept separate from `buildView` so the loop takes a model rather than a
 * secret: that is the seam `MockLanguageModelV4` plugs into, and it is the only
 * way to test the loop without paying a provider to be non-deterministic.
 */
export function viewModel(apiKey: string, id: ViewModelId = VIEW_MODEL_ID): LanguageModel {
  return createGateway({ apiKey })(id);
}

/**
 * The strong model behind `rebuild_view`: the voice model calls it when a page
 * has grown tangled, and it rewrites the whole page from its spec. Rare and
 * allowed to be slow, so it is chosen for getting the whole app right in one
 * pass, not for first paint.
 *
 * Measured on a five-request finance app Haiku had built (3.5 KB, nine spec
 * items, two of them duplicates), rebuilt at `REBUILD_REASONING`:
 *
 *   | model          | done   | cost    | runtime check | spec          |
 *   | Sonnet 5.5     | 7.7 s  | $0.024  | passes        | merged dupes  |
 *   | Opus 5.5       | 14.2 s | $0.053  | passes        | merged dupes  |
 *
 * Same page, half the time and cost. Re-measure on a bigger app before
 * switching up.
 */
export const REBUILD_MODEL_ID = "anthropic/claude-sonnet-5.5";

export function rebuildModel(apiKey: string): LanguageModel {
  return createGateway({ apiKey })(REBUILD_MODEL_ID);
}

/**
 * Some thinking pays for itself on a rewrite: the model has to hold every
 * spec item and the state shape at once. The everyday loop stays at "none".
 */
const REBUILD_REASONING = "low";

/** `edit` is the everyday loop on the fast model; `rebuild` is the rewrite. */
export type BuildMode = "edit" | "rebuild";

/**
 * A healthy run is one step: write (or edit), pass, done. The cap exists so a
 * model that keeps failing its checks stops burning tokens.
 */
const MAX_STEPS = 8;

/**
 * How often a half-written page is re-sent while `write_view` streams. Each
 * one reloads the iframe and re-sends the whole document so far, so this
 * trades smoothness against bytes on the wire and reload flicker.
 */
const DRAFT_INTERVAL_MS = 300;

const instructions = `Você constrói um pequeno app web que aparece na tela do usuário enquanto ele conversa com um
assistente de voz. O assistente repassa o que o usuário quer; você faz funcionar, rápido. O usuário
vê a página aparecer enquanto você a digita e está esperando por você — cada caractere custa tempo.

Escreva TODO texto que o usuário vê (títulos, rótulos, botões, mensagens) em português do Brasil,
a menos que o pedido peça outro idioma.

Construa a página MAIS SIMPLES que faça o que foi pedido, e nada além. Sem decoração, animação,
temas, ícones, comentários ou funcionalidades que ninguém pediu. Se o pedido for vago, escolha a
leitura razoável mais simples. O usuário pedirá mudanças se quiser — não as antecipe.

Ferramentas — chame uma ou mais a cada turno:

- write_view — substitui a página inteira. Para uma página nova, ou um pedido que torna a antiga obsoleta.
- edit_view — substitui um trecho exato da página (ele deve aparecer exatamente uma vez, ou passe
  replaceAll). Para qualquer mudança em uma página existente. Faça todas as edições que uma mudança
  exige no mesmo turno, como chamadas paralelas.

Seu trabalho vai para a tela no instante em que cada chamada termina. A execução acaba assim que um
turno deixa a página passando nas verificações; se uma verificação falhar, o resultado diz o que corrigir.

Toda página roda no runtime Astro, que já está carregado. Escreva exatamente neste formato
e ordem — <script>s separados, para a página aparecer assim que sua view chegar:

<title>Calculadora de gorjeta</title>
<!-- spec
- Digitar o valor da conta e escolher 10, 15 ou 20% de gorjeta
- Mostra a gorjeta e o total
-->
<style>.row{display:flex;gap:8px}</style>
<script>Astro.state({ bill: 0, pct: 15 })</script>
<script>Astro.view((s, a) => html\`
  <input type="number" value=\${s.bill} onInput=\${(e) => a.setBill(e.target.value)} />
  <div class="row">\${[10, 15, 20].map((p) => html\`<button key=\${p} onClick=\${() => a.setPct(p)}>\${p}%</button>\`)}</div>
  <p>Gorjeta \${(s.bill * s.pct / 100).toFixed(2)} · Total \${(s.bill * (1 + s.pct / 100)).toFixed(2)}</p>
\`)</script>
<script>Astro.actions({
  setBill(s, value) { s.bill = Number(value) || 0 },
  setPct(s, pct) { s.pct = pct },
})</script>

- Astro.state: UM objeto JSON com tudo que o app sabe. Ele sobrevive às suas edições por conta
  própria. Mantenha as chaves estáveis: adicione chaves em vez de renomear.
- Astro.view: a tela inteira como função do estado, em html\`\` (htm — parecido com JSX, com
  \${...} para valores e handlers: onClick, onInput, class=, key= nos itens de lista). Nunca leia nem
  escreva o DOM você mesmo; um valor que muda pertence ao estado.
- Astro.actions: toda mudança de estado, como nome(s, ...args) que altera s. A tela
  renderiza de novo após cada uma. Os handlers as chamam: onClick=\${a.reset} ou onClick=\${() => a.add(x)}.
  Actions sem argumentos são executadas uma vez a partir do estado inicial para testar a página.
- Astro.start((a) => setInterval(a.tick, 100)) — timers e loops de jogo; roda uma vez ao carregar.
- Astro.after((s, root) => ...) — só para desenhar em um canvas, depois de cada renderização.
- Astro.emit("select", "T3") — avisa o assistente de voz que o usuário fez algo relevante
  (não cada clique ou movimento).

O spec é o registro de toda funcionalidade que o usuário pediu, em palavras simples — é como
o próximo pedido sabe o que precisa continuar funcionando. Adicione um item quando um pedido
acrescentar uma funcionalidade, reescreva-o quando mudar, e remova um SOMENTE quando o pedido
pedir isso explicitamente.

O estilo já está pronto: a página ganha fundo escuro, fonte de sistema legível, margens, e
botões e campos arredondados e dimensionados. Adicione CSS só para layout (grid, flex, tamanhos). Ela
renderiza em um iframe isolado que preenche a tela, muitas vezes com largura de celular.

Regras:
- Bibliotecas são bem-vindas quando foram pedidas ou poupam trabalho real (3D, gráficos, mapas, física).
  Carregue-as de um CDN com versão fixada; nada vem pré-carregado além do runtime Astro. Um
  build global vai em sua própria tag antes dos scripts que o usam:
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>. Uma biblioteca só em módulo ES
  (Three.js, por exemplo) é importada dentro de um script module que também faz o trabalho:
  <script type="module">import * as THREE from "https://esm.sh/three@0.170.0"; Astro.start(...)</script>.
- A página pode usar fetch (APIs públicas que permitam CORS), localStorage, câmera, microfone e
  localização, tela cheia, e alert/confirm. Astro.state já sobrevive às suas edições; use
  localStorage só para algo que precise durar depois de o app ser fechado.
- JavaScript puro. Não escape placeholders de template: escreva \`\${value}\`, nunca \`\\\${value}\`.`;

/**
 * Prepended to the request in `rebuild` mode. The current page goes along as
 * reference — it is the reason for the rebuild, not a template.
 */
const rebuildBrief = (reason: string) =>
  `Este app ficou emaranhado com muitas edições pequenas, e o assistente de voz pediu uma ` +
  `reescrita limpa. Motivo: ${reason}\n\n` +
  `Reescreva do zero com UM write_view, a partir do spec. O código acima serve só de ` +
  `referência — reaproveite o que funciona, reestruture à vontade. Ao terminar, todo item ` +
  `do spec deve funcionar; mantenha os itens do spec, reescrevendo só para resolver uma contradição. Mantenha ` +
  `as chaves e formatos de valor de Astro.state para os dados do usuário passarem; se um formato precisar ` +
  `mudar, adicione Astro.restore((saved, initial) => state) para migrá-lo.`;

type BuildOptions = {
  model: LanguageModel;
  /** Defaults to `edit`. */
  mode?: BuildMode;
  request: string;
  currentHtml?: string | undefined;
  /** Errors the page on screen threw while the user used it, newest last. */
  pageErrors?: string[] | undefined;
  /** Status for the user, derived from the loop's lifecycle. */
  onProgress: (progress: ViewProgress) => void;
  /**
   * The page as it stands mid-run: a half-written document while
   * `write_view` streams, the patched one after each `edit_view`. It has not
   * necessarily passed the checks — show it, do not keep it.
   */
  onDraft: (html: string) => void;
  /**
   * What each step cost, in USD, as the Gateway billed it. Called per step
   * rather than once at the end because a run that fails still spent money.
   */
  onCost: (usd: number) => void;
};

/**
 * The Gateway reports every call's actual charge in its provider metadata —
 * the invoice figure, so nothing here has to know the model's rates. It is a
 * decimal string; anything else (a mock, another provider) counts as unknown.
 */
export function gatewayCostUsd(providerMetadata: unknown): number | null {
  const cost = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  if (typeof cost !== "string" && typeof cost !== "number") return null;

  const usd = Number(cost);
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/** Both tools answer in this shape, so the loop and the progress line read one thing. */
type ToolOutcome = { ok: true } | { ok: false; problems: string[] };

function outcome(problems: string[]): ToolOutcome {
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Runs the loop and returns the finished document.
 *
 * The loop owns a mutable draft: `write_view` replaces it and `edit_view`
 * patches it, so the model never re-emits the parts of the page it is not
 * changing. There is no separate publish step — that was a whole extra model
 * round-trip on every run. Instead every tool result carries the checks, and
 * the run stops on the first step that leaves a passing draft.
 *
 * Every `execute` here is deliberately synchronous: if the model emits several
 * `edit_view` calls in one step, sync executes run to completion in call
 * order, so edits cannot interleave.
 */
export async function buildView({
  model,
  mode = "edit",
  request,
  currentHtml,
  pageErrors,
  onProgress,
  onDraft,
  onCost,
}: BuildOptions): Promise<View> {
  let draft = currentHtml ?? "";

  /**
   * Ends the run when the last step changed the page, every call in it
   * succeeded, and the draft as a whole passes. A failed call — a missed
   * edit, a failing write, input the schema rejected — keeps the loop going
   * with the problem in front of the model.
   */
  const passed: StopCondition<ToolSet> = ({ steps }) => {
    const last = steps.at(-1);
    if (last == null || last.toolResults.length === 0) return false;
    if (last.content.some((part) => part.type === "tool-error")) return false;
    if (last.toolResults.some((result) => (result.output as ToolOutcome).ok !== true)) {
      return false;
    }
    return checkViewHtml(draft).length === 0;
  };

  /**
   * `write_view` input, as it streams, per call. Removed when the call
   * executes, so a parse that resolves late cannot paint over the real page.
   */
  const streaming = new Map<string, { json: string; sentAt: number }>();

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: {
      write_view: tool({
        description:
          "Substitui a página inteira. Para uma página nova, ou uma reescrita que o pedido realmente " +
          "exija — prefira edit_view para mudanças. Aparece para o usuário enquanto é escrita.",
        inputSchema: z.object({
          html: z.string().max(MAX_VIEW_HTML_BYTES).describe("O documento HTML completo."),
        }),
        onInputStart: ({ toolCallId }) => {
          streaming.set(toolCallId, { json: "", sentAt: 0 });
          onProgress({ phase: "writing" });
        },
        /**
         * Re-parses the whole input so far rather than decoding deltas: the
         * html is a JSON string, so a delta can end mid-escape, and the
         * repair in `parsePartialJson` handles that. Throttled, so the cost is
         * a few parses a second.
         */
        onInputDelta: async ({ toolCallId, inputTextDelta }) => {
          const input = streaming.get(toolCallId);
          if (input == null) return;

          input.json += inputTextDelta;
          const now = Date.now();
          if (now - input.sentAt < DRAFT_INTERVAL_MS) return;
          input.sentAt = now;

          const { value } = await parsePartialJson(input.json);
          const html = (value as { html?: unknown } | undefined)?.html;
          if (typeof html === "string" && html !== "" && streaming.has(toolCallId)) {
            onDraft(html);
          }
        },
        execute: ({ html }, { toolCallId }) => {
          streaming.delete(toolCallId);
          draft = html;
          onDraft(draft);
          return outcome(checkViewHtml(draft));
        },
      }),

      edit_view: tool({
        description:
          "Substitui um trecho de texto exato da página por outro. oldText deve coincidir com a " +
          "página exatamente e, a menos que replaceAll esteja ativo, aparecer exatamente uma vez.",
        inputSchema: z.object({
          oldText: z.string().min(1).describe("Texto exato a localizar na página."),
          newText: z.string().describe("Texto que o substitui."),
          replaceAll: z.boolean().optional().describe("Substitui todas as ocorrências."),
        }),
        onInputStart: () => onProgress({ phase: "editing" }),
        execute: ({ oldText, newText, replaceAll }): ToolOutcome => {
          if (draft === "") {
            return outcome(["A página está vazia — não há nada para editar. Use write_view."]);
          }

          const occurrences = draft.split(oldText).length - 1;
          if (occurrences === 0) {
            return outcome([
              "oldText não foi encontrado na página. Ele precisa coincidir exatamente, incluindo " +
                "espaços. Releia o documento e tente um trecho que realmente exista.",
            ]);
          }
          if (occurrences > 1 && replaceAll !== true) {
            return outcome([
              `oldText aparece ${occurrences} vezes. Inclua mais texto ao redor para isolar ` +
                "uma ocorrência, ou passe replaceAll: true para mudar todas.",
            ]);
          }

          draft =
            replaceAll === true
              ? draft.replaceAll(oldText, newText)
              : draft.replace(oldText, newText);
          onDraft(draft);
          return outcome(checkViewHtml(draft));
        },
      }),
    },
    /**
     * With `required`, the model cannot answer in prose — every step is a tool
     * call, so the run either passes or hits the step cap.
     */
    toolChoice: "required",
    stopWhen: [isStepCount(MAX_STEPS), passed],
    /**
     * The portable reasoning knob (translated per provider). None for edits:
     * thinking happens before the first character reaches the screen, and
     * measured on a calculator, "low" still spent 4–40 s thinking (wildly
     * variable) for a page that takes seconds to write.
     */
    reasoning: mode === "rebuild" ? REBUILD_REASONING : "none",

    /** `fixing` reuses the checks' problem lists verbatim. */
    onToolExecutionEnd: ({ toolOutput }) => {
      if (toolOutput.type !== "tool-result") return;
      const result = toolOutput.output as ToolOutcome | undefined;
      if (result?.ok === false) onProgress({ phase: "fixing", problems: result.problems });
    },
    onStepEnd: ({ providerMetadata }) => {
      const usd = gatewayCostUsd(providerMetadata);
      if (usd != null) onCost(usd);
    },
  });

  /**
   * Streamed, not generated: `onInputDelta` only fires on a stream, and it is
   * what puts a page on screen while it is still being written.
   */
  const result = await agent.stream({
    prompt: buildPrompt({ mode, request, currentHtml, pageErrors }),
  });

  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
  }

  const steps = await result.steps;
  const touched = steps.some((step) => step.toolResults.length > 0);
  const problems = checkViewHtml(draft);

  if (!touched || problems.length > 0 || !passed({ steps })) {
    throw new Error(
      `O agente de código parou após ${steps.length} passos sem uma página funcionando` +
        (problems.length > 0 ? `: ${problems.join(" ")}` : "."),
    );
  }

  return { title: viewTitle(draft), html: draft };
}

/** The one user message a run starts from. Exported for the tests. */
export function buildPrompt({
  mode,
  request,
  currentHtml,
  pageErrors,
}: Pick<BuildOptions, "request" | "currentHtml" | "pageErrors"> & { mode: BuildMode }): string {
  if (currentHtml == null || currentHtml === "") return `A tela está vazia. ${request}`;

  const page = `Esta página está na tela do usuário agora:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\n`;
  const errors =
    pageErrors != null && pageErrors.length > 0
      ? `Enquanto o usuário a usava, a página lançou:\n${pageErrors
          .map((error) => `- ${error}`)
          .join("\n")}\n\n`
      : "";

  if (mode === "rebuild") return page + errors + rebuildBrief(request);

  return (
    page +
    errors +
    `O pedido provavelmente é uma mudança nela — use edit_view, a menos que uma reescrita seja claramente ` +
    `melhor, ou a página ainda não use Astro.view. ${request}`
  );
}
