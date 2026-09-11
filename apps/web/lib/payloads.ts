export const CREDENTIAL_CATEGORIES = ["repository_token", "cloud_credentials", "database"] as const;

export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

export function simulatePayload(input: {
  packageId: string;
  ciInstall: boolean;
  lifecycleScripts: boolean;
  categories: CredentialCategory[];
}) {
  return {
    package_id: input.packageId,
    ci_install: input.ciInstall,
    lifecycle_scripts_enabled: input.lifecycleScripts,
    credential_categories: input.categories,
  };
}

export function remediationPayload(maxChanges: number) {
  if (!Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 100) {
    throw new Error("max_changes must be an integer from 1 to 100");
  }
  return { max_changes: maxChanges };
}
