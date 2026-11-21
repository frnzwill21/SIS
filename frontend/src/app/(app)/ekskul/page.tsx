'use client';
import { Row } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { useLoad, Status } from '@/components/useLoad';

export default function Ekskul() {
  const { data, error, loading } = useLoad<{ data: Row[] }>('/ekskul');
  return (
    <div className="space-y-4">
      <Status loading={loading} error={error} />
      {!loading && !error && data != null && <DataTable rows={data.data} />}
    </div>
  );
}
