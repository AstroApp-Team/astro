/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { PASSWORD_QUERY_PARAM } from "../shared/realtime.ts";
import { createDb } from "./db/client.ts";
import { items, projectFiles, projectStates, projects } from "./db/schema.ts";
import app from "./index.ts";
import { D1ProjectRepository } from "./repositories/d1-project-repository.ts";

/**
 * Runs inside workerd against a real (local) D1 binding. Proves `drizzle/migrations`
 * applies cleanly, integer-backed booleans/timestamps round-trip, and the
 * relational project repository & endpoints persist files and state in D1.
 */
describe("D1 schema", () => {
  beforeEach(async () => {
    await createDb(env.DB).delete(items);
  });

  it("round-trips a row through the migrated schema", async () => {
    const db = createDb(env.DB);

    const [inserted] = await db.insert(items).values({ title: "hello" }).returning();
    expect(inserted?.title).toBe("hello");
    // D1 has no BOOLEAN — this proves the integer comes back as a real false.
    expect(inserted?.done).toBe(false);
    // ...and no DATETIME, so createdAt must arrive as a usable Date.
    expect(inserted?.createdAt).toBeInstanceOf(Date);

    const rows = await db.select().from(items);
    expect(rows).toHaveLength(1);
  });

  it("generates a uuid primary key client-side", async () => {
    const db = createDb(env.DB);

    const [row] = await db.insert(items).values({ title: "keyed" }).returning();
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("D1ProjectRepository", () => {
  beforeEach(async () => {
    const db = createDb(env.DB);
    await db.delete(projects);
  });

  it("creates, reads, upserts files/state, and cascades deletes", async () => {
    const db = createDb(env.DB);
    const repo = new D1ProjectRepository(db);

    const created = await repo.create({
      title: "Timer",
      spec: "- Countdown",
      initialFile: { filePath: "index.html", content: "<title>Timer</title>" },
      initialStateData: JSON.stringify({ seconds: 60 }),
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.files).toHaveLength(1);
    expect(created.files[0]?.filePath).toBe("index.html");
    expect(created.state?.stateData).toBe('{"seconds":60}');

    // Upserting the same filePath replaces content instead of creating a duplicate row.
    const updatedIndex = await repo.saveFile({
      projectId: created.id,
      filePath: "index.html",
      content: "<title>Timer v2</title>",
      projectMeta: { title: "Timer v2", spec: "- Countdown\n- Reset button" },
    });
    expect(updatedIndex?.content).toBe("<title>Timer v2</title>");

    // Adding a second file keeps both under the same project.
    await repo.saveFile({
      projectId: created.id,
      filePath: "style.css",
      content: "body { margin: 0; }",
    });

    await repo.updateState(created.id, JSON.stringify({ seconds: 42 }));

    const loaded = await repo.getById(created.id);
    expect(loaded?.title).toBe("Timer v2");
    expect(loaded?.spec).toBe("- Countdown\n- Reset button");
    expect(loaded?.files.map((file) => file.filePath).sort()).toEqual(["index.html", "style.css"]);
    expect(loaded?.state?.stateData).toBe('{"seconds":42}');

    const listed = await repo.listAll();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.getById(created.id)).toBeNull();
    expect(await db.select().from(projectFiles)).toHaveLength(0);
    expect(await db.select().from(projectStates)).toHaveLength(0);
  });

  it("returns null/false when operating on a missing project id", async () => {
    const repo = new D1ProjectRepository(createDb(env.DB));

    expect(
      await repo.saveFile({
        projectId: "missing-id",
        filePath: "index.html",
        content: "<p>x</p>",
      }),
    ).toBeNull();
    expect(await repo.updateState("missing-id", "{}")).toBeNull();
    expect(await repo.delete("missing-id")).toBe(false);
  });
});

describe("/api/projects routes", () => {
  const PASSWORD = "test-password";
  const workerEnv = () => ({ ...env, APP_PASSWORD: PASSWORD });

  beforeEach(async () => {
    await createDb(env.DB).delete(projects);
  });

  it("rejects unauthorized requests", async () => {
    const listRes = await app.request("/api/projects", {}, workerEnv());
    expect(listRes.status).toBe(401);

    const createRes = await app.request(
      "/api/projects",
      {
        method: "POST",
        body: JSON.stringify({
          password: "wrong",
          title: "App",
          html: "<title>App</title>",
        }),
        headers: { "Content-Type": "application/json" },
      },
      workerEnv(),
    );
    expect(createRes.status).toBe(401);
  });

  it("supports create, list, get, file upsert, state upsert, and delete", async () => {
    const createRes = await app.request(
      "/api/projects",
      {
        method: "POST",
        body: JSON.stringify({
          password: PASSWORD,
          title: "Counter",
          spec: "- Increment",
          html: "<title>Counter</title><!-- spec\n- Increment\n-->",
        }),
        headers: { "Content-Type": "application/json" },
      },
      workerEnv(),
    );
    expect(createRes.status).toBe(201);
    const createdBody = await createRes.json<{ project: { id: string; title: string } }>();
    const projectId = createdBody.project.id;

    const listRes = await app.request(
      `/api/projects?${PASSWORD_QUERY_PARAM}=${encodeURIComponent(PASSWORD)}`,
      {},
      workerEnv(),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json<{ projects: { id: string; title: string }[] }>();
    expect(listBody.projects).toHaveLength(1);
    expect(listBody.projects[0]?.id).toBe(projectId);

    const fileRes = await app.request(
      `/api/projects/${projectId}/files`,
      {
        method: "PUT",
        body: JSON.stringify({
          password: PASSWORD,
          filePath: "index.html",
          content: "<title>Counter Pro</title>",
          title: "Counter Pro",
        }),
        headers: { "Content-Type": "application/json" },
      },
      workerEnv(),
    );
    expect(fileRes.status).toBe(200);

    const stateRes = await app.request(
      `/api/projects/${projectId}/state`,
      {
        method: "PUT",
        body: JSON.stringify({
          password: PASSWORD,
          stateData: JSON.stringify({ count: 7 }),
        }),
        headers: { "Content-Type": "application/json" },
      },
      workerEnv(),
    );
    expect(stateRes.status).toBe(200);

    const getRes = await app.request(
      `/api/projects/${projectId}?${PASSWORD_QUERY_PARAM}=${encodeURIComponent(PASSWORD)}`,
      {},
      workerEnv(),
    );
    expect(getRes.status).toBe(200);
    const detailBody = await getRes.json<{
      project: {
        title: string;
        files: { filePath: string; content: string }[];
        state: { stateData: string } | null;
      };
    }>();
    expect(detailBody.project.title).toBe("Counter Pro");
    expect(detailBody.project.files[0]?.content).toBe("<title>Counter Pro</title>");
    expect(detailBody.project.state?.stateData).toBe('{"count":7}');

    const delRes = await app.request(
      `/api/projects/${projectId}?${PASSWORD_QUERY_PARAM}=${encodeURIComponent(PASSWORD)}`,
      { method: "DELETE" },
      workerEnv(),
    );
    expect(delRes.status).toBe(200);

    const missingRes = await app.request(
      `/api/projects/${projectId}?${PASSWORD_QUERY_PARAM}=${encodeURIComponent(PASSWORD)}`,
      {},
      workerEnv(),
    );
    expect(missingRes.status).toBe(404);
  });
});
