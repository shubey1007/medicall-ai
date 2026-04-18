// dashboard/src/components/Docs/DocsSidebar.tsx
interface Section {
  id: string;
  title: string;
  group: string;
}

interface Props {
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function DocsSidebar({ sections, activeId, onSelect }: Props) {
  const groups: Record<string, Section[]> = {};
  for (const s of sections) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }

  return (
    <nav
      className="docs-sidebar"
      style={{ display: "flex", flexDirection: "column", gap: 18 }}
    >
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <div className="overline" style={{ padding: "0 8px", marginBottom: 6 }}>
            {group}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`nav-item ${activeId === s.id ? "active" : ""}`}
                style={{ height: 32, fontSize: "var(--text-xs)", padding: "0 10px" }}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
