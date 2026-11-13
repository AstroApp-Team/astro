/**
 * Domain contracts for project persistence (Clean Architecture).
 *
 * The application layer and Hono handlers depend only on `ProjectRepository`
 * and these domain types, never directly on Drizzle or Cloudflare D1.
 */

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
  id?: string | undefined;
  title: string;
  spec: string;
  initialFile?: {
    filePath: string;
    content: string;
  };
  initialStateData?: string | undefined;
};

export type SaveProjectFileInput = {
  projectId: string;
  filePath: string;
  content: string;
  projectMeta?: {
    title?: string | undefined;
    spec?: string | undefined;
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
