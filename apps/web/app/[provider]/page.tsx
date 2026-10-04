import { permanentRedirect } from "next/navigation";

/**
 * The first URL scheme was /<provider>. M2 moved API pages to /apis/<api>, and
 * links already shared must keep working: 308 to the new address.
 */
export default async function LegacyProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  permanentRedirect(`/apis/${encodeURIComponent(provider)}`);
}
