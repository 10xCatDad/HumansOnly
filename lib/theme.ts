export type ThemePreference = "system" | "light" | "dark";
export const THEME_KEY = "writing-captcha-theme";

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch { /* Unsupported preferences default to dark. */ }
  return "dark";
}

// Run before paint, so a saved choice or system preference does not flash the
// default theme during hydration. Local storage is optional.
export const themeScript = `(function(){var p='system',t='dark';try{var s=localStorage.getItem('writing-captcha-theme');if(s==='light'||s==='dark')p=s}catch(e){}if(p!=='system')t=p;else try{if(matchMedia('(prefers-color-scheme: dark)').matches)t='dark';else if(matchMedia('(prefers-color-scheme: light)').matches)t='light'}catch(e){}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})();`;
