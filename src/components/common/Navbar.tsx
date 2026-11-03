import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Mic,
  Upload,
  Menu,
  ChevronRight,
  Bell,
  User as UserIcon,
  Settings,
  LogOut,
  CheckCircle2,
} from "lucide-react";
import { useAuth, getStudentInitials } from "../../context/AuthContext";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";
import { ThemeToggle } from "./ThemeToggle";
import { DROPDOWN_MENU_VARIANTS } from "../../utils/motionVariants";

interface NavbarProps {
  onOpenSearch: () => void;
  onOpenUpload: () => void;
  onOpenLiveModal: () => void;
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSearch,
  onOpenUpload,
  onOpenLiveModal,
  onToggleSidebar,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { activeLecture, liveSession } = useLecture();

  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setIsAccountMenuOpen(false);
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setIsNotificationsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Close menus on route change
  useEffect(() => {
    setIsAccountMenuOpen(false);
    setIsNotificationsOpen(false);
  }, [location.pathname, location.hash]);

  // Dynamic route-aware breadcrumb computation
  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path === "/profile" || path === "/student-profile") {
      return { parent: APP_NAME, current: "Profile" };
    }
    if (path === "/home" || path === "/") {
      return { parent: APP_NAME, current: "Home Overview" };
    }
    if (path === "/student-dashboard") {
      return { parent: APP_NAME, current: "Student Dashboard" };
    }
    if (path === "/lectures" || path === "/library") {
      return { parent: APP_NAME, current: "Lectures" };
    }
    if (path === "/live") {
      return { parent: APP_NAME, current: liveSession.currentTopic || "Live Lecture" };
    }
    if (path === "/processing") {
      return { parent: APP_NAME, current: activeLecture?.title || "Processing Discourse" };
    }
    if (path === "/notes") {
      return { parent: APP_NAME, current: "Notes" };
    }
    if (path === "/quizzes") {
      return { parent: APP_NAME, current: "Quizzes" };
    }
    if (path === "/revision") {
      return { parent: APP_NAME, current: "Revision" };
    }
    if (path.startsWith("/workspace")) {
      return { parent: APP_NAME, current: activeLecture?.title || "Study Materials" };
    }
    return { parent: APP_NAME, current: "Home Overview" };
  };

  const breadcrumb = getBreadcrumbs();
  const displayName = user?.fullName || user?.name || "Alex Dev";
  const displayEmail = user?.email || "alex.student@learnix.ai";
  const initials = getStudentInitials(displayName);
  const hasAvatarImage = Boolean(user?.avatar && user.avatar.trim());

  return (
    <header className="sticky top-0 z-30 w-full h-15 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-white/95 dark:bg-[#1B2421]/95 backdrop-blur-md transition-colors">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Mobile Toggle + Breadcrumbs */}
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="md:hidden p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.96] transition-all duration-150 cursor-pointer"
              aria-label="Toggle navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="flex items-center space-x-1.5 text-xs min-w-0">
            <button
              onClick={() => navigate("/home")}
              className="text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition-colors font-medium hidden sm:inline cursor-pointer shrink-0"
              title="Return to Home Overview"
            >
              {breadcrumb.parent}
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#9BA4A0] hidden sm:inline shrink-0" />
            <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[140px] sm:max-w-xs md:max-w-md">
              {breadcrumb.current}
            </span>
          </div>
        </div>

        {/* Center / Right: Global Search, Quick Capture & Single Account Control Area */}
        <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
          {/* Global Search Input Field */}
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 text-xs text-[#66736E] dark:text-[#9BA4A0] bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] dark:hover:bg-[#2C3B36] hover:border-[#168A72]/35 active:scale-[0.99] rounded-xl transition-all duration-150 border border-[#E4EAE7] dark:border-[#2C3B36] w-9 sm:w-52 md:w-64 justify-center sm:justify-between cursor-pointer"
            title="Search lectures and notes (⌘K)"
          >
            <div className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0] shrink-0" />
              <span className="hidden sm:inline truncate">Search lectures, notes...</span>
            </div>
            <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] text-[#66736E] dark:text-[#9BA4A0]">
              ⌘K
            </kbd>
          </button>

          {/* Record Live Action Button */}
          {liveSession.isRecording ? (
            <button
              onClick={() => navigate("/live")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white rounded-xl shadow-xs transition-all duration-150 cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-white" />
              <span className="hidden sm:inline tabular-nums">
                Recording ({Math.floor(liveSession.duration / 60)}m)
              </span>
            </button>
          ) : (
            <button
              onClick={onOpenLiveModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white rounded-xl shadow-xs transition-all duration-150 cursor-pointer"
              title="Record Live Lecture"
            >
              <Mic className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Record Live</span>
            </button>
          )}

          {/* Upload Lecture Action Button */}
          <button
            onClick={onOpenUpload}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] hover:border-[#168A72]/35 active:scale-[0.98] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl shadow-xs transition-all duration-150 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
            <span>Upload</span>
          </button>

          {/* Divider before Account Controls */}
          <div className="h-5 w-px bg-[#E4EAE7] dark:bg-[#2C3B36] hidden sm:block mx-0.5" />

          {/* 1. Theme Switcher Toggle */}
          <ThemeToggle size="md" />

          {/* 2. Notifications Popover Control */}
          <div className="relative" ref={notificationsRef}>
            <button
              type="button"
              onClick={() => {
                setIsNotificationsOpen((prev) => !prev);
                setIsAccountMenuOpen(false);
              }}
              aria-expanded={isNotificationsOpen}
              aria-haspopup="dialog"
              aria-label="Notifications"
              className="p-2 rounded-xl text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.96] transition-all duration-150 relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#168A72]"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
            </button>

            <AnimatePresence>
              {isNotificationsOpen && (
                <motion.div
                  key="notifications-popover"
                  variants={DROPDOWN_MENU_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  role="dialog"
                  aria-label="Notifications panel"
                  className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xl py-3 px-4 z-50 origin-top-right"
                >
                  <div className="flex items-center justify-between pb-2.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
                    <span className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsNotificationsOpen(false);
                        navigate("/profile#notifications");
                      }}
                      className="text-[11px] font-medium text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] cursor-pointer"
                    >
                      Preferences
                    </button>
                  </div>

                  <div className="py-6 text-center space-y-1.5">
                    <div className="w-8 h-8 rounded-xl bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-4 h-4 text-[#168A72] dark:text-[#23A98D]" />
                    </div>
                    <p className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      No new notifications
                    </p>
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                      You're all caught up on your study schedule and lecture alerts.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 3. Student Avatar & Account Menu Dropdown */}
          <div className="relative" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => {
                setIsAccountMenuOpen((prev) => !prev);
                setIsNotificationsOpen(false);
              }}
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="menu"
              aria-label="Open student account menu"
              className="flex items-center gap-1.5 p-0.5 rounded-xl hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.96] transition-all duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#168A72]"
              title={`${displayName} (${displayEmail})`}
            >
              {hasAvatarImage ? (
                <img
                  src={user!.avatar}
                  alt={displayName}
                  className="w-8 h-8 rounded-lg object-cover border border-[#168A72]/40 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/30 flex items-center justify-center text-xs font-bold text-[#0F6B59] dark:text-[#23A98D] shrink-0 tracking-tight">
                  {initials}
                </div>
              )}
            </button>

            <AnimatePresence>
              {isAccountMenuOpen && (
                <motion.div
                  key="account-dropdown"
                  variants={DROPDOWN_MENU_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  role="menu"
                  aria-orientation="vertical"
                  aria-label="Student account menu"
                  className="absolute right-0 mt-2 w-60 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xl py-2 z-50 origin-top-right"
                >
                  {/* Student Identity Header */}
                  <div className="px-4 py-2.5 border-b border-[#E4EAE7] dark:border-[#2C3B36] flex items-center gap-3">
                    {hasAvatarImage ? (
                      <img
                        src={user!.avatar}
                        alt={displayName}
                        className="w-9 h-9 rounded-xl object-cover border border-[#168A72]/30 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/30 flex items-center justify-center text-xs font-bold text-[#0F6B59] dark:text-[#23A98D] shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate">
                        {displayName}
                      </p>
                      <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] truncate">
                        {displayEmail}
                      </p>
                    </div>
                  </div>

                  {/* Menu Actions */}
                  <div className="py-1.5 px-1.5 space-y-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        navigate("/profile");
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer text-left focus:outline-none focus-visible:bg-[#F4F6F5] dark:focus-visible:bg-[#24302C] group"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-[#168A72] dark:text-[#23A98D] transition-transform duration-150 group-hover:translate-x-0.5" />
                      <span>View Profile</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        navigate("/profile#account-settings");
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer text-left focus:outline-none focus-visible:bg-[#F4F6F5] dark:focus-visible:bg-[#24302C] group"
                    >
                      <Settings className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0] transition-transform duration-150 group-hover:translate-x-0.5" />
                      <span>Account Settings</span>
                    </button>
                  </div>

                  {/* Divider & Log Out */}
                  <div className="pt-1.5 mt-0.5 border-t border-[#E4EAE7] dark:border-[#2C3B36] px-1.5">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        logout();
                        navigate("/login");
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#E07A5F] hover:bg-[#FDF0ED] dark:hover:bg-[#38241D] transition-colors cursor-pointer text-left focus:outline-none focus-visible:bg-[#FDF0ED] group"
                    >
                      <LogOut className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                      <span>Log Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
};
