export const NetworkServiceTypes = {
  Zynth: "_zynth._tcp.",
  LocalSend: "_localsend._tcp.",
} as const;

export const NetworkServiceDomains = {
  Local: "local.",
} as const;

export type BonjourTransport = "tcp" | "udp";

export function toBonjourServiceType(
  serviceName: string,
  transport: BonjourTransport = "tcp"
): string {
  const normalizedName = serviceName
    .trim()
    .toLowerCase()
    .replace(/^_+/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalizedName) {
    throw new Error("serviceName must contain at least one alphanumeric character");
  }

  return `_${normalizedName}._${transport}.`;
}
