"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { useHeroFxStore } from "~/lib/hero-fx-store";
import { cn } from "~/lib/utils";

export function HeroStage(props: { children: ReactNode; footer?: ReactNode; scene?: string }) {
  const reduce = useReducedMotion();
  const scene = props.scene ?? "hero";

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden outline-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-36 bg-gradient-to-t from-multi-chat via-multi-chat/78 to-transparent" />

      <motion.div
        key={scene}
        initial={reduce ? { opacity: 0 } : { y: "100%", opacity: 0.2 }}
        animate={reduce ? { opacity: 0.18 } : { y: "30%", opacity: 0 }}
        transition={
          reduce
            ? { duration: 0.3, ease: "easeOut" }
            : { type: "spring", stiffness: 100, damping: 20 }
        }
        className="pointer-events-none absolute bottom-0 left-1/2 z-[1] flex h-[100vh] w-full max-w-3xl -translate-x-1/2"
        style={{ willChange: reduce ? "opacity" : "transform, opacity" }}
      >
        <Grad className="w-full" />
        <Grad className="w-full -translate-y-20" />
        <Grad className="w-full" />
      </motion.div>

      <div className="relative z-10 flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center px-6 py-12 outline-hidden">
        <div className="relative w-full max-w-[720px]">
          <HeroBurst />
          <div className="relative mx-auto flex w-full max-w-[640px] flex-col items-start gap-2 px-4 pt-2 pb-8">
            {props.children}
            {props.footer}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroBurst() {
  const reduce = useReducedMotion();
  const shot = useHeroFxStore((state) => state.shot);
  const clear = useHeroFxStore((state) => state.clear);

  useEffect(() => {
    if (!shot) return;
    const sid = shot.id;
    const id = window.setTimeout(() => clear(sid), reduce ? 700 : 1180);
    return () => {
      window.clearTimeout(id);
      clear(sid);
    };
  }, [clear, reduce, shot]);

  return (
    <AnimatePresence initial={false}>
      {shot ? (
        <motion.div
          key={shot.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.18 : 0.22, ease: "easeOut" }}
          className="pointer-events-none absolute inset-x-0 -top-12 bottom-0 overflow-hidden"
        >
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <div className="relative h-[320px] w-full max-w-3xl">
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.96 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.98 }}
                transition={
                  reduce ? { duration: 0.16 } : { duration: 0.24, type: "spring", bounce: 0.3 }
                }
                className="absolute right-8 bottom-24 max-w-[260px] rounded-[18px_18px_8px_18px] border border-white/55 bg-white/88 px-4 py-2.5 text-sm text-black shadow-[0_18px_48px_-18px_rgba(0,0,0,0.35)] backdrop-blur-xl"
                style={{ willChange: "transform, opacity" }}
              >
                <p className="max-h-20 overflow-hidden break-words">{shot.text}</p>
              </motion.div>
              <motion.div
                initial={reduce ? { opacity: 0 } : { y: "40%", opacity: 0.22 }}
                animate={reduce ? { opacity: 0.24 } : { y: "-6%", opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={
                  reduce
                    ? { duration: 0.4, ease: "easeOut" }
                    : { type: "spring", stiffness: 110, damping: 20 }
                }
                className="absolute inset-x-0 bottom-0 flex h-[320px] items-end justify-center"
                style={{ willChange: "transform, opacity" }}
              >
                <Grad className="w-full" />
                <Grad className="w-full -translate-y-20" />
                <Grad className="w-full" />
              </motion.div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Grad(props: { className?: string }) {
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full blur-3xl",
        "bg-[linear-gradient(180deg,#FC2BA3_0%,#F44FA3_6%,#FC6D35_18%,#FD8F4A_28%,#F9C83D_40%,#E8D8A8_50%,#BFD4E6_62%,#7BA6E8_78%,#144EC5_92%,#103D9E_100%)]",
        props.className,
      )}
    />
  );
}
