export interface NotificationPreferences {
  quizReminders: boolean;
  revisionReminders: boolean;
  studyPlanReminders: boolean;
  lectureProcessing: boolean;
  productUpdates: boolean;
}

export interface User {
  id: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  avatar?: string;
  role?: "student" | "admin";
  isVerified?: boolean;
  status?: "active" | "suspended";
  college?: string;
  course?: string;
  specialization?: string;
  semester?: string;
  academicSession?: string;
  studentId?: string;
  preferredLanguage?: "English" | "Hinglish" | "Hindi";
  noteStyle?: "Concise" | "Detailed" | "Exam-focused";
  difficultyPreference?: "Beginner" | "Intermediate" | "Advanced";
  dailyStudyGoal?: "30 min" | "1 hr" | "2 hr" | "Custom";
  customStudyGoalMinutes?: number;
  revisionFrequency?: "Daily" | "Every 3 Days" | "Weekly" | "Before Exams";
  notificationPreferences?: NotificationPreferences;
  createdAt?: string;
  updatedAt?: string;
}

export type StudentProfile = User;

export interface TranscriptSegment {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
  topic?: string;
  speaker?: string;
  detectedLanguage?: string;
  languageCode?: string;
  isImportant?: boolean;
  isDefinition?: boolean;
  isExample?: boolean;
  isKeyPoint?: boolean;
  confidence?: number;
}

export interface Chapter {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  description: string;
  keyConcepts: string[];
  summaryPoints?: string[];
}

export interface DefinitionItem {
  term: string;
  definition: string;
  timestamp?: number;
}

export interface SmartNoteSection {
  id: string;
  topic: string;
  summary: string;
  definitions: DefinitionItem[];
  keyConcepts: string[];
  proceduresOrSteps?: string[];
  procedures?: string[];
  examples: string[];
  formulas?: string[];
  importantPoints: string[];
  sourceTimestamps: {
    start: number;
    end: number;
  }[];
}

export type SmartNote = SmartNoteSection;

export type QuestionType = "mcq" | "short_answer" | "conceptual";
export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface QuizQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[]; // for MCQ
  correctAnswer: string;
  explanation: string;
  sourceChapter: string;
  sourceTimestamp: number;
  difficulty: QuestionDifficulty;
  topic: string;
}

export interface QuestionResult {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  score: number; // 0 or 1
  feedback: string;
  topic: string;
  difficulty: QuestionDifficulty;
}

export interface TopicPerformance {
  total: number;
  correct: number;
  accuracy: number;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  lectureId: string;
  timestamp: string;
  answers: Record<string, string>;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount?: number;
  totalQuestions?: number;
  questionResults: QuestionResult[];
  topicBreakdown: Record<string, TopicPerformance>;
  weakTopics: string[];
}

export interface Quiz {
  id: string;
  lectureId: string;
  title: string;
  questions: QuizQuestion[];
  totalQuestions: number;
  createdAt: string;
}

export interface MiniPracticeQuestion {
  id: string;
  question: string;
  answerHint: string;
  expectedKeyTerms: string[];
}

export interface WeakTopic {
  id: string;
  lectureId: string;
  topicName: string;
  accuracy: number;
  explanation: string;
  reviewTimestampRange?: {
    start: number;
    end: number;
  };
  recommendedTimestampStart: number;
  recommendedTimestampEnd: number;
  practiceDrill: QuizQuestion[];
  miniPracticeQuestions?: MiniPracticeQuestion[];
  recommendedAction: string;
  status: "pending" | "practicing" | "mastered";
}

export interface RagSource {
  chapterTitle?: string;
  chapter?: string;
  timestamp?: number;
  timestampStart?: number;
  timestampEnd?: number;
  context?: string;
  snippet?: string;
  confidence?: number;
  relevanceScore?: number;
}

export interface RagResponse {
  answer: string;
  sources: RagSource[];
  isLectureGrounded?: boolean;
  generalKnowledgeOffered?: boolean;
  suggestedFollowUps?: string[];
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  sources?: RagSource[];
  isLectureGrounded?: boolean;
  timestamp: string;
}

export type LectureStatus = "idle" | "recording" | "processing" | "ready" | "failed";
export type LectureSource = "live" | "upload" | "sample";

export interface ProcessingProgress {
  stage: string;
  percent: number;
  message: string;
  steps: {
    name: string;
    completed: boolean;
    active: boolean;
  }[];
}

export interface Lecture {
  id: string;
  title: string;
  subject: string;
  instructor?: string;
  date: string;
  duration: number; // in seconds
  status: LectureStatus;
  source: LectureSource;
  audioUrl?: string;
  videoUrl?: string;
  transcript: TranscriptSegment[];
  chapters: Chapter[];
  notes: SmartNoteSection[];
  quiz?: Quiz;
  attempts: QuizAttempt[];
  weakTopics: WeakTopic[];
  processingProgress?: ProcessingProgress;
  createdBy: string;
  createdAt?: string;
  tags?: string[];
  teacherId?: string;
  subjectId?: string;
  topicIds?: string[];
  language?: string;
}

export interface Teacher {
  id: string;
  name: string;
  email?: string;
  department: string;
  designation: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Subject {
  id: string;
  subjectCode: string;
  subjectName: string;
  description?: string;
  semester?: string;
  department?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Topic {
  id: string;
  subjectId: string;
  topicName: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeacherSubject {
  id: string;
  teacherId: string;
  subjectId: string;
  createdAt?: string;
}

export interface SearchResultItem {
  lectureId: string;
  lectureTitle: string;
  chapterTitle: string;
  timestamp: number;
  text: string;
  matchType: "transcript" | "notes" | "definitions" | "concept";
}

export interface ModelQuotaStatus {
  name: string;
  rpdUsed: number;
  rpdLimit: number;
  rpdRemaining: number;
  rpmCurrent: number;
  rpmLimit: number;
  isDailyQuotaExhausted: boolean;
  dailyResetAt: string;
  secondsUntilReset: number;
  status: "available" | "daily_exhausted" | "rate_limited";
  reason?: string;
}

export interface AiUsageMetrics {
  totalAiRequests: number;
  totalCachedRequests: number;
  totalFallbackRequests: number;
  totalFailedRequests: number;
  pendingTasksCount: number;
  queuedTasksCount: number;
  activeRequests: number;
}

export interface AiUsageReport {
  provider: string;
  activeModels: string[];
  metrics: AiUsageMetrics;
  models: Record<string, ModelQuotaStatus>;
  circuitBreakerActive: boolean;
  lastUpdated: string;
}

