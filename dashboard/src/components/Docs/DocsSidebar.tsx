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
    <nav className="sticky top-6 w-64 flex-shrink-0 space-y-5 max-h-[calc(100vh-3rem)] overflow-y-auto pr-3">
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <div className="text-xs font-semibold uppercase text-slate-400 mb-2 px-2">
            {group}
          </div>
          <ul className="space-y-0.5">
            {items.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                    activeId === s.id
                      ? "bg-blue-100 text-blue-700 font-medium"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
