"use client";
import { useEffect, useState } from "react";
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => { const update = () => { const total = document.documentElement.scrollHeight - innerHeight; setProgress(total > 0 ? Math.min(100, scrollY / total * 100) : 100); }; update(); addEventListener("scroll", update, { passive: true }); addEventListener("resize", update); return () => { removeEventListener("scroll", update); removeEventListener("resize", update); }; }, []);
  return <div className="reading-progress" style={{ width: `${progress}%` }} aria-hidden />;
}
