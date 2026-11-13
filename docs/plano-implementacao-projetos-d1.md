# Plano de Implementação: Persistência Relacional de Projetos (Cloudflare D1 + Drizzle ORM)

> **Objetivo:** Implementar a persistência de projetos gerados pelo Astro utilizando Cloudflare D1 e Drizzle ORM em 3 tabelas relacionais (`projects`, `project_files`, `project_states`), seguindo Clean Architecture no backend Hono e integrando um painel lateral (gaveta/sheet) com auto-save silencioso no frontend React/Ionic sem desmontar a sessão de voz ativa.

---

## Regras Críticas do Repositório (`AGENTS.md`) — Leia Antes de Editar

Qualquer modelo que execute este plano **deve** respeitar as seguintes restrições do projeto:

1. **React Compiler está ativo (`oxc-transform-react` com `panicThreshold: "all_errors"`):**
   - **NÃO** utilize `useMemo`, `useCallback` ou `React.memo`.
   - **NÃO** leia `.current` de um `useRef` durante a renderização nem passe callbacks que leiam refs diretamente por props durante o render (use `useEffect` ou estado reativo, como `useViewBuilder` já faz com `report`).
2. **Rotas Hono encadeadas (`worker/index.ts`):**
   - Todas as rotas em `worker/index.ts` **devem permanecer encadeadas** na mesma expressão `const api = new Hono<AppEnv>().get(...).post(...)`. Quebrar em declarações separadas destrói silenciosamente a inferência de tipos RPC (`AppType` vira `any` no `hc<AppType>`).
3. **Restrições do Cloudflare D1 (`worker/db/schema.ts`):**
   - Sem `BOOLEAN` nativo -> usar `integer("...", { mode: "boolean" })`.
   - Sem `DATETIME` nativo -> usar `integer("...", { mode: "timestamp" })`.
   - Foreign keys são **sempre aplicadas** no D1 -> usar `.references(() => projects.id, { onDelete: "cascade" })`.
   - Limite de 100 parâmetros vinculados por query.
4. **Testes com Vite+ (`vite-plus/test`):**
   - Importar helpers de teste (`describe`, `it`, `expect`, `beforeEach`, `vi`) **sempre** de `"vite-plus/test"`, nunca de `"vitest"`.
   - Testes que usam o binding real do D1 (`env.DB`) ficam em `worker/*.workers.test.ts` (projeto `workers` do Vitest com `cloudflareTest()`), que aplica automaticamente as migrações de `./drizzle/migrations` via `worker/test/apply-migrations.ts`.
5. **Autenticação por senha compartilhada (`APP_PASSWORD`):**
   - Todas as rotas de API que leem ou gravam projetos devem validar a senha com `passwordMatches` (via header, query param `password` ou body JSON), mantendo o mesmo modelo de proteção de `/api/auth`, `/api/realtime/setup` e `/api/view`.
6. **Comandos de validação:**
   - Usar `vp check` (ou `vp lint`) e `vp test` (dentro do ambiente Conda `astro`).

---

## Visão Geral da Arquitetura

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Frontend (React 19 + Ionic 9 + TanStack Query + Hono RPC)                │
│                                                                          │
│  VoiceSession.tsx                                                        │
│   ├── ProjectsSheet.tsx (Gaveta lateral / Modal mobile sem desmontar)    │
│   ├── useViewBuilder.ts (Gera HTML -> Auto-salva 'index.html' + spec)    │
│   │    └── loadProjectView(view)  <── Injeta HTML ao abrir projeto       │
│   └── useViewEvents.ts  (Escuta 'astro:state' -> Auto-salva stateData)   │
│        └── restoreProjectState(s) <── Injeta estado ao abrir projeto     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Hono RPC (`hc<AppType>`)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Backend (Cloudflare Worker + Hono — `worker/index.ts`)                   │
│                                                                          │
│  GET    /api/projects              -> Lista projetos (metadados)         │
│  POST   /api/projects              -> Cria projeto + 'index.html' inicial│
│  GET    /api/projects/:id          -> Retorna projeto + files + state    │
│  PUT    /api/projects/:id/files    -> Upsert de arquivo + metadados      │
│  PUT    /api/projects/:id/state    -> Upsert de stateData (JSON string)  │
│  DELETE /api/projects/:id          -> Remove projeto (cascade)           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Clean Architecture Interface
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Camada de Domínio & Persistência (`worker/repositories/`)                │
│                                                                          │
│  ProjectRepository (Interface)  <── D1ProjectRepository (Drizzle ORM)    │
│   ├── projects       (id, title, spec, created_at, updated_at)           │
│   ├── project_files  (id, project_id, file_path, content, updated_at)    │
│   └── project_states (id, project_id, state_data, updated_at)            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Passo 1: Domínio e Drizzle Schemas

### 1.1. Atualizar `worker/db/schema.ts`

Manter a tabela existente `items` (ou substituí-la apenas se atualizar `worker/index.workers.test.ts`, **recomendado manter `items` para não quebrar testes existentes** e adicionar as 3 novas tabelas logo abaixo) com as relações e índices adequados para o D1:

- **Tabela `projects`:**
  - `id`: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`
  - `title`: `text("title").notNull()`
  - `spec`: `text("spec").notNull().default("")` _(armazena os itens da `<!-- spec -->` unidos por `\n` ou texto da spec)_
  - `createdAt`: `integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())`
  - `updatedAt`: `integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())`
  - Índice: `index("projects_updated_at_idx").on(table.updatedAt)`

- **Tabela `project_files`:**
  - `id`: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`
  - `projectId`: `text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" })`
  - `filePath`: `text("file_path").notNull()` _(ex: `'index.html'`, `'style.css'`)_
  - `content`: `text("content").notNull()`
  - `updatedAt`: `integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())`
  - Índices:
    - `uniqueIndex("project_files_project_path_idx").on(table.projectId, table.filePath)` _(essencial para `onConflictDoUpdate` no auto-save de arquivos)_
    - `index("project_files_project_id_idx").on(table.projectId)`

- **Tabela `project_states`:**
  - `id`: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`
  - `projectId`: `text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" })`
  - `stateData`: `text("state_data").notNull().default("{}")` _(JSON serializado como string)_
  - `updatedAt`: `integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())`
  - Índice único:
    - `uniqueIndex("project_states_project_id_idx").on(table.projectId)` _(1 estado ativo por projeto, permitindo upsert atômico via `onConflictDoUpdate`)_

- **Relações Drizzle (`relations` de `"drizzle-orm"`):**
  - `projectsRelations`: `many(projectFiles)` e `one(projectStates)`
  - `projectFilesRelations`: `one(projects, { fields: [projectFiles.projectId], references: [projects.id] })`
  - `projectStatesRelations`: `one(projects, { fields: [projectStates.projectId], references: [projects.id] })`

- **Tipos exportados:**
  - `ProjectRow`, `NewProjectRow`
  - `ProjectFileRow`, `NewProjectFileRow`
  - `ProjectStateRow`, `NewProjectStateRow`

### 1.2. Gerar e aplicar a migração do D1

Após salvar `worker/db/schema.ts`, executar:

```bash
vp run db:generate
vp run db:migrate:local
```

> **Importante:** O comando `vp run db:generate` criará o arquivo SQL em `drizzle/migrations/0001_*.sql`. O setup de testes do Vitest (`vite.config.ts` -> `readD1Migrations("./drizzle/migrations")`) lê esse diretório automaticamente para rodar os testes em `workerd`.

### 1.3. Criar a Interface de Domínio `worker/repositories/project-repository.ts`

Criar a interface `ProjectRepository` desacoplada do Drizzle, usando tipos de domínio claros:

```ts
export type ProjectSummary = {
  id: string;
  title: string;
  spec: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectFile = {
  id: string;
  projectId: string;
  filePath: string;
  content: string;
  updatedAt: Date;
};

export type ProjectState = {
  id: string;
  projectId: string;
  stateData: string;
  updatedAt: Date;
};

export type ProjectDetails = ProjectSummary & {
  files: ProjectFile[];
  state: ProjectState | null;
};

export type CreateProjectInput = {
  id?: string;
  title: string;
  spec: string;
  initialFile?: {
    filePath: string;
    content: string;
  };
  initialStateData?: string;
};

export type SaveProjectFileInput = {
  projectId: string;
  filePath: string;
  content: string;
  /** Quando fornecido (ex: ao salvar index.html), atualiza também a capa do projeto */
  projectMeta?: {
    title?: string;
    spec?: string;
  };
};

export interface ProjectRepository {
  listAll(): Promise<ProjectSummary[]>;
  getById(id: string): Promise<ProjectDetails | null>;
  create(input: CreateProjectInput): Promise<ProjectDetails>;
  saveFile(input: SaveProjectFileInput): Promise<ProjectFile | null>;
  updateState(projectId: string, stateData: string): Promise<ProjectState | null>;
  delete(id: string): Promise<boolean>;
}
```

---

## Passo 2: Repositório D1 e Backend (API Hono)

### 2.1. Implementar `D1ProjectRepository` em `worker/repositories/d1-project-repository.ts`

Implementar a classe `D1ProjectRepository implements ProjectRepository` recebendo `Db` (`ReturnType<typeof createDb>`):

- **`listAll()`**:
  - `db.select().from(projects).orderBy(desc(projects.updatedAt)).all()`
- **`getById(id)`**:
  - Buscar o projeto em `projects` (`where(eq(projects.id, id)).get()`). Se não existir, retornar `null`.
  - Buscar `files` em `projectFiles` (`where(eq(projectFiles.projectId, id)).all()`).
  - Buscar `state` em `projectStates` (`where(eq(projectStates.projectId, id)).get() ?? null`).
  - Retornar `{ ...project, files, state }`.
- **`create(input)`**:
  - Inserir na tabela `projects` com `title`, `spec`, `createdAt: now`, `updatedAt: now`.
  - Se `input.initialFile` estiver presente, inserir em `projectFiles` (`filePath`, `content`).
  - Se `input.initialStateData` estiver presente, inserir em `projectStates` (`stateData`).
  - Retornar o `ProjectDetails` completo.
- **`saveFile(input)`**:
  - Verificar se o `projectId` existe em `projects` (retornar `null` caso não exista, evitando erro de FK no D1).
  - Fazer upsert em `projectFiles` usando `.insert(projectFiles).values(...).onConflictDoUpdate({ target: [projectFiles.projectId, projectFiles.filePath], set: { content: input.content, updatedAt: now } }).returning()`.
  - Atualizar `projects.updatedAt` (e `title` / `spec` se `input.projectMeta` for passado) em `projects`.
- **`updateState(projectId, stateData)`**:
  - Verificar se o `projectId` existe em `projects` (retornar `null` se não existir).
  - Fazer upsert em `projectStates` usando `.insert(projectStates).values({ projectId, stateData, updatedAt: now }).onConflictDoUpdate({ target: projectStates.projectId, set: { stateData, updatedAt: now } }).returning()`.
  - Atualizar `projects.updatedAt = now`.
- **`delete(id)`**:
  - Remover de `projects` (`where(eq(projects.id, id)).returning({ id: projects.id })`). Graças ao `onDelete: "cascade"`, `project_files` e `project_states` são limpos automaticamente pelo D1.

### 2.2. Adicionar Schemas Zod em `shared/schemas.ts`

Adicionar schemas de validação para as novas rotas reutilizando os limites existentes (`MAX_VIEW_HTML_BYTES`, `MAX_VIEW_STATE_BYTES` de `shared/view.ts`):

- `ProjectIdParamSchema`:
  ```ts
  export const ProjectIdParamSchema = z.object({
    id: z.string().min(1).max(100),
  });
  ```
- `CreateProjectSchema`:
  ```ts
  export const CreateProjectSchema = PasswordSchema.extend({
    title: z.string().min(1).max(120),
    spec: z.string().max(4000).default(""),
    html: z.string().min(1).max(MAX_VIEW_HTML_BYTES),
    stateData: z.string().max(MAX_VIEW_STATE_BYTES).optional(),
  });
  ```
- `SaveProjectFileSchema`:
  ```ts
  export const SaveProjectFileSchema = PasswordSchema.extend({
    filePath: z.string().min(1).max(255).default("index.html"),
    content: z.string().min(1).max(MAX_VIEW_HTML_BYTES),
    title: z.string().min(1).max(120).optional(),
    spec: z.string().max(4000).optional(),
  });
  ```
- `UpdateProjectStateSchema`:
  ```ts
  export const UpdateProjectStateSchema = PasswordSchema.extend({
    stateData: z.string().min(2).max(MAX_VIEW_STATE_BYTES),
  });
  ```

### 2.3. Adicionar Rotas Encadeadas em `worker/index.ts`

Encadear na variável `api` existente em `worker/index.ts` (instanciando `new D1ProjectRepository(createDb(c.env.DB))` nos handlers):

1. **`GET /projects`** (autenticado via query `?password=...`, usando `PASSWORD_QUERY_PARAM`):
   - Retorna `{ projects: ProjectSummary[] }` (datas serializadas em ISO string pelo `c.json`).
2. **`POST /projects`** (`zValidator("json", CreateProjectSchema)`):
   - Extrai `title` e `spec` (ou calcula fallback via `viewTitle(html)` e `(viewSpec(html) ?? []).join("\n")`).
   - Chama `repo.create({ title, spec, initialFile: { filePath: "index.html", content: html }, initialStateData: stateData })`.
   - Retorna status `201` com `{ project }`.
3. **`GET /projects/:id`** (`zValidator("param", ProjectIdParamSchema)`, autenticado via query `?password=...`):
   - Chama `repo.getById(id)`. Se `null`, retorna `c.json({ error: "Project not found" }, 404)`.
   - Retorna `{ project }`.
4. **`PUT /projects/:id/files`** (`zValidator("param", ProjectIdParamSchema)`, `zValidator("json", SaveProjectFileSchema)`):
   - Chama `repo.saveFile({ projectId: id, filePath, content, projectMeta: { title, spec } })`.
   - Se `null`, retorna `404`. Caso contrário, retorna `{ file }`.
5. **`PUT /projects/:id/state`** (`zValidator("param", ProjectIdParamSchema)`, `zValidator("json", UpdateProjectStateSchema)`):
   - Chama `repo.updateState(id, stateData)`.
   - Se `null`, retorna `404`. Caso contrário, retorna `{ state }`.
6. **`DELETE /projects/:id`** (`zValidator("param", ProjectIdParamSchema)`, autenticado via query `?password=...`):
   - Chama `repo.delete(id)`. Retorna `{ ok: true }`.

### 2.4. Testes de Repositório e Rotas (`worker/index.workers.test.ts`)

Adicionar suíte de testes em `worker/index.workers.test.ts` exercitando o `D1ProjectRepository` e as rotas `/api/projects*` diretamente contra o runtime `workerd` + D1 local:

- Criar projeto com `index.html` e verificar `listAll()` e `getById()`.
- Fazer upsert de `index.html` e de um segundo arquivo (`style.css`) e verificar que `project_files` mantém ambos sem duplicar `index.html`.
- Fazer upsert de estado em `project_states` e verificar que atualizações subsequentes sobrescrevem `stateData`.
- Verificar deleção em cascata (`delete(id)` apaga registros de `project_files` e `project_states`).

---

## Passo 3: Frontend (UI e Integração)

### 3.1. Atualizar `src/lib/use-view-builder.ts` (Suporte a `loadView` e Notificação de Build Concluído)

Atualmente, `useViewBuilder` possui `view` privado e só altera `view` quando a stream `/api/view` emite `data-view`. Precisamos expor duas capacidades limpas e compatíveis com o React Compiler:

1. **Estado `landedView` (ou incremento de versão de build concluído):**
   - Adicionar um estado `const [savedTrigger, setSavedTrigger] = useState<{ id: number; view: View } | null>(null);`
   - Dentro de `check(landed: View)`, **quando a checagem terminar** (ou seja, logo antes de `setStatus(null); say(...)`, quando não houver mais auto-fixes pendentes), chamar:
     ```ts
     setSavedTrigger((prev) => ({ id: (prev?.id ?? 0) + 1, view: landed }));
     ```
   - Assim, o consumidor pode observar `viewBuilder.lastCheckedView` via `useEffect` para disparar o auto-save apenas quando um build válido finalizar (nunca durante `draft` ou entre tentativas de auto-fix!).
2. **Ação `loadView(loaded: View | null)`:**
   - Permite que o frontend injete um projeto carregado do banco sem acionar o agente de código nem falar no microfone:
     ```ts
     const loadView = (loaded: View | null) => {
       runRef.current = {
         id: runRef.current.id + 1, // Cancela qualquer check pendente de um build anterior
         fixes: 0,
         baseline: loaded?.html ?? null,
         landed: null,
       };
       setDraft(null);
       setStatus(null);
       setFailure(null);
       setView(loaded);
     };
     ```
   - Retornar `loadView` e `lastCheckedView: savedTrigger` no objeto de retorno do `useViewBuilder`.

### 3.2. Atualizar `src/lib/use-view-events.ts` (Restauração de Estado e Auto-save de Estado)

Atualmente, `useViewEvents` guarda o estado recebido do iframe apenas em `savedStateRef.current` (um `useRef`), que não dispara efeitos quando muda. Precisamos:

1. **Expor o último estado publicado como estado reativo para auto-save:**
   - Adicionar `const [latestState, setLatestState] = useState<{ id: number; data: unknown } | null>(null);`
   - No listener `onMessage`, quando `const state = parseViewState(message.data)` for válido:
     ```ts
     savedStateRef.current = state.state;
     setLatestState((prev) => ({ id: (prev?.id ?? 0) + 1, data: state.state }));
     return;
     ```
2. **Expor função `restoreState(state: unknown)` para quando o usuário abrir um projeto da gaveta:**
   - Atualiza `savedStateRef.current = state` para que o `onFrameLoad` envie esse estado assim que o `srcDoc` do projeto terminar de carregar no iframe (e, caso o iframe já esteja carregado com o mesmo documento, faz `postMessage({ type: VIEW_STATE_TYPE, state }, "*")`).
   - Retornar `latestState` e `restoreState` de `useViewEvents`.

### 3.3. Criar Hook de Dados e Auto-Save `src/lib/use-projects.ts` (TanStack Query + Hono RPC)

Criar um módulo dedicado `src/lib/use-projects.ts` usando `@tanstack/react-query` e o cliente RPC `api` de `src/lib/api.ts`:

- **Query Keys:**
  - `projectKeys = { all: ["projects"] as const, detail: (id: string) => ["projects", id] as const }`
- **Hooks TanStack Query:**
  - `useProjectsList(password: string)`: chama `api.projects.$get({ query: { password } })`.
  - `useCreateProject(password: string)`: chama `api.projects.$post(...)` e invalida `projectKeys.all`.
  - `useSaveProjectFile(password: string)`: chama `api.projects[":id"].files.$put(...)` e invalida `projectKeys.all` e `projectKeys.detail(id)`.
  - `useUpdateProjectState(password: string)`: chama `api.projects[":id"].state.$put(...)`.
  - `useDeleteProject(password: string)`: chama `api.projects[":id"].$delete(...)` e invalida `projectKeys.all`.
- **Orquestração de Auto-save (`useProjectAutoSave`):**
  - Mantém `activeProjectId: string | null`.
  - **Auto-save de Build (`lastCheckedView`):**
    - Em um `useEffect` observando `lastCheckedView`:
    - Extrai `title = viewTitle(html)` e `spec = (viewSpec(html) ?? []).join("\n")`.
    - Se `activeProjectId == null`: cria automaticamente um novo projeto via `POST /api/projects` (enviando também o estado inicial caso já exista) e define `setActiveProjectId(created.id)`.
    - Se `activeProjectId != null`: envia `PUT /api/projects/:id/files` com `filePath: "index.html"`, `content: html`, `title`, `spec`.
  - **Auto-save de Estado (`latestState`):**
    - Em um `useEffect` observando `latestState` com debounce leve (~600ms via `setTimeout` + cleanup no `useEffect`) para não inundar o D1 em jogos que disparam ações rápidas:
    - Se `activeProjectId != null`, serializa `JSON.stringify(latestState.data)` e envia `PUT /api/projects/:id/state` silenciosamente.

### 3.4. Criar o Componente `src/components/ProjectsSheet.tsx` (Painel Lateral / Gaveta)

Seguindo o mesmo padrão de UX e responsividade já utilizado para o Transcript em `VoiceSession.tsx` (`docked` em telas `>= 900px` como `<aside className="voice-panel">` e `<IonModal>` estilo bottom-sheet/drawer em telas menores):

- **Funcionalidades do `ProjectsSheet`:**
  - Lista todos os projetos ordenados por `updatedAt` (mais recentes primeiro), exibindo:
    - Título do projeto (`project.title`)
    - Resumo/contagem de features da `spec` e horário da última atualização
    - Badge ou destaque visual indicando qual projeto está atualmente aberto (`project.id === activeProjectId`)
  - **Ação "Abrir Projeto" (clique no item):**
    - Busca `GET /api/projects/:id`
    - Localiza o arquivo `filePath === "index.html"` em `project.files`
    - Parseia `project.state?.stateData` (com `try { JSON.parse(...) } catch {}`)
    - Chama `onSelectProject({ id, title, html, state })` que:
      1. Define `activeProjectId = project.id`
      2. Chama `restoreState(parsedState)` no `useViewEvents`
      3. Chama `loadView({ title, html })` no `useViewBuilder`
      4. Opcionalmente informa silenciosamente ao modelo de voz (se conectado) via `reportToVoice('The user opened saved project "' + title + '".', { speak: false })` para que o assistente saiba o que está na tela caso o usuário peça alterações por voz em seguida!
  - **Ação "Novo Projeto em Branco" (botão no topo da gaveta):**
    - Limpa `activeProjectId = null`, `restoreState(undefined)` e `loadView(null)` sem derrubar a chamada de voz.
  - **Ação "Excluir Projeto" (botão discreto com ícone `trashOutline`):**
    - Remove o projeto via `DELETE /api/projects/:id`; se era o projeto ativo, desvincula `activeProjectId`.

### 3.5. Integrar na Tela Principal (`src/components/VoiceSession.tsx` e `src/theme/voice.css`)

- Em `VoiceSession.tsx`:
  - Adicionar estado `const [projectsOpen, setProjectsOpen] = useState(false);`
  - No `<div className="voice-bar">` (rodapé ao lado do botão de Transcript), adicionar um `<IonButton fill="clear">` com ícone `folderOpenOutline` (de `ionicons/icons`) para abrir/fechar a gaveta de projetos.
  - Quando `projectsOpen` for `true` em desktop (`docked`), renderizar o painel lateral `ProjectsSheet` ao lado do `.voice-stage` (sem desmontar o iframe nem a sessão de voz!). Em telas mobile (`!docked`), o `ProjectsSheet` abre dentro de um `<IonModal>` com `breakpoints={[0, 0.6, 1]}`.
- Em `src/theme/voice.css`:
  - Adicionar estilos para `.project-list`, `.project-card`, `.project-card--active` usando exclusivamente variáveis `--ion-*` (seguindo a regra do topo de `voice.css`: nenhuma cor hex hardcoded).

---

## Checklist de Verificação Final (Para o Modelo Executor)

Ao concluir os 3 passos, execute na ordem abaixo:

1. `vp run db:generate` — Confirme que a migração SQL foi gerada em `drizzle/migrations/`.
2. `vp run db:migrate:local` — Confirme que as tabelas `projects`, `project_files` e `project_states` foram aplicadas no SQLite local do D1.
3. `vp lint` — Confirme **0 warnings e 0 errors** (incluindo checagem de tipos TypeScript dos 3 projetos `tsconfig` e regras do React Compiler).
4. `vp test` — Confirme que todos os testes (tanto o projeto `node` quanto o projeto `workers` em `workerd`) passam.
5. `vp run build` — Confirme que `tsc -b && vp build` compila o bundle do Worker e do cliente sem erros.
