import { X_LOGO_PATH } from "@/lib/brand";
export function XIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={X_LOGO_PATH} /></svg>;
}
