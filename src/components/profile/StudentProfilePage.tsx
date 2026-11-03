import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  User as UserIcon,
  Mail,
  Phone,
  GraduationCap,
  BookOpen,
  Bell,
  ShieldAlert,
  LogOut,
  Trash2,
  Camera,
  CheckCircle2,
  AlertCircle,
  Edit3,
  ChevronRight,
  X,
  Upload,
} from "lucide-react";
import {
  useAuth,
  getStudentInitials,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "../../context/AuthContext";
import { APP_NAME } from "../../config/branding";
import { NotificationPreferences } from "../../types";

export const StudentProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, updateProfile, deleteAccount, logout } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullNameInputRef = useRef<HTMLInputElement>(null);

  // Edit mode states
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const [isEditingAcademic, setIsEditingAcademic] = useState(false);

  // Personal Information state
  const [fullName, setFullName] = useState(user?.fullName || user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || "");

  // Academic Profile state
  const [college, setCollege] = useState(user?.college || "");
  const [course, setCourse] = useState(user?.course || "");
  const [specialization, setSpecialization] = useState(user?.specialization || "");
  const [semester, setSemester] = useState(user?.semester || "");
  const [academicSession, setAcademicSession] = useState(user?.academicSession || "");
  const [studentId, setStudentId] = useState(user?.studentId || "");

  // Learning Preferences state
  const [preferredLanguage, setPreferredLanguage] = useState<"English" | "Hinglish" | "Hindi">(
    user?.preferredLanguage || "English"
  );
  const [noteStyle, setNoteStyle] = useState<"Concise" | "Detailed" | "Exam-focused">(
    user?.noteStyle || "Detailed"
  );
  const [difficultyPreference, setDifficultyPreference] = useState<
    "Beginner" | "Intermediate" | "Advanced"
  >(user?.difficultyPreference || "Intermediate");
  const [dailyStudyGoal, setDailyStudyGoal] = useState<"30 min" | "1 hr" | "2 hr" | "Custom">(
    user?.dailyStudyGoal || "1 hr"
  );
  const [customStudyGoalMinutes, setCustomStudyGoalMinutes] = useState<number>(
    user?.customStudyGoalMinutes || 90
  );
  const [revisionFrequency, setRevisionFrequency] = useState<
    "Daily" | "Every 3 Days" | "Weekly" | "Before Exams"
  >(user?.revisionFrequency || "Every 3 Days");

  // Notification Preferences state
  const [notifications, setNotifications] = useState<NotificationPreferences>(
    user?.notificationPreferences || { ...DEFAULT_NOTIFICATION_PREFERENCES }
  );

  // Feedback banner state
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Delete Account confirmation modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync local state when user updates from context
  useEffect(() => {
    if (user) {
      setFullName(user.fullName || user.name || "");
      setPhone(user.phone || "");
      setAvatarPreview(user.avatar || "");
      setCollege(user.college || "");
      setCourse(user.course || "");
      setSpecialization(user.specialization || "");
      setSemester(user.semester || "");
      setAcademicSession(user.academicSession || "");
      setStudentId(user.studentId || "");
      setPreferredLanguage(user.preferredLanguage || "English");
      setNoteStyle(user.noteStyle || "Detailed");
      setDifficultyPreference(user.difficultyPreference || "Intermediate");
      setDailyStudyGoal(user.dailyStudyGoal || "1 hr");
      setCustomStudyGoalMinutes(user.customStudyGoalMinutes || 90);
      setRevisionFrequency(user.revisionFrequency || "Every 3 Days");
      setNotifications(
        user.notificationPreferences || { ...DEFAULT_NOTIFICATION_PREFERENCES }
      );
    }
  }, [user]);

  // Scroll to hash section if navigated via #account-settings or #notifications
  useEffect(() => {
    if (location.hash) {
      const targetId = location.hash.replace("#", "");
      const el = document.getElementById(targetId);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    }
  }, [location.hash]);

  const showFeedback = (type: "success" | "error", text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showFeedback("error", "Please select a valid image file (PNG, JPG, or WebP).");
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      showFeedback("error", "Image file must be smaller than 4 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      setIsSaving(true);
      try {
        await updateProfile({ avatar: dataUrl });
        showFeedback("success", "Profile updated successfully.");
      } catch (err) {
        showFeedback("error", "Unable to update profile. Please try again.");
      } finally {
        setIsSaving(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveAvatar = async () => {
    setAvatarPreview("");
    setIsSaving(true);
    try {
      await updateProfile({ avatar: "" });
      showFeedback("success", "Profile updated successfully.");
    } catch (err) {
      showFeedback("error", "Unable to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      showFeedback("error", "Full Name cannot be empty.");
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({
        name: fullName.trim(),
        fullName: fullName.trim(),
        phone: phone.trim(),
        avatar: avatarPreview,
      });
      setIsEditingPersonal(false);
      showFeedback("success", "Profile updated successfully.");
    } catch (err) {
      showFeedback("error", "Unable to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelPersonal = () => {
    setFullName(user?.fullName || user?.name || "");
    setPhone(user?.phone || "");
    setAvatarPreview(user?.avatar || "");
    setIsEditingPersonal(false);
  };

  const handleSaveAcademic = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateProfile({
        college: college.trim(),
        course: course.trim(),
        specialization: specialization.trim(),
        semester: semester.trim(),
        academicSession: academicSession.trim(),
        studentId: studentId.trim(),
      });
      setIsEditingAcademic(false);
      showFeedback("success", "Profile updated successfully.");
    } catch (err) {
      showFeedback("error", "Unable to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelAcademic = () => {
    setCollege(user?.college || "");
    setCourse(user?.course || "");
    setSpecialization(user?.specialization || "");
    setSemester(user?.semester || "");
    setAcademicSession(user?.academicSession || "");
    setStudentId(user?.studentId || "");
    setIsEditingAcademic(false);
  };

  const handleSaveLearningPreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateProfile({
        preferredLanguage,
        noteStyle,
        difficultyPreference,
        dailyStudyGoal,
        customStudyGoalMinutes:
          dailyStudyGoal === "Custom" ? Number(customStudyGoalMinutes) || 60 : undefined,
        revisionFrequency,
      });
      showFeedback("success", "Profile updated successfully.");
    } catch (err) {
      showFeedback("error", "Unable to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleNotification = async (key: keyof NotificationPreferences) => {
    const updated: NotificationPreferences = {
      ...notifications,
      [key]: !notifications[key],
    };
    setNotifications(updated);
    setIsSaving(true);
    try {
      await updateProfile({ notificationPreferences: updated });
      showFeedback("success", "Profile updated successfully.");
    } catch (err) {
      showFeedback("error", "Unable to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteAccount();
      setIsDeleteModalOpen(false);
      navigate("/login", { replace: true });
    } catch (err) {
      showFeedback("error", "Unable to delete account. Please try again.");
      setIsDeleting(false);
    }
  };

  const displayName = user?.fullName || user?.name || "Alex Dev";
  const displayEmail = user?.email || "alex.student@learnix.ai";
  const initials = getStudentInitials(displayName);
  const hasAvatarImage = Boolean(avatarPreview && avatarPreview.trim());

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-7 animate-fade-in font-sans">
      {/* Hidden File Input for Avatar Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleAvatarFileChange}
        className="hidden"
      />

      {/* Top Breadcrumb & Page Heading */}
      <div className="border-b border-[#E4EAE7] dark:border-[#2C3B36] pb-5 space-y-2">
        <div className="flex items-center space-x-1.5 text-xs text-[#66736E] dark:text-[#9BA4A0]">
          <button
            type="button"
            onClick={() => navigate("/student-dashboard")}
            className="hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition-colors font-medium cursor-pointer"
          >
            {APP_NAME}
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-[#9BA4A0]" />
          <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">Profile</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
              My Profile
            </h1>
            <p className="text-xs sm:text-sm text-[#66736E] dark:text-[#9BA4A0] mt-1">
              Manage your personal information, academic details and learning preferences.
            </p>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {statusMessage && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-semibold animate-fade-in ${
            statusMessage.type === "success"
              ? "bg-[#E7F6F1] dark:bg-[#1E3730] border-[#168A72]/30 text-[#0F6B59] dark:text-[#23A98D]"
              : "bg-[#FDF0ED] dark:bg-[#38241D] border-[#E07A5F]/30 text-[#E07A5F]"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Two-Column Profile Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Profile Overview Card */}
        <div className="lg:col-span-4 space-y-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5">
            <div className="flex flex-col items-center text-center space-y-3">
              {/* Avatar Display */}
              <div className="relative group">
                {hasAvatarImage ? (
                  <img
                    src={avatarPreview}
                    alt={displayName}
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-[#168A72]/40 shadow-xs"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-[#E7F6F1] dark:bg-[#1E3730] border-2 border-[#168A72]/30 flex items-center justify-center text-2xl font-bold text-[#0F6B59] dark:text-[#23A98D] tracking-tight">
                    {initials}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1.5 -right-1.5 p-1.5 rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white shadow-sm transition cursor-pointer"
                  title={hasAvatarImage ? "Replace profile photo" : "Upload profile photo"}
                  aria-label={hasAvatarImage ? "Replace profile photo" : "Upload profile photo"}
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-0.5 min-w-0 w-full">
                <h2 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7] truncate">
                  {displayName}
                </h2>
                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] truncate">
                  {displayEmail}
                </p>
              </div>

              {/* Avatar Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] dark:hover:bg-[#2C3B36] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3 h-3 text-[#168A72]" />
                  <span>{hasAvatarImage ? "Replace Image" : "Upload Photo"}</span>
                </button>

                {hasAvatarImage && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={isSaving}
                    className="px-3 py-1.5 rounded-xl text-[11px] font-semibold text-[#E07A5F] hover:bg-[#FDF0ED] dark:hover:bg-[#38241D] border border-[#E07A5F]/20 transition cursor-pointer"
                  >
                    Remove Image
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-[#E4EAE7] dark:border-[#2C3B36] space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#66736E] dark:text-[#9BA4A0]">University</span>
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[160px]">
                  {user?.college || "Not specified"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#66736E] dark:text-[#9BA4A0]">Program</span>
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[160px]">
                  {user?.course || "Not specified"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#66736E] dark:text-[#9BA4A0]">Semester</span>
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[160px]">
                  {user?.semester || "Not specified"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#66736E] dark:text-[#9BA4A0]">Daily Study Goal</span>
                <span className="font-semibold text-[#168A72] dark:text-[#23A98D]">
                  {user?.dailyStudyGoal === "Custom"
                    ? `${user?.customStudyGoalMinutes || 90} min`
                    : user?.dailyStudyGoal || "1 hr"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsEditingPersonal(true);
                setTimeout(() => fullNameInputRef.current?.focus(), 50);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile</span>
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Editable Sections */}
        <div className="lg:col-span-8 space-y-6">
          {/* 1. PERSONAL INFORMATION CARD */}
          <section className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <UserIcon className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#17201D] dark:text-[#F1FAF7]">
                    Personal Information
                  </h2>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    Your student identity and contact information
                  </p>
                </div>
              </div>

              {!isEditingPersonal && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingPersonal(true);
                    setTimeout(() => fullNameInputRef.current?.focus(), 50);
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] dark:hover:bg-[#2C3B36] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#168A72]" />
                  <span>Edit</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSavePersonal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-full-name"
                    className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]"
                  >
                    Full Name
                  </label>
                  <div className="relative">
                    <UserIcon className="w-3.5 h-3.5 text-[#9BA4A0] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      ref={fullNameInputRef}
                      id="profile-full-name"
                      type="text"
                      disabled={!isEditingPersonal}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Dev"
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-email"
                    className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-[#9BA4A0] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="profile-email"
                      type="email"
                      readOnly
                      disabled
                      value={displayEmail}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-phone"
                    className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]"
                  >
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-[#9BA4A0] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="profile-phone"
                      type="tel"
                      disabled={!isEditingPersonal}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 234-5678"
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Profile Photo / Avatar
                  </span>
                  <div className="flex items-center gap-2.5 pt-0.5">
                    {hasAvatarImage ? (
                      <img
                        src={avatarPreview}
                        alt={displayName}
                        className="w-8 h-8 rounded-lg object-cover border border-[#168A72]/40 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/30 flex items-center justify-center text-xs font-bold text-[#0F6B59] dark:text-[#23A98D] shrink-0">
                        {getStudentInitials(fullName || displayName)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#F8FAF8] dark:bg-[#17201D] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition cursor-pointer"
                    >
                      {hasAvatarImage ? "Replace Photo" : "Upload Photo"}
                    </button>
                    {hasAvatarImage && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#E07A5F] hover:bg-[#FDF0ED] dark:hover:bg-[#38241D] transition cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isEditingPersonal && (
                <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={handleCancelPersonal}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </form>
          </section>

          {/* 2. ACADEMIC PROFILE CARD */}
          <section className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#17201D] dark:text-[#F1FAF7]">
                    Academic Profile
                  </h2>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    University, program, specialization, and current semester details
                  </p>
                </div>
              </div>

              {!isEditingAcademic && (
                <button
                  type="button"
                  onClick={() => setIsEditingAcademic(true)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] dark:hover:bg-[#2C3B36] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#168A72]" />
                  <span>Edit</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveAcademic} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    College / University
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={college}
                    onChange={(e) => setCollege(e.target.value)}
                    placeholder="e.g., Stanford University"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Course / Program
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="e.g., B.S. in Computer Science"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Specialization
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    placeholder="e.g., Artificial Intelligence & Systems"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Semester / Year
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    placeholder="e.g., Semester 5 (Junior Year)"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Academic Session
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={academicSession}
                    onChange={(e) => setAcademicSession(e.target.value)}
                    placeholder="e.g., 2025–2026"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Student ID / Enrollment Number{" "}
                    <span className="text-[#66736E] dark:text-[#9BA4A0] font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    disabled={!isEditingAcademic}
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="e.g., CS-2024-0891"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] disabled:opacity-70 focus:outline-none focus:border-[#168A72] transition"
                  />
                </div>
              </div>

              {isEditingAcademic && (
                <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={handleCancelAcademic}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </form>
          </section>

          {/* 3. LEARNING PREFERENCES CARD */}
          <section className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#17201D] dark:text-[#F1FAF7]">
                    Learning Preferences
                  </h2>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    Customize how AI study notes, quizzes, and revision plans are tailored for you
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveLearningPreferences} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Preferred Learning Language
                  </label>
                  <select
                    value={preferredLanguage}
                    onChange={(e) =>
                      setPreferredLanguage(e.target.value as "English" | "Hinglish" | "Hindi")
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                  >
                    <option value="English">English</option>
                    <option value="Hinglish">Hinglish</option>
                    <option value="Hindi">Hindi</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Preferred Note Style
                  </label>
                  <select
                    value={noteStyle}
                    onChange={(e) =>
                      setNoteStyle(e.target.value as "Concise" | "Detailed" | "Exam-focused")
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                  >
                    <option value="Concise">Concise</option>
                    <option value="Detailed">Detailed</option>
                    <option value="Exam-focused">Exam-focused</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Difficulty Preference
                  </label>
                  <select
                    value={difficultyPreference}
                    onChange={(e) =>
                      setDifficultyPreference(
                        e.target.value as "Beginner" | "Intermediate" | "Advanced"
                      )
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Daily Study Goal
                  </label>
                  <select
                    value={dailyStudyGoal}
                    onChange={(e) =>
                      setDailyStudyGoal(
                        e.target.value as "30 min" | "1 hr" | "2 hr" | "Custom"
                      )
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                  >
                    <option value="30 min">30 min</option>
                    <option value="1 hr">1 hr</option>
                    <option value="2 hr">2 hr</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>

                {dailyStudyGoal === "Custom" && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Custom Study Duration (Minutes)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={480}
                      value={customStudyGoalMinutes}
                      onChange={(e) => setCustomStudyGoalMinutes(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Preferred Revision Frequency
                  </label>
                  <select
                    value={revisionFrequency}
                    onChange={(e) =>
                      setRevisionFrequency(
                        e.target.value as "Daily" | "Every 3 Days" | "Weekly" | "Before Exams"
                      )
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72] transition"
                  >
                    <option value="Daily">Daily</option>
                    <option value="Every 3 Days">Every 3 Days</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Before Exams">Before Exams</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </section>

          {/* 4. NOTIFICATION PREFERENCES CARD */}
          <section
            id="notifications"
            className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5"
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#17201D] dark:text-[#F1FAF7]">
                    Notification Preferences
                  </h2>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    Control study reminders and lecture intelligence alerts
                  </p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-[#E4EAE7] dark:divide-[#2C3B36]">
              {[
                {
                  key: "quizReminders" as const,
                  label: "Quiz reminders",
                  description: "Get notified when adaptive practice drills are ready for review",
                },
                {
                  key: "revisionReminders" as const,
                  label: "Revision reminders",
                  description: "Scheduled nudges to revisit flagged weak concepts",
                },
                {
                  key: "studyPlanReminders" as const,
                  label: "Study plan reminders",
                  description: "Daily goal progress and weekly study schedule alerts",
                },
                {
                  key: "lectureProcessing" as const,
                  label: "Lecture processing notifications",
                  description: "Alerts when uploaded or recorded lectures finish AI indexing",
                },
                {
                  key: "productUpdates" as const,
                  label: "General product notifications",
                  description: "Occasional updates on new student study tools",
                },
              ].map((item) => {
                const isChecked = Boolean(notifications[item.key]);
                return (
                  <div
                    key={item.key}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                  >
                    <div>
                      <span className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] block">
                        {item.label}
                      </span>
                      <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                        {item.description}
                      </span>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={isChecked}
                      aria-label={item.label}
                      onClick={() => handleToggleNotification(item.key)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#168A72] ${
                        isChecked
                          ? "bg-[#168A72]"
                          : "bg-[#E4EAE7] dark:bg-[#2C3B36]"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                          isChecked ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 5. ACCOUNT SETTINGS CARD */}
          <section
            id="account-settings"
            className="p-6 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-5"
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F] flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#17201D] dark:text-[#F1FAF7]">
                    Account Settings
                  </h2>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    Manage your active student session and account lifecycle
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Log Out Row */}
              <div className="p-4 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Sign Out of {APP_NAME}
                  </h3>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    End your current student session on this browser
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
                  <span>Log Out</span>
                </button>
              </div>

              {/* Delete Account Row */}
              <div className="p-4 rounded-xl bg-[#FDF0ED]/50 dark:bg-[#38241D]/30 border border-[#E07A5F]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-[#E07A5F]">
                    Delete Student Account
                  </h3>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                    Permanently remove your student profile and personal study settings
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#E07A5F] hover:bg-[#c9654b] text-white transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Account</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F] flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3
                  id="delete-account-title"
                  className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]"
                >
                  Delete your account?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] leading-relaxed">
              This will permanently remove your profile and associated personal data. This action cannot be undone.
            </p>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] dark:hover:bg-[#2C3B36] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAccount}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#E07A5F] hover:bg-[#c9654b] text-white transition cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
