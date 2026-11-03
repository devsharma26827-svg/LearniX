import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User, NotificationPreferences } from "../types";
import { apiFetch, bootstrapCsrf, setCsrfToken } from "../services/apiClient";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  quizReminders: true,
  revisionReminders: true,
  studyPlanReminders: true,
  lectureProcessing: true,
  productUpdates: false,
};

const LEGACY_PLACEHOLDER_AVATARS = new Set([
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
]);

export function getStudentInitials(name?: string): string {
  if (!name || !name.trim()) return "ST";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AuthContextType {
  user: User | null;
  authUser: User | null;
  profile: User | null;
  isAuthenticated: boolean;
  demoEnabled: boolean;
  login: (email: string, password?: string) => Promise<void>;
  register: (name: string, email: string, password?: string, additional?: Partial<User>) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<User>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

function normalizeStoredUser(raw: any): User | null {
  if (!raw || typeof raw !== "object") return null;

  // Migrate legacy teacher data safely to a clean student account
  if (
    raw.role === "teacher" ||
    raw.id === "user-teacher-1" ||
    raw.email === "s.jenkins@university.edu"
  ) {
    return {
      id: "user-student-1",
      name: "Alex Dev",
      fullName: "Alex Dev",
      email: "alex.student@learnix.ai",
      phone: "+1 (555) 234-5678",
      avatar: "",
      college: "Stanford University",
      course: "B.S. in Computer Science",
      specialization: "Artificial Intelligence & Systems",
      semester: "Semester 5 (Junior Year)",
      academicSession: "2025–2026",
      studentId: "CS-2024-0891",
      preferredLanguage: "English",
      noteStyle: "Detailed",
      difficultyPreference: "Intermediate",
      dailyStudyGoal: "1 hr",
      revisionFrequency: "Every 3 Days",
      notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    };
  }

  if (typeof raw.email === "string" && raw.email.trim()) {
    const cleanName =
      typeof raw.fullName === "string" && raw.fullName.trim()
        ? raw.fullName.trim()
        : typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : raw.email.split("@")[0];

    const rawAvatar = typeof raw.avatar === "string" ? raw.avatar.trim() : "";
    const cleanAvatar = LEGACY_PLACEHOLDER_AVATARS.has(rawAvatar) ? "" : rawAvatar;

    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : `user-${Date.now()}`,
      name: cleanName,
      fullName: cleanName,
      email: raw.email.trim().toLowerCase(),
      phone: typeof raw.phone === "string" ? raw.phone : "",
      avatar: cleanAvatar,
      college: typeof raw.college === "string" ? raw.college : "",
      course: typeof raw.course === "string" ? raw.course : "",
      specialization: typeof raw.specialization === "string" ? raw.specialization : "",
      semester: typeof raw.semester === "string" ? raw.semester : "",
      academicSession: typeof raw.academicSession === "string" ? raw.academicSession : "",
      studentId: typeof raw.studentId === "string" ? raw.studentId : "",
      preferredLanguage: raw.preferredLanguage || "English",
      noteStyle: raw.noteStyle || "Detailed",
      difficultyPreference: raw.difficultyPreference || "Intermediate",
      dailyStudyGoal: raw.dailyStudyGoal || "1 hr",
      customStudyGoalMinutes:
        typeof raw.customStudyGoalMinutes === "number" ? raw.customStudyGoalMinutes : undefined,
      revisionFrequency: raw.revisionFrequency || "Every 3 Days",
      notificationPreferences: raw.notificationPreferences
        ? {
            quizReminders: Boolean(raw.notificationPreferences.quizReminders),
            revisionReminders: Boolean(raw.notificationPreferences.revisionReminders),
            studyPlanReminders: Boolean(raw.notificationPreferences.studyPlanReminders),
            lectureProcessing: Boolean(raw.notificationPreferences.lectureProcessing),
            productUpdates: Boolean(raw.notificationPreferences.productUpdates),
          }
        : { ...DEFAULT_NOTIFICATION_PREFERENCES },
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    };
  }

  return null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("learnix_user") || localStorage.getItem("edupulse_user");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return normalizeStoredUser(parsed);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(true);

  const getAuthHeaders = useCallback((currentUser: User | null) => {
    const token = localStorage.getItem("learnix_token") || "";
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem("learnix_user", JSON.stringify(user));
      localStorage.removeItem("edupulse_user");
    } else {
      localStorage.removeItem("learnix_user");
      localStorage.removeItem("learnix_token");
      localStorage.removeItem("edupulse_user");
    }
  }, [user]);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await apiFetch("/api/me", {
        method: "GET",
        headers: getAuthHeaders(user),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const normalized = normalizeStoredUser(data.user);
          if (normalized) {
            setUser(normalized);
          }
        }
      } else if (res.status === 401) {
        setUser(null);
        localStorage.removeItem("learnix_user");
        localStorage.removeItem("learnix_token");
      }
    } catch (e) {
      console.warn("Could not refresh profile from server:", e);
    }
  }, [user?.id, user?.email, getAuthHeaders]);

  // Sync CSRF bootstrap and profile from backend on initial mount
  useEffect(() => {
    bootstrapCsrf().then((res) => {
      if (res) {
        setDemoEnabled(res.demoEnabled);
        if (res.csrfToken) {
          setCsrfToken(res.csrfToken);
        }
      }
    });
    refreshProfile();
  }, []);

  const login = async (email: string, password?: string) => {
    setIsLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const effectivePassword = password || (normalizedEmail === "alex.student@learnix.ai" ? "DemoStudent@123" : "");

    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: normalizedEmail, password: effectivePassword }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        if (data.token) {
          localStorage.setItem("learnix_token", data.token);
        }
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
        const normalized = normalizeStoredUser(data.user);
        if (normalized) {
          setUser(normalized);
        }
      } else {
        throw new Error(data.message || data.error || "Login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (
    name: string,
    email: string,
    password?: string,
    additionalProfile?: Partial<User>
  ) => {
    setIsLoading(true);
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const effectivePassword = password || "DemoStudent@123";

    try {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: normalizedName,
          email: normalizedEmail,
          password: effectivePassword,
          ...additionalProfile,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        if (data.token) {
          localStorage.setItem("learnix_token", data.token);
        }
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
        const normalized = normalizeStoredUser(data.user);
        if (normalized) {
          setUser(normalized);
        }
      } else {
        throw new Error(data.message || data.error || "Registration failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<User>): Promise<User> => {
    if (!user) {
      throw new Error("You must be signed in to update your profile.");
    }

    const res = await apiFetch("/api/me", {
      method: "PATCH",
      headers: getAuthHeaders(user),
      credentials: "include",
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || "Unable to update profile. Please try again.");
    }

    const data = await res.json();
    const normalized = normalizeStoredUser(data.user);
    if (!normalized) {
      throw new Error("Invalid profile response from server.");
    }

    setUser(normalized);
    return normalized;
  };

  const deleteAccount = async (): Promise<void> => {
    if (!user) return;
    const res = await apiFetch("/api/me", {
      method: "DELETE",
      headers: getAuthHeaders(user),
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Unable to delete account. Please try again.");
    }
    await logout();
  };

  const logout = async (): Promise<void> => {
    try {
      const res = await apiFetch("/api/auth/logout", {
        method: "POST",
        headers: getAuthHeaders(user),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data?.csrfToken) {
        setCsrfToken(data.csrfToken);
      }
    } catch (e) {
      console.warn("Logout request failed:", e);
    } finally {
      setUser(null);
      localStorage.removeItem("learnix_user");
      localStorage.removeItem("learnix_token");
      localStorage.removeItem("edupulse_user");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authUser: user,
        profile: user,
        isAuthenticated: Boolean(user),
        demoEnabled,
        login,
        register,
        updateProfile,
        deleteAccount,
        refreshProfile,
        logout,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
