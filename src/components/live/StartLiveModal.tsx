import React, { useState, useEffect } from "react";
import {
  Mic,
  X,
  AlertCircle,
  BookOpen,
  User,
  Languages,
  Check,
  GraduationCap,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Tag,
  CheckCircle2,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";
import { Teacher, Subject, Topic, StudentAcademicContext } from "../../types";
import { apiFetch } from "../../services/apiClient";

interface StartLiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type WizardStepId = "TEACHER" | "SUBJECT" | "TOPIC" | "LANGUAGE" | "TITLE";

interface WizardStepMeta {
  id: WizardStepId;
  index: number;
  label: string;
  shortLabel: string;
}

const WIZARD_STEPS: WizardStepMeta[] = [
  { id: "TEACHER", index: 1, label: "Teacher", shortLabel: "Teacher" },
  { id: "SUBJECT", index: 2, label: "Subject", shortLabel: "Subject" },
  { id: "TOPIC", index: 3, label: "Topics", shortLabel: "Topics" },
  { id: "LANGUAGE", index: 4, label: "Language", shortLabel: "Language" },
  { id: "TITLE", index: 5, label: "Start", shortLabel: "Start" },
];

const SUPPORTED_LANGUAGES = [
  { code: "auto", label: "Auto-Detect (Multilingual)", flag: "🌐" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi (हिन्दी)", flag: "🇮🇳" },
  { code: "hinglish", label: "Hinglish (Hindi + English)", flag: "🇮🇳" },
  { code: "bn", label: "Bengali (বাংলা)", flag: "🇮🇳" },
  { code: "ta", label: "Tamil (தமிழ்)", flag: "🇮🇳" },
  { code: "te", label: "Telugu (తెలుగు)", flag: "🇮🇳" },
  { code: "mr", label: "Marathi (मराठी)", flag: "🇮🇳" },
  { code: "es", label: "Spanish (Español)", flag: "🇪🇸" },
  { code: "fr", label: "French (Français)", flag: "🇫🇷" },
  { code: "de", label: "German (Deutsch)", flag: "🇩🇪" },
  { code: "ja", label: "Japanese (日本語)", flag: "🇯🇵" },
];

export const StartLiveModal: React.FC<StartLiveModalProps> = ({ isOpen, onClose }) => {
  const { startLiveLecture } = useLecture();

  // Active Wizard Step State Machine
  const [currentStep, setCurrentStep] = useState<WizardStepId>("TEACHER");

  // Academic Master Data Collections
  const [academicContext, setAcademicContext] = useState<StudentAcademicContext | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  // Loading States per Step
  const [isLoadingTeachers, setIsLoadingTeachers] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  // User Selections (Preserved across backward/forward navigation)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");
  const [title, setTitle] = useState("");

  // Consent & Execution State
  const [consentChecked, setConsentChecked] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper for auth headers
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("learnix_token") || "";
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // 1. Initial Load: Fetch Student Academic Context and Teachers on Modal Open
  useEffect(() => {
    if (!isOpen) return;

    setCurrentStep("TEACHER");
    setConsentChecked(false);
    setError(null);
    setIsLoadingTeachers(true);

    const loadStudentContext = async () => {
      try {
        const res = await apiFetch("/api/academic/student-context", {
          headers: getAuthHeaders(),
          credentials: "include",
        });

        if (res.ok) {
          const data: StudentAcademicContext = await res.json();
          setAcademicContext(data);

          const teacherList: Teacher[] = data.allowedTeachers || [];
          setTeachers(teacherList);

          if (teacherList.length > 0 && !selectedTeacherId) {
            setSelectedTeacherId(teacherList[0].id);
          }
        } else {
          // Fallback to general teachers if academic context endpoint is not yet seeded
          const fallbackRes = await apiFetch("/api/master/teachers", {
            headers: getAuthHeaders(),
            credentials: "include",
          });
          if (fallbackRes.ok) {
            const data: Teacher[] = await fallbackRes.json();
            setTeachers(data);
            if (data.length > 0 && !selectedTeacherId) {
              setSelectedTeacherId(data[0].id);
            }
          }
        }
      } catch (err) {
        console.warn("Could not load student academic context:", err);
        setError("Could not load faculty list. Please check your network connection.");
      } finally {
        setIsLoadingTeachers(false);
      }
    };

    loadStudentContext();
  }, [isOpen]);

  // 2. Cascade Step: When selected teacher changes, reload strictly associated subjects
  useEffect(() => {
    if (!isOpen || !selectedTeacherId) {
      setSubjects([]);
      setSelectedSubjectId("");
      return;
    }

    setIsLoadingSubjects(true);
    const loadTeacherSubjects = async () => {
      try {
        const res = await apiFetch(`/api/academic/subjects?teacherId=${selectedTeacherId}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });

        if (res.ok) {
          const data: Subject[] = await res.json();
          setSubjects(data);

          // If current subject is invalid for this teacher, select first available or reset
          const isStillValid = data.some((s) => s.id === selectedSubjectId);
          if (!isStillValid) {
            if (data.length > 0) {
              const first = data[0];
              setSelectedSubjectId(first.id);
              const subName = first.subjectName || first.name || "Subject";
              if (!title || title.endsWith("Lecture")) {
                setTitle(`${subName} Lecture`);
              }
            } else {
              setSelectedSubjectId("");
            }
            // Clear dependent topics on subject change
            setSelectedTopicIds([]);
            setTopics([]);
          }
        }
      } catch (err) {
        console.warn("Could not load subjects for teacher:", err);
      } finally {
        setIsLoadingSubjects(false);
      }
    };

    loadTeacherSubjects();
  }, [selectedTeacherId, isOpen]);

  // 3. Cascade Step: When selected subject changes, load strictly associated topics
  useEffect(() => {
    if (!isOpen || !selectedSubjectId) {
      setTopics([]);
      setSelectedTopicIds([]);
      return;
    }

    const sub = subjects.find((s) => s.id === selectedSubjectId);
    if (sub) {
      const subName = sub.subjectName || sub.name || "Subject";
      if (!title || title.endsWith("Lecture")) {
        setTitle(`${subName} Lecture`);
      }
    }

    setIsLoadingTopics(true);
    const loadSubjectTopics = async () => {
      try {
        const res = await apiFetch(`/api/academic/topics?subjectId=${selectedSubjectId}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });

        if (res.ok) {
          const data: Topic[] = await res.json();
          setTopics(data);
          // Keep selection clean on subject switch
          setSelectedTopicIds([]);
        } else {
          setTopics([]);
        }
      } catch (err) {
        console.warn("Could not load topics for subject:", err);
        setTopics([]);
      } finally {
        setIsLoadingTopics(false);
      }
    };

    loadSubjectTopics();
  }, [selectedSubjectId, isOpen]);

  if (!isOpen) return null;

  // Topic Toggle Handler
  const toggleTopic = (topicId: string, topicName: string) => {
    setSelectedTopicIds((prev) => {
      const exists = prev.includes(topicId);
      const next = exists ? prev.filter((id) => id !== topicId) : [...prev, topicId];
      if (!exists && (!title || title.endsWith("Lecture"))) {
        setTitle(topicName);
      }
      return next;
    });
  };

  const selectAllTopics = () => {
    setSelectedTopicIds(topics.map((t) => t.id));
  };

  const clearAllTopics = () => {
    setSelectedTopicIds([]);
  };

  // Step Navigation State Machine
  const goToStep = (step: WizardStepId) => {
    setError(null);
    setCurrentStep(step);
  };

  const handleNextFromTeacher = () => {
    if (!selectedTeacherId) {
      setError("Please select a teacher to continue.");
      return;
    }
    setError(null);
    setCurrentStep("SUBJECT");
  };

  const handleNextFromSubject = () => {
    if (!selectedSubjectId) {
      setError("Please select an enrolled subject to continue.");
      return;
    }
    setError(null);
    setCurrentStep("TOPIC");
  };

  const handleNextFromTopic = () => {
    // Topic selection is optional; student can proceed whether 0 or multiple topics are selected
    setError(null);
    setCurrentStep("LANGUAGE");
  };

  const handleNextFromLanguage = () => {
    if (!selectedLanguage) {
      setError("Please choose a spoken language.");
      return;
    }
    setError(null);
    setCurrentStep("TITLE");
  };

  // Final Submission Handler
  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();

    const selectedTeacher = teachers.find((t) => t.id === selectedTeacherId);
    const selectedSub = subjects.find((s) => s.id === selectedSubjectId);

    if (!selectedTeacher || !selectedSub) {
      setError("Please select both a valid teacher and an enrolled subject.");
      return;
    }

    if (!title.trim()) {
      setError("Please enter a lecture title.");
      return;
    }

    if (!consentChecked) {
      setError("Please acknowledge microphone recording consent to continue.");
      return;
    }

    const finalSubjectName = selectedSub.subjectName || selectedSub.name || "General";
    const finalInstructorName = selectedTeacher.name;

    setError(null);
    setIsStarting(true);

    try {
      const success = await startLiveLecture(
        title.trim(),
        finalSubjectName,
        finalInstructorName,
        {
          teacherId: selectedTeacher.id,
          subjectId: selectedSub.id,
          topicIds: selectedTopicIds.length > 0 ? selectedTopicIds : undefined,
          language: selectedLanguage,
        }
      );
      if (success) {
        onClose();
      } else {
        setError("Could not access microphone. Please check browser permissions and try again.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to start live lecture recording.");
    } finally {
      setIsStarting(false);
    }
  };

  // Metadata Lookups
  const activeTeacher = teachers.find((t) => t.id === selectedTeacherId);
  const activeSubject = subjects.find((s) => s.id === selectedSubjectId);
  const activeLanguageObj = SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage);
  const currentStepMeta = WIZARD_STEPS.find((s) => s.id === currentStep) || WIZARD_STEPS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
                  Start Live Lecture
                </h2>
                {academicContext?.semester && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
                    <GraduationCap className="w-3 h-3" />
                    {academicContext.semester}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                Step {currentStepMeta.index} of 5: {currentStepMeta.label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 5-Step Visual Wizard Progress Stepper */}
        <div className="px-6 py-2.5 bg-[#FAFCFA] dark:bg-[#141C19] border-b border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between">
          {WIZARD_STEPS.map((step, idx) => {
            const isCurrent = step.id === currentStep;
            const isCompleted = step.index < currentStepMeta.index;
            return (
              <React.Fragment key={step.id}>
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition ${
                      isCompleted
                        ? "bg-[#168A72] text-white"
                        : isCurrent
                        ? "bg-[#168A72] text-white ring-2 ring-[#168A72]/30"
                        : "bg-[#E4EAE7] dark:bg-[#2C3B36] text-[#66736E] dark:text-[#9BA4A0]"
                    }`}
                  >
                    {isCompleted ? <Check className="w-3 h-3" /> : step.index}
                  </div>
                  <span
                    className={`text-[11px] font-medium hidden sm:inline ${
                      isCurrent
                        ? "text-[#168A72] dark:text-[#23A98D] font-bold"
                        : isCompleted
                        ? "text-[#17201D] dark:text-[#F1FAF7]"
                        : "text-[#9BA4A0]"
                    }`}
                  >
                    {step.shortLabel}
                  </span>
                </div>
                {idx < WIZARD_STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1.5 transition ${
                      isCompleted ? "bg-[#168A72]" : "bg-[#E4EAE7] dark:bg-[#2C3B36]"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Modal Form & Step Content */}
        <form onSubmit={handleStart} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-[#FDF0ED] dark:bg-[#38241D] border border-[#E07A5F]/30 rounded-xl text-xs text-[#E07A5F] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: TEACHER SELECTION */}
          {currentStep === "TEACHER" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#168A72]" />
                  1. Choose Faculty Instructor *
                </label>
                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mb-2">
                  Select the professor or lecturer conducting this session. Subjects will filter to their assigned courses.
                </p>
              </div>

              {isLoadingTeachers ? (
                <div className="py-8 text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#168A72] mx-auto" />
                  <p className="text-xs text-[#66736E]">Loading verified faculty directory...</p>
                </div>
              ) : teachers.length === 0 ? (
                <div className="p-4 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-center text-[#66736E]">
                  No instructors found for your program. Please contact your institution administrator.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {teachers.map((t) => {
                    const isSelected = t.id === selectedTeacherId;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => setSelectedTeacherId(t.id)}
                        className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? "border-[#168A72] bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 text-[#17201D] dark:text-[#F1FAF7]"
                            : "border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#17201D] text-[#66736E] dark:text-[#9BA4A0] hover:border-[#168A72]/40"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-[#17201D] dark:text-[#F1FAF7]">
                            {t.name}
                          </div>
                          <div className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                            {t.designation || "Faculty"} · {t.department}
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: SUBJECT SELECTION */}
          {currentStep === "SUBJECT" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[#168A72]" />
                  2. Choose Enrolled Subject *
                </label>
                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mb-2">
                  Showing courses taught by{" "}
                  <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    {activeTeacher?.name || "selected instructor"}
                  </span>
                  .
                </p>
              </div>

              {isLoadingSubjects ? (
                <div className="py-8 text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#168A72] mx-auto" />
                  <p className="text-xs text-[#66736E]">Loading courses for {activeTeacher?.name}...</p>
                </div>
              ) : subjects.length === 0 ? (
                <div className="p-4 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-center text-[#66736E]">
                  No enrolled subjects assigned to this instructor. Please select a different teacher.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {subjects.map((s) => {
                    const isSelected = s.id === selectedSubjectId;
                    const code = s.subjectCode || s.code || "COURSE";
                    const name = s.subjectName || s.name || "Subject";
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => setSelectedSubjectId(s.id)}
                        className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? "border-[#168A72] bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 text-[#17201D] dark:text-[#F1FAF7]"
                            : "border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#17201D] text-[#66736E] dark:text-[#9BA4A0] hover:border-[#168A72]/40"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-[#17201D] dark:text-[#F1FAF7]">
                            <span className="text-[#168A72] dark:text-[#23A98D] mr-1.5">{code}</span>
                            {name}
                          </div>
                          {s.description && (
                            <div className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] line-clamp-1">
                              {s.description}
                            </div>
                          )}
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: TOPICS SELECTION */}
          {currentStep === "TOPIC" && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-[#168A72]" />
                    3. Focus Topics (Optional)
                  </label>
                  <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                    Select specific topics to emphasize during AI note synthesis, or skip for full lecture coverage.
                  </p>
                </div>
                {topics.length > 0 && (
                  <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] bg-[#E7F6F1] dark:bg-[#1E3730] px-2 py-0.5 rounded-full shrink-0">
                    {selectedTopicIds.length} of {topics.length} selected
                  </span>
                )}
              </div>

              {isLoadingTopics ? (
                <div className="py-8 text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#168A72] mx-auto" />
                  <p className="text-xs text-[#66736E]">Loading course syllabus topics...</p>
                </div>
              ) : topics.length === 0 ? (
                <div className="p-4 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-center space-y-2">
                  <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                    No specific syllabus topics have been registered for this course yet.
                  </p>
                  <p className="text-[11px] text-[#9BA4A0]">
                    You can safely continue; AI will transcribe and detect lecture concepts automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-end gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllTopics}
                      className="text-[#168A72] hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-[#9BA4A0]">·</span>
                    <button
                      type="button"
                      onClick={clearAllTopics}
                      className="text-[#66736E] dark:text-[#9BA4A0] hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D]">
                    {topics.map((top) => {
                      const isSelected = selectedTopicIds.includes(top.id);
                      const topName = top.topicName || top.name || "Topic";
                      return (
                        <button
                          type="button"
                          key={top.id}
                          onClick={() => toggleTopic(top.id, topName)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? "bg-[#168A72] text-white shadow-2xs"
                              : "bg-white dark:bg-[#232F2B] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36]"
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                          <span>{topName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: LANGUAGE SELECTION */}
          {currentStep === "LANGUAGE" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5 text-[#168A72]" />
                  4. Spoken Language / Classroom Dialect *
                </label>
                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mb-2">
                  Select the language spoken by the teacher. Authentic Unicode script (e.g. Devanagari) is preserved.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isSelected = lang.code === selectedLanguage;
                  return (
                    <button
                      type="button"
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang.code)}
                      className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? "border-[#168A72] bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 text-[#17201D] dark:text-[#F1FAF7]"
                          : "border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#17201D] text-[#66736E] dark:text-[#9BA4A0] hover:border-[#168A72]/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{lang.flag}</span>
                        <span className="text-xs font-medium text-[#17201D] dark:text-[#F1FAF7]">
                          {lang.label}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5: TITLE & START */}
          {currentStep === "TITLE" && (
            <div className="space-y-3.5">
              {/* Summary Recap Card */}
              <div className="p-3.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#66736E] dark:text-[#9BA4A0]">Teacher:</span>
                  <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    {activeTeacher?.name || "Instructor"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#66736E] dark:text-[#9BA4A0]">Subject:</span>
                  <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    {activeSubject ? `${activeSubject.subjectCode || activeSubject.code} · ${activeSubject.subjectName || activeSubject.name}` : "Course"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#66736E] dark:text-[#9BA4A0]">Language:</span>
                  <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    {activeLanguageObj?.flag} {activeLanguageObj?.label}
                  </span>
                </div>
                {selectedTopicIds.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#66736E] dark:text-[#9BA4A0]">Focus Topics:</span>
                    <span className="font-semibold text-[#168A72] dark:text-[#23A98D]">
                      {selectedTopicIds.length} topic{selectedTopicIds.length > 1 ? "s" : ""} selected
                    </span>
                  </div>
                )}
              </div>

              {/* Lecture Title Input */}
              <div>
                <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
                  5. Lecture Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Stack Basics & Push/Pop Pointer Operations"
                  className="w-full px-3.5 py-2.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72]"
                />
              </div>

              {/* Privacy & Microphone Consent Notice */}
              <div className="p-3.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#66736E] dark:text-[#9BA4A0]">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="mic-consent"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72] cursor-pointer"
                  />
                  <label htmlFor="mic-consent" className="cursor-pointer select-none leading-relaxed text-[11px]">
                    <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Microphone Recording Consent
                    </span>
                    : I authorize {APP_NAME} to record and transcribe this lecture. Audio is processed for study notes synthesis and can be paused or stopped at any moment.
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Action Navigation Bar */}
          <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between shrink-0">
            {/* Left: Back / Cancel */}
            {currentStep === "TEACHER" ? (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (currentStep === "SUBJECT") goToStep("TEACHER");
                  else if (currentStep === "TOPIC") goToStep("SUBJECT");
                  else if (currentStep === "LANGUAGE") goToStep("TOPIC");
                  else if (currentStep === "TITLE") goToStep("LANGUAGE");
                }}
                className="px-3.5 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] rounded-xl transition flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            {/* Right: Continue / Start */}
            {currentStep === "TEACHER" && (
              <button
                type="button"
                onClick={handleNextFromTeacher}
                disabled={!selectedTeacherId || isLoadingTeachers}
                className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Subject</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === "SUBJECT" && (
              <button
                type="button"
                onClick={handleNextFromSubject}
                disabled={!selectedSubjectId || isLoadingSubjects}
                className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Topics</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Step 3: Crucially provides clear Continue or Skip Topics buttons that never get stuck */}
            {currentStep === "TOPIC" && (
              <div className="flex items-center gap-2">
                {topics.length > 0 && selectedTopicIds.length === 0 && (
                  <button
                    type="button"
                    onClick={handleNextFromTopic}
                    className="px-3 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] rounded-xl transition cursor-pointer"
                  >
                    Skip Topics
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNextFromTopic}
                  disabled={isLoadingTopics}
                  className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
                >
                  <span>
                    {topics.length === 0 || selectedTopicIds.length === 0
                      ? "Continue to Language"
                      : `Continue with ${selectedTopicIds.length} Topic${selectedTopicIds.length > 1 ? "s" : ""}`}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {currentStep === "LANGUAGE" && (
              <button
                type="button"
                onClick={handleNextFromLanguage}
                disabled={!selectedLanguage}
                className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Final Step</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === "TITLE" && (
              <button
                type="submit"
                disabled={isStarting || !consentChecked || !selectedTeacherId || !selectedSubjectId || !title.trim()}
                className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>{isStarting ? "Connecting Mic..." : "Start Recording"}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
