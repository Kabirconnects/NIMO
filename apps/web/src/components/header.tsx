import { Moon, Sun } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import Logo from "@workspace/ui/components/logo";
import { cn } from "@workspace/ui/lib/utils";
import { useTheme } from "next-themes";

export function Header({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header
      className={cn(
        " bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/60",
        className,
      )}
    >
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-2 text-foreground dark:text-foreground">
          <Logo className="text-foreground dark:text-foreground" />
          <span className="font-medium text-foreground">Nimo</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          >
            Sign in
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          >
            Get started
          </Button>
        </nav>
      </div>
    </header>
  );
}
