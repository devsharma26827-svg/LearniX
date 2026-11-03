import type { Variants, Transition } from "motion/react";

export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const FAST_TRANSITION: Transition = {
  duration: 0.22,
  ease: EASE_OUT_EXPO,
};

export const PAGE_CONTAINER_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: EASE_OUT_EXPO,
      staggerChildren: 0.055,
      delayChildren: 0.02,
    },
  },
};

export const SECTION_ITEM_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: EASE_OUT_EXPO,
    },
  },
};

export const STAGGER_GRID_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
    },
  },
};

export const CARD_ITEM_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 6,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: EASE_OUT_EXPO,
    },
  },
};

export const MODAL_BACKDROP_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: "easeIn" } },
};

export const MODAL_PANEL_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.22, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 6,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

export const DROPDOWN_MENU_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.16, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: -4,
    transition: { duration: 0.12, ease: "easeIn" },
  },
};
