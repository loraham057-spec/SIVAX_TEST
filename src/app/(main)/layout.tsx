import { AppShell } from "@/components/layout/app-shell";
import { AssistantProvider } from "@/store/assistant-store";
import { AgentProvider } from "@/lib/agent/agent-provider";
import { AnalysisProvider } from "@/store/analysis-store";
import { ApprovalModal } from "@/components/agent/approval-modal";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AgentProvider>
      <AssistantProvider>
        <AnalysisProvider>
          <AppShell>{children}</AppShell>
          <ApprovalModal />
        </AnalysisProvider>
      </AssistantProvider>
    </AgentProvider>
  );
}
