import React, { useState, useEffect } from "react";
import { Cpu, RefreshCw, Zap, ShieldCheck, Database, Clock } from "lucide-react";
import { AiUsageReport } from "../../types";
import { apiFetch } from "../../services/apiClient";

export const AiQuotaWidget: React.FC = () => {
  const [report, setReport] = useState<AiUsageReport | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUsage = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/system/ai-usage");
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      }
    } catch (e) {
      console.warn("Failed to fetch AI usage stats", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!report) return null;

  const textModel = report.models["gemini-3.7-flash"] || Object.values(report.models)[0];
  const transcribeModel = report.models["gemini-3.5-transcribe"];
  const circuitBreaker = report.circuitBreakerActive;

  return (
    <div className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl shadow-xs space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#E7F6F1] dark:bg-[#1E3730] text-[#168A72] dark:text-[#23A98D] flex items-center justify-center">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
              AI Orchestrator & Quota Status
            </h3>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Centralized Gemini resource management & resilient local fallbacks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1.5 ${
              circuitBreaker
                ? "bg-[#FEF6EE] dark:bg-[#3D2817] text-[#D97706] dark:text-[#FBBF24]"
                : "bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                circuitBreaker ? "bg-[#D97706] animate-pulse" : "bg-[#168A72]"
              }`}
            />
            {circuitBreaker ? "Local Fallback Active" : "Gemini Connected"}
          </span>

          <button
            onClick={fetchUsage}
            disabled={loading}
            title="Refresh usage statistics"
            className="p-1 rounded-lg text-[#66736E] dark:text-[#9BA4A0] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Text Intelligence Model Quota */}
        {textModel && (
          <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#202B27] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[120px]">
                {textModel.name}
              </span>
              <span className="font-mono text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                {textModel.rpmCurrent}/{textModel.rpmLimit} RPM
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                <span>Daily Quota</span>
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
                  {textModel.rpdUsed} / {textModel.rpdLimit} RPD
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#E4EAE7] dark:bg-[#2C3B36] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    textModel.rpdUsed >= textModel.rpdLimit
                      ? "bg-[#E07A5F]"
                      : textModel.rpdUsed / textModel.rpdLimit > 0.75
                      ? "bg-[#D97706]"
                      : "bg-[#168A72]"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((textModel.rpdUsed / textModel.rpdLimit) * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-[#66736E] dark:text-[#9BA4A0] pt-0.5">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Reset in {Math.round(textModel.secondsUntilReset / 3600)}h
              </span>
              <span className="font-medium text-[#168A72] dark:text-[#23A98D]">
                {textModel.rpdRemaining} remaining
              </span>
            </div>
          </div>
        )}

        {/* Card 2: Audio Transcription Model Quota */}
        {transcribeModel && (
          <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#202B27] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[120px]">
                {transcribeModel.name}
              </span>
              <span className="font-mono text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                {transcribeModel.rpmCurrent}/{transcribeModel.rpmLimit} RPM
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                <span>Daily Chunks</span>
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
                  {transcribeModel.rpdUsed} / {transcribeModel.rpdLimit}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#E4EAE7] dark:bg-[#2C3B36] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#168A72] transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((transcribeModel.rpdUsed / transcribeModel.rpdLimit) * 100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-[#66736E] dark:text-[#9BA4A0] pt-0.5">
              <span>Sequenced queue</span>
              <span className="text-[#0F6B59] dark:text-[#23A98D] font-medium">Ready</span>
            </div>
          </div>
        )}

        {/* Card 3: Optimization & Fallback Performance */}
        <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#202B27] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#17201D] dark:text-[#F1FAF7]">
              Quota Optimization
            </span>
            <ShieldCheck className="w-3.5 h-3.5 text-[#168A72]" />
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="p-1.5 rounded-lg bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36]">
              <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] block">Cached Hits</span>
              <span className="text-xs font-semibold text-[#168A72] dark:text-[#23A98D] tabular-nums">
                {report.metrics.totalCachedRequests}
              </span>
            </div>
            <div className="p-1.5 rounded-lg bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36]">
              <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] block">Local Fallbacks</span>
              <span className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
                {report.metrics.totalFallbackRequests}
              </span>
            </div>
          </div>

          <p className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] flex items-center justify-between">
            <span>Deduplication & zero fake text</span>
            <span className="font-mono text-[#168A72] dark:text-[#23A98D]">Protected</span>
          </p>
        </div>
      </div>
    </div>
  );
};
