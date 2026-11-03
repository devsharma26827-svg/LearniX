import { jsPDF } from "jspdf";
import { Lecture } from "../types";
import { APP_NAME, APP_CONFIG } from "../config/branding";
import { formatSecondsToTime } from "./formatters";

export interface ExportPdfOptions {
  includeSummary?: boolean;
  includeChapters?: boolean;
  includeNotes?: boolean;
  includeQuiz?: boolean;
  includeWeakTopics?: boolean;
}

export function generateLecturePdf(lecture: Lecture, options: ExportPdfOptions = {}): void {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const {
    includeSummary = true,
    includeChapters = true,
    includeNotes = true,
    includeQuiz = true,
    includeWeakTopics = true,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeaderFooter();
    }
  };

  const drawHeaderFooter = () => {
    // Top subtle bar
    doc.setFillColor(22, 138, 114); // #168A72 LearniX Brand Green
    doc.rect(margin, 8, contentWidth, 1.5, "F");

    // Footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(102, 115, 110);
    doc.text(`${APP_NAME} — ${APP_CONFIG.tagline}`, margin, pageHeight - 10);
    doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin - 15, pageHeight - 10);
  };

  // Header Banner
  doc.setFillColor(15, 107, 89); // #0F6B59 Dark Green
  doc.roundedRect(margin, y, contentWidth, 28, 3, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(APP_NAME.toUpperCase(), margin + 6, y + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(231, 246, 241); // Soft mint
  doc.text(APP_CONFIG.tagline, margin + 6, y + 16);

  doc.setTextColor(226, 232, 240);
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin + 6, y + 22);

  y += 36;

  // Lecture Metadata Card
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(lecture.title, margin + 5, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Subject: ${lecture.subject}   |   Instructor: ${lecture.instructor || "Course Instructor"}   |   Duration: ${formatSecondsToTime(lecture.duration)}`, margin + 5, y + 15);
  doc.text(`Recorded Date: ${lecture.date}   |   Status: ${lecture.status.toUpperCase()}   |   AI Notes: ${lecture.notes.length} Topics`, margin + 5, y + 20);

  y += 32;

  // Section 1: Executive Summary
  if (includeSummary) {
    checkPageBreak(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(22, 138, 114);
    doc.text("1. LECTURE OVERVIEW & OBJECTIVES", margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const summaryText = `This lecture explores fundamental theoretical and operational principles of ${lecture.title}. The session presents key definitions, constant time complexity boundaries, error prevention states (such as stack boundary conditions), and real-world system implementations.`;
    const splitSummary = doc.splitTextToSize(summaryText, contentWidth);
    doc.text(splitSummary, margin, y);
    y += splitSummary.length * 5 + 6;
  }

  // Section 2: Automatic Chapters
  if (includeChapters && lecture.chapters.length > 0) {
    checkPageBreak(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(67, 56, 202);
    doc.text("2. STRUCTURED CHAPTER TIMELINE", margin, y);
    y += 6;

    for (const ch of lecture.chapters) {
      checkPageBreak(18);
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, y, contentWidth, 14, 1.5, 1.5, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`[${formatSecondsToTime(ch.startTime)} - ${formatSecondsToTime(ch.endTime)}]  ${ch.title}`, margin + 4, y + 5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(ch.description, margin + 4, y + 10);
      y += 18;
    }
    y += 4;
  }

  // Section 3: Smart Notes
  if (includeNotes && lecture.notes.length > 0) {
    checkPageBreak(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(67, 56, 202);
    doc.text("3. SMART REVISION NOTES & DEFINITIONS", margin, y);
    y += 6;

    for (const note of lecture.notes) {
      checkPageBreak(35);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59);
      doc.text(`TOPIC: ${note.topic.toUpperCase()}`, margin, y);
      y += 5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const splitSummary = doc.splitTextToSize(note.summary, contentWidth);
      doc.text(splitSummary, margin, y);
      y += splitSummary.length * 4.5 + 3;

      // Definitions
      if (note.definitions && note.definitions.length > 0) {
        for (const def of note.definitions) {
          checkPageBreak(14);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(67, 56, 202);
          doc.text(`• Definition (${def.term}):`, margin + 3, y);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(51, 65, 85);
          const splitDef = doc.splitTextToSize(def.definition, contentWidth - 35);
          doc.text(splitDef, margin + 35, y);
          y += Math.max(splitDef.length * 4, 5);
        }
      }

      // Key concepts
      if (note.keyConcepts && note.keyConcepts.length > 0) {
        checkPageBreak(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.text("Key Concepts: " + note.keyConcepts.join(" • "), margin + 3, y);
        y += 5;
      }

      // Important Points
      if (note.importantPoints && note.importantPoints.length > 0) {
        checkPageBreak(12);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(180, 83, 9);
        doc.text("Important Point: " + note.importantPoints.join("; "), margin + 3, y);
        y += 6;
      }

      y += 4;
    }
  }

  // Section 4: Assessment Questions
  if (includeQuiz && lecture.quiz && lecture.quiz.questions.length > 0) {
    checkPageBreak(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(67, 56, 202);
    doc.text("4. LECTURE ASSESSMENT & PRACTICE QUESTIONS", margin, y);
    y += 6;

    lecture.quiz.questions.forEach((q, idx) => {
      checkPageBreak(25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      const splitQ = doc.splitTextToSize(`Q${idx + 1}. ${q.question} [${q.difficulty.toUpperCase()} | ${q.topic}]`, contentWidth);
      doc.text(splitQ, margin, y);
      y += splitQ.length * 4.5 + 2;

      if (q.options) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        for (const opt of q.options) {
          doc.text(`   • ${opt}`, margin + 3, y);
          y += 3.8;
        }
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(5, 150, 105);
      doc.text(`Correct Answer: ${q.correctAnswer}`, margin + 3, y);
      y += 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      const splitExp = doc.splitTextToSize(`Explanation: ${q.explanation} (Source: ${q.sourceChapter} @ ${formatSecondsToTime(q.sourceTimestamp)})`, contentWidth - 6);
      doc.text(splitExp, margin + 3, y);
      y += splitExp.length * 3.5 + 5;
    });
  }

  // Section 5: Weak Topic Detection & Revision Plan
  if (includeWeakTopics && lecture.weakTopics && lecture.weakTopics.length > 0) {
    checkPageBreak(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(225, 29, 72); // Rose 600
    doc.text("5. PERSONALIZED WEAK TOPIC DIAGNOSTICS & REVISION", margin, y);
    y += 6;

    for (const wt of lecture.weakTopics) {
      checkPageBreak(30);
      doc.setFillColor(255, 241, 242);
      doc.setDrawColor(254, 205, 211);
      doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(159, 18, 57);
      doc.text(`Weak Area Detected: ${wt.topicName} (Score: ${wt.accuracy}%)`, margin + 4, y + 6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(136, 19, 55);
      const splitExpl = doc.splitTextToSize(wt.explanation, contentWidth - 8);
      doc.text(splitExpl, margin + 4, y + 11);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(159, 18, 57);
      doc.text(`Action Plan: ${wt.recommendedAction}`, margin + 4, y + 20);

      y += 28;
    }
  }

  // Draw Header/Footer for all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawHeaderFooter();
  }

  // Save the PDF
  const filename = `${lecture.title.replace(/[^a-zA-Z0-9]/g, "_")}_${APP_NAME}_Learning_Pack.pdf`;
  doc.save(filename);
}
