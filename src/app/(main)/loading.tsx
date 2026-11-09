import { Loader2 } from "lucide-react";

/**
 * Route-level loading skeleton.
 *
 * Next.js shows this immediately while the page chunk is being downloaded
 * or compiled (dev), instead of a blank white screen. The skeleton mirrors
 * the AppShell layout (top bar + sidebar space + content area) so the
 * transition feels seamless.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar placeholder */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-16 items-center border-b bg-card/80 px-4 backdrop-blur-md lg:px-6">
        <div className="h-5 w-5 rounded bg-muted" />
        <div className="ml-4 h-4 w-24 rounded bg-muted" />
        <div className="ml-auto flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-muted" />
        </div>
      </div>

      {/* Sidebar placeholder */}
      <div className="fixed left-0 top-0 z-20 hidden h-full w-64 border-r bg-card lg:block">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="h-8 w-8 rounded-lg bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
        </div>
        <div className="space-y-2 p-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex h-9 items-center gap-3 rounded-lg px-3"
            >
              <div className="h-4 w-4 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="pt-16 lg:pl-64">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
