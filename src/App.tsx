import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LectureProvider } from "./context/LectureContext";
import { Navbar } from "./components/common/Navbar";
import { Sidebar } from "./components/common/Sidebar";
import { GlobalSearchModal } from "./components/common/GlobalSearchModal";
import { StartLiveModal } from "./components/live/StartLiveModal";
import { UploadModal } from "./components/upload/UploadModal";
import { LandingPage } from "./components/landing/LandingPage";
import { StudentDashboard } from "./components/dashboard/StudentDashboard";
import { LectureLibrary } from "./components/library/LectureLibrary";
import { LiveLectureWorkspace } from "./components/live/LiveLectureWorkspace";
import { ProcessingScreen } from "./components/workspace/ProcessingScreen";
import { LectureWorkspace } from "./components/workspace/LectureWorkspace";
import { StudentAuthPage } from "./components/auth/StudentAuthPage";
import { StudentProfilePage } from "./components/profile/StudentProfilePage";
import { APP_NAME, APP_DOCUMENT_TITLE } from "./config/branding";

const DocumentTitleSync: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    if (path === "/profile" || path === "/student-profile") {
      document.title = `${APP_NAME} | Profile`;
    } else if (path === "/student-dashboard") {
      document.title = `${APP_NAME} | Student Dashboard`;
    } else if (path === "/lectures" || path === "/library") {
      document.title = `${APP_NAME} | Lecture Library`;
    } else if (path === "/live") {
      document.title = `${APP_NAME} | Live Lecture`;
    } else if (path === "/notes") {
      document.title = `${APP_NAME} | Study Notes`;
    } else if (path === "/quizzes") {
      document.title = `${APP_NAME} | Quizzes`;
    } else if (path === "/revision") {
      document.title = `${APP_NAME} | Revision`;
    } else if (path === "/login") {
      document.title = `${APP_NAME} | Sign In`;
    } else if (path === "/register") {
      document.title = `${APP_NAME} | Create Account`;
    } else {
      document.title = APP_DOCUMENT_TITLE;
    }
  }, [location.pathname]);

  return null;
};

const ProtectedShell: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Global keyboard shortcut for search (⌘K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] flex flex-col font-sans selection:bg-[#168A72] selection:text-white">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenLiveModal={() => setIsLiveModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="md:pl-64 flex-1 flex flex-col min-w-0 transition-all">
        {/* Clean Top Navigation */}
        <Navbar
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenUpload={() => setIsUploadModalOpen(true)}
          onOpenLiveModal={() => setIsLiveModalOpen(true)}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        />

        {/* View Routing Canvas */}
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route
              path="/home"
              element={
                <LandingPage
                  onStartLive={() => setIsLiveModalOpen(true)}
                  onOpenUpload={() => setIsUploadModalOpen(true)}
                />
              }
            />
            <Route
              path="/student-dashboard"
              element={
                <StudentDashboard
                  onStartLive={() => setIsLiveModalOpen(true)}
                  onOpenUpload={() => setIsUploadModalOpen(true)}
                />
              }
            />
            <Route path="/teacher-dashboard" element={<Navigate to="/student-dashboard" replace />} />
            <Route
              path="/lectures"
              element={
                <LectureLibrary
                  onStartLive={() => setIsLiveModalOpen(true)}
                  onOpenUpload={() => setIsUploadModalOpen(true)}
                />
              }
            />
            <Route path="/library" element={<Navigate to="/lectures" replace />} />
            <Route path="/live" element={<LiveLectureWorkspace />} />
            <Route path="/processing" element={<ProcessingScreen />} />
            <Route path="/workspace" element={<LectureWorkspace />} />
            <Route path="/workspace/:lectureId" element={<LectureWorkspace />} />
            <Route path="/notes" element={<LectureWorkspace initialTab="notes" />} />
            <Route path="/quizzes" element={<LectureWorkspace initialTab="quiz" />} />
            <Route path="/revision" element={<LectureWorkspace initialTab="revision" />} />
            <Route path="/profile" element={<StudentProfilePage />} />
            <Route path="/student-profile" element={<Navigate to="/profile" replace />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </main>
      </div>

      {/* Global Modals */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      <StartLiveModal
        isOpen={isLiveModalOpen}
        onClose={() => setIsLiveModalOpen(false)}
      />

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />
    </div>
  );
};

const AuthRouteGuard: React.FC<{ mode: "login" | "register" }> = ({ mode }) => {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/student-dashboard" replace />;
  }
  return <StudentAuthPage mode={mode} />;
};

const AppRoutes: React.FC = () => {
  return (
    <>
      <DocumentTitleSync />
      <Routes>
        <Route path="/login" element={<AuthRouteGuard mode="login" />} />
        <Route path="/register" element={<AuthRouteGuard mode="register" />} />
        <Route path="/*" element={<ProtectedShell />} />
      </Routes>
    </>
  );
};

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <LectureProvider>
            <AppRoutes />
          </LectureProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
