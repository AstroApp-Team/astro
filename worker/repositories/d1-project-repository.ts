import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/client.ts";
import { projectFiles, projectStates, projects } from "../db/schema.ts";
import type {
  CreateProjectInput,
  ProjectDetails,
  ProjectFile,
  ProjectRepository,
  ProjectState,
  ProjectSummary,
  SaveProjectFileInput,
} from "./project-repository.ts";

/**
 * Cloudflare D1 implementation of `ProjectRepository` backed by Drizzle ORM.
 */
export class D1ProjectRepository implements ProjectRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async listAll(): Promise<ProjectSummary[]> {
    return this.#db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
  }

  async getById(id: string): Promise<ProjectDetails | null> {
    const project = await this.#db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return null;

    const [files, state] = await Promise.all([
      this.#db.select().from(projectFiles).where(eq(projectFiles.projectId, id)).all(),
      this.#db.select().from(projectStates).where(eq(projectStates.projectId, id)).get(),
    ]);

    return {
      ...project,
      files,
      state: state ?? null,
    };
  }

  async create(input: CreateProjectInput): Promise<ProjectDetails> {
    const now = new Date();
    const projectId = input.id ?? crypto.randomUUID();

    const [project] = await this.#db
      .insert(projects)
      .values({
        id: projectId,
        title: input.title,
        spec: input.spec,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!project) {
      throw new Error("Failed to create project record in D1.");
    }

    const files: ProjectFile[] = [];
    if (input.initialFile) {
      const [file] = await this.#db
        .insert(projectFiles)
        .values({
          projectId: project.id,
          filePath: input.initialFile.filePath,
          content: input.initialFile.content,
          updatedAt: now,
        })
        .returning();
      if (file) files.push(file);
    }

    let state: ProjectState | null = null;
    if (input.initialStateData !== undefined) {
      const [insertedState] = await this.#db
        .insert(projectStates)
        .values({
          projectId: project.id,
          stateData: input.initialStateData,
          updatedAt: now,
        })
        .returning();
      state = insertedState ?? null;
    }

    return { ...project, files, state };
  }

  async saveFile(input: SaveProjectFileInput): Promise<ProjectFile | null> {
    const existing = await this.#db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();

    if (!existing) return null;

    const now = new Date();

    const [file] = await this.#db
      .insert(projectFiles)
      .values({
        projectId: input.projectId,
        filePath: input.filePath,
        content: input.content,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.filePath],
        set: {
          content: input.content,
          updatedAt: now,
        },
      })
      .returning();

    await this.#db
      .update(projects)
      .set({
        updatedAt: now,
        ...(input.projectMeta?.title !== undefined && { title: input.projectMeta.title }),
        ...(input.projectMeta?.spec !== undefined && { spec: input.projectMeta.spec }),
      })
      .where(eq(projects.id, input.projectId));

    return file ?? null;
  }

  async updateState(projectId: string, stateData: string): Promise<ProjectState | null> {
    const existing = await this.#db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    if (!existing) return null;

    const now = new Date();

    const [state] = await this.#db
      .insert(projectStates)
      .values({
        projectId,
        stateData,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectStates.projectId,
        set: {
          stateData,
          updatedAt: now,
        },
      })
      .returning();

    await this.#db.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId));

    return state ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.#db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });

    return deleted.length > 0;
  }
}
