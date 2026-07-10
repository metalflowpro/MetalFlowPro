import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import type { User } from '@supabase/supabase-js';
import type { Page, Project } from '../../types';

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (p: Project) => void;
  onNewProject: () => void;
  onEditProject: () => void;
  onBackToProjects: () => void;
  onSignOut: () => void;
  user: User;
  children: ReactNode;
}

export function Layout({
  currentPage,
  onNavigate,
  projects,
  activeProject,
  onSelectProject,
  onNewProject,
  onEditProject,
  onBackToProjects,
  onSignOut,
  user,
  children,
}: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-mf-bg">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={onSelectProject}
        onNewProject={onNewProject}
        onEditProject={onEditProject}
        onBackToProjects={onBackToProjects}
        onSignOut={onSignOut}
        user={user}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
