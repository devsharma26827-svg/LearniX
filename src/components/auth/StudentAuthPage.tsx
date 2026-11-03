import React, { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  Mail,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle2,
  BookOpen,
  Mic,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { APP_NAME, APP_CONFIG } from "../../config/branding";
import { ThemeToggle } from "../common/ThemeToggle";

interface StudentAuthPageProps {
  mode: "login" | "register";
}

export const StudentAuthPage: React.FC<StudentAuthPageProps> = ({ mode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, isLoading, demoEnabled } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If in demo mode and email is empty on login screen, offer one-click demo prefill via button
  useEffect(() => {
    if (demoEnabled && mode === "login" && !email) {
      setEmail("alex.student@learnix.ai");
      setPassword("DemoStudent@123");
    }
  }, [demoEnabled, mode]);

  const fromPath = (location.state as any)?.from?.pathname;
  const redirectTarget =
    fromPath && fromPath !== "/login" && fromPath !== "/register" && fromPath !== "/teacher-dashboard"
      ? fromPath
      : "/student-dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (!name.trim() || name.trim().length < 2) {
        setError("Please enter your full name (minimum 2 characters).");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match. Please re-enter.");
        return;
      }
    }

    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid student email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(name.trim(), email.trim(), password);
      }
      navigate(redirectTarget, { replace: true });
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please check your credentials.");
    }
  };

  const handleQuickDemoLogin = async () => {
    setError(null);
    try {
      await login("alex.student@learnix.ai", "DemoStudent@123");
      navigate(redirectTarget, { replace: true });
    } catch (err: any) {
      setError(err.message || "Demo login failed.");
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] flex flex-col justify-between font-sans transition-colors">
      {/* Top Bar */}
      <header className="w-full h-16 px-6 sm:px-10 flex items-center justify-between border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-white/90 dark:bg-[#1B2421]/90 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#168A72] flex items-center justify-center text-white shadow-xs">
            <span className="font-mono text-xs font-bold tracking-tight">{APP_CONFIG.shortCode}</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
            {APP_NAME}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle size="md" />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Platform Value Proposition */}
          <div className="lg:col-span-6 space-y-6 hidden lg:block pr-4">
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wider text-[#168A72] dark:text-[#23A98D] font-semibold">
                Student Learning Workspace
              </p>
              <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7] leading-tight">
                Turn Every Classroom Lecture into Structured Study Material.
              </h1>
              <p className="text-sm text-[#66736E] dark:text-[#9BA4A0] leading-relaxed">
                Record live classes or upload lecture recordings to automatically generate timestamped chapters, AI study notes, adaptive quizzes, and personalized revision plans.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3.5 pt-2">
              <div className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-1.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <Mic className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Live Audio Capture
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                  Real-time speech transcription with concept detection
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-1.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Smart Study Notes
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                  Key definitions, formulas, and source timestamps
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-1.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Adaptive Quizzes
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                  Instant self-evaluation and weak topic detection
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-1.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Grounded Doubt Q&A
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                  Ask questions answered directly from lecture context
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Auth Card */}
          <div className="lg:col-span-6">
            <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-sm p-6 sm:p-8 max-w-md mx-auto space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-bold text-[#17201D] dark:text-[#F1FAF7]">
                  {mode === "login" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                  {mode === "login"
                    ? "Sign in to access your lectures, study notes, and revision plan."
                    : "Sign up to start capturing lectures and building your AI study library."}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#FDF0ED] dark:bg-[#38241D] border border-[#E07A5F]/30 text-xs text-[#E07A5F] font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "register" && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Full Name
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-[#9BA4A0] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        placeholder="Alex Dev"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#9BA4A0] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="alex.student@learnix.ai"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Password
                    </label>
                    {mode === "register" && (
                      <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                        Min. 8 characters
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#9BA4A0] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 text-xs sm:text-sm rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === "register" && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#9BA4A0] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white font-semibold text-xs sm:text-sm shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>
                    {isLoading
                      ? "Signing in..."
                      : mode === "login"
                      ? "Sign In"
                      : "Create Account"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Quick Demo Access (strictly disabled in production) */}
              <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] space-y-3">
                {demoEnabled && (
                  <button
                    type="button"
                    onClick={handleQuickDemoLogin}
                    disabled={isLoading}
                    className="w-full py-2 px-3.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/40 text-xs font-medium text-[#17201D] dark:text-[#F1FAF7] transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#168A72]" />
                    <span>Continue with Demo Account (Alex Dev)</span>
                  </button>
                )}

                <p className="text-center text-xs text-[#66736E] dark:text-[#9BA4A0]">
                  {mode === "login" ? (
                    <>
                      New to {APP_NAME}?{" "}
                      <Link
                        to="/register"
                        className="font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] transition-colors"
                      >
                        Create an account
                      </Link>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <Link
                        to="/login"
                        className="font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] transition-colors"
                      >
                        Sign in
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 px-6 text-center text-[11px] text-[#66736E] dark:text-[#9BA4A0] border-t border-[#E4EAE7] dark:border-[#2C3B36]">
        {APP_NAME} · {APP_CONFIG.subtitle} · Built for student lecture intelligence, smart notes & revision
      </footer>
    </div>
  );
};
