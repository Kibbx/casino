import { PageWrapper, SubHeader, CardGrid } from "./shared";

const staff = [
  { id: 1, name: "Marcus DeLeon",  role: "Casino Director",    dept: "Management",  status: "Online",  initials: "MD", color: "#f5c518" },
  { id: 2, name: "Vera Nakashima", role: "Head of Security",   dept: "Security",    status: "Online",  initials: "VN", color: "#ef4444" },
  { id: 3, name: "Tony Ashford",   role: "Poker Room Manager", dept: "Gaming",      status: "On Duty", initials: "TA", color: "#22c55e" },
  { id: 4, name: "Simone Ortega",  role: "Events Coordinator", dept: "Events",      status: "Online",  initials: "SO", color: "#ec4899" },
  { id: 5, name: "Raj Patel",      role: "Lead Developer",     dept: "Tech",        status: "On Duty", initials: "RP", color: "#06b6d4" },
  { id: 6, name: "Dana Wu",        role: "Customer Support",   dept: "Support",     status: "Online",  initials: "DW", color: "#a855f7" },
  { id: 7, name: "Leo Strand",     role: "Table Supervisor",   dept: "Gaming",      status: "Off Duty", initials: "LS", color: "#f97316" },
  { id: 8, name: "Anika Ross",     role: "Finance Manager",    dept: "Finance",     status: "Online",  initials: "AR", color: "#fbbf24" },
];

const deptColors: Record<string, string> = {
  Management: "#f5c518", Security: "#ef4444", Gaming: "#22c55e",
  Events: "#ec4899", Tech: "#06b6d4", Support: "#a855f7",
  Finance: "#fbbf24",
};

const statusColors: Record<string, string> = {
  Online: "#22c55e", "On Duty": "#06b6d4", "Off Duty": "#4b5563",
};

function StaffCard({ s }: { s: typeof staff[0] }) {
  const sc = statusColors[s.status];
  const dc = deptColors[s.dept];
  return (
    <div
      className="rounded-2xl px-5 py-5 flex flex-col gap-4"
      style={{ background: "#0c0a0a", border: `1px solid ${s.color}22`, width: 230, minWidth: 210, flexShrink: 0 }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-base font-black shrink-0"
          style={{
            background: `${s.color}18`,
            border: `2px solid ${s.color}44`,
            color: s.color,
          }}
        >
          {s.initials}
        </div>
        <div>
          <h3 className="font-rajdhani font-black text-sm text-white leading-tight">{s.name}</h3>
          <p className="text-[11px] leading-tight mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{s.role}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full"
          style={{ color: dc, background: `${dc}18`, border: `1px solid ${dc}33` }}
        >
          {s.dept}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: sc, boxShadow: `0 0 5px ${sc}` }} />
          <span className="text-[10px] font-semibold" style={{ color: sc }}>{s.status}</span>
        </div>
      </div>
    </div>
  );
}

export function StaffPage() {
  const online = staff.filter(s => s.status !== "Off Duty");
  const offline = staff.filter(s => s.status === "Off Duty");

  return (
    <PageWrapper title="Staff" breadcrumb="Account / Staff" accentColor="#f5c518">
      <SubHeader label={`On Duty (${online.length})`} />
      <CardGrid minItemWidth={210} maxItemWidth={250} gap={16} className="mb-10">
        {online.map((s) => <StaffCard key={s.id} s={s} />)}
      </CardGrid>

      {offline.length > 0 && (
        <>
          <SubHeader label="Off Duty" />
          <CardGrid minItemWidth={210} maxItemWidth={250} gap={16}>
            {offline.map((s) => <StaffCard key={s.id} s={s} />)}
          </CardGrid>
        </>
      )}
    </PageWrapper>
  );
}
