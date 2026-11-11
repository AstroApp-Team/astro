import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * D1 constraints that shape this file:
 *  - No native BOOLEAN  -> integer({ mode: "boolean" })
 *  - No native DATETIME -> integer({ mode: "timestamp" }) (unix seconds)
 *  - Foreign keys are always enforced and cannot be disabled
 *  - Max 100 bound parameters per query, which caps how wide a batch insert
 *    can be (rows x columns <= 100)
 */
export const items = sqliteTable(
  "items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("items_created_at_idx").on(table.createdAt)],
);

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;

export const projects = sqliteTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    spec: text("spec").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("projects_updated_at_idx").on(table.updatedAt)],
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    content: text("content").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_files_project_path_idx").on(table.projectId, table.filePath),
    index("project_files_project_id_idx").on(table.projectId),
  ],
);

export const projectStates = sqliteTable(
  "project_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stateData: text("state_data").notNull().default("{}"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("project_states_project_id_idx").on(table.projectId)],
);

export const projectsRelations = relations(projects, ({ many, one }) => ({
  files: many(projectFiles),
  state: one(projectStates),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
}));

export const projectStatesRelations = relations(projectStates, ({ one }) => ({
  project: one(projects, {
    fields: [projectStates.projectId],
    references: [projects.id],
  }),
}));

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectFileRow = typeof projectFiles.$inferSelect;
export type NewProjectFileRow = typeof projectFiles.$inferInsert;
export type ProjectStateRow = typeof projectStates.$inferSelect;
export type NewProjectStateRow = typeof projectStates.$inferInsert;
