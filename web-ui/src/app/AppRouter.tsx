import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { useAuth } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/LoginPage";
import { useTheme } from "@/hooks/useTheme";
import { AssistantPage } from "@/features/assistant/AssistantPage";

export function ProtectedRoute() {
  const { auth } = useAuth();
  return auth ? <Outlet /> : <Navigate to="/login" replace />;
}

const Page = ({ title }: { title: string }) => <section className="p-6"><h1 className="text-2xl font-semibold">{title}</h1></section>;

export function AppRouter() {
  const { auth, logout } = useAuth();
  const { toggle } = useTheme();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={auth ? <AppShell user={auth.user} onLogout={() => void logout()} onToggleTheme={toggle}><Outlet /></AppShell> : <Navigate to="/login" replace />}>
        <Route path="/assistant/:threadId?" element={<AssistantPage />} />
        <Route path="/workflows" element={<Page title="工作流" />} />
        <Route path="/workflows/:workflowId/:threadId?" element={<Page title="工作流运行" />} />
        <Route path="/knowledge" element={<Page title="知识库" />} />
        <Route path="/knowledge/:documentId" element={<Page title="文档详情" />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/assistant" replace />} />
  </Routes>;
}
