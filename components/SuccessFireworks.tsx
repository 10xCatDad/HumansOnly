"use client";
import { useEffect, useState, type CSSProperties } from "react";

const bursts = [
  { left: "22%", top: "27%", delay: 0, color: "#54ff81" },
  { left: "76%", top: "22%", delay: 180, color: "#59d9ff" },
  { left: "50%", top: "16%", delay: 360, color: "#d9ff89" },
];
export function SuccessFireworks() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="success-fireworks" aria-hidden="true">{bursts.map((burst, index) => <span className="firework-burst" key={index} style={{ left: burst.left, top: burst.top }}>{Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6, distance = i % 2 ? 48 : 66;
    return <i key={i} style={{ "--spark-x": `${Math.cos(angle) * distance}px`, "--spark-y": `${Math.sin(angle) * distance}px`, "--spark-color": burst.color, animationDelay: `${burst.delay}ms` } as CSSProperties} />;
  })}</span>)}</div>;
}
