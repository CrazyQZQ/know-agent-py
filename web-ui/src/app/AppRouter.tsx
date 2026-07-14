import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { useAuth } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/LoginPage";
import { useTheme } from "@/hooks/useTheme";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";
import { WorkflowRunPage } from "@/features/workflows/WorkflowRunPage";
import { KnowledgeListPage } from "@/features/knowledge/KnowledgeListPage";
import { DocumentDetailPage } from "@/features/knowledge/DocumentDetailPage";

export function ProtectedRoute() {
  const { auth } = useAuth();
  return auth ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AppRouter() {
  const { auth, logout } = useAuth();
  const { toggle } = useTheme();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={auth ? <AppShell user={auth.user} onLogout={() => void logout()} onToggleTheme={toggle}><Outlet /></AppShell> : <Navigate to="/login" replace />}>
        <Route path="/assistant/:threadId?" element={<AssistantPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:workflowId/:threadId?" element={<WorkflowRunPage />} />
        <Route path="/knowledge" element={<KnowledgeListPage />} />
        <Route path="/knowledge/:documentId" element={<DocumentDetailPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/assistant" replace />} />
  </Routes>;
}
