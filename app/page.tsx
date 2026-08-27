import Console from '@/components/Console';
import { getSnapshot } from '@/lib/sources';

// The page itself is cheap to regenerate; the individual feeds carry their own
// cache windows, so this only reassembles what has actually expired.
// literal required by Next segment config; mirrors TTL.traffic
export const revalidate = 60;

export default async function Page() {
  const snapshot = await getSnapshot();
  return <Console initial={snapshot} />;
}
