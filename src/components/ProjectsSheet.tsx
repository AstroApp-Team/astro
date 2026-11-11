import {
  IonBadge,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchProjectDetails,
  projectKeys,
  useDeleteProject,
  useProjectsList,
} from "../lib/use-projects.ts";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";

export type LoadedProject = {
  id: string;
  title: string;
  html: string;
  state: unknown;
};

type ProjectsSheetProps = {
  isOpen: boolean;
  docked: boolean;
  password: string;
  activeProjectId: string | null;
  onClose: () => void;
  onSelectProject: (project: LoadedProject) => void;
  onNewProject: () => void;
  onActiveProjectDeleted: () => void;
};

function specCount(spec: string): number {
  if (spec.trim() === "") return 0;
  return spec.split("\n").filter((line) => line.trim() !== "").length;
}

function formatUpdatedAt(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseSavedState(stateData: string | undefined): unknown {
  if (stateData == null || stateData.trim() === "") return undefined;
  try {
    return JSON.parse(stateData) as unknown;
  } catch {
    return undefined;
  }
}

function ProjectsSheetBody({
  isOpen,
  password,
  activeProjectId,
  onClose,
  onSelectProject,
  onNewProject,
  onActiveProjectDeleted,
}: Omit<ProjectsSheetProps, "docked">) {
  const queryClient = useQueryClient();
  const { data: projects, isLoading, isError, error } = useProjectsList(password, isOpen);
  const deleteProject = useDeleteProject(password);

  const openProject = useMutation({
    mutationFn: async (id: string): Promise<LoadedProject> => {
      const details = await queryClient.fetchQuery({
        queryKey: projectKeys.detail(id),
        queryFn: () => fetchProjectDetails(password, id),
      });
      const indexFile = details.files.find((file) => file.filePath === "index.html");
      if (!indexFile) {
        throw new Error("Este projeto ainda não possui um arquivo index.html.");
      }
      return {
        id: details.id,
        title: details.title,
        html: indexFile.content,
        state: parseSavedState(details.state?.stateData),
      };
    },
    onSuccess: (loaded) => {
      onSelectProject(loaded);
      onClose();
    },
  });

  const handleDelete = (id: string) => {
    deleteProject.mutate(id, {
      onSuccess: () => {
        if (id === activeProjectId) {
          onActiveProjectDeleted();
        }
      },
    });
  };

  const actionError = openProject.error ?? deleteProject.error;

  return (
    <div className="projects-sheet">
      <div className="projects-sheet__actions">
        <button
          type="button"
          className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--block"
          onClick={() => {
            onNewProject();
            onClose();
          }}
        >
          <LiquidGlassIcon name="add" size={18} />
          Novo projeto em branco
        </button>
      </div>

      {actionError != null && (
        <IonNote color="danger" className="projects-sheet__status">
          {actionError instanceof Error ? actionError.message : "Falha na ação do projeto."}
        </IonNote>
      )}

      {isLoading && (
        <div className="projects-sheet__loading">
          <IonSpinner name="dots" />
          <IonNote>Carregando projetos…</IonNote>
        </div>
      )}

      {isError && (
        <IonNote color="danger" className="projects-sheet__status">
          {error instanceof Error ? error.message : "Falha ao carregar projetos."}
        </IonNote>
      )}

      {!isLoading && !isError && (projects == null || projects.length === 0) && (
        <IonNote className="voice-empty">
          Nenhum projeto salvo ainda. Peça ao Astro para criar algo e ele será salvo aqui
          automaticamente.
        </IonNote>
      )}

      {projects != null && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isOpening = openProject.isPending && openProject.variables === project.id;
            const features = specCount(project.spec);

            return (
              <li
                key={project.id}
                className={`project-card${isActive ? " project-card--active" : ""}`}
              >
                <button
                  type="button"
                  className="project-card__select"
                  disabled={openProject.isPending}
                  onClick={() => openProject.mutate(project.id)}
                >
                  <div className="project-card__title-row">
                    <span className="project-card__title">{project.title}</span>
                    {isActive && <IonBadge className="project-card__badge">Ativo</IonBadge>}
                    {isOpening && <IonSpinner name="dots" />}
                  </div>
                  <div className="project-card__meta">
                    <span>{formatUpdatedAt(project.updatedAt)}</span>
                    {features > 0 && (
                      <span>
                        {features} {features === 1 ? "recurso" : "recursos"}
                      </span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm apple-liquid-glass-btn--danger"
                  disabled={deleteProject.isPending}
                  onClick={() => handleDelete(project.id)}
                  aria-label={`Excluir ${project.title}`}
                  title={`Excluir ${project.title}`}
                >
                  <LiquidGlassIcon name="trash" tone="ember" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ProjectsSheet({
  isOpen,
  docked,
  password,
  activeProjectId,
  onClose,
  onSelectProject,
  onNewProject,
  onActiveProjectDeleted,
}: ProjectsSheetProps) {
  if (docked) {
    if (!isOpen) return null;

    return (
      <aside className="voice-panel" aria-label="Projetos">
        <header className="voice-panel__header">
          <h2>Projetos</h2>
          <button
            type="button"
            className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--sm"
            onClick={onClose}
          >
            Fechar
          </button>
        </header>
        <div className="voice-panel__body">
          <ProjectsSheetBody
            isOpen={isOpen}
            password={password}
            activeProjectId={activeProjectId}
            onClose={onClose}
            onSelectProject={onSelectProject}
            onNewProject={onNewProject}
            onActiveProjectDeleted={onActiveProjectDeleted}
          />
        </div>
      </aside>
    );
  }

  return (
    <IonModal
      className="astro-modal"
      isOpen={isOpen}
      onDidDismiss={onClose}
      breakpoints={[0, 0.6, 1]}
      initialBreakpoint={0.6}
    >
      <IonHeader className="astro-header">
        <IonToolbar className="astro-toolbar">
          <IonTitle>Projetos</IonTitle>
          <IonButtons slot="end">
            <button
              type="button"
              className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--sm"
              onClick={onClose}
            >
              Fechar
            </button>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding astro-modal-content">
        <ProjectsSheetBody
          isOpen={isOpen}
          password={password}
          activeProjectId={activeProjectId}
          onClose={onClose}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
          onActiveProjectDeleted={onActiveProjectDeleted}
        />
      </IonContent>
    </IonModal>
  );
}
