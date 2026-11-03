import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Lecture, TranscriptSegment, RagResponse, QuizAttempt, WeakTopic } from "../types";
import { useAuth } from "./AuthContext";

export type ViewType =
  | "landing"
  | "student-dashboard"
  | "library"
  | "live"
  | "processing"
  | "workspace";

export type WorkspaceTab =
  | "overview"
  | "transcript"
  | "chapters"
  | "notes"
  | "ask"
  | "quiz"
  | "revision"
  | "pdf";

interface LiveSessionState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number; // in seconds
  currentTopic: string;
  detectedConcepts: string[];
  detectedDefinitions: string[];
  detectedExamples: string[];
  mediaStream: MediaStream | null;
  audioAnalyser: AnalyserNode | null;
  audioDataArray: Uint8Array | null;
  errorMessage: string | null;
  hasMicrophoneConsent: boolean;
}

interface LectureContextType {
  lectures: Lecture[];
  activeLecture: Lecture | null;
  activeView: ViewType;
  workspaceTab: WorkspaceTab;
  liveSession: LiveSessionState;
  isLoading: boolean;
  searchQuery: string;
  setActiveView: (view: ViewType) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  setSearchQuery: (query: string) => void;
  openLecture: (lectureId: string, tab?: WorkspaceTab) => Promise<void>;
  fetchLectures: () => Promise<void>;
  createNewLecture: (
    title: string,
    subject: string,
    instructor?: string,
    source?: "live" | "upload",
    metadata?: {
      teacherId?: string;
      subjectId?: string;
      topicIds?: string[];
      language?: string;
    }
  ) => Promise<Lecture>;
  startLiveLecture: (
    title: string,
    subject: string,
    instructor?: string,
    metadata?: {
      teacherId?: string;
      subjectId?: string;
      topicIds?: string[];
      language?: string;
    }
  ) => Promise<boolean>;
  pauseLiveLecture: () => void;
  resumeLiveLecture: () => void;
  stopLiveLecture: () => Promise<void>;
  processLearningPack: (lectureId: string) => Promise<void>;
  askLectureQuestion: (question: string) => Promise<RagResponse>;
  submitQuizAttempt: (answers: Record<string, string>) => Promise<{ attempt: QuizAttempt; weakTopics: WeakTopic[] }>;
  resetToSampleData: () => Promise<void>;
  deleteLecture: (id: string) => Promise<void>;
  updateLectureNotes: (notes: any[]) => Promise<void>;
}

const LectureContext = createContext<LectureContextType | undefined>(undefined);

export const LectureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [activeLecture, setActiveLecture] = useState<Lecture | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Map current URL pathname to active view
  const getActiveView = (pathname: string): ViewType => {
    if (pathname === "/home" || pathname === "/") return "landing";
    if (pathname === "/student-dashboard") return "student-dashboard";
    if (pathname === "/lectures" || pathname === "/library") return "library";
    if (pathname === "/live") return "live";
    if (pathname === "/processing") return "processing";
    if (pathname.startsWith("/workspace") || pathname === "/notes" || pathname === "/quizzes" || pathname === "/revision") {
      return "workspace";
    }
    return "landing";
  };

  const activeView = getActiveView(location.pathname);

  const setActiveView = (view: ViewType) => {
    switch (view) {
      case "landing":
        navigate("/home");
        break;
      case "student-dashboard":
        navigate("/student-dashboard");
        break;
      case "library":
        navigate("/lectures");
        break;
      case "live":
        navigate("/live");
        break;
      case "processing":
        navigate("/processing");
        break;
      case "workspace":
        navigate("/workspace");
        break;
      default:
        navigate("/home");
    }
  };

  const [liveSession, setLiveSession] = useState<LiveSessionState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    currentTopic: "Introduction",
    detectedConcepts: [],
    detectedDefinitions: [],
    detectedExamples: [],
    mediaStream: null,
    audioAnalyser: null,
    audioDataArray: null,
    errorMessage: null,
    hasMicrophoneConsent: false,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const currentUserIdRef = useRef<string | undefined>(user?.id);
  currentUserIdRef.current = user?.id;

  // Audio chunking and sequencing refs for reliable live transcription
  const chunkSequenceRef = useRef<number>(0);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingActiveRef = useRef<boolean>(false);
  const currentLectureIdRef = useRef<string | null>(null);
  const liveDurationRef = useRef<number>(0);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("learnix_token") || "";
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Fetch lectures on load or user change; cleanly isolate data on logout/login
  useEffect(() => {
    if (!user) {
      setLectures([]);
      setActiveLecture(null);
      setIsLoading(false);
      return;
    }

    // Immediately clear state from prior user to prevent stale flash
    setLectures([]);
    setActiveLecture(null);
    fetchLectures(user.id);
  }, [user?.id]);

  const fetchLectures = async (explicitUserId?: string) => {
    const targetUserId = explicitUserId || user?.id;
    if (!targetUserId) {
      setLectures([]);
      setActiveLecture(null);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/lectures", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        // Prevent race conditions if user switched while fetch was inflight
        if (currentUserIdRef.current !== targetUserId) {
          return;
        }

        const data: Lecture[] = await res.json();
        setLectures(data);

        const storageKey = `learnix_active_lecture_id_${targetUserId}`;
        const savedId = localStorage.getItem(storageKey);

        if (activeLecture && data.some((l) => l.id === activeLecture.id)) {
          const fresh = data.find((l) => l.id === activeLecture.id);
          if (fresh) setActiveLecture(fresh);
        } else if (savedId && data.some((l) => l.id === savedId)) {
          const saved = data.find((l) => l.id === savedId);
          if (saved) setActiveLecture(saved);
        } else if (data.length > 0) {
          setActiveLecture(data[0]);
          localStorage.setItem(storageKey, data[0].id);
        } else {
          setActiveLecture(null);
          localStorage.removeItem(storageKey);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch lectures:", err);
    } finally {
      if (currentUserIdRef.current === targetUserId) {
        setIsLoading(false);
      }
    }
  };

  const openLecture = async (lectureId: string, tab: WorkspaceTab = "overview") => {
    if (!user) return;
    try {
      const storageKey = `learnix_active_lecture_id_${user.id}`;
      localStorage.setItem(storageKey, lectureId);
      let target = lectures.find((l) => l.id === lectureId);
      if (!target) {
        const res = await fetch(`/api/lectures/${lectureId}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });
        if (res.ok) {
          target = await res.json();
        }
      }
      if (target) {
        setActiveLecture(target);
      }
      setWorkspaceTab(tab);
      if (target?.status === "processing") {
        navigate("/processing");
      } else if (tab === "notes") {
        navigate("/notes");
      } else if (tab === "quiz") {
        navigate("/quizzes");
      } else if (tab === "revision") {
        navigate("/revision");
      } else {
        navigate(`/workspace/${lectureId}`);
      }
    } catch (e) {
      console.error("Open lecture error:", e);
    }
  };

  const createNewLecture = async (
    title: string,
    subject: string,
    instructor = "Course Instructor",
    source: "live" | "upload" = "live",
    metadata?: {
      teacherId?: string;
      subjectId?: string;
      topicIds?: string[];
      language?: string;
    }
  ): Promise<Lecture> => {
    const res = await fetch("/api/lectures", {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({
        title,
        subject,
        instructor,
        source,
        teacherId: metadata?.teacherId,
        subjectId: metadata?.subjectId,
        topicIds: metadata?.topicIds,
        language: metadata?.language || "auto",
      }),
    });
    if (!res.ok) {
      throw new Error("Failed to create lecture");
    }
    const newL: Lecture = await res.json();
    setLectures((prev) => [newL, ...prev]);
    setActiveLecture(newL);
    if (user?.id) {
      localStorage.setItem(`learnix_active_lecture_id_${user.id}`, newL.id);
    }
    return newL;
  };

  // Flagship Live Lecture Audio & Transcription Engine
  const startLiveLecture = async (
    title: string,
    subject: string,
    instructor = "Course Instructor",
    metadata?: {
      teacherId?: string;
      subjectId?: string;
      topicIds?: string[];
      language?: string;
    }
  ): Promise<boolean> => {
    try {
      setLiveSession((prev) => ({ ...prev, errorMessage: null, hasMicrophoneConsent: true }));

      // 1. Request Microphone Access
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (micErr: any) {
        setLiveSession((prev) => ({
          ...prev,
          errorMessage: "Microphone permission was denied. Please allow microphone access in your browser to record live lectures.",
        }));
        return false;
      }

      // 2. Setup Web Audio API Analyzer for Live Waveform
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = audioCtx;

      // 3. Create or get active lecture on backend
      const lecture = await createNewLecture(title, subject, instructor, "live", metadata);
      await fetch(`/api/lectures/${lecture.id}/status`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ status: "recording", duration: 0 }),
      });

      // 4. Setup Live MediaRecorder with robust chunking (Single authoritative pipeline)
      try {
        chunkSequenceRef.current = 0;
        isRecordingActiveRef.current = true;
        currentLectureIdRef.current = lecture.id;
        liveDurationRef.current = 0;

        const CHUNK_INTERVAL_MS = 25000; // 25-second chunks
        let chunkStartTime = 0;

        const sendAudioChunk = (blob: Blob, seq: number, timestamp: number) => {
          if (!blob || blob.size < 1024 || !currentLectureIdRef.current) return;
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = (reader.result as string)?.split(",")[1];
            const lectureId = currentLectureIdRef.current;
            if (base64 && lectureId) {
              try {
                const res = await fetch(`/api/lectures/${lectureId}/transcribe-chunk`, {
                  method: "POST",
                  headers: getAuthHeaders(),
                  credentials: "include",
                  body: JSON.stringify({
                    audioBase64: base64,
                    mimeType: "audio/webm",
                    currentTimestamp: timestamp,
                    sequenceNumber: seq,
                    language: metadata?.language || "auto",
                  }),
                });
                const data = await res.json();
                if (data.newSegments && data.newSegments.length > 0) {
                  setActiveLecture((prev) => {
                    if (!prev || prev.id !== lectureId) return prev;
                    return {
                      ...prev,
                      duration: data.currentDuration || prev.duration,
                      transcript: [...prev.transcript, ...data.newSegments],
                    };
                  });

                  // Update live AI panel signals dynamically from new segments
                  const defs = data.newSegments.filter((s: any) => s.isDefinition).map((s: any) => s.text);
                  const imps = data.newSegments.filter((s: any) => s.isImportant || s.isKeyPoint).map((s: any) => s.text);
                  const exs = data.newSegments.filter((s: any) => s.isExample).map((s: any) => s.text);
                  const latestTopic = data.newSegments[data.newSegments.length - 1]?.topic;

                  setLiveSession((prev) => ({
                    ...prev,
                    currentTopic: latestTopic || prev.currentTopic,
                    detectedConcepts: Array.from(new Set([...imps, ...prev.detectedConcepts])).slice(0, 5),
                    detectedDefinitions: Array.from(new Set([...defs, ...prev.detectedDefinitions])).slice(0, 5),
                    detectedExamples: Array.from(new Set([...exs, ...prev.detectedExamples])).slice(0, 5),
                  }));
                }
              } catch (err) {
                console.warn("[TRANSCRIPTION] Failed to upload chunk to server:", err);
              }
            }
          };
          reader.readAsDataURL(blob);
        };

        const createRecorder = () => {
          if (!stream || !isRecordingActiveRef.current) return null;
          try {
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
              ? "audio/webm;codecs=opus"
              : MediaRecorder.isTypeSupported("audio/webm")
              ? "audio/webm"
              : "";
            const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            rec.ondataavailable = (e) => {
              if (e.data && e.data.size >= 1024) {
                sendAudioChunk(e.data, chunkSequenceRef.current++, chunkStartTime);
              }
            };
            return rec;
          } catch (e) {
            console.warn("Failed to create MediaRecorder:", e);
            return null;
          }
        };

        const rec = createRecorder();
        if (rec) {
          rec.start();
          mediaRecorderRef.current = rec;
        }

        // Periodically cycle the recorder to ensure every chunk has a valid standalone header
        if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = setInterval(() => {
          if (!isRecordingActiveRef.current) return;
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            try {
              mediaRecorderRef.current.stop();
            } catch {}
          }
          chunkStartTime = liveDurationRef.current;
          const nextRec = createRecorder();
          if (nextRec) {
            nextRec.start();
            mediaRecorderRef.current = nextRec;
          }
        }, CHUNK_INTERVAL_MS);
      } catch (e) {
        console.warn("MediaRecorder not supported or failed:", e);
      }

      // 5. Setup duration ticker
      let seconds = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        seconds += 1;
        liveDurationRef.current = seconds;
        setLiveSession((prev) => ({ ...prev, duration: seconds }));
      }, 1000);

      setLiveSession({
        isRecording: true,
        isPaused: false,
        duration: 0,
        currentTopic: `${subject} Introduction`,
        detectedConcepts: ["Initial Lecture Overview"],
        detectedDefinitions: [],
        detectedExamples: [],
        mediaStream: stream,
        audioAnalyser: analyser,
        audioDataArray: dataArray,
        errorMessage: null,
        hasMicrophoneConsent: true,
      });

      setActiveView("live");
      return true;
    } catch (err: any) {
      console.error("Live lecture error:", err);
      setLiveSession((prev) => ({
        ...prev,
        errorMessage: `Failed to initialize recording: ${err.message}`,
      }));
      return false;
    }
  };

  const handleNewLiveSegment = async (
    lectureId: string,
    text: string,
    startTime: number,
    endTime: number
  ) => {
    // Detect keywords for live AI panel
    const textLower = text.toLowerCase();
    let isDef = textLower.includes("is defined as") || textLower.includes("definition") || textLower.includes("means that");
    let isEx = textLower.includes("for example") || textLower.includes("for instance") || textLower.includes("think of");
    let isImp = textLower.includes("important") || textLower.includes("remember") || textLower.includes("note that");

    let detectedTopic = liveSession.currentTopic;
    if (textLower.includes("stack")) detectedTopic = "Stack Operations";
    if (textLower.includes("queue")) detectedTopic = "Queue Operations";
    if (textLower.includes("overflow")) detectedTopic = "Stack Overflow & Underflow";
    if (textLower.includes("complexity") || textLower.includes("o(1)")) detectedTopic = "Time Complexity Analysis";

    try {
      const res = await fetch(`/api/lectures/${lectureId}/append-transcript`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text,
          startTime,
          endTime,
          topic: detectedTopic,
          isImportant: isImp || isDef,
        }),
      });
      const data = await res.json();
      if (data.segment) {
        setActiveLecture((prev) => {
          if (!prev || prev.id !== lectureId) return prev;
          return {
            ...prev,
            duration: endTime,
            transcript: [...prev.transcript, data.segment],
          };
        });

        // Update live AI panel signals
        setLiveSession((prev) => ({
          ...prev,
          currentTopic: detectedTopic,
          detectedConcepts: isImp && !prev.detectedConcepts.includes(text) ? [text, ...prev.detectedConcepts].slice(0, 5) : prev.detectedConcepts,
          detectedDefinitions: isDef && !prev.detectedDefinitions.includes(text) ? [text, ...prev.detectedDefinitions].slice(0, 5) : prev.detectedDefinitions,
          detectedExamples: isEx && !prev.detectedExamples.includes(text) ? [text, ...prev.detectedExamples].slice(0, 5) : prev.detectedExamples,
        }));
      }
    } catch (e) {
      console.warn("Failed to append transcript to server:", e);
    }
  };

  const pauseLiveLecture = () => {
    isRecordingActiveRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    setLiveSession((prev) => ({ ...prev, isPaused: true }));
  };

  const resumeLiveLecture = () => {
    isRecordingActiveRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      liveDurationRef.current += 1;
      setLiveSession((prev) => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);

    if (liveSession.mediaStream && currentLectureIdRef.current) {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      try {
        const rec = mimeType
          ? new MediaRecorder(liveSession.mediaStream, { mimeType })
          : new MediaRecorder(liveSession.mediaStream);
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size >= 1024 && currentLectureIdRef.current) {
            const seq = chunkSequenceRef.current++;
            const timestamp = liveDurationRef.current;
            const reader = new FileReader();
            reader.onloadend = async () => {
              const base64 = (reader.result as string)?.split(",")[1];
              const lectureId = currentLectureIdRef.current;
              if (base64 && lectureId) {
                try {
                  await fetch(`/api/lectures/${lectureId}/transcribe-chunk`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    credentials: "include",
                    body: JSON.stringify({
                      audioBase64: base64,
                      mimeType: "audio/webm",
                      currentTimestamp: timestamp,
                      sequenceNumber: seq,
                    }),
                  });
                } catch {}
              }
            };
            reader.readAsDataURL(e.data);
          }
        };
        rec.start();
        mediaRecorderRef.current = rec;
      } catch {}
    }
    setLiveSession((prev) => ({ ...prev, isPaused: false }));
  };

  const stopLiveLecture = async () => {
    isRecordingActiveRef.current = false;
    // 1. Clear timers and stop chunking
    if (timerRef.current) clearInterval(timerRef.current);
    if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {}
    }
    if (liveSession.mediaStream) {
      liveSession.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
    }

    const currentDuration = liveSession.duration;
    setLiveSession((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
      mediaStream: null,
      audioAnalyser: null,
    }));

    if (activeLecture) {
      // Update status on server
      await fetch(`/api/lectures/${activeLecture.id}/status`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ status: "processing", duration: currentDuration }),
      });

      // Begin Learning Pack processing
      await processLearningPack(activeLecture.id);
    }
  };

  const processLearningPack = async (lectureId: string) => {
    setActiveView("processing");
    try {
      const res = await fetch(`/api/lectures/${lectureId}/process-learning-pack`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      const data = await res.json();
      if (data.lecture) {
        setActiveLecture(data.lecture);
      }

      // Poll until ready
      const interval = setInterval(async () => {
        try {
          const checkRes = await fetch(`/api/lectures/${lectureId}`, {
            headers: getAuthHeaders(),
            credentials: "include",
          });
          if (checkRes.ok) {
            const checkData: Lecture = await checkRes.json();
            setActiveLecture(checkData);
            if (checkData.status === "ready" || checkData.status === "failed") {
              clearInterval(interval);
              fetchLectures();
              if (checkData.status === "ready") {
                setActiveView("workspace");
                setWorkspaceTab("overview");
              }
            }
          }
        } catch (err) {
          clearInterval(interval);
        }
      }, 1500);
    } catch (err) {
      console.error("Process learning pack error:", err);
    }
  };

  const askLectureQuestion = async (question: string): Promise<RagResponse> => {
    if (!activeLecture) {
      throw new Error("No active lecture selected");
    }
    const res = await fetch(`/api/lectures/${activeLecture.id}/ask`, {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({ question }),
    });
    return await res.json();
  };

  const submitQuizAttempt = async (
    answers: Record<string, string>
  ): Promise<{ attempt: QuizAttempt; weakTopics: WeakTopic[] }> => {
    if (!activeLecture) {
      throw new Error("No active lecture");
    }
    const res = await fetch(`/api/lectures/${activeLecture.id}/quiz/attempt`, {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    if (data.attempt) {
      setActiveLecture((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          attempts: [...prev.attempts, data.attempt],
          weakTopics: data.weakTopics || prev.weakTopics,
        };
      });
      fetchLectures();
    }
    return data;
  };

  const resetToSampleData = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/lectures/reset-sample", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      await fetchLectures();
      openLecture("lecture-dsa-stack-queue", "overview");
    } catch (err) {
      console.error("Reset error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteLecture = async (id: string) => {
    try {
      await fetch(`/api/lectures/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      setLectures((prev) => prev.filter((l) => l.id !== id));
      if (activeLecture?.id === id) {
        setActiveLecture(null);
        if (user?.id) {
          localStorage.removeItem(`learnix_active_lecture_id_${user.id}`);
        }
        setActiveView("student-dashboard");
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const updateLectureNotes = async (notes: any[]) => {
    if (!activeLecture) return;
    try {
      const res = await fetch(`/api/lectures/${activeLecture.id}/notes`, {
        method: "PUT",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (data.lecture) {
        setActiveLecture(data.lecture);
      }
    } catch (err) {
      console.error("Update notes error:", err);
    }
  };

  return (
    <LectureContext.Provider
      value={{
        lectures,
        activeLecture,
        activeView,
        workspaceTab,
        liveSession,
        isLoading,
        searchQuery,
        setActiveView,
        setWorkspaceTab,
        setSearchQuery,
        openLecture,
        fetchLectures,
        createNewLecture,
        startLiveLecture,
        pauseLiveLecture,
        resumeLiveLecture,
        stopLiveLecture,
        processLearningPack,
        askLectureQuestion,
        submitQuizAttempt,
        resetToSampleData,
        deleteLecture,
        updateLectureNotes,
      }}
    >
      {children}
    </LectureContext.Provider>
  );
};

function mediaStreamActive(stream: MediaStream | null): boolean {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);
}

export function useLecture(): LectureContextType {
  const context = useContext(LectureContext);
  if (!context) {
    throw new Error("useLecture must be used within a LectureProvider");
  }
  return context;
}
