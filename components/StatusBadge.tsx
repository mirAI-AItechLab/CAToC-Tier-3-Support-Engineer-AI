import { CaseStatus } from '@/types/api';

interface Props {
  status: CaseStatus;
  compact?: boolean;
}

export default function StatusBadge({ status, compact }: Props) {
  const base = compact
    ? 'px-2 py-0.5 text-xs'
    : 'px-3 py-1 text-sm';

  const getColor = (s: CaseStatus) => {
    switch (s) {
      case 'NEW':
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'ANALYZING':
        return 'bg-amber-100 text-amber-900 border-amber-200 animate-pulse';
      case 'PROPOSED':
        return 'bg-violet-100 text-violet-900 border-violet-200';
      case 'WAITING_CUSTOMER':
        return 'bg-yellow-100 text-yellow-900 border-yellow-200';
      case 'WAITING_INTERNAL':
        return 'bg-orange-100 text-orange-900 border-orange-200';
      case 'VALIDATING':
        return 'bg-blue-100 text-blue-900 border-blue-200';
      case 'CLOSING':
        return 'bg-indigo-100 text-indigo-900 border-indigo-200';
      case 'CLOSED':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border font-semibold',
        base,
        getColor(status),
      ].join(' ')}
      title={status}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {status}
    </span>
  );
}
