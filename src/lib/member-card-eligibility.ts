type MemberCardEligibilityInput = {
  status: string;
  joinedYear: number | null;
  exitYear: number | null;
  reactivationPhotoRequired: boolean;
  profileCompletedAt: string | null;
  photoPath: string | null;
  reviewApproved: boolean;
  hasCurrentPeriod: boolean;
  periodEnd: string | null;
  hasCurrentEducation: boolean;
  hasPrintableQr: boolean;
  hasSignature: boolean;
  hasSeal: boolean;
};

export function getMemberCardBlockers(input: MemberCardEligibilityInput, today: string, currentYear: number) {
  const reasons: string[] = [];
  if (input.status !== "active") reasons.push("Membre non actif");
  if (input.reactivationPhotoRequired) reasons.push("Nouvelle photo après réactivation requise");
  if (input.joinedYear === null || input.exitYear === null || input.exitYear < currentYear) reasons.push("Année de fin de cycle absente ou dépassée");
  if (!input.profileCompletedAt) reasons.push("Profil incomplet");
  if (!input.photoPath) reasons.push("Photo manquante");
  if (!input.reviewApproved) reasons.push("Validation Super Admin manquante");
  if (!input.hasCurrentPeriod) reasons.push("Période d’adhésion actuelle manquante");
  else if (!input.periodEnd) reasons.push("Période d’adhésion à actualiser lors de la validation");
  else if (input.periodEnd !== `${input.exitYear}-12-31`) reasons.push("Période d’adhésion incohérente avec l’année de fin de cycle");
  else if (input.periodEnd < today) reasons.push("Période expirée");
  if (!input.hasCurrentEducation) reasons.push("Formation actuelle manquante");
  if (!input.hasPrintableQr) reasons.push("QR actif manquant");
  if (!input.hasSignature || !input.hasSeal) reasons.push("Signature ou cachet manquant");
  return reasons;
}

export function canIssueMemberQr(input: {
  status: string;
  exitYear: number | null;
  reactivationPhotoRequired: boolean;
  hasActiveQr: boolean;
}, currentYear: number) {
  return input.status === "active"
    && !input.reactivationPhotoRequired
    && input.exitYear !== null
    && input.exitYear >= currentYear
    && !input.hasActiveQr;
}
