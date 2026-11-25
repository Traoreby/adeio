export type MemberStatus = "active" | "former" | "suspended" | "deceased";

export const memberStatusLabels: Record<MemberStatus, string> = {
  active: "Actif",
  former: "Archivé",
  suspended: "Suspendu",
  deceased: "Décédé",
};

export function formatMemberName(member: { first_name: string; last_name: string }) {
  return `${member.first_name} ${member.last_name}`.trim();
}

export function normalizeMemberHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}
