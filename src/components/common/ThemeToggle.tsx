import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2233] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${className}`}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
