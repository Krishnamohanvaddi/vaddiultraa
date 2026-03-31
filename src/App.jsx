import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import ChatBot from "./components/ChatBot";

function AppContent() {
  const { user } = useAuth();

  if (!user) return <LoginPage />;

  return (
    <>
      <Dashboard />
      <ChatBot />   {/* 👈 ADD HERE */}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}