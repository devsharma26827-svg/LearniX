import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "button" | "pill";
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className = "",
  showLabel = false,
  size = "md",
  variant = "button",
}) => {
  const { isDark, toggleTheme } = useTheme();

  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-4.5 h-4.5",
  };

  const buttonPadding = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-2.5",
  };

  const currentLabel = isDark
    ? "Switch to light-first theme"
    : "Switch to dark theme";

  const iconContent = (
    <AnimatePresence mode="wait" initial={false}>
      {isDark ? (
        <motion.span
          key="sun"
          initial={{ rotate: -35, opacity: 0, scale: 0.85 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 35, opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex items-center justify-center"
        >
          <Sun className={`${iconSizes[size]} text-[#E5984A]`} />
        </motion.span>
      ) : (
        <motion.span
          key="moon"
          initial={{ rotate: 35, opacity: 0, scale: 0.85 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: -35, opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex items-center justify-center"
        >
          <Moon className={`${iconSizes[size]} text-[#168A72]`} />
        </motion.span>
      )}
    </AnimatePresence>
  );

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={currentLabel}
        title={currentLabel}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.97] transition-all duration-150 shadow-xs cursor-pointer select-none ${className}`}
      >
        <div className="relative flex items-center justify-center">
          {iconContent}
        </div>
        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={currentLabel}
      title={currentLabel}
      className={`rounded-xl text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-transparent hover:border-[#E4EAE7] dark:hover:border-[#2C3B36] active:scale-[0.95] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168A72] flex items-center gap-2 select-none cursor-pointer ${buttonPadding[size]} ${className}`}
    >
      <div className="relative flex items-center justify-center">
        {iconContent}
      </div>

      {showLabel && (
        <span className="text-xs font-semibold">
          {isDark ? "Light Mode" : "Dark Mode"}
        </span>
      )}
    </button>
  );
};
