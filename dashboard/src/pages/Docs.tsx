// dashboard/src/pages/Docs.tsx
import { useEffect, useState } from "react";
import { DocsSidebar } from "@/components/Docs/DocsSidebar";
import { MarkdownRenderer } from "@/components/Docs/MarkdownRenderer";

import overview from "@/content/docs/01-overview.md?raw";
import techStack from "@/content/docs/02-tech-stack.md?raw";
import architecture from "@/content/docs/03-architecture.md?raw";
import requestLifecycle from "@/content/docs/04-request-lifecycle.md?raw";
import vapiPath from "@/content/docs/05-vapi-path.md?raw";
import multiAgent from "@/content/docs/06-multi-agent-system.md?raw";
import dataModel from "@/content/docs/07-data-model.md?raw";
import servicesLayer from "@/content/docs/08-services-layer.md?raw";
import externalIntegrations from "@/content/docs/09-external-integrations.md?raw";
import vectorMemory from "@/content/docs/10-vector-memory.md?raw";
import postCallPipeline from "@/content/docs/11-post-call-pipeline.md?raw";
import realtimeDashboard from "@/content/docs/12-realtime-dashboard.md?raw";
import apiReference from "@/content/docs/13-api-reference.md?raw";
import configDeployment from "@/content/docs/14-configuration-deployment.md?raw";
import designDecisions from "@/content/docs/15-design-decisions.md?raw";
import debuggingStories from "@/content/docs/16-debugging-stories.md?raw";
import faqs from "@/content/docs/17-faqs.md?raw";
import interviewBasic from "@/content/docs/18-interview-basic.md?raw";
import interviewIntermediate from "@/content/docs/19-interview-intermediate.md?raw";
import interviewAdvanced from "@/content/docs/20-interview-advanced.md?raw";
import architectureQuestions from "@/content/docs/21-architecture-questions.md?raw";

interface DocSection {
  id: string;
  title: string;
  group: string;
  content: string;
}

const SECTIONS: DocSection[] = [
  { id: "overview", title: "Overview", group: "Getting Started", content: overview },
  { id: "tech-stack", title: "Tech Stack", group: "Getting Started", content: techStack },
  { id: "architecture", title: "Architecture", group: "Getting Started", content: architecture },
  { id: "request-lifecycle", title: "Request Lifecycle", group: "Core Flows", content: requestLifecycle },
  { id: "vapi-path", title: "Vapi Path", group: "Core Flows", content: vapiPath },
  { id: "multi-agent", title: "Multi-Agent System", group: "Core Flows", content: multiAgent },
  { id: "post-call", title: "Post-Call Pipeline", group: "Core Flows", content: postCallPipeline },
  { id: "realtime-dashboard", title: "Real-Time Dashboard", group: "Core Flows", content: realtimeDashboard },
  { id: "data-model", title: "Data Model", group: "Internals", content: dataModel },
  { id: "services", title: "Services Layer", group: "Internals", content: servicesLayer },
  { id: "integrations", title: "External Integrations", group: "Internals", content: externalIntegrations },
  { id: "vector-memory", title: "Vector Memory (Qdrant)", group: "Internals", content: vectorMemory },
  { id: "api-reference", title: "API Reference", group: "Internals", content: apiReference },
  { id: "config", title: "Configuration & Deployment", group: "Internals", content: configDeployment },
  { id: "design-decisions", title: "Design Decisions", group: "Reflections", content: designDecisions },
  { id: "debugging", title: "Debugging Stories", group: "Reflections", content: debuggingStories },
  { id: "faqs", title: "FAQs", group: "Interview Prep", content: faqs },
  { id: "interview-basic", title: "Interview Q&A — Basic", group: "Interview Prep", content: interviewBasic },
  { id: "interview-intermediate", title: "Interview Q&A — Intermediate", group: "Interview Prep", content: interviewIntermediate },
  { id: "interview-advanced", title: "Interview Q&A — Advanced", group: "Interview Prep", content: interviewAdvanced },
  { id: "architecture-questions", title: "Architecture Q&A", group: "Interview Prep", content: architectureQuestions },
];

export default function Docs() {
  const [activeId, setActiveId] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return SECTIONS.find((s) => s.id === hash)?.id ?? SECTIONS[0].id;
  });

  useEffect(() => {
    window.history.replaceState(null, "", `#${activeId}`);
    const main = document.querySelector(".main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeId]);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Documentation</h1>
          <div className="page-sub">Deep dive into MediCall AI architecture and design</div>
        </div>
      </div>
      <div className="docs-layout">
        <DocsSidebar
          sections={SECTIONS.map(({ id, title, group }) => ({ id, title, group }))}
          activeId={activeId}
          onSelect={setActiveId}
        />
        <div className="card" style={{ padding: 28, minWidth: 0 }}>
          <MarkdownRenderer content={active.content} />
        </div>
      </div>
    </div>
  );
}
